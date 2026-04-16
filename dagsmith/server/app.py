"""FastAPI app wiring, CORS, and the module-level default instance."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..workspace import Workspace
from .registry import WorkspaceRegistry
from . import routes_introspect, routes_mutate, routes_read, routes_run


def create_app(registry: WorkspaceRegistry | None = None) -> FastAPI:
    """Construct a FastAPI app bound to the given (or a fresh) registry.

    Exposes the registry on `app.state.registry` for tests and handlers
    that need to reach it without a second reference.
    """
    app = FastAPI(title="DAGsmith UI")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    reg = registry or WorkspaceRegistry()
    app.state.registry = reg
    app.include_router(routes_read.build_router(reg))
    app.include_router(routes_mutate.build_router(reg))
    app.include_router(routes_run.build_router(reg))
    app.include_router(routes_introspect.build_router(reg))
    return app


# Module-level defaults — the CLI preloads into `registry`, and `app` is
# the FastAPI instance uvicorn serves.
registry = WorkspaceRegistry()
app = create_app(registry)


def preload_workspace(name: str) -> Workspace:
    """Preload a workspace into the module-level registry (called from CLI)."""
    return registry.get(name)
