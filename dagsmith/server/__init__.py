"""DAGsmith server package (FastAPI backend for the visual UI).

Re-exports the module-level `app`, `registry`, `preload_workspace`, and
`create_app` so existing callers (`from dagsmith.server import app`,
`from dagsmith import server`) keep working after the package split.

Not imported by default — requires the `ui` optional extras
(`uv sync --all-extras` or `pip install dagsmith[ui]`).
"""

from __future__ import annotations

from .app import app, create_app, preload_workspace, registry
from .registry import WorkspaceRegistry
from .schemas import (
    AddEdgeRequest,
    AddNodeRequest,
    DeleteEdgeRequest,
    EdgeView,
    FlowView,
    NodeLayoutPosition,
    NodeView,
    RunRequest,
    RunResponse,
    UpdateLayoutRequest,
    UpdateLayoutResponse,
    UpdateSourceRequest,
    UpdateSourceResponse,
    WorkspaceList,
    WorkspaceView,
)

__all__ = [
    "AddEdgeRequest",
    "AddNodeRequest",
    "DeleteEdgeRequest",
    "EdgeView",
    "FlowView",
    "NodeLayoutPosition",
    "NodeView",
    "RunRequest",
    "RunResponse",
    "UpdateLayoutRequest",
    "UpdateLayoutResponse",
    "UpdateSourceRequest",
    "UpdateSourceResponse",
    "WorkspaceList",
    "WorkspaceRegistry",
    "WorkspaceView",
    "app",
    "create_app",
    "preload_workspace",
    "registry",
]
