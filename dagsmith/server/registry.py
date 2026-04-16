"""Workspace registry — explicit, testable cache of loaded workspaces.

Wraps the previous module-global dict + helper functions. Routes talk
to a single instance (`registry` in `app.py`) instead of mutating
module state directly, which makes the cache injectable for tests and
keeps the server file split from scattering globals across modules.
"""

from __future__ import annotations

import importlib
import sys

from fastapi import HTTPException

from ..workspace import Workspace, WorkspaceError, load_workspace


class WorkspaceRegistry:
    def __init__(self) -> None:
        self._cache: dict[str, Workspace] = {}

    def get(self, name: str) -> Workspace:
        """Load and cache a workspace by package name."""
        if name in self._cache:
            return self._cache[name]
        try:
            importlib.import_module(name)
        except ImportError as exc:
            raise WorkspaceError(
                f"package {name!r} not found on sys.path: {exc}"
            ) from exc
        ws = load_workspace(name)
        self._cache[name] = ws
        return ws

    def reload(self, name: str) -> Workspace:
        """Drop all cached modules under this namespace and reload from scratch."""
        to_drop = [
            key
            for key in list(sys.modules.keys())
            if key == name or key.startswith(f"{name}.")
        ]
        for key in to_drop:
            del sys.modules[key]
        self._cache.pop(name, None)
        return self.get(name)

    def list(self) -> list[Workspace]:
        """Return all currently cached workspaces, in insertion order."""
        return list(self._cache.values())


def get_or_404(registry: WorkspaceRegistry, name: str) -> Workspace:
    try:
        return registry.get(name)
    except WorkspaceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
