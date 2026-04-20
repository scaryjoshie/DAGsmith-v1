"""Pydantic request/response models for the server API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class NodeView(BaseModel):
    """UI-facing view of a single node."""

    name: str
    kind: str
    ref: str
    selector_ref: str | None
    input_type: str
    exits: dict[str, str]
    label: str
    description: str
    source_code: str | None
    source_path: str | None


class EdgeView(BaseModel):
    """UI-facing view of a single edge."""

    from_node: str
    from_exit: str
    to_node: str


class FlowView(BaseModel):
    """UI-facing view of a full flow — graph + source code + UI layout.

    `public_exits` is derived (Infer model, SPEC §12 line 425) from
    unconnected source handles, populated at response-build time from the
    loaded flow's derived public-exit map.

    `diagnostics` is populated from the workspace's current diagnostic list
    filtered to this flow_id. Set on both GETs and mutation responses so
    the UI has a single source of truth for per-flow error state.
    """

    id: str
    input_type: str
    entry_node: str
    description: str
    nodes: dict[str, NodeView]
    edges: list[EdgeView]
    public_exits: dict[str, str]
    layout: dict[str, Any]
    diagnostics: list[dict[str, Any]] = []


class WorkspaceView(BaseModel):
    """UI-facing view of a workspace's manifest data."""

    name: str
    flow_ids: list[str]


class WorkspaceList(BaseModel):
    """List of currently known (cached) workspaces."""

    workspaces: list[WorkspaceView]


class RunRequest(BaseModel):
    value: Any


class RunResponse(BaseModel):
    exit: str
    value: Any


class UpdateSourceRequest(BaseModel):
    source: str


class UpdateSourceResponse(BaseModel):
    ok: bool
    path: str
    diagnostics: list[dict[str, Any]] = []


class AddNodeRequest(BaseModel):
    """UI → server node-creation payload.

    `kind` is restricted to `"python"` and `"flow"` — the `"start"`
    sentinel cannot be user-added via this endpoint (SPEC §12 line 427;
    start nodes are structural, not semantic user content).
    """

    name: str
    kind: Literal["python", "flow"] = "python"
    ref: str = ""
    input_type: str = Field(default="typing.Any", alias="input")
    exits: dict[str, str] = Field(default_factory=lambda: {"out": "typing.Any"})
    selector_ref: str | None = Field(default=None, alias="selector")
    label: str = ""
    description: str = ""
    create_stub: bool = True

    model_config = ConfigDict(populate_by_name=True)


class AddEdgeRequest(BaseModel):
    from_node: str
    from_exit: str
    to_node: str


class DeleteEdgeRequest(BaseModel):
    from_node: str
    from_exit: str
    to_node: str | None = None


class NodeLayoutPosition(BaseModel):
    x: float
    y: float


class UpdateLayoutRequest(BaseModel):
    nodes: dict[str, NodeLayoutPosition] = Field(default_factory=dict)
    exits: dict[str, list[str]] | None = None


class UpdateLayoutResponse(BaseModel):
    ok: bool
    diagnostics: list[dict[str, Any]] = []


class TypeEntry(BaseModel):
    """A single entry in the workspace types palette."""

    qualified_name: str
    kind: str
    module: str
    source_file: str
    is_generic: bool
    scope: str
    flow_id: str | None = None


class TypePalette(BaseModel):
    types: list[TypeEntry]


class GroupCreateRequest(BaseModel):
    """Create or replace a layout group (UI folding metadata).

    Permissive: `node_ids` may include unknown ids; those surface as
    diagnostics but the group is still stored.
    """

    id: str
    node_ids: list[str]
    label: str = ""


class UpdateNodeRequest(BaseModel):
    new_name: str | None = None
    ref: str | None = None
    input: str | None = None
    exits: dict[str, str] | None = None
    rename_exits: dict[str, str] | None = None


class DiagnosticsResponse(BaseModel):
    diagnostics: list[dict[str, Any]]


class FlowTreeNode(BaseModel):
    flow_id: str
    label: str


class SubflowLink(BaseModel):
    flow_id: str
    label: str
    node_id: str


class FlowTree(BaseModel):
    flow_id: str
    label: str
    ancestors: list[FlowTreeNode]
    siblings: list[FlowTreeNode]
    subflows: list[SubflowLink]
