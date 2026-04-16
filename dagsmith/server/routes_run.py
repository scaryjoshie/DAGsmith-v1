"""Flow-execution endpoints."""

from __future__ import annotations

import json as _json
from typing import Any

from fastapi import APIRouter, HTTPException

from ..workspace import WorkspaceError
from .introspection import resolve_type
from .registry import WorkspaceRegistry, get_or_404
from .schemas import RunRequest, RunResponse


def build_router(registry: WorkspaceRegistry) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/api/workspaces/{name}/flows/{flow_id}/run",
        response_model=RunResponse,
    )
    def run_flow(name: str, flow_id: str, request: RunRequest) -> RunResponse:
        ws = get_or_404(registry, name)
        try:
            spec = ws.flow_spec(flow_id)
        except WorkspaceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        input_cls = resolve_type(spec.input_type)
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
                _json.dumps(result.value)
                value_dump = result.value
            except (TypeError, ValueError):
                value_dump = repr(result.value)

        return RunResponse(exit=result.exit, value=value_dump)

    return router
