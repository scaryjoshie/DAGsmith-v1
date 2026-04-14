"""Runtime helpers for node execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from .model import DEFAULT_EXIT_NAME


@dataclass(frozen=True)
class Emit:
    """Explicit graph-local routing instruction."""

    exit_name: str
    value: Any

    def __post_init__(self) -> None:
        if not isinstance(self.exit_name, str) or not self.exit_name.strip():
            raise ValueError("Emit.exit_name must be a non-empty string")
        object.__setattr__(self, "exit_name", self.exit_name.strip())


def emit(exit_name: str, value: Any) -> Emit:
    """Construct an explicit routed result for a node."""

    return Emit(exit_name=exit_name, value=value)


@dataclass(frozen=True)
class NodeExecution:
    """Normalized node result after routing is resolved."""

    exit_name: str
    value: Any
    emitted: bool = False


def resolve_node_result(
    result: Any,
    *,
    default_exit: str = DEFAULT_EXIT_NAME,
    selector: Optional[Callable[[Any], str]] = None
) -> NodeExecution:
    """Normalize a node return value into a routed result."""

    if isinstance(result, Emit):
        return NodeExecution(exit_name=result.exit_name, value=result.value, emitted=True)

    if selector is not None:
        selected_exit = selector(result)
        if not isinstance(selected_exit, str) or not selected_exit.strip():
            raise ValueError("selector must return a non-empty exit name")
        return NodeExecution(exit_name=selected_exit.strip(), value=result, emitted=False)

    return NodeExecution(exit_name=default_exit, value=result, emitted=False)
