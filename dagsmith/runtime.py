"""Runtime primitives for DAGsmith flow execution.

`emit` is the public API for explicit routing inside node code.
`FlowResult` is what calling a flow returns. `Emit` is the internal
routing instruction type — users construct it via `emit(name, value)`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional


class DagsmithRuntimeError(RuntimeError):
    """Base class for all DAGsmith runtime failures."""


class AmbiguousRoute(DagsmithRuntimeError):
    """A node with >1 exits returned a plain value and has no selector."""

    def __init__(
        self,
        flow_id: str,
        node_id: str,
        exits: Mapping[str, Any],
    ) -> None:
        self.flow_id = flow_id
        self.node_id = node_id
        self.exits = dict(exits)
        super().__init__(
            f"ambiguous route: node {node_id!r} in flow {flow_id!r} returned a "
            f"plain value but has {len(self.exits)} exits {sorted(self.exits)} "
            f"and no selector (use `emit(exit, value)` or declare a selector)"
        )


class MultiplePublicExitsReached(DagsmithRuntimeError):
    """Fan-out reached two or more distinct public exits in one invocation."""

    def __init__(
        self,
        flow_id: str,
        exits_reached: list[str],
    ) -> None:
        self.flow_id = flow_id
        self.exits_reached = list(exits_reached)
        super().__init__(
            f"multiple public exits reached in flow {flow_id!r}: "
            f"{sorted(set(self.exits_reached))} — fan-out must merge before exit"
        )


@dataclass(frozen=True)
class Emit:
    """Internal routing instruction. Construct via `emit(name, value)`."""

    exit_name: str
    value: Any

    def __post_init__(self) -> None:
        if not isinstance(self.exit_name, str) or not self.exit_name.strip():
            raise ValueError("exit_name must be a non-empty string")
        object.__setattr__(self, "exit_name", self.exit_name.strip())


def emit(exit_name: str, value: Any) -> Emit:
    """Return an explicit routed result from a node.

    When a node knows which exit it wants to take, it returns
    `emit(exit_name, value)` instead of a plain value. The runtime
    routes the result to the named exit without consulting a selector.

    Example:

        def validate(customer):
            if not customer.email:
                return emit("invalid", ValidationError("missing email"))
            return emit("valid", customer)
    """
    return Emit(exit_name=exit_name, value=value)


@dataclass(frozen=True)
class FlowResult:
    """The return value of calling a flow.

    - `exit` is the name of the public exit the flow reached.
    - `value` is the payload produced by the node that exited.
    """

    exit: str
    value: Any


def _resolve_node_result(
    raw: Any,
    default_exit: str,
    selector: Optional[Callable[[Any], str]],
    *,
    flow_id: str,
    node_id: str,
    exits: Mapping[str, Any],
) -> tuple[str, Any]:
    """Apply the routing rule: Emit -> selector -> single exit.

    For a 0-exit plain-return node, route through the implicit `default_exit`
    handle (SPEC §5). For a 1-exit node, route through that single declared
    exit — whatever its name — so the Infer model's public exit name is
    preserved. Raises `AmbiguousRoute` when a node with >1 declared exits
    returns a plain value and has no selector.
    """
    if isinstance(raw, Emit):
        return raw.exit_name, raw.value
    if selector is not None:
        chosen = selector(raw)
        if not isinstance(chosen, str) or not chosen.strip():
            raise ValueError("selector must return a non-empty exit name")
        return chosen.strip(), raw
    if len(exits) > 1:
        raise AmbiguousRoute(flow_id=flow_id, node_id=node_id, exits=exits)
    if len(exits) == 1:
        (sole,) = exits.keys()
        return sole, raw
    return default_exit, raw
