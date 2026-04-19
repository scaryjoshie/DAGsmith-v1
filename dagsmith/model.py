"""Pydantic IR for DAGsmith flows, nodes, and edges.

Users rarely construct these directly — the workspace loader builds them
from `flow.json` files on disk. These classes are internal to DAGsmith;
only the loader, validator, and runner touch them.
"""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, model_validator

DEFAULT_EXIT_NAME = "out"

TypeRef = str


class _Base(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore", populate_by_name=True)


class NodeSpec(_Base):
    """A single node in a flow. Phase 1 supports only `python`-kind nodes."""

    kind: Literal["python", "flow"]
    ref: str
    input_type: TypeRef = Field(alias="input")
    exits: Mapping[str, TypeRef]
    selector_ref: str | None = Field(default=None, alias="selector")
    label: str = ""
    description: str = ""


class EdgeSpec(_Base):
    """A directed edge from one node exit to another node.

    Under the Infer model (SPEC §12 line 425), public exits are derived from
    unconnected source handles — not represented by edges. An edge must
    target another node.
    """

    from_node: str
    from_exit: str = DEFAULT_EXIT_NAME
    to_node: str


class FlowSpec(_Base):
    """A flow: a DAG of nodes. A flow is a pure function.

    `public_exits` are not stored — they are derived at load time by
    `workspace._derive_public_exits` from source handles with no outgoing
    edge. See SPEC §12 line 425 (Infer model).
    """

    id: str
    input_type: TypeRef = Field(alias="input")
    nodes: Mapping[str, NodeSpec]
    edges: tuple[EdgeSpec, ...] = ()
    entry_node: str
    description: str = ""
    layout: Mapping[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_shape(self) -> "FlowSpec":
        if not self.nodes:
            raise ValueError("flows must declare at least one node")
        return self
