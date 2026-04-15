"""Runtime primitives for DAGsmith flow execution.

`emit` is the public API for explicit routing inside node code.
`FlowResult` is what calling a flow returns. `Emit` is the internal
routing instruction type — users construct it via `emit(name, value)`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional


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
) -> tuple[str, Any]:
    """Apply the routing rule: Emit -> selector -> default exit."""
    if isinstance(raw, Emit):
        return raw.exit_name, raw.value
    if selector is not None:
        chosen = selector(raw)
        if not isinstance(chosen, str) or not chosen.strip():
            raise ValueError("selector must return a non-empty exit name")
        return chosen.strip(), raw
    return default_exit, raw
