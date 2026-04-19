"""Runtime tests for fan-out, subflow dispatch, visited-merge, exceptions, tracer.

These tests build `FlowSpec` and `Workspace` in-memory — no example workspace
package on disk — to exercise `_run` directly with ad-hoc Python callables.

Under the Infer model (SPEC §12 line 425), public exits are derived from
unconnected source handles. Tests create leaves by leaving the desired exit
handle with no outgoing edge; the runtime terminates there.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Mapping

import pytest

from dagsmith.model import EdgeSpec, FlowSpec, NodeSpec
from dagsmith.runtime import (
    AmbiguousRoute,
    MultiplePublicExitsReached,
    emit,
)
from dagsmith.workspace import (
    Workspace,
    WorkspaceError,
    _derive_public_exits,
    _LoadedFlow,
)


def _node(
    exits: Mapping[str, str],
    *,
    kind: str = "python",
    ref: str = "x:y",
    input_type: str = "Any",
    selector_ref: str | None = None,
) -> NodeSpec:
    data: dict[str, Any] = {
        "kind": kind,
        "ref": ref,
        "input": input_type,
        "exits": dict(exits),
    }
    if selector_ref is not None:
        data["selector"] = selector_ref
    return NodeSpec.model_validate(data)


def _flow(
    *,
    flow_id: str,
    nodes: Mapping[str, NodeSpec],
    edges: tuple[EdgeSpec, ...],
    entry: str,
    input_type: str = "Any",
) -> FlowSpec:
    """Build a FlowSpec, auto-prepending a kind=start sentinel wired to `entry`.

    This is a test-helper convenience so each test doesn't spell out the
    start boilerplate. If `nodes` already contains a `kind="start"` node,
    we leave it alone.
    """
    full_nodes = dict(nodes)
    full_edges = list(edges)
    if not any(n.kind == "start" for n in full_nodes.values()):
        full_nodes["_start"] = NodeSpec.model_validate(
            {
                "kind": "start",
                "input": input_type,
                "exits": {"out": input_type},
            }
        )
        full_edges.insert(
            0, EdgeSpec(from_node="_start", from_exit="out", to_node=entry)
        )
    return FlowSpec.model_validate(
        {
            "id": flow_id,
            "nodes": full_nodes,
            "edges": [e.model_dump() for e in full_edges],
        }
    )


def _workspace(flows: Mapping[str, _LoadedFlow]) -> Workspace:
    return Workspace(
        root=Path("/tmp/dagsmith-test"),
        package_name="dagsmith_test",
        _flows=dict(flows),
    )


def _loaded(
    spec: FlowSpec,
    callables: Mapping[str, Callable[..., Any]],
    selectors: Mapping[str, Callable[..., Any]] | None = None,
) -> _LoadedFlow:
    public_exits, _ = _derive_public_exits(spec.id, spec)
    return _LoadedFlow(
        spec=spec,
        callables=dict(callables),
        selectors=dict(selectors or {}),
        public_exits=public_exits,
    )


def test_fanout_sequential_merge_at_visited_node():
    """Entry fans out to two branches that both target the same join node.

    The join node runs once (first-writer-wins on visited); its payload comes
    from whichever branch arrives first. Verify a single public exit result.
    """
    calls: list[tuple[str, Any]] = []

    def entry(x: int) -> int:
        calls.append(("entry", x))
        return x

    def branch_a(x: int) -> int:
        calls.append(("branch_a", x))
        return x + 1

    def branch_b(x: int) -> int:
        calls.append(("branch_b", x))
        return x + 10

    def join(x: int) -> int:
        calls.append(("join", x))
        return x * 100

    spec = _flow(
        flow_id="fanout_merge",
        nodes={
            "entry": _node({"out": "int"}),
            "branch_a": _node({"out": "int"}),
            "branch_b": _node({"out": "int"}),
            "join": _node({"out": "int"}),
        },
        edges=(
            EdgeSpec(from_node="entry", from_exit="out", to_node="branch_a"),
            EdgeSpec(from_node="entry", from_exit="out", to_node="branch_b"),
            EdgeSpec(from_node="branch_a", from_exit="out", to_node="join"),
            EdgeSpec(from_node="branch_b", from_exit="out", to_node="join"),
            # join.out is left unconnected → inferred public exit "out"
        ),
        entry="entry",
    )

    ws = _workspace(
        {
            "fanout_merge": _loaded(
                spec,
                callables={
                    "entry": entry,
                    "branch_a": branch_a,
                    "branch_b": branch_b,
                    "join": join,
                },
            )
        }
    )

    result = ws.flow("fanout_merge")(5)

    assert result.exit == "out"
    # first-writer-wins: join ran exactly once; it saw branch_a's payload since
    # branch_a was enqueued first (edge order).
    join_calls = [c for c in calls if c[0] == "join"]
    assert len(join_calls) == 1
    assert join_calls[0][1] == 6  # branch_a: 5 + 1
    assert result.value == 600

    # both branches ran (sequentially), but join only once
    names = [name for name, _ in calls]
    assert names.count("entry") == 1
    assert names.count("branch_a") == 1
    assert names.count("branch_b") == 1
    assert names.count("join") == 1


def test_subflow_execution_payload_flows_through_public_exit():
    """Parent flow calls a subflow node; payload flows through the subflow's
    public exit and continues in the parent."""

    def sub_only(x: int) -> int:
        return x * 2

    sub_spec = _flow(
        flow_id="sub",
        nodes={"only": _node({"done": "int"})},
        edges=(),  # only.done unconnected → public exit "done"
        entry="only",
    )

    def tail(x: int) -> int:
        return x + 1

    parent_spec = _flow(
        flow_id="parent",
        nodes={
            "sub_node": _node({"done": "int"}, kind="flow", ref="sub"),
            "tail": _node({"out": "int"}),
        },
        edges=(
            EdgeSpec(from_node="sub_node", from_exit="done", to_node="tail"),
            # tail.out unconnected → public exit "out"
        ),
        entry="sub_node",
    )

    ws = _workspace(
        {
            "sub": _loaded(sub_spec, callables={"only": sub_only}),
            "parent": _loaded(parent_spec, callables={"tail": tail}),
        }
    )

    result = ws.flow("parent")(10)
    assert result.exit == "out"
    assert result.value == 21  # (10 * 2) + 1


def test_multiple_public_exits_reached_raised_on_divergent_fanout():
    """Fan-out where the two branches reach DIFFERENT public exits should
    raise MultiplePublicExitsReached."""

    def entry(x: int) -> int:
        return x

    def left(x: int) -> int:
        return x

    def right(x: int) -> int:
        return x

    spec = _flow(
        flow_id="diverge",
        nodes={
            "entry": _node({"out": "int"}),
            # left + right have distinct exit names so they become distinct
            # inferred public exits ("a" and "b") under the Infer model.
            "left": _node({"a": "int"}),
            "right": _node({"b": "int"}),
        },
        edges=(
            EdgeSpec(from_node="entry", from_exit="out", to_node="left"),
            EdgeSpec(from_node="entry", from_exit="out", to_node="right"),
            # left.a and right.b both unconnected → two public exits
        ),
        entry="entry",
    )

    ws = _workspace(
        {
            "diverge": _loaded(
                spec,
                callables={"entry": entry, "left": left, "right": right},
            )
        }
    )

    with pytest.raises(MultiplePublicExitsReached) as excinfo:
        ws.flow("diverge")(1)
    exc = excinfo.value
    assert exc.flow_id == "diverge"
    assert set(exc.exits_reached) == {"a", "b"}


def test_ambiguous_route_raised_for_plain_return_on_multi_exit_node():
    """A node with >1 exits, no selector, and a plain return should raise."""

    def ambiguous(x: int) -> int:
        return x  # plain return, no emit

    spec = _flow(
        flow_id="ambig",
        nodes={
            "ambiguous": _node({"a": "int", "b": "int"}),
        },
        edges=(),  # both handles unconnected → public exits "a" and "b"
        entry="ambiguous",
    )

    ws = _workspace(
        {"ambig": _loaded(spec, callables={"ambiguous": ambiguous})}
    )

    with pytest.raises(AmbiguousRoute) as excinfo:
        ws.flow("ambig")(1)
    assert excinfo.value.flow_id == "ambig"
    assert excinfo.value.node_id == "ambiguous"
    assert set(excinfo.value.exits) == {"a", "b"}


def test_tracer_receives_edges_in_order_including_subflow_frames():
    """Tracer fires on every edge crossing (including terminal leaf exits);
    subflow edges interleave between the parent's edges that feed into /
    come out of the subflow node."""

    def sub_entry(x: int) -> int:
        return x + 100

    def sub_tail(x: int) -> Any:
        return emit("done", x + 1)

    sub_spec = _flow(
        flow_id="sub",
        nodes={
            "sub_entry": _node({"out": "int"}),
            "sub_tail": _node({"done": "int"}),
        },
        edges=(
            EdgeSpec(from_node="sub_entry", from_exit="out", to_node="sub_tail"),
            # sub_tail.done unconnected → public exit "done"
        ),
        entry="sub_entry",
    )

    def parent_entry(x: int) -> int:
        return x

    def parent_tail(x: int) -> int:
        return x * 2

    parent_spec = _flow(
        flow_id="parent",
        nodes={
            "parent_entry": _node({"out": "int"}),
            "sub_node": _node({"done": "int"}, kind="flow", ref="sub"),
            "parent_tail": _node({"out": "int"}),
        },
        edges=(
            EdgeSpec(
                from_node="parent_entry", from_exit="out", to_node="sub_node"
            ),
            EdgeSpec(
                from_node="sub_node", from_exit="done", to_node="parent_tail"
            ),
            # parent_tail.out unconnected → public exit "out"
        ),
        entry="parent_entry",
    )

    ws = _workspace(
        {
            "sub": _loaded(
                sub_spec,
                callables={"sub_entry": sub_entry, "sub_tail": sub_tail},
            ),
            "parent": _loaded(
                parent_spec,
                callables={"parent_entry": parent_entry, "parent_tail": parent_tail},
            ),
        }
    )

    events: list[tuple[str, str, str, str, Any]] = []

    def tracer(flow_id, from_node, from_exit, to, payload):  # noqa: ANN001
        events.append((flow_id, from_node, from_exit, to, payload))

    result = ws.flow("parent")(5, tracer=tracer)
    assert result.exit == "out"
    # 5 -> parent_entry -> sub_node (subflow: 5 -> sub_entry -> sub_tail -> done(106))
    # -> parent_tail(106) -> out(212)
    assert result.value == 212

    # Terminal leaf exits still fire the tracer, with to==exit_name (the
    # public exit name under the Infer model). The _start sentinel fires
    # its own edge (start → entry) at the top of each flow invocation.
    assert events == [
        ("parent", "_start", "out", "parent_entry", 5),
        ("parent", "parent_entry", "out", "sub_node", 5),
        ("sub", "_start", "out", "sub_entry", 5),
        ("sub", "sub_entry", "out", "sub_tail", 105),
        ("sub", "sub_tail", "done", "done", 106),
        ("parent", "sub_node", "done", "parent_tail", 106),
        ("parent", "parent_tail", "out", "out", 212),
    ]


def test_tracer_not_called_when_absent():
    """Happy path without tracer keeps working."""

    def one(x: int) -> int:
        return x + 1

    spec = _flow(
        flow_id="simple",
        nodes={"one": _node({"out": "int"})},
        edges=(),  # one.out unconnected → public exit "out"
        entry="one",
    )
    ws = _workspace({"simple": _loaded(spec, callables={"one": one})})
    result = ws.flow("simple")(5)
    assert result.exit == "out"
    assert result.value == 6


def test_emit_routes_to_named_exit():
    """Multi-exit node with emit() picks the exit without raising AmbiguousRoute."""

    def decide(x: int) -> Any:
        return emit("even" if x % 2 == 0 else "odd", x)

    spec = _flow(
        flow_id="decide",
        nodes={"decide": _node({"even": "int", "odd": "int"})},
        edges=(),  # both handles unconnected → public exits "even" + "odd"
        entry="decide",
    )
    ws = _workspace({"decide": _loaded(spec, callables={"decide": decide})})
    assert ws.flow("decide")(4).exit == "even"
    assert ws.flow("decide")(5).exit == "odd"


def test_in_invocation_cycle_drains_queue_without_public_exit():
    def passthrough(x: Any) -> Any:
        return x

    spec = _flow(
        flow_id="loopy",
        nodes={"a": _node({"out": "int"}), "b": _node({"out": "int"})},
        edges=(
            EdgeSpec(from_node="a", from_exit="out", to_node="b"),
            EdgeSpec(from_node="b", from_exit="out", to_node="a"),
        ),
        entry="a",
    )
    ws = _workspace({"loopy": _loaded(spec, callables={"a": passthrough, "b": passthrough})})
    with pytest.raises(WorkspaceError, match="without reaching any public exit"):
        ws.flow("loopy")(1)


def test_node_body_exception_propagates():
    class Boom(RuntimeError):
        pass

    def detonate(_: Any) -> Any:
        raise Boom("intentional")

    spec = _flow(
        flow_id="bang",
        nodes={"boom": _node({"out": "int"})},
        edges=(),
        entry="boom",
    )
    ws = _workspace({"bang": _loaded(spec, callables={"boom": detonate})})
    with pytest.raises(Boom, match="intentional"):
        ws.flow("bang")(1)
