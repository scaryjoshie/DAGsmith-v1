"""Pydantic IR for DAGsmith flows, nodes, and edges.

Users rarely construct these directly — the workspace loader builds them
from `flow.json` files on disk. These classes are internal to DAGsmith;
only the loader, validator, and runner touch them.
"""

from __future__ import annotations

from typing import Any, Literal, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

DEFAULT_EXIT_NAME = "out"

TypeRef = str


class _Base(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore", populate_by_name=True)


class NodeSpec(_Base):
    """A single node in a flow. Phase 1 supports only `python`-kind nodes."""

    kind: Literal["python"]
    ref: str
    input_type: TypeRef = Field(alias="input")
    exits: Mapping[str, TypeRef]
    selector_ref: Optional[str] = Field(default=None, alias="selector")
    label: str = ""
    description: str = ""

    @model_validator(mode="after")
    def _check_exits(self) -> "NodeSpec":
        if not self.exits:
            raise ValueError("nodes must declare at least one exit")
        return self


class EdgeSpec(_Base):
    """A directed edge from one node exit to another node or a public flow exit."""

    from_node: str
    from_exit: str = DEFAULT_EXIT_NAME
    to_node: Optional[str] = None
    to_flow_exit: Optional[str] = None

    @model_validator(mode="after")
    def _check_target(self) -> "EdgeSpec":
        if (self.to_node is None) == (self.to_flow_exit is None):
            raise ValueError(
                "edges must target exactly one of `to_node` or `to_flow_exit`"
            )
        return self


class FlowSpec(_Base):
    """A flow: a DAG of nodes with named public exits. A flow is a pure function."""

    id: str
    input_type: TypeRef = Field(alias="input")
    nodes: Mapping[str, NodeSpec]
    edges: tuple[EdgeSpec, ...] = ()
    entry_node: str
    public_exits: Mapping[str, TypeRef]
    description: str = ""
    layout: Mapping[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_shape(self) -> "FlowSpec":
        if not self.nodes:
            raise ValueError("flows must declare at least one node")
        if self.entry_node not in self.nodes:
            raise ValueError(
                f"entry_node {self.entry_node!r} is not a declared node"
            )
        if not self.public_exits:
            raise ValueError("flows must declare at least one public exit")
        return self
