"""Type-palette introspection for GET /workspace/{w}/types.

Walks modules already imported under a workspace's package namespace and
classifies the public types found there by kind and scope:

* `kind`: pydantic | dataclass | enum | named_tuple | typed_dict
* `scope`: flow_local | workspace | shared | external

Scope is derived from the type's defining source file relative to the
workspace root:

* `<ws_root>/<flow_dir>/types/` or anywhere under `<flow_dir>/` → flow_local
  (attributed to the innermost flow whose dotted path contains the file)
* `<ws_root>/types/` or `<ws_root>/<module>.py` → workspace
* `<ws_root>/shared/` → shared
* anything outside the workspace root → external (skipped)

PEP 695 type aliases are a known gap — they don't surface via getattr
walking and need AST scanning to pick up. Deferred.
"""

from __future__ import annotations

import dataclasses
import enum
import inspect
import sys
import typing
from pathlib import Path
from typing import Any

from pydantic import BaseModel as _PydanticBaseModel

from ..workspace import Workspace


_KIND_ORDER = {
    "pydantic": 0,
    "dataclass": 1,
    "enum": 2,
    "named_tuple": 3,
    "typed_dict": 4,
}

_SCOPE_ORDER = {
    "flow_local": 0,
    "workspace": 1,
    "shared": 2,
    "external": 3,
}


def _classify_kind(obj: Any) -> str | None:
    """Return the type kind for an object, or None if it is not a palette type."""
    if not isinstance(obj, type):
        return None

    # TypedDict first — TypedDict classes are dict subclasses with these attrs.
    if isinstance(obj, type(typing.TypedDict("_", {}))) or (
        hasattr(obj, "__required_keys__")
        and hasattr(obj, "__optional_keys__")
        and issubclass(obj, dict)
    ):
        return "typed_dict"

    # NamedTuple — tuple subclass with `_fields`, but not the raw tuple.
    if (
        issubclass(obj, tuple)
        and obj is not tuple
        and hasattr(obj, "_fields")
        and hasattr(obj, "_field_defaults")
    ):
        return "named_tuple"

    if issubclass(obj, enum.Enum):
        return "enum"

    if dataclasses.is_dataclass(obj):
        return "dataclass"

    try:
        if issubclass(obj, _PydanticBaseModel) and obj is not _PydanticBaseModel:
            return "pydantic"
    except TypeError:
        pass

    return None


def _is_generic(obj: Any) -> bool:
    """Heuristic: does the class declare any type parameters?"""
    params = getattr(obj, "__parameters__", ())
    return bool(params)


def _scope_for_path(
    source_path: Path,
    ws_root: Path,
    flow_dirs: dict[str, Path],
) -> tuple[str, str | None]:
    """Return (scope, owning_flow_id) for a source file under the workspace.

    `flow_dirs` maps flow_id → absolute flow directory. The flow_local scope
    matches the most specific (deepest-dotted) flow whose directory contains
    the source file.
    """
    try:
        source_path.resolve().relative_to(ws_root)
    except ValueError:
        return "external", None

    resolved = source_path.resolve()

    # Pick the flow whose dir contains the file, preferring the deepest match
    # (so that nested flows win over their parents).
    best: tuple[int, str] | None = None
    for flow_id, flow_dir in flow_dirs.items():
        try:
            resolved.relative_to(flow_dir.resolve())
        except ValueError:
            continue
        depth = flow_id.count(".")
        if best is None or depth > best[0]:
            best = (depth, flow_id)
    if best is not None:
        return "flow_local", best[1]

    # Outside any flow dir but inside the workspace root.
    try:
        rel = resolved.relative_to(ws_root)
    except ValueError:
        return "external", None

    top_segment = rel.parts[0] if rel.parts else ""
    if top_segment == "shared":
        return "shared", None
    return "workspace", None


def build_types_palette(ws: Workspace) -> list[dict[str, Any]]:
    """Return the type palette list for a workspace.

    Each entry: {qualified_name, kind, module, source_file, is_generic,
    scope, flow_id}.
    """
    pkg = ws.package_name
    ws_root = ws.root.resolve()

    flow_dirs: dict[str, Path] = {
        flow_id: ws.root / Path(*flow_id.split("."))
        for flow_id in ws.flow_ids
    }

    seen: dict[str, dict[str, Any]] = {}

    for mod_name in list(sys.modules.keys()):
        if mod_name != pkg and not mod_name.startswith(pkg + "."):
            continue
        module = sys.modules[mod_name]
        if module is None:
            continue
        for attr_name in dir(module):
            if attr_name.startswith("_"):
                continue
            obj = getattr(module, attr_name, None)
            kind = _classify_kind(obj)
            if kind is None:
                continue

            # Only include types actually defined in this module (avoid
            # re-exporting pydantic.BaseModel or typing.* imports).
            obj_module = getattr(obj, "__module__", None)
            if obj_module != mod_name:
                continue

            try:
                source_file_str = inspect.getsourcefile(obj)
            except TypeError:
                source_file_str = None
            if source_file_str is None:
                continue
            source_file = Path(source_file_str)

            scope, flow_id = _scope_for_path(source_file, ws_root, flow_dirs)
            if scope == "external":
                continue

            qualified = f"{mod_name}.{attr_name}"
            if qualified in seen:
                continue

            seen[qualified] = {
                "qualified_name": qualified,
                "kind": kind,
                "module": mod_name,
                "source_file": str(source_file.resolve()),
                "is_generic": _is_generic(obj),
                "scope": scope,
                "flow_id": flow_id,
            }

    return sorted(
        seen.values(),
        key=lambda t: (
            _SCOPE_ORDER.get(t["scope"], 99),
            t.get("flow_id") or "",
            _KIND_ORDER.get(t["kind"], 99),
            t["qualified_name"],
        ),
    )
