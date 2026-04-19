"""Workspace loading, ref resolution, and flow execution.

`load_workspace(package_name)` is the main entry point. Called from a
workspace package's `__init__.py` with `__name__`. It walks the
workspace for `flow.json` files, eagerly imports every referenced
Python callable, runs structural validation, and returns a `Workspace`
whose `.flow(flow_id)` method hands you a plain callable.

The intended usage pattern is:

    # my_workspace/__init__.py
    from dagsmith import load_workspace
    _workspace = load_workspace(__name__)
    hello = _workspace.flow("hello")

External code then just does `from my_workspace import hello` and calls
it like any Python function.

Permissive posture (SPEC §3): semantic violations surface as diagnostics
on `Workspace.diagnostics`, not exceptions at load time. Broken refs
resolve to `UnresolvableRef` sentinels; broken flow.json becomes a
`_BrokenFlow` sentinel that raises only when invoked.
"""

from __future__ import annotations

import importlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

from collections import deque

from .diagnostics import Diagnostic, SourceLocation, UnresolvableRef
from .model import DEFAULT_EXIT_NAME, FlowSpec
from .runtime import (
    FlowResult,
    MultiplePublicExitsReached,
    _resolve_node_result,
)

_SKIPPED_DIR_NAMES = frozenset({"__pycache__"})


class WorkspaceError(ValueError):
    """Raised when workspace loading or validation fails."""


@dataclass(frozen=True)
class _LoadedFlow:
    """A FlowSpec plus its eagerly resolved callables, ready to execute.

    `public_exits` is derived at load time from unconnected source handles
    (SPEC §12 line 425, Infer model). It's kept on `_LoadedFlow` rather than
    `FlowSpec` because it's computed, not stored in flow.json.
    """

    spec: FlowSpec
    callables: Mapping[str, Callable[..., Any] | UnresolvableRef]
    selectors: Mapping[str, Callable[..., Any] | UnresolvableRef]
    public_exits: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class _BrokenFlow:
    """A flow whose JSON was malformed or whose FlowSpec failed validation.

    Stored in `Workspace._flows` alongside `_LoadedFlow` so other flows keep
    loading and the broken id still appears in `flow_ids`. Invoking
    `workspace.flow(broken_id)(...)` raises with the diagnostic message.
    """

    flow_id: str
    diagnostic: Diagnostic


@dataclass(frozen=True)
class Workspace:
    """A loaded DAGsmith workspace.

    Use `workspace.flow(flow_id)` to get a callable for a named flow.
    Calling that callable with an input value runs the flow and returns
    a `FlowResult`.
    """

    root: Path
    package_name: str
    _flows: Mapping[str, _LoadedFlow | _BrokenFlow]
    diagnostics: list[Diagnostic] = field(default_factory=list)

    @property
    def flow_ids(self) -> list[str]:
        """Sorted list of flow IDs discovered in this workspace."""
        return sorted(self._flows.keys())

    def _require_loaded(self, flow_id: str) -> _LoadedFlow:
        entry = self._flows.get(flow_id)
        if entry is None:
            raise WorkspaceError(f"unknown flow: {flow_id!r}")
        if isinstance(entry, _BrokenFlow):
            raise WorkspaceError(
                f"flow {flow_id!r} failed to load: {entry.diagnostic.message}"
            )
        return entry

    def flow_spec(self, flow_id: str) -> "FlowSpec":
        """Return the FlowSpec for a named flow (advanced introspection)."""
        return self._require_loaded(flow_id).spec

    def public_exits(self, flow_id: str) -> Mapping[str, str]:
        """Return the inferred public exits (name -> type) for a named flow."""
        return self._require_loaded(flow_id).public_exits

    def node_callable(
        self, flow_id: str, node_name: str
    ) -> Callable[..., Any] | UnresolvableRef:
        """Return the resolved callable for a specific node (for source inspection)."""
        loaded = self._require_loaded(flow_id)
        if node_name not in loaded.callables:
            raise WorkspaceError(
                f"unknown node {node_name!r} in flow {flow_id!r}"
            )
        return loaded.callables[node_name]

    def flow(self, flow_id: str) -> Callable[[Any], FlowResult]:
        """Return a callable that runs the named flow."""
        if flow_id not in self._flows:
            known = sorted(self._flows.keys())
            raise WorkspaceError(
                f"unknown flow: {flow_id!r} (known: {known})"
            )

        def _run(value: Any, *, tracer: Callable[..., None] | None = None) -> FlowResult:
            return self._run(flow_id, value, tracer=tracer)

        _run.__name__ = flow_id.replace(".", "_")
        _run.__qualname__ = f"{self.package_name}.{flow_id}"
        _run.__doc__ = (
            f"Run the {flow_id!r} flow from workspace {self.package_name!r}."
        )
        return _run

    def _run(
        self,
        flow_id: str,
        value: Any,
        *,
        tracer: Callable[..., None] | None = None,
    ) -> FlowResult:
        loaded = self._require_loaded(flow_id)
        spec = loaded.spec

        # Also diagnosed at load (missing_start_node / ambiguous_start_node);
        # this is the invoke-time trap. entry_node is a computed property that
        # returns "" when zero or >1 start nodes exist.
        if not spec.entry_node:
            raise WorkspaceError(
                f"flow {flow_id!r} has no unique start node; cannot invoke"
            )
        if spec.entry_node not in spec.nodes:
            raise WorkspaceError(
                f"entry_node {spec.entry_node!r} is not declared in flow {flow_id!r}"
            )

        queue: deque[tuple[str, Any]] = deque([(spec.entry_node, value)])
        visited: dict[str, Any] = {}
        reached_exits: list[tuple[str, Any]] = []

        while queue:
            node_id, payload = queue.popleft()
            if node_id in visited:
                continue

            if node_id not in spec.nodes:
                raise WorkspaceError(
                    f"edge target {node_id!r} not declared in flow {flow_id!r}"
                )
            node_spec = spec.nodes[node_id]

            if node_spec.kind == "start":
                # SPEC §12 line 427: start is a virtual entry sentinel. No
                # ref, no callable — just pass the input payload straight
                # through the implicit "out" handle.
                exit_name = DEFAULT_EXIT_NAME
                new_value = payload
                visited[node_id] = new_value
            elif node_spec.kind == "flow":
                subflow_id = node_spec.ref
                if subflow_id not in self._flows:
                    raise WorkspaceError(
                        f"unresolved subflow ref {subflow_id!r} on node "
                        f"{node_id!r} in flow {flow_id!r}"
                    )
                sub_result = self._run(subflow_id, payload, tracer=tracer)
                exit_name = sub_result.exit
                new_value = sub_result.value
                visited[node_id] = new_value
            else:
                func = loaded.callables[node_id]
                selector = loaded.selectors.get(node_id)
                raw = func(payload)
                exit_name, new_value = _resolve_node_result(
                    raw,
                    DEFAULT_EXIT_NAME,
                    selector,
                    flow_id=flow_id,
                    node_id=node_id,
                    exits=node_spec.exits,
                )
                visited[node_id] = new_value

            matching = [
                edge
                for edge in spec.edges
                if edge.from_node == node_id and edge.from_exit == exit_name
            ]

            # Infer model (SPEC §12 line 425): an unconnected source handle
            # is a public exit. If the exit the node chose has no outgoing
            # edge, the flow terminates here with public exit name = the
            # exit name itself (merge-by-name happens at derivation time).
            if not matching:
                if tracer is not None:
                    tracer(flow_id, node_id, exit_name, exit_name, new_value)
                reached_exits.append((exit_name, new_value))
                continue

            for edge in matching:
                if tracer is not None:
                    tracer(flow_id, node_id, exit_name, edge.to_node, new_value)
                queue.append((edge.to_node, new_value))

        if not reached_exits:
            raise WorkspaceError(
                f"flow {flow_id!r} terminated without reaching any public exit"
            )

        distinct_exit_names = {name for name, _ in reached_exits}
        if len(distinct_exit_names) > 1:
            raise MultiplePublicExitsReached(
                flow_id=flow_id,
                exits_reached=[name for name, _ in reached_exits],
            )

        exit_name, exit_value = reached_exits[0]
        return FlowResult(exit=exit_name, value=exit_value)


def load_workspace(package_name: str) -> Workspace:
    """Load a DAGsmith workspace.

    Called from a workspace package's `__init__.py` with `__name__` as
    the argument. Returns a `Workspace` whose `flow(id)` method gives
    you a callable for each discovered flow.

    All referenced Python callables are imported eagerly at load time —
    flow execution has no import machinery in its hot path. Import and
    ref failures are captured as `UnresolvableRef` sentinels, and broken
    flow.json files become `_BrokenFlow` sentinels; both surface as
    diagnostics on the returned `Workspace`.
    """
    module = sys.modules.get(package_name)
    if module is None:
        raise WorkspaceError(
            f"package {package_name!r} is not loaded; "
            f"call load_workspace(__name__) from inside the workspace's __init__.py"
        )
    module_file = getattr(module, "__file__", None)
    if module_file is None:
        raise WorkspaceError(
            f"package {package_name!r} has no __file__ "
            f"(namespace packages without an __init__.py are not supported)"
        )

    root = Path(module_file).parent.resolve()

    manifest = root / "dagsmith.json"
    if not manifest.is_file():
        raise WorkspaceError(
            f"no dagsmith.json found at {manifest}; "
            f"expected a workspace root"
        )

    flows: dict[str, _LoadedFlow | _BrokenFlow] = {}
    diagnostics: list[Diagnostic] = []

    for flow_json_path in sorted(root.rglob("flow.json")):
        rel = flow_json_path.parent.relative_to(root)
        if _is_skipped(rel):
            continue
        if rel == Path("."):
            raise WorkspaceError(
                f"flow.json at workspace root is not allowed "
                f"(found at {flow_json_path})"
            )
        flow_id = ".".join(rel.parts)
        flow_package = f"{package_name}.{flow_id}"

        try:
            raw = _load_json(flow_json_path)
        except WorkspaceError as exc:
            diag = Diagnostic(
                severity="error",
                code="malformed_flow_json",
                message=str(exc),
                flow_id=flow_id,
                source_location=SourceLocation(path=str(flow_json_path)),
            )
            diagnostics.append(diag)
            flows[flow_id] = _BrokenFlow(flow_id=flow_id, diagnostic=diag)
            continue

        raw.setdefault("id", flow_id)

        try:
            spec = FlowSpec.model_validate(raw)
        except Exception as exc:
            diag = Diagnostic(
                severity="error",
                code="invalid_flow_spec",
                message=(
                    f"flow.json in {flow_json_path} failed schema validation: {exc}"
                ),
                flow_id=flow_id,
                source_location=SourceLocation(path=str(flow_json_path)),
            )
            diagnostics.append(diag)
            flows[flow_id] = _BrokenFlow(flow_id=flow_id, diagnostic=diag)
            continue

        node_callables: dict[str, Callable[..., Any] | UnresolvableRef] = {}
        selector_callables: dict[str, Callable[..., Any] | UnresolvableRef] = {}
        for node_name, node in spec.nodes.items():
            if node.kind == "python":
                node_callables[node_name] = _resolve_ref_or_sentinel(
                    node.ref,
                    flow_package,
                    flow_id=flow_id,
                    node_id=node_name,
                    diagnostics=diagnostics,
                )
            if node.selector_ref is not None:
                selector_callables[node_name] = _resolve_ref_or_sentinel(
                    node.selector_ref,
                    flow_package,
                    flow_id=flow_id,
                    node_id=node_name,
                    diagnostics=diagnostics,
                )

        public_exits, exit_diagnostics = _derive_public_exits(flow_id, spec)
        diagnostics.extend(exit_diagnostics)
        diagnostics.extend(_collect_shape_diagnostics(flow_id, spec, public_exits))
        diagnostics.extend(_validate_flow_structure(flow_id, spec))

        flows[flow_id] = _LoadedFlow(
            spec=spec,
            callables=node_callables,
            selectors=selector_callables,
            public_exits=public_exits,
        )

    diagnostics.extend(_detect_unresolved_flow_refs(flows))
    diagnostics.extend(_detect_cross_flow_cycles(flows))

    return Workspace(
        root=root,
        package_name=package_name,
        _flows=flows,
        diagnostics=diagnostics,
    )


def _is_skipped(rel: Path) -> bool:
    return any(
        part in _SKIPPED_DIR_NAMES or part.startswith((".", "_"))
        for part in rel.parts
    )


def _load_json(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkspaceError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise WorkspaceError(f"{path} must contain a JSON object at the top level")
    return raw


def _resolve_ref_or_sentinel(
    ref: str,
    anchor_package: str,
    *,
    flow_id: str,
    node_id: str,
    diagnostics: list[Diagnostic],
) -> Callable[..., Any] | UnresolvableRef:
    """Resolve a ref or return an UnresolvableRef, appending a diagnostic."""
    try:
        return _resolve_ref(ref, anchor_package)
    except WorkspaceError as exc:
        code: Any = (
            "syntax_error" if isinstance(exc.__cause__, SyntaxError) else "unresolved_ref"
        )
        diag = Diagnostic(
            severity="error",
            code=code,
            message=str(exc),
            flow_id=flow_id,
            node_id=node_id,
            detail={"ref": ref},
        )
        diagnostics.append(diag)
        return UnresolvableRef(diagnostic=diag)


def _resolve_ref(ref: str, anchor_package: str) -> Callable[..., Any]:
    """Resolve a ref string to a callable.

    Supported forms:
      - `.module:func`         - relative to the flow's package
      - `..module:func`        - relative to the parent package
      - `package.module:func`  - absolute import

    Raises `WorkspaceError` on any failure; callers convert to
    `UnresolvableRef` diagnostics via `_resolve_ref_or_sentinel`.
    """
    if ":" not in ref:
        raise WorkspaceError(
            f"invalid ref {ref!r}: expected `module:function` form"
        )
    module_part, _, func_name = ref.partition(":")
    if not module_part:
        raise WorkspaceError(f"invalid ref {ref!r}: missing module part")
    if not func_name:
        raise WorkspaceError(f"invalid ref {ref!r}: missing function name after `:`")

    try:
        if module_part.startswith("."):
            module = importlib.import_module(module_part, package=anchor_package)
        else:
            module = importlib.import_module(module_part)
    except Exception as exc:
        raise WorkspaceError(
            f"could not import {module_part!r} for ref {ref!r} "
            f"(anchor: {anchor_package!r}): {exc}"
        ) from exc

    func = getattr(module, func_name, None)
    if func is None:
        raise WorkspaceError(
            f"function {func_name!r} not found in module {module.__name__!r} "
            f"(ref {ref!r})"
        )
    if not callable(func):
        raise WorkspaceError(
            f"attribute {func_name!r} in {module.__name__!r} is not callable "
            f"(ref {ref!r})"
        )
    return func


def _collect_shape_diagnostics(
    flow_id: str, spec: FlowSpec, public_exits: Mapping[str, str]
) -> list[Diagnostic]:
    """Load-time shape checks that used to raise pre-M1.

    Emits diagnostics for: missing / ambiguous start node (SPEC §12 line 427),
    and flows with no inferred public exits.
    """
    diagnostics: list[Diagnostic] = []

    # Start-node shape (SPEC §12 line 427): every flow must declare exactly
    # one `kind="start"` node. Zero → missing_start_node; ≥2 → ambiguous.
    start_ids = sorted(
        nid for nid, n in spec.nodes.items() if n.kind == "start"
    )
    if len(start_ids) == 0:
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="missing_start_node",
                message=(
                    f"flow {flow_id!r}: no start node — expected exactly one "
                    f'node with kind="start" (the virtual entry sentinel)'
                ),
                flow_id=flow_id,
            )
        )
    elif len(start_ids) > 1:
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="ambiguous_start_node",
                message=(
                    f"flow {flow_id!r}: multiple start nodes {start_ids!r} — "
                    f'expected exactly one node with kind="start"'
                ),
                flow_id=flow_id,
                detail={"start_nodes": start_ids},
            )
        )

    # A node with no declared exits is a plain-return node (SPEC §5 / line 153:
    # `plain -> out`). The runtime routes its return value through the implicit
    # DEFAULT_EXIT_NAME ("out") handle. No diagnostic needed — 0-exit is a valid
    # first-class shape, not a broken one. Edges from such nodes carry
    # `from_exit="out"` by convention; see the unknown_edge_exit block below
    # for the implicit-"out" exemption.

    if not public_exits:
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="no_public_exits",
                message=(
                    f"flow {flow_id!r}: no public exits inferred; every source "
                    f"handle is connected to another node, so the flow has no "
                    f"reachable terminus"
                ),
                flow_id=flow_id,
            )
        )

    return diagnostics


def _derive_public_exits(
    flow_id: str, spec: FlowSpec
) -> tuple[dict[str, str], list[Diagnostic]]:
    """Infer the flow's public exits from unconnected source handles.

    Per SPEC §12 line 425 (Infer model): any (node_id, exit_name) pair with no
    outgoing edge is a public exit. The exit's public name is `exit_name` (so
    two leaves sharing a name share one merged public exit). The public type
    is the common contributing type when all agree, else `typing.Any` with a
    `merged_exit_type_mismatch` warning.

    Action-kind nodes (SPEC §12 line 431, not-yet-shipped) don't contribute to
    public exits. Kind=`"flow"` subflow nodes participate normally.
    """
    diagnostics: list[Diagnostic] = []

    # Collect (exit_name, node_id, type) for every unconnected source handle.
    connected: set[tuple[str, str]] = {
        (edge.from_node, edge.from_exit) for edge in spec.edges
    }

    contributions: dict[str, list[tuple[str, str]]] = {}
    for node_id, node in spec.nodes.items():
        if node.kind not in ("python", "flow"):
            # Planted guard for `action` kind (SPEC §12 line 431) once shipped.
            continue

        # Source handles are the declared exits, plus the implicit "out" on
        # 0-exit plain-return nodes (SPEC §5).
        if node.exits:
            handles = [(name, t) for name, t in node.exits.items()]
        else:
            handles = [(DEFAULT_EXIT_NAME, node.input_type)]

        for exit_name, exit_type in handles:
            if (node_id, exit_name) in connected:
                continue
            contributions.setdefault(exit_name, []).append((node_id, exit_type))

    public_exits: dict[str, str] = {}
    for exit_name, contribs in contributions.items():
        types = {t for _, t in contribs}
        if len(types) == 1:
            public_exits[exit_name] = contribs[0][1]
            continue
        public_exits[exit_name] = "typing.Any"
        contributing_nodes = sorted(n for n, _ in contribs)
        diagnostics.append(
            Diagnostic(
                severity="warning",
                code="merged_exit_type_mismatch",
                message=(
                    f"flow {flow_id!r}: inferred public exit {exit_name!r} is "
                    f"contributed by nodes {contributing_nodes} with differing "
                    f"types {sorted(types)}; merged type is typing.Any"
                ),
                flow_id=flow_id,
                detail={
                    "exit_name": exit_name,
                    "contributing_nodes": contributing_nodes,
                    "types": sorted(types),
                },
            )
        )

    return public_exits, diagnostics


def _detect_unresolved_flow_refs(
    flows: Mapping[str, _LoadedFlow | _BrokenFlow],
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    for flow_id, loaded in flows.items():
        if isinstance(loaded, _BrokenFlow):
            continue
        for node_id, node in loaded.spec.nodes.items():
            if node.kind == "flow" and node.ref not in flows:
                diagnostics.append(
                    Diagnostic(
                        severity="error",
                        code="unresolved_flow_ref",
                        message=(
                            f"subflow ref {node.ref!r} on node {node_id!r} in flow "
                            f"{flow_id!r} does not match any loaded flow"
                        ),
                        flow_id=flow_id,
                        node_id=node_id,
                        detail={"target_flow": node.ref},
                    )
                )
    return diagnostics


def _detect_cross_flow_cycles(
    flows: Mapping[str, _LoadedFlow | _BrokenFlow],
) -> list[Diagnostic]:
    """Find cycles in the flow→subflow reference graph and emit diagnostics.

    Each `kind="flow"` node whose ref participates in a cycle receives a
    diagnostic. Does not raise — runtime's visited-map enforces at the second
    visit. Per spec §5.4. Unresolved refs and broken flows are skipped so
    they don't falsely contribute to (or suppress) cycle detection.
    """
    edges_by_flow: dict[str, list[tuple[str, str]]] = {}
    for flow_id, loaded in flows.items():
        refs: list[tuple[str, str]] = []
        if isinstance(loaded, _LoadedFlow):
            for node_id, node in loaded.spec.nodes.items():
                if (
                    node.kind == "flow"
                    and node.ref in flows
                    and isinstance(flows[node.ref], _LoadedFlow)
                ):
                    refs.append((node_id, node.ref))
        edges_by_flow[flow_id] = refs

    scc_of = _tarjan_sccs({fid: [t for _, t in es] for fid, es in edges_by_flow.items()})

    diagnostics: list[Diagnostic] = []
    for flow_id, refs in edges_by_flow.items():
        src_scc = scc_of.get(flow_id)
        if src_scc is None:
            continue
        for node_id, target_flow in refs:
            tgt_scc = scc_of.get(target_flow)
            if tgt_scc is None or tgt_scc != src_scc:
                continue
            cycle_members = sorted(
                fid for fid, s in scc_of.items() if s == src_scc
            )
            diagnostics.append(
                Diagnostic(
                    severity="error",
                    code="cross_flow_cycle",
                    message=(
                        f"flow {flow_id!r} participates in a cross-flow cycle "
                        f"via node {node_id!r} -> {target_flow!r} "
                        f"(cycle: {cycle_members})"
                    ),
                    flow_id=flow_id,
                    node_id=node_id,
                    detail={"cycle": cycle_members},
                )
            )
    return diagnostics


def _tarjan_sccs(
    graph: Mapping[str, list[str]],
) -> dict[str, int]:
    """Return mapping node -> SCC id, but only for nodes that participate in
    a cycle (SCCs of size >1 or a single node with a self-edge). Nodes not in
    any cycle are absent from the result.
    """
    index_counter = [0]
    stack: list[str] = []
    on_stack: set[str] = set()
    index: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    result: dict[str, int] = {}
    scc_id_counter = [0]

    def strongconnect(v: str) -> None:
        index[v] = index_counter[0]
        lowlink[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack.add(v)

        for w in graph.get(v, ()):
            if w not in graph:
                continue
            if w not in index:
                strongconnect(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif w in on_stack:
                lowlink[v] = min(lowlink[v], index[w])

        if lowlink[v] == index[v]:
            scc_id = scc_id_counter[0]
            scc_id_counter[0] += 1
            members: list[str] = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                members.append(w)
                if w == v:
                    break
            has_self_edge = v in graph.get(v, ())
            if len(members) > 1 or has_self_edge:
                for m in members:
                    result[m] = scc_id

    for node in graph:
        if node not in index:
            strongconnect(node)

    return result


def _validate_flow_structure(flow_id: str, spec: FlowSpec) -> list[Diagnostic]:
    """Check edges reference valid nodes and exits.

    Returns a list of diagnostics rather than raising (SPEC §6.4 gap 3).
    Codes emitted: `dangling_edge_target` (unknown from_node / to_node) and
    `unknown_edge_exit` (from_exit not declared on the source node).
    """
    diagnostics: list[Diagnostic] = []
    node_names = set(spec.nodes.keys())

    for idx, edge in enumerate(spec.edges):
        if edge.from_node not in node_names:
            diagnostics.append(
                Diagnostic(
                    severity="error",
                    code="dangling_edge_target",
                    message=(
                        f"flow {flow_id!r}: edge references unknown from_node "
                        f"{edge.from_node!r}"
                    ),
                    flow_id=flow_id,
                    edge_index=idx,
                    detail={"from_node": edge.from_node},
                )
            )
        else:
            source_node = spec.nodes[edge.from_node]
            # Implicit-"out" exemption: a 0-exit plain-return node routes its
            # return value through DEFAULT_EXIT_NAME per SPEC §5. Edges with
            # `from_exit="out"` from such nodes are valid even though "out"
            # isn't in the declared exits dict.
            implicit_out = (
                not source_node.exits and edge.from_exit == DEFAULT_EXIT_NAME
            )
            if edge.from_exit not in source_node.exits and not implicit_out:
                diagnostics.append(
                    Diagnostic(
                        severity="error",
                        code="unknown_edge_exit",
                        message=(
                            f"flow {flow_id!r}: edge from_exit {edge.from_exit!r} "
                            f"is not declared on node {edge.from_node!r} "
                            f"(declared exits: {sorted(source_node.exits)})"
                        ),
                        flow_id=flow_id,
                        edge_index=idx,
                        node_id=edge.from_node,
                        detail={"from_exit": edge.from_exit},
                    )
                )
        if edge.to_node not in node_names:
            diagnostics.append(
                Diagnostic(
                    severity="error",
                    code="dangling_edge_target",
                    message=(
                        f"flow {flow_id!r}: edge targets unknown to_node "
                        f"{edge.to_node!r}"
                    ),
                    flow_id=flow_id,
                    edge_index=idx,
                    detail={"to_node": edge.to_node},
                )
            )

        # Type mismatch: source exit type vs. target node input type.
        # Skip if either node is unknown (already emitted dangling_edge_target).
        if (
            edge.to_node in node_names
            and edge.from_node in node_names
        ):
            source_node = spec.nodes[edge.from_node]
            target_node = spec.nodes[edge.to_node]
            source_exit_type = source_node.exits.get(edge.from_exit)
            target_input_type = target_node.input_type
            # Only emit when both types are known strings and they differ.
            # typing.Any on either side is always compatible.
            if (
                source_exit_type is not None
                and source_exit_type != "typing.Any"
                and target_input_type != "typing.Any"
                and source_exit_type != target_input_type
            ):
                diagnostics.append(
                    Diagnostic(
                        severity="warning",
                        code="type_mismatch",
                        message=(
                            f"flow {flow_id!r}: exit {edge.from_exit!r} of node "
                            f"{edge.from_node!r} has type {source_exit_type!r} but "
                            f"target node {edge.to_node!r} expects {target_input_type!r}"
                        ),
                        flow_id=flow_id,
                        node_id=edge.from_node,
                        edge_index=idx,
                        detail={
                            "from_node": edge.from_node,
                            "from_exit": edge.from_exit,
                            "source_type": source_exit_type,
                            "to_node": edge.to_node,
                            "target_type": target_input_type,
                        },
                    )
                )

    return diagnostics
