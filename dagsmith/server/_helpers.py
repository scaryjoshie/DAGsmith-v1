"""Shared helpers for route modules."""

from __future__ import annotations

from fastapi import HTTPException

from ..workspace import WorkspaceError
from .registry import WorkspaceRegistry


def reload_or_500(registry: WorkspaceRegistry, name: str) -> None:
    """Reload the workspace; map failures to HTTP 500 so handlers can return."""
    try:
        registry.reload(name)
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
