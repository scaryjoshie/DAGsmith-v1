"""Introspection endpoints: types palette, diagnostics, flow tree."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..workspace import WorkspaceError
from .registry import WorkspaceRegistry, get_or_404
from .schemas import (
    DiagnosticsResponse,
    FlowTree,
    FlowTreeNode,
    SubflowLink,
    TypeEntry,
    TypePalette,
)
from .types_palette import build_types_palette


def _label_for_flow_id(flow_id: str) -> str:
    """Take the last dotted segment as the human-readable label."""
    return flow_id.rsplit(".", 1)[-1]


def build_router(registry: WorkspaceRegistry) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/workspaces/{name}/types",
        response_model=TypePalette,
    )
    def list_types(name: str) -> TypePalette:
        ws = get_or_404(registry, name)
        return TypePalette(
            types=[TypeEntry(**entry) for entry in build_types_palette(ws)]
        )

    @router.get(
        "/api/workspaces/{name}/diagnostics",
        response_model=DiagnosticsResponse,
    )
    def workspace_diagnostics(name: str) -> DiagnosticsResponse:
        ws = get_or_404(registry, name)
        return DiagnosticsResponse(
            diagnostics=[d.model_dump() for d in ws.diagnostics]
        )

    @router.get(
        "/api/workspaces/{name}/flows/{flow_id}/diagnostics",
        response_model=DiagnosticsResponse,
    )
    def flow_diagnostics(name: str, flow_id: str) -> DiagnosticsResponse:
        ws = get_or_404(registry, name)
        if flow_id not in ws.flow_ids:
            raise HTTPException(
                status_code=404,
                detail=f"unknown flow {flow_id!r} in workspace {name!r}",
            )
        return DiagnosticsResponse(
            diagnostics=[
                d.model_dump() for d in ws.diagnostics if d.flow_id == flow_id
            ]
        )

    @router.get(
        "/api/workspaces/{name}/flows/{flow_id}/tree",
        response_model=FlowTree,
    )
    def flow_tree(name: str, flow_id: str) -> FlowTree:
        ws = get_or_404(registry, name)
        if flow_id not in ws.flow_ids:
            raise HTTPException(
                status_code=404,
                detail=f"unknown flow {flow_id!r} in workspace {name!r}",
            )

        # Ancestors: every prefix of the dotted path that is itself a flow.
        parts = flow_id.split(".")
        ancestors: list[FlowTreeNode] = []
        for i in range(1, len(parts)):
            prefix = ".".join(parts[:i])
            if prefix in ws.flow_ids:
                ancestors.append(
                    FlowTreeNode(flow_id=prefix, label=_label_for_flow_id(prefix))
                )

        # Siblings: flows with the same dotted prefix but different final
        # segment. Two branches: root-level flows (no dot) are siblings with
        # all other root-level flows; nested flows are siblings with flows
        # sharing their parent's dotted prefix at the same depth.
        if len(parts) == 1:
            sibling_prefix = ""
            sibling_depth = 1
        else:
            sibling_prefix = ".".join(parts[:-1]) + "."
            sibling_depth = len(parts)

        siblings: list[FlowTreeNode] = []
        for other in ws.flow_ids:
            if other == flow_id:
                continue
            other_parts = other.split(".")
            if len(other_parts) != sibling_depth:
                continue
            if sibling_prefix and not other.startswith(sibling_prefix):
                continue
            if not sibling_prefix and "." in other:
                continue
            siblings.append(
                FlowTreeNode(flow_id=other, label=_label_for_flow_id(other))
            )

        # Subflows: nodes in this flow with kind="flow" — their refs are
        # subflow flow_ids (can cross dotted-path boundaries). If a ref is
        # unresolved (no matching flow), we still return it — the caller can
        # render it with a diagnostic.
        try:
            spec = ws.flow_spec(flow_id)
        except WorkspaceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        subflows: list[SubflowLink] = []
        for node_id, node_spec in spec.nodes.items():
            if node_spec.kind == "flow":
                subflows.append(
                    SubflowLink(
                        flow_id=node_spec.ref,
                        label=_label_for_flow_id(node_spec.ref),
                        node_id=node_id,
                    )
                )

        return FlowTree(
            flow_id=flow_id,
            label=_label_for_flow_id(flow_id),
            ancestors=ancestors,
            siblings=siblings,
            subflows=subflows,
        )

    return router
