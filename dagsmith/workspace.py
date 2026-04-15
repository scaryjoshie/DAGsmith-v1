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
"""

from __future__ import annotations

import importlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from .model import DEFAULT_EXIT_NAME, FlowSpec
from .runtime import FlowResult, _resolve_node_result

_SKIPPED_DIR_NAMES = frozenset({"__pycache__"})


class WorkspaceError(ValueError):
    """Raised when workspace loading or validation fails."""


@dataclass(frozen=True)
class _LoadedFlow:
    """A FlowSpec plus its eagerly resolved callables, ready to execute."""

    spec: FlowSpec
    callables: Mapping[str, Callable[..., Any]]
    selectors: Mapping[str, Callable[..., Any]]


@dataclass(frozen=True)
class Workspace:
    """A loaded DAGsmith workspace.

    Use `workspace.flow(flow_id)` to get a callable for a named flow.
    Calling that callable with an input value runs the flow and returns
    a `FlowResult`.
    """

    root: Path
    package_name: str
    _flows: Mapping[str, _LoadedFlow]

    def flow(self, flow_id: str) -> Callable[[Any], FlowResult]:
        """Return a callable that runs the named flow."""
        if flow_id not in self._flows:
            known = sorted(self._flows.keys())
            raise WorkspaceError(
                f"unknown flow: {flow_id!r} (known: {known})"
            )

        def _run(value: Any) -> FlowResult:
            return self._run(flow_id, value)

        _run.__name__ = flow_id.replace(".", "_")
        _run.__qualname__ = f"{self.package_name}.{flow_id}"
        _run.__doc__ = (
            f"Run the {flow_id!r} flow from workspace {self.package_name!r}."
        )
        return _run

    def _run(self, flow_id: str, value: Any) -> FlowResult:
        loaded = self._flows[flow_id]
        spec = loaded.spec

        current_node = spec.entry_node
        current_value: Any = value
        visited: set[str] = set()

        while True:
            if current_node in visited:
                raise WorkspaceError(
                    f"cycle detected at node {current_node!r} in flow {flow_id!r}"
                )
            visited.add(current_node)

            func = loaded.callables[current_node]
            selector = loaded.selectors.get(current_node)

            raw = func(current_value)
            exit_name, new_value = _resolve_node_result(
                raw, DEFAULT_EXIT_NAME, selector
            )

            matching = [
                edge
                for edge in spec.edges
                if edge.from_node == current_node and edge.from_exit == exit_name
            ]
            if not matching:
                raise WorkspaceError(
                    f"no outgoing edge for {current_node!r}:{exit_name!r} "
                    f"in flow {flow_id!r}"
                )
            if len(matching) > 1:
                raise WorkspaceError(
                    f"multiple outgoing edges for {current_node!r}:{exit_name!r} "
                    f"in flow {flow_id!r}"
                )
            edge = matching[0]

            if edge.to_flow_exit is not None:
                return FlowResult(exit=edge.to_flow_exit, value=new_value)

            assert edge.to_node is not None
            current_node = edge.to_node
            current_value = new_value


def load_workspace(package_name: str) -> Workspace:
    """Load a DAGsmith workspace.

    Called from a workspace package's `__init__.py` with `__name__` as
    the argument. Returns a `Workspace` whose `flow(id)` method gives
    you a callable for each discovered flow.

    All referenced Python callables are imported eagerly at load time —
    flow execution has no import machinery in its hot path.
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

    flows: dict[str, _LoadedFlow] = {}
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

        raw = _load_json(flow_json_path)
        raw.setdefault("id", flow_id)

        try:
            spec = FlowSpec.model_validate(raw)
        except Exception as exc:
            raise WorkspaceError(
                f"invalid flow schema in {flow_json_path}: {exc}"
            ) from exc

        node_callables: dict[str, Callable[..., Any]] = {}
        selector_callables: dict[str, Callable[..., Any]] = {}
        for node_name, node in spec.nodes.items():
            node_callables[node_name] = _resolve_ref(node.ref, flow_package)
            if node.selector_ref is not None:
                selector_callables[node_name] = _resolve_ref(
                    node.selector_ref, flow_package
                )

        _validate_flow_structure(flow_id, spec)

        flows[flow_id] = _LoadedFlow(
            spec=spec,
            callables=node_callables,
            selectors=selector_callables,
        )

    return Workspace(
        root=root,
        package_name=package_name,
        _flows=flows,
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


def _resolve_ref(ref: str, anchor_package: str) -> Callable[..., Any]:
    """Resolve a ref string to a callable.

    Supported forms:
      - `.module:func`         - relative to the flow's package
      - `..module:func`        - relative to the parent package
      - `package.module:func`  - absolute import
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
    except ImportError as exc:
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


def _validate_flow_structure(flow_id: str, spec: FlowSpec) -> None:
    """Check edges reference valid nodes, exits, and public exits."""
    node_names = set(spec.nodes.keys())
    public_exit_names = set(spec.public_exits.keys())

    for edge in spec.edges:
        if edge.from_node not in node_names:
            raise WorkspaceError(
                f"flow {flow_id!r}: edge references unknown from_node "
                f"{edge.from_node!r}"
            )
        source_node = spec.nodes[edge.from_node]
        if edge.from_exit not in source_node.exits:
            raise WorkspaceError(
                f"flow {flow_id!r}: edge from_exit {edge.from_exit!r} "
                f"is not declared on node {edge.from_node!r} "
                f"(declared exits: {sorted(source_node.exits)})"
            )
        if edge.to_node is not None and edge.to_node not in node_names:
            raise WorkspaceError(
                f"flow {flow_id!r}: edge targets unknown to_node {edge.to_node!r}"
            )
        if (
            edge.to_flow_exit is not None
            and edge.to_flow_exit not in public_exit_names
        ):
            raise WorkspaceError(
                f"flow {flow_id!r}: edge targets unknown to_flow_exit "
                f"{edge.to_flow_exit!r} "
                f"(declared public exits: {sorted(public_exit_names)})"
            )
