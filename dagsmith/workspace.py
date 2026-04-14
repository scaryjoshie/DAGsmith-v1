"""Workspace container and filesystem loader for DAGsmith flows."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any, Dict, Mapping, Union

from .model import FlowSpec
from .validation import validate_flow

RESERVED_DIRECTORY_NAMES = frozenset({"shared", "datatypes"})


class WorkspaceLoadError(ValueError):
    """Raised when a filesystem workspace cannot be loaded."""


@dataclass
class Workspace:
    """In-memory registry of flows keyed by ID."""

    flows: Dict[str, FlowSpec] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.flows = {
            flow_id: flow if isinstance(flow, FlowSpec) else FlowSpec.from_dict(flow)
            for flow_id, flow in self.flows.items()
        }

    def register_flow(self, flow: FlowSpec) -> None:
        self.flows[flow.id] = flow

    def get_flow(self, flow_id: str) -> FlowSpec:
        return self.flows[flow_id]

    def to_dict(self) -> Dict[str, Any]:
        return {"flows": {flow_id: flow.to_dict() for flow_id, flow in self.flows.items()}}

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "Workspace":
        return cls(flows=data.get("flows", {}))

    @classmethod
    def from_directory(
        cls,
        root: Union[str, Path],
        *,
        validate: bool = True,
    ) -> "Workspace":
        """Load a workspace from a Python package directory on disk."""

        package_root = Path(root).expanduser().resolve()
        _validate_package_root(package_root)
        _load_manifest(package_root)

        flows: Dict[str, FlowSpec] = {}
        for flow_path in sorted(package_root.rglob("flow.json")):
            relative_path = flow_path.relative_to(package_root)
            if relative_path.parent == Path("."):
                raise WorkspaceLoadError("root-level flow.json is not allowed")
            _validate_flow_parent(relative_path.parent)

            flow_data = _read_json_object(flow_path, label="flow file")
            derived_flow_id = ".".join(relative_path.parent.parts)
            declared_flow_id = flow_data.get("id")
            if declared_flow_id != derived_flow_id:
                raise WorkspaceLoadError(
                    "flow %s declares id %r but must match derived id %r"
                    % (flow_path, declared_flow_id, derived_flow_id)
                )

            flow = FlowSpec.from_dict(flow_data)
            flows[flow.id] = validate_flow(flow) if validate else flow

        return cls(flows=flows)


def _validate_package_root(package_root: Path) -> None:
    if not package_root.exists():
        raise WorkspaceLoadError("workspace root %s does not exist" % package_root)
    if not package_root.is_dir():
        raise WorkspaceLoadError("workspace root %s is not a directory" % package_root)
    if not (package_root / "__init__.py").exists():
        raise WorkspaceLoadError("workspace root %s must contain __init__.py" % package_root)


def _validate_flow_parent(relative_parent: Path) -> None:
    reserved = [part for part in relative_parent.parts if part in RESERVED_DIRECTORY_NAMES]
    if reserved:
        raise WorkspaceLoadError(
            "flow paths cannot use reserved support directories: %s"
            % ", ".join(sorted(set(reserved)))
        )


def _load_manifest(package_root: Path) -> Dict[str, Any]:
    manifest_path = package_root / "dagsmith.json"
    if not manifest_path.exists():
        return {}
    return _read_json_object(manifest_path, label="manifest")


def _read_json_object(path: Path, *, label: str) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkspaceLoadError("invalid %s JSON in %s: %s" % (label, path, exc)) from exc

    if not isinstance(data, dict):
        raise WorkspaceLoadError("%s %s must contain a JSON object" % (label, path))
    return data
