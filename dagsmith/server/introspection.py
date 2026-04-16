"""Ref → source path resolution and type-reference resolution helpers."""

from __future__ import annotations

import importlib
import importlib.util
import inspect
from pathlib import Path
from typing import Any

from ..diagnostics import UnresolvableRef


def source_path_from_ref(
    ref: str, flow_id: str, package_name: str, ws_root: Path
) -> str | None:
    """Resolve a `module:func` ref to its source file path.

    First tries `importlib.util.find_spec` (works for module-loads-but-
    function-missing and syntax-error-on-import cases). Falls back to
    deriving the path structurally from the relative ref + flow dir,
    which is what the UI needs to "open" a node whose file never existed
    (the next save creates it).

    Returns None only when the ref is malformed or non-relative and
    not importable.
    """
    if not ref or ":" not in ref:
        return None
    module_part, _, _ = ref.partition(":")
    if not module_part:
        return None
    anchor_package = f"{package_name}.{flow_id}"
    spec = None
    try:
        if module_part.startswith("."):
            spec = importlib.util.find_spec(module_part, package=anchor_package)
        else:
            spec = importlib.util.find_spec(module_part)
    except (ImportError, ValueError, ModuleNotFoundError):
        spec = None
    if spec is not None and spec.origin not in (None, "built-in", "frozen"):
        return spec.origin

    # Structural fallback for relative refs whose target file doesn't exist
    # (yet). Only single-dot + single-segment refs map unambiguously to
    # `<flow_dir>/<name>.py`; deeper relative refs or absolute refs fall
    # through to None.
    if module_part.startswith(".") and not module_part.startswith(".."):
        rel = module_part.lstrip(".")
        if rel and "." not in rel:
            flow_rel = flow_id.replace(".", "/")
            return str(ws_root / flow_rel / f"{rel}.py")
    return None


def read_source(
    func: Any, ref: str, flow_id: str, package_name: str, ws_root: Path
) -> tuple[str | None, str | None]:
    """Return (source_text, source_path) for the module containing a callable.

    Falls back to `source_path_from_ref` when the callable is an
    UnresolvableRef sentinel (no frame → no inspect.getsourcefile) or when
    inspect can't derive a path for any other reason.
    """
    source_file: str | None = None
    if not isinstance(func, UnresolvableRef):
        try:
            source_file = inspect.getsourcefile(func)
        except TypeError:
            source_file = None
    if source_file is None:
        source_file = source_path_from_ref(ref, flow_id, package_name, ws_root)
    if source_file is None:
        return None, None
    try:
        text = Path(source_file).read_text(encoding="utf-8")
    except OSError:
        return None, source_file
    return text, source_file


def resolve_type(type_ref: str) -> Any:
    """Resolve a fully qualified type ref to a Python class (best effort)."""
    if not type_ref or "." not in type_ref:
        return None
    module_name, _, attr_name = type_ref.rpartition(".")
    try:
        module = importlib.import_module(module_name)
    except ImportError:
        return None
    return getattr(module, attr_name, None)
