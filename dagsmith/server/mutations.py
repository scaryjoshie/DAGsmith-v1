"""Atomic flow.json reads/writes and stub creation for mutation endpoints."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..workspace import Workspace


def read_flow_json(ws: Workspace, flow_id: str) -> tuple[Path, dict[str, Any]]:
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


def write_flow_json(path: Path, data: dict[str, Any]) -> None:
    """Write flow.json atomically with 2-space indent."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)


def maybe_create_stub(ws: Workspace, flow_id: str, ref: str) -> None:
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
