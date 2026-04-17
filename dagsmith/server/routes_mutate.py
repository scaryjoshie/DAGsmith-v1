"""Mutation endpoints: node/edge CRUD, layout writes, source writes, reload."""

from __future__ import annotations

import inspect
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

_IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')

from ..diagnostics import UnresolvableRef
from ..workspace import WorkspaceError
from ._helpers import reload_or_500
from .introspection import source_path_from_ref
from .mutations import maybe_create_stub, read_flow_json, write_flow_json
from .registry import WorkspaceRegistry, get_or_404
from .routes_read import build_flow_view
from .schemas import (
    AddEdgeRequest,
    AddNodeRequest,
    DeleteEdgeRequest,
    FlowView,
    GroupCreateRequest,
    UpdateNodeRequest,
    UpdateLayoutRequest,
    UpdateLayoutResponse,
    UpdateSourceRequest,
    UpdateSourceResponse,
    WorkspaceView,
)


def build_router(registry: WorkspaceRegistry) -> APIRouter:
    router = APIRouter()

    @router.put(
        "/api/workspaces/{name}/flows/{flow_id}/nodes/{node_name}/source",
        response_model=UpdateSourceResponse,
    )
    def update_node_source(
        name: str,
        flow_id: str,
        node_name: str,
        request: UpdateSourceRequest,
    ) -> UpdateSourceResponse:
        ws = get_or_404(registry, name)
        try:
            spec = ws.flow_spec(flow_id)
        except WorkspaceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        node_spec = spec.nodes.get(node_name)
        if node_spec is None:
            raise HTTPException(
                status_code=404,
                detail=f"unknown node {node_name!r} in flow {flow_id!r}",
            )
        try:
            func = ws.node_callable(flow_id, node_name)
        except WorkspaceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        source_file: str | None = None
        if not isinstance(func, UnresolvableRef):
            try:
                source_file = inspect.getsourcefile(func)
            except TypeError:
                source_file = None
        if source_file is None:
            source_file = source_path_from_ref(
                node_spec.ref, flow_id, ws.package_name, ws.root
            )
        if source_file is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"could not determine source file for node {node_name!r} "
                    f"(ref {node_spec.ref!r})"
                ),
            )

        path = Path(source_file).resolve()
        try:
            path.relative_to(ws.root)
        except ValueError as exc:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"refusing to write to {path}: outside workspace root {ws.root}"
                ),
            ) from exc

        path.write_text(request.source, encoding="utf-8")
        registry.reload(name)
        ws2 = registry.get(name)
        return UpdateSourceResponse(
            ok=True,
            path=str(path),
            diagnostics=[
                d.model_dump() for d in ws2.diagnostics if d.flow_id == flow_id
            ],
        )

    @router.post(
        "/api/workspaces/{name}/flows/{flow_id}/nodes",
        response_model=FlowView,
    )
    def add_node(
        name: str, flow_id: str, request: AddNodeRequest
    ) -> FlowView:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        nodes = data.setdefault("nodes", {})
        if not isinstance(nodes, dict):
            raise HTTPException(
                status_code=500,
                detail=f"flow.json 'nodes' field is not a JSON object in {path}",
            )
        if request.name in nodes:
            raise HTTPException(
                status_code=400,
                detail=f"node {request.name!r} already exists in flow {flow_id!r}",
            )

        ref_value = request.ref.strip() or f".{request.name}:process"
        node_entry: dict[str, Any] = {
            "kind": "python",
            "ref": ref_value,
            "input": request.input_type,
            "exits": dict(request.exits),
        }
        if request.selector_ref is not None:
            node_entry["selector"] = request.selector_ref
        if request.label:
            node_entry["label"] = request.label
        if request.description:
            node_entry["description"] = request.description

        nodes[request.name] = node_entry

        if request.create_stub:
            maybe_create_stub(ws, flow_id, ref_value)

        write_flow_json(path, data)
        reload_or_500(registry, name)
        return build_flow_view(registry.get(name), flow_id)

    @router.delete(
        "/api/workspaces/{name}/flows/{flow_id}/nodes/{node_name}",
        response_model=FlowView,
    )
    def delete_node(name: str, flow_id: str, node_name: str) -> FlowView:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        nodes = data.get("nodes")
        if not isinstance(nodes, dict) or node_name not in nodes:
            raise HTTPException(
                status_code=404,
                detail=f"node {node_name!r} not found in flow {flow_id!r}",
            )
        if data.get("entry_node") == node_name:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"cannot delete node {node_name!r}: it is the entry_node of "
                    f"flow {flow_id!r}"
                ),
            )

        del nodes[node_name]

        edges = data.get("edges")
        if isinstance(edges, list):
            data["edges"] = [
                edge
                for edge in edges
                if not (
                    isinstance(edge, dict)
                    and (
                        edge.get("from_node") == node_name
                        or edge.get("to_node") == node_name
                    )
                )
            ]

        write_flow_json(path, data)
        reload_or_500(registry, name)
        return build_flow_view(registry.get(name), flow_id)

    @router.patch(
        "/api/workspaces/{name}/flows/{flow_id}/nodes/{node_name}",
        response_model=FlowView,
    )
    def update_node(
        name: str, flow_id: str, node_name: str, request: UpdateNodeRequest
    ) -> FlowView:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        nodes = data.get("nodes")
        if not isinstance(nodes, dict) or node_name not in nodes:
            raise HTTPException(
                status_code=404,
                detail=f"node {node_name!r} not found in flow {flow_id!r}",
            )

        node_entry = nodes[node_name]
        if not isinstance(node_entry, dict):
            raise HTTPException(status_code=500, detail=f"node entry for {node_name!r} is malformed")

        dirty = False

        # Apply ref update.
        if request.ref is not None:
            new_ref = request.ref.strip()
            if not new_ref:
                raise HTTPException(status_code=400, detail="ref must not be empty")
            node_entry["ref"] = new_ref
            dirty = True

        # Apply input type update.
        if request.input is not None:
            new_input = request.input.strip()
            if not new_input:
                raise HTTPException(status_code=400, detail="input must not be empty")
            node_entry["input"] = new_input
            dirty = True

        # Apply exit renames.
        if request.rename_exits:
            current_exits = node_entry.get("exits")
            if not isinstance(current_exits, dict):
                raise HTTPException(status_code=500, detail=f"exits for {node_name!r} is malformed")
            for old_exit, new_exit in request.rename_exits.items():
                new_exit = new_exit.strip()
                if not new_exit:
                    raise HTTPException(status_code=400, detail=f"exit name must not be empty")
                if not _IDENTIFIER_RE.match(new_exit):
                    raise HTTPException(
                        status_code=400,
                        detail=f"invalid exit name {new_exit!r}: must be a valid Python identifier",
                    )
                if old_exit not in current_exits:
                    raise HTTPException(status_code=400, detail=f"exit {old_exit!r} not found on node {node_name!r}")
                if new_exit != old_exit:
                    if new_exit in current_exits:
                        raise HTTPException(status_code=400, detail=f"exit {new_exit!r} already exists on node {node_name!r}")
                    current_exits[new_exit] = current_exits.pop(old_exit)
                    # Cascade rename in edges.
                    edges = data.get("edges")
                    if isinstance(edges, list):
                        for edge in edges:
                            if isinstance(edge, dict) and edge.get("from_node") == node_name and edge.get("from_exit") == old_exit:
                                edge["from_exit"] = new_exit
                    # Cascade rename in layout.exits.
                    layout = data.get("layout")
                    if isinstance(layout, dict):
                        layout_exits = layout.get("exits")
                        if isinstance(layout_exits, dict) and node_name in layout_exits:
                            order = layout_exits[node_name]
                            if isinstance(order, list):
                                layout_exits[node_name] = [new_exit if e == old_exit else e for e in order]
                    dirty = True

        # Apply exits dict (add/remove with edge cascade).
        if request.exits is not None:
            current_exits = node_entry.get("exits")
            if not isinstance(current_exits, dict):
                current_exits = {}
            if not request.exits:
                raise HTTPException(status_code=400, detail="a node must have at least one exit")
            # Validate all new exit names.
            for exit_name in request.exits:
                if not _IDENTIFIER_RE.match(exit_name):
                    raise HTTPException(
                        status_code=400,
                        detail=f"invalid exit name {exit_name!r}: must be a valid Python identifier",
                    )
            # Find removed exits and cascade-delete their edges.
            removed_exits = set(current_exits.keys()) - set(request.exits.keys())
            if removed_exits:
                edges = data.get("edges")
                if isinstance(edges, list):
                    data["edges"] = [
                        edge for edge in edges
                        if not (
                            isinstance(edge, dict)
                            and edge.get("from_node") == node_name
                            and edge.get("from_exit") in removed_exits
                        )
                    ]
                # Remove from layout.exits order too.
                layout = data.get("layout")
                if isinstance(layout, dict):
                    layout_exits = layout.get("exits")
                    if isinstance(layout_exits, dict) and node_name in layout_exits:
                        order = layout_exits[node_name]
                        if isinstance(order, list):
                            layout_exits[node_name] = [e for e in order if e not in removed_exits]
            node_entry["exits"] = dict(request.exits)
            dirty = True

        # Apply rename — must come last so ref/input patches use the original key.
        effective_name = node_name
        if request.new_name is not None:
            new_name = request.new_name.strip()
            if not new_name:
                raise HTTPException(status_code=400, detail="new_name must not be empty")
            if not _IDENTIFIER_RE.match(new_name):
                raise HTTPException(
                    status_code=400,
                    detail=f"invalid node name {new_name!r}: must be a valid Python identifier (letters, digits, underscores; no spaces or special characters)",
                )
            if new_name != node_name:
                if new_name in nodes:
                    raise HTTPException(
                        status_code=400,
                        detail=f"node {new_name!r} already exists in flow {flow_id!r}",
                    )
                nodes[new_name] = nodes.pop(node_name)
                data["nodes"] = nodes
                effective_name = new_name

                if data.get("entry_node") == node_name:
                    data["entry_node"] = new_name

                edges = data.get("edges")
                if isinstance(edges, list):
                    for edge in edges:
                        if not isinstance(edge, dict):
                            continue
                        if edge.get("from_node") == node_name:
                            edge["from_node"] = new_name
                        if edge.get("to_node") == node_name:
                            edge["to_node"] = new_name

                layout = data.get("layout")
                if isinstance(layout, dict):
                    layout_nodes = layout.get("nodes")
                    if isinstance(layout_nodes, dict) and node_name in layout_nodes:
                        layout_nodes[new_name] = layout_nodes.pop(node_name)
                dirty = True

        if not dirty:
            return build_flow_view(ws, flow_id)

        write_flow_json(path, data)
        reload_or_500(registry, name)
        return build_flow_view(registry.get(name), flow_id)

    @router.post(
        "/api/workspaces/{name}/flows/{flow_id}/edges",
        response_model=FlowView,
    )
    def add_edge(
        name: str, flow_id: str, request: AddEdgeRequest
    ) -> FlowView:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        if (request.to_node is None) == (request.to_flow_exit is None):
            raise HTTPException(
                status_code=400,
                detail="edge must target exactly one of `to_node` or `to_flow_exit`",
            )

        nodes = data.get("nodes")
        if not isinstance(nodes, dict):
            raise HTTPException(
                status_code=500,
                detail=f"flow.json 'nodes' field is not a JSON object in {path}",
            )

        from_entry = nodes.get(request.from_node)
        if not isinstance(from_entry, dict):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"from_node {request.from_node!r} does not exist in flow "
                    f"{flow_id!r}"
                ),
            )
        from_exits = from_entry.get("exits")
        if not isinstance(from_exits, dict) or request.from_exit not in from_exits:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"from_exit {request.from_exit!r} is not declared on node "
                    f"{request.from_node!r}"
                ),
            )

        if request.to_node is not None and request.to_node not in nodes:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"to_node {request.to_node!r} does not exist in flow "
                    f"{flow_id!r}"
                ),
            )
        if request.to_flow_exit is not None:
            public_exits = data.get("public_exits")
            if (
                not isinstance(public_exits, dict)
                or request.to_flow_exit not in public_exits
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"to_flow_exit {request.to_flow_exit!r} is not declared in "
                        f"public_exits"
                    ),
                )

        edges = data.setdefault("edges", [])
        if not isinstance(edges, list):
            raise HTTPException(
                status_code=500,
                detail=f"flow.json 'edges' field is not a JSON array in {path}",
            )

        # Idempotency: return unchanged view if this edge already exists.
        for existing in edges:
            if (
                isinstance(existing, dict)
                and existing.get("from_node") == request.from_node
                and existing.get("from_exit") == request.from_exit
                and existing.get("to_node") == request.to_node
                and existing.get("to_flow_exit") == request.to_flow_exit
            ):
                return build_flow_view(ws, flow_id)

        new_edge: dict[str, Any] = {
            "from_node": request.from_node,
            "from_exit": request.from_exit,
        }
        if request.to_node is not None:
            new_edge["to_node"] = request.to_node
        else:
            new_edge["to_flow_exit"] = request.to_flow_exit
        edges.append(new_edge)

        write_flow_json(path, data)
        reload_or_500(registry, name)
        return build_flow_view(registry.get(name), flow_id)

    @router.delete(
        "/api/workspaces/{name}/flows/{flow_id}/edges",
        response_model=FlowView,
    )
    def delete_edge(
        name: str, flow_id: str, request: DeleteEdgeRequest
    ) -> FlowView:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        edges = data.get("edges")
        if not isinstance(edges, list):
            raise HTTPException(
                status_code=404,
                detail=(
                    f"no edge from {request.from_node!r}:{request.from_exit!r} "
                    f"in flow {flow_id!r}"
                ),
            )

        match_index: int | None = None
        for idx, edge in enumerate(edges):
            if (
                isinstance(edge, dict)
                and edge.get("from_node") == request.from_node
                and edge.get("from_exit") == request.from_exit
            ):
                match_index = idx
                break
        if match_index is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"no edge from {request.from_node!r}:{request.from_exit!r} "
                    f"in flow {flow_id!r}"
                ),
            )

        edges.pop(match_index)
        data["edges"] = edges
        write_flow_json(path, data)
        reload_or_500(registry, name)
        return build_flow_view(registry.get(name), flow_id)

    @router.put(
        "/api/workspaces/{name}/flows/{flow_id}/layout",
        response_model=UpdateLayoutResponse,
    )
    def update_layout(
        name: str, flow_id: str, request: UpdateLayoutRequest
    ) -> UpdateLayoutResponse:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        layout = data.get("layout")
        if not isinstance(layout, dict):
            layout = {}
        if request.nodes:
            layout["nodes"] = {
                node_name: {"x": pos.x, "y": pos.y}
                for node_name, pos in request.nodes.items()
            }
        if request.exits is not None:
            layout["exits"] = dict(request.exits)
        data["layout"] = layout

        write_flow_json(path, data)
        return UpdateLayoutResponse(
            ok=True,
            diagnostics=[
                d.model_dump() for d in ws.diagnostics if d.flow_id == flow_id
            ],
        )

    @router.post(
        "/api/workspaces/{name}/flows/{flow_id}/group",
        response_model=FlowView,
    )
    def create_group(
        name: str, flow_id: str, request: GroupCreateRequest
    ) -> FlowView:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        layout = data.get("layout")
        if not isinstance(layout, dict):
            layout = {}
        groups = layout.get("groups")
        if not isinstance(groups, list):
            groups = []

        new_group: dict[str, Any] = {
            "id": request.id,
            "node_ids": list(request.node_ids),
            "label": request.label,
        }
        # Replace existing group with the same id, else append.
        replaced = False
        for idx, existing in enumerate(groups):
            if isinstance(existing, dict) and existing.get("id") == request.id:
                groups[idx] = new_group
                replaced = True
                break
        if not replaced:
            groups.append(new_group)

        layout["groups"] = groups
        data["layout"] = layout
        write_flow_json(path, data)
        reload_or_500(registry, name)
        return build_flow_view(registry.get(name), flow_id)

    @router.delete(
        "/api/workspaces/{name}/flows/{flow_id}/group/{group_id}",
        response_model=FlowView,
    )
    def delete_group(name: str, flow_id: str, group_id: str) -> FlowView:
        ws = get_or_404(registry, name)
        path, data = read_flow_json(ws, flow_id)

        layout = data.get("layout")
        if not isinstance(layout, dict):
            layout = {}
        groups = layout.get("groups")
        if not isinstance(groups, list):
            raise HTTPException(
                status_code=404,
                detail=f"no group {group_id!r} in flow {flow_id!r}",
            )

        filtered = [
            g for g in groups
            if not (isinstance(g, dict) and g.get("id") == group_id)
        ]
        if len(filtered) == len(groups):
            raise HTTPException(
                status_code=404,
                detail=f"no group {group_id!r} in flow {flow_id!r}",
            )
        layout["groups"] = filtered
        data["layout"] = layout

        write_flow_json(path, data)
        reload_or_500(registry, name)
        return build_flow_view(registry.get(name), flow_id)

    @router.post(
        "/api/workspaces/{name}/reload",
        response_model=WorkspaceView,
    )
    def reload_workspace(name: str) -> WorkspaceView:
        try:
            ws = registry.reload(name)
        except WorkspaceError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"workspace reload failed: {exc}",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"workspace reload failed: {type(exc).__name__}: {exc}",
            ) from exc
        return WorkspaceView(name=ws.package_name, flow_ids=ws.flow_ids)

    return router
