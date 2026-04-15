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
import json
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

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
    """UI-facing view of a full flow — graph + source code + UI layout."""

    id: str
    input_type: str
    entry_node: str
    description: str
    nodes: dict[str, NodeView]
    edges: list[EdgeView]
    public_exits: dict[str, str]
    layout: dict[str, Any]


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


class AddNodeRequest(BaseModel):
    name: str
    ref: str
    input_type: str = Field(alias="input")
    exits: dict[str, str]
    selector_ref: str | None = Field(default=None, alias="selector")
    label: str = ""
    description: str = ""
    create_stub: bool = True

    model_config = ConfigDict(populate_by_name=True)


class AddEdgeRequest(BaseModel):
    from_node: str
    from_exit: str
    to_node: str | None = None
    to_flow_exit: str | None = None


class DeleteEdgeRequest(BaseModel):
    from_node: str
    from_exit: str


class NodeLayoutPosition(BaseModel):
    x: float
    y: float


class UpdateLayoutRequest(BaseModel):
    nodes: dict[str, NodeLayoutPosition]


class UpdateLayoutResponse(BaseModel):
    ok: bool


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


def _reload_workspace(name: str) -> Workspace:
    """Drop all cached modules under this namespace and reload from scratch."""
    to_drop = [
        key
        for key in list(sys.modules.keys())
        if key == name or key.startswith(f"{name}.")
    ]
    for key in to_drop:
        del sys.modules[key]
    _workspace_cache.pop(name, None)
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


def _read_flow_json(ws: Workspace, flow_id: str) -> tuple[Path, dict[str, Any]]:
    """Return (path, parsed dict) for a flow's flow.json."""
    flow_rel = flow_id.replace(".", "/")
    path = ws.root / flow_rel / "flow.json"
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"flow.json for {flow_id!r} not found at {path}",
        )
    with path.open("r", encoding="utf-8") as f:
        return path, json.load(f)


def _write_flow_json(path: Path, data: dict[str, Any]) -> None:
    """Write flow.json atomically with 2-space indent."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)


def _maybe_create_stub(ws: Workspace, flow_id: str, ref: str) -> None:
    """If the ref points at a missing relative module, create a stub .py file."""
    if not ref.startswith("."):
        return
    module_part, _, func_name = ref.partition(":")
    if not func_name:
        return
    if module_part.count(".") > 1:
        return
    rel = module_part.lstrip(".")
    if not rel:
        return
    flow_rel = flow_id.replace(".", "/")
    flow_dir = ws.root / flow_rel
    target = flow_dir / f"{rel}.py"
    if target.exists():
        return
    stub = (
        f'"""The `{flow_id.split(".")[-1]}:{func_name}` node stub."""\n\n'
        f'from typing import Any\n\n\n'
        f'def {func_name}(value: Any) -> Any:\n'
        f'    # TODO: implement\n'
        f'    return value\n'
    )
    target.write_text(stub, encoding="utf-8")


def _reload_and_get_flow(name: str, flow_id: str) -> FlowView:
    """Reload the workspace and return a fresh FlowView, mapping errors to HTTP 500."""
    try:
        _reload_workspace(name)
    except WorkspaceError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"workspace reload failed after mutation: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                f"workspace reload failed after mutation: "
                f"{type(exc).__name__}: {exc}"
            ),
        ) from exc
    return get_flow(name, flow_id)


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

    # Read layout fresh from disk — the PUT /layout endpoint does not reload
    # the workspace (layout is opaque to the runtime), so the in-memory spec
    # can be stale on layout specifically. A tiny extra JSON parse per GET is
    # the cost of round-tripping dragged positions without forcing a reload.
    try:
        _, raw = _read_flow_json(ws, flow_id)
        layout_data = raw.get("layout", {}) or {}
    except HTTPException:
        layout_data = dict(spec.layout)

    return FlowView(
        id=spec.id,
        input_type=spec.input_type,
        entry_node=spec.entry_node,
        description=spec.description,
        nodes=nodes,
        edges=edges,
        public_exits=dict(spec.public_exits),
        layout=layout_data,
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


@app.put(
    "/api/workspaces/{name}/flows/{flow_id}/nodes/{node_name}/source",
    response_model=UpdateSourceResponse,
)
def update_node_source(
    name: str,
    flow_id: str,
    node_name: str,
    request: UpdateSourceRequest,
) -> UpdateSourceResponse:
    ws = _get_or_404(name)
    try:
        func = ws.node_callable(flow_id, node_name)
    except WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        source_file = inspect.getsourcefile(func)
    except TypeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"could not determine source file for node {node_name!r}: {exc}",
        ) from exc
    if source_file is None:
        raise HTTPException(
            status_code=400,
            detail=f"could not determine source file for node {node_name!r}",
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
    _reload_workspace(name)
    return UpdateSourceResponse(ok=True, path=str(path))


@app.post(
    "/api/workspaces/{name}/flows/{flow_id}/nodes",
    response_model=FlowView,
)
def add_node(
    name: str, flow_id: str, request: AddNodeRequest
) -> FlowView:
    ws = _get_or_404(name)
    path, data = _read_flow_json(ws, flow_id)

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

    node_entry: dict[str, Any] = {
        "kind": "python",
        "ref": request.ref,
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
        _maybe_create_stub(ws, flow_id, request.ref)

    _write_flow_json(path, data)
    return _reload_and_get_flow(name, flow_id)


@app.delete(
    "/api/workspaces/{name}/flows/{flow_id}/nodes/{node_name}",
    response_model=FlowView,
)
def delete_node(name: str, flow_id: str, node_name: str) -> FlowView:
    ws = _get_or_404(name)
    path, data = _read_flow_json(ws, flow_id)

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
                and (edge.get("from_node") == node_name or edge.get("to_node") == node_name)
            )
        ]

    _write_flow_json(path, data)
    return _reload_and_get_flow(name, flow_id)


@app.post(
    "/api/workspaces/{name}/flows/{flow_id}/edges",
    response_model=FlowView,
)
def add_edge(
    name: str, flow_id: str, request: AddEdgeRequest
) -> FlowView:
    ws = _get_or_404(name)
    path, data = _read_flow_json(ws, flow_id)

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
            detail=f"from_node {request.from_node!r} does not exist in flow {flow_id!r}",
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
            detail=f"to_node {request.to_node!r} does not exist in flow {flow_id!r}",
        )
    if request.to_flow_exit is not None:
        public_exits = data.get("public_exits")
        if not isinstance(public_exits, dict) or request.to_flow_exit not in public_exits:
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
    for edge in edges:
        if (
            isinstance(edge, dict)
            and edge.get("from_node") == request.from_node
            and edge.get("from_exit") == request.from_exit
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"an edge from {request.from_node!r}:{request.from_exit!r} "
                    f"already exists"
                ),
            )

    new_edge: dict[str, Any] = {
        "from_node": request.from_node,
        "from_exit": request.from_exit,
    }
    if request.to_node is not None:
        new_edge["to_node"] = request.to_node
    else:
        new_edge["to_flow_exit"] = request.to_flow_exit
    edges.append(new_edge)

    _write_flow_json(path, data)
    return _reload_and_get_flow(name, flow_id)


@app.delete(
    "/api/workspaces/{name}/flows/{flow_id}/edges",
    response_model=FlowView,
)
def delete_edge(
    name: str, flow_id: str, request: DeleteEdgeRequest
) -> FlowView:
    ws = _get_or_404(name)
    path, data = _read_flow_json(ws, flow_id)

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
    _write_flow_json(path, data)
    return _reload_and_get_flow(name, flow_id)


@app.put(
    "/api/workspaces/{name}/flows/{flow_id}/layout",
    response_model=UpdateLayoutResponse,
)
def update_layout(
    name: str, flow_id: str, request: UpdateLayoutRequest
) -> UpdateLayoutResponse:
    ws = _get_or_404(name)
    path, data = _read_flow_json(ws, flow_id)

    layout = data.get("layout")
    if not isinstance(layout, dict):
        layout = {}
    layout["nodes"] = {
        node_name: {"x": pos.x, "y": pos.y}
        for node_name, pos in request.nodes.items()
    }
    data["layout"] = layout

    _write_flow_json(path, data)
    return UpdateLayoutResponse(ok=True)


@app.post(
    "/api/workspaces/{name}/reload",
    response_model=WorkspaceView,
)
def reload_workspace(name: str) -> WorkspaceView:
    try:
        ws = _reload_workspace(name)
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
