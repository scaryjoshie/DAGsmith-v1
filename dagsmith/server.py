"""FastAPI backend for the DAGsmith visual UI.

Serves workspace data and executes flows via HTTP. The frontend is a
React SPA (typically Vite dev server during development) that fetches
from this backend.

Not imported by default — requires the `ui` optional extras
(`uv sync --all-extras` or `pip install dagsmith[ui]`).
"""

from __future__ import annotations

import importlib
import inspect
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .workspace import Workspace, WorkspaceError, load_workspace


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
    to_node: str | None
    to_flow_exit: str | None


class FlowView(BaseModel):
    """UI-facing view of a full flow — graph + source code."""

    id: str
    input_type: str
    entry_node: str
    description: str
    nodes: dict[str, NodeView]
    edges: list[EdgeView]
    public_exits: dict[str, str]


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


app = FastAPI(title="DAGsmith UI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


_workspace_cache: dict[str, Workspace] = {}


def _load_cached(name: str) -> Workspace:
    """Load and cache a workspace by package name."""
    if name in _workspace_cache:
        return _workspace_cache[name]
    try:
        importlib.import_module(name)
    except ImportError as exc:
        raise WorkspaceError(
            f"package {name!r} not found on sys.path: {exc}"
        ) from exc
    ws = load_workspace(name)
    _workspace_cache[name] = ws
    return ws


def preload_workspace(name: str) -> Workspace:
    """Preload a workspace into the cache (called from the CLI at startup)."""
    return _load_cached(name)


def _get_or_404(name: str) -> Workspace:
    try:
        return _load_cached(name)
    except WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _read_source(func: Any) -> tuple[str | None, str | None]:
    """Return (source_text, source_path) for the module containing a callable."""
    try:
        source_file = inspect.getsourcefile(func)
    except TypeError:
        return None, None
    if source_file is None:
        return None, None
    try:
        text = Path(source_file).read_text(encoding="utf-8")
    except OSError:
        return None, None
    return text, source_file


def _resolve_type(type_ref: str) -> Any:
    """Resolve a fully qualified type ref to a Python class (best effort)."""
    if not type_ref or "." not in type_ref:
        return None
    module_name, _, attr_name = type_ref.rpartition(".")
    try:
        module = importlib.import_module(module_name)
    except ImportError:
        return None
    return getattr(module, attr_name, None)


@app.get("/api/workspaces", response_model=WorkspaceList)
def list_workspaces() -> WorkspaceList:
    """List all workspaces the backend has loaded so far.

    Starts with whatever was preloaded via the CLI; grows as the
    frontend fetches additional workspaces on demand.
    """
    return WorkspaceList(
        workspaces=[
            WorkspaceView(name=ws.package_name, flow_ids=ws.flow_ids)
            for ws in _workspace_cache.values()
        ]
    )


@app.get("/api/workspaces/{name}", response_model=WorkspaceView)
def get_workspace(name: str) -> WorkspaceView:
    ws = _get_or_404(name)
    return WorkspaceView(name=ws.package_name, flow_ids=ws.flow_ids)


@app.get(
    "/api/workspaces/{name}/flows/{flow_id}",
    response_model=FlowView,
)
def get_flow(name: str, flow_id: str) -> FlowView:
    ws = _get_or_404(name)
    try:
        spec = ws.flow_spec(flow_id)
    except WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    nodes: dict[str, NodeView] = {}
    for node_name, node_spec in spec.nodes.items():
        func = ws.node_callable(flow_id, node_name)
        source_code, source_path = _read_source(func)
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
            to_flow_exit=edge.to_flow_exit,
        )
        for edge in spec.edges
    ]

    return FlowView(
        id=spec.id,
        input_type=spec.input_type,
        entry_node=spec.entry_node,
        description=spec.description,
        nodes=nodes,
        edges=edges,
        public_exits=dict(spec.public_exits),
    )


@app.post(
    "/api/workspaces/{name}/flows/{flow_id}/run",
    response_model=RunResponse,
)
def run_flow(name: str, flow_id: str, request: RunRequest) -> RunResponse:
    ws = _get_or_404(name)
    try:
        spec = ws.flow_spec(flow_id)
    except WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    input_cls = _resolve_type(spec.input_type)
    try:
        if input_cls is not None and hasattr(input_cls, "model_validate"):
            value = input_cls.model_validate(request.value)
        else:
            value = request.value
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"could not coerce input to {spec.input_type!r}: {exc}",
        ) from exc

    try:
        result = ws.flow(flow_id)(value)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"flow execution failed: {type(exc).__name__}: {exc}",
        ) from exc

    if hasattr(result.value, "model_dump"):
        value_dump: Any = result.value.model_dump()
    else:
        try:
            # Let FastAPI try to JSON-encode it directly.
            import json as _json

            _json.dumps(result.value)
            value_dump = result.value
        except (TypeError, ValueError):
            value_dump = repr(result.value)

    return RunResponse(exit=result.exit, value=value_dump)
