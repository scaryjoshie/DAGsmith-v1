"""Pydantic IR for DAGsmith flows, nodes, and edges.

Users rarely construct these directly — the workspace loader builds them
from `flow.json` files on disk. These classes are internal to DAGsmith;
only the loader, validator, and runner touch them.
"""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

DEFAULT_EXIT_NAME = "out"

TypeRef = str


class _Base(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore", populate_by_name=True)


class NodeSpec(_Base):
    """A single node in a flow.

    Kinds:
    - `"python"`: a compute node whose `ref` points at a Python callable.
    - `"flow"`: embeds a named subflow as a step; `ref` is a flow id.
    - `"start"`: a sentinel entry node (SPEC §12 line 427). Holds no `ref`
      and no callable — the runtime short-circuits through its implicit
      "out" exit, passing the flow's input payload unchanged. Every flow
      must declare exactly one start node; it's the sole entry point.
    """

    kind: Literal["python", "flow", "start"]
    # `ref` is required for python + flow kinds and empty for start nodes.
    # Defaults to "" to accommodate start nodes without extra validator
    # gymnastics; the loader flags a python/flow node with an empty ref as
    # an unresolved_ref diagnostic.
    ref: str = ""
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

    Computed fields:
    - `public_exits` (see `workspace._derive_public_exits`): derived from
      unconnected source handles. Not on the spec — on the loaded flow.
    - `entry_node` and `input_type`: computed from the unique `kind="start"`
      node (SPEC §12 line 427). If zero or multiple start nodes exist,
      `entry_node` returns `""` and diagnostics (`missing_start_node` /
      `ambiguous_start_node`) surface the issue. Legacy stored `entry_node`
      and `input` fields are ignored via `extra="ignore"`.
    """

    id: str
    nodes: Mapping[str, NodeSpec]
    edges: tuple[EdgeSpec, ...] = ()
    description: str = ""
    layout: Mapping[str, Any] = Field(default_factory=dict)

    @computed_field
    @property
    def entry_node(self) -> str:
        starts = [nid for nid, n in self.nodes.items() if n.kind == "start"]
        if len(starts) == 1:
            return starts[0]
        return ""

    @computed_field
    @property
    def input_type(self) -> TypeRef:
        entry = self.entry_node
        if not entry:
            return "typing.Any"
        start = self.nodes[entry]
        return start.exits.get(DEFAULT_EXIT_NAME, start.input_type)

    @model_validator(mode="after")
    def _check_shape(self) -> "FlowSpec":
        if not self.nodes:
            raise ValueError("flows must declare at least one node")
        return self
