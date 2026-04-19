"""Read-only endpoints: workspace/flow listing and flow views."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..workspace import Workspace, WorkspaceError
from .introspection import read_source
from .mutations import read_flow_json
from .registry import WorkspaceRegistry, get_or_404
from .schemas import (
    EdgeView,
    FlowView,
    NodeView,
    WorkspaceList,
    WorkspaceView,
)


def build_flow_view(ws: Workspace, flow_id: str) -> FlowView:
    """Build the full FlowView (nodes + edges + layout) for a flow.

    Shared by GET /flow/{fid} and mutation handlers that return the updated
    flow view after writing flow.json.
    """
    try:
        spec = ws.flow_spec(flow_id)
    except WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    nodes: dict[str, NodeView] = {}
    for node_name, node_spec in spec.nodes.items():
        # Start nodes (SPEC §12 line 427) have no callable and no source.
        if node_spec.kind == "start":
            source_code, source_path = None, None
        else:
            func = ws.node_callable(flow_id, node_name)
            source_code, source_path = read_source(
                func, node_spec.ref, flow_id, ws.package_name, ws.root
            )
        nodes[node_name] = NodeView(
            name=node_name,
            kind=node_spec.kind,
            ref=node_spec.ref,
            selector_ref=node_spec.selector_ref,
            input_type=node_spec.input_type,
            exits=dict(node_spec.exits),
            label=node_spec.label,
            description=node_spec.description,
            source_code=source_code,
            source_path=source_path,
        )

    edges = [
        EdgeView(
            from_node=edge.from_node,
            from_exit=edge.from_exit,
            to_node=edge.to_node,
        )
        for edge in spec.edges
    ]

    # Read layout fresh from disk — PUT /layout does not reload the workspace
    # (layout is opaque to the runtime), so the in-memory spec can be stale
    # on layout specifically.
    try:
        _, raw = read_flow_json(ws, flow_id)
        layout_data = raw.get("layout", {}) or {}
    except HTTPException:
        layout_data = dict(spec.layout)

    # Infer model (SPEC §12 line 425): public_exits is derived, stored on the
    # loaded flow by the workspace loader. Not persisted to flow.json.
    loaded_public_exits = dict(ws.public_exits(flow_id))

    return FlowView(
        id=spec.id,
        input_type=spec.input_type,
        entry_node=spec.entry_node,
        description=spec.description,
        nodes=nodes,
        edges=edges,
        public_exits=loaded_public_exits,
        layout=layout_data,
        diagnostics=[
            d.model_dump() for d in ws.diagnostics if d.flow_id == flow_id
        ],
    )


def build_router(registry: WorkspaceRegistry) -> APIRouter:
    router = APIRouter()

    @router.get("/api/workspaces", response_model=WorkspaceList)
    def list_workspaces() -> WorkspaceList:
        return WorkspaceList(
            workspaces=[
                WorkspaceView(name=ws.package_name, flow_ids=ws.flow_ids)
                for ws in registry.list()
            ]
        )

    @router.get("/api/workspaces/{name}", response_model=WorkspaceView)
    def get_workspace(name: str) -> WorkspaceView:
        ws = get_or_404(registry, name)
        return WorkspaceView(name=ws.package_name, flow_ids=ws.flow_ids)

    @router.get(
        "/api/workspaces/{name}/flows/{flow_id}",
        response_model=FlowView,
    )
    def get_flow(name: str, flow_id: str) -> FlowView:
        ws = get_or_404(registry, name)
        return build_flow_view(ws, flow_id)

    return router
