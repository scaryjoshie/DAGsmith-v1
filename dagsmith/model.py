"""Small, explicit data structures for DAGsmith flows."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Mapping, Optional, Tuple

TypeRef = str
DEFAULT_EXIT_NAME = "out"
VALID_NODE_KINDS = frozenset({"python", "flow"})


def _text(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s must be a non-empty string" % field_name)
    return value.strip()


@dataclass(frozen=True)
class ExitSpec:
    """Payload contract for a named exit."""

    type_ref: TypeRef
    description: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "type_ref", _text(self.type_ref, "type_ref"))
        object.__setattr__(self, "description", self.description or "")

    @classmethod
    def from_value(cls, raw: Any) -> "ExitSpec":
        if isinstance(raw, cls):
            return raw
        if isinstance(raw, str):
            return cls(type_ref=raw)
        if isinstance(raw, Mapping):
            return cls(type_ref=raw["type"], description=raw.get("description", ""))
        raise TypeError("exit specs must be strings, mappings, or ExitSpec values")

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {"type": self.type_ref}
        if self.description:
            data["description"] = self.description
        return data


def _normalize_exits(raw: Mapping[str, Any]) -> Dict[str, ExitSpec]:
    exits = {_text(name, "exit name"): ExitSpec.from_value(spec) for name, spec in raw.items()}
    if not exits:
        raise ValueError("at least one exit is required")
    return exits


def _normalize_layout(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise TypeError("layout must be a mapping when provided")
    return dict(raw)


@dataclass(frozen=True)
class NodeSpec:
    """A python callable or nested flow used as a node."""

    kind: str
    ref: str
    input_type: TypeRef
    exits: Mapping[str, ExitSpec]
    selector_ref: Optional[str] = None
    label: str = ""
    description: str = ""

    def __post_init__(self) -> None:
        kind = _text(self.kind, "kind")
        if kind not in VALID_NODE_KINDS:
            raise ValueError("kind must be one of %s" % sorted(VALID_NODE_KINDS))

        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "ref", _text(self.ref, "ref"))
        object.__setattr__(self, "input_type", _text(self.input_type, "input_type"))
        object.__setattr__(self, "exits", _normalize_exits(self.exits))
        object.__setattr__(
            self,
            "selector_ref",
            None if self.selector_ref is None else _text(self.selector_ref, "selector_ref"),
        )
        object.__setattr__(self, "label", self.label or "")
        object.__setattr__(self, "description", self.description or "")

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "NodeSpec":
        return cls(
            kind=raw["kind"],
            ref=raw["ref"],
            input_type=raw["input"],
            exits=raw["exits"],
            selector_ref=raw.get("selector"),
            label=raw.get("label", ""),
            description=raw.get("description", ""),
        )

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "kind": self.kind,
            "ref": self.ref,
            "input": self.input_type,
            "exits": {name: spec.to_dict() for name, spec in self.exits.items()},
        }
        if self.selector_ref:
            data["selector"] = self.selector_ref
        if self.label:
            data["label"] = self.label
        if self.description:
            data["description"] = self.description
        return data


@dataclass(frozen=True)
class EdgeSpec:
    """A connection from one node exit to another node or flow exit."""

    from_node: str
    from_exit: str = DEFAULT_EXIT_NAME
    to_node: Optional[str] = None
    to_flow_exit: Optional[str] = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "from_node", _text(self.from_node, "from_node"))
        object.__setattr__(self, "from_exit", _text(self.from_exit, "from_exit"))
        object.__setattr__(
            self,
            "to_node",
            None if self.to_node is None else _text(self.to_node, "to_node"),
        )
        object.__setattr__(
            self,
            "to_flow_exit",
            None if self.to_flow_exit is None else _text(self.to_flow_exit, "to_flow_exit"),
        )
        if (self.to_node is None) == (self.to_flow_exit is None):
            raise ValueError("edge must target exactly one of to_node or to_flow_exit")

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "EdgeSpec":
        return cls(
            from_node=raw["from_node"],
            from_exit=raw.get("from_exit", DEFAULT_EXIT_NAME),
            to_node=raw.get("to_node"),
            to_flow_exit=raw.get("to_flow_exit"),
        )

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {"from_node": self.from_node, "from_exit": self.from_exit}
        if self.to_node is not None:
            data["to_node"] = self.to_node
        if self.to_flow_exit is not None:
            data["to_flow_exit"] = self.to_flow_exit
        return data


@dataclass(frozen=True)
class FlowSpec:
    """A flow is a DAG of named nodes plus named public exits."""

    id: str
    input_type: TypeRef
    nodes: Mapping[str, NodeSpec]
    edges: Tuple[EdgeSpec, ...]
    entry_node: str
    public_exits: Mapping[str, ExitSpec]
    description: str = ""
    layout: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _text(self.id, "id"))
        object.__setattr__(self, "input_type", _text(self.input_type, "input_type"))
        object.__setattr__(self, "entry_node", _text(self.entry_node, "entry_node"))
        object.__setattr__(
            self,
            "nodes",
            {_text(name, "node name"): node if isinstance(node, NodeSpec) else NodeSpec.from_dict(node) for name, node in self.nodes.items()},
        )
        object.__setattr__(
            self,
            "edges",
            tuple(edge if isinstance(edge, EdgeSpec) else EdgeSpec.from_dict(edge) for edge in self.edges),
        )
        object.__setattr__(self, "public_exits", _normalize_exits(self.public_exits))
        object.__setattr__(self, "description", self.description or "")
        object.__setattr__(self, "layout", _normalize_layout(self.layout))
        if not self.nodes:
            raise ValueError("flows must declare at least one node")

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "FlowSpec":
        return cls(
            id=raw["id"],
            input_type=raw["input"],
            nodes=raw["nodes"],
            edges=tuple(raw.get("edges", ())),
            entry_node=raw["entry_node"],
            public_exits=raw["public_exits"],
            description=raw.get("description", ""),
            layout=raw.get("layout", {}),
        )

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "input": self.input_type,
            "nodes": {name: node.to_dict() for name, node in self.nodes.items()},
            "edges": [edge.to_dict() for edge in self.edges],
            "entry_node": self.entry_node,
            "public_exits": {
                name: exit_spec.to_dict() for name, exit_spec in self.public_exits.items()
            },
        }
        if self.description:
            data["description"] = self.description
        if self.layout:
            data["layout"] = dict(self.layout)
        return data

    def outgoing(self, node_name: str) -> Tuple[EdgeSpec, ...]:
        return tuple(edge for edge in self.edges if edge.from_node == node_name)

    def incoming(self, node_name: str) -> Tuple[EdgeSpec, ...]:
        return tuple(edge for edge in self.edges if edge.to_node == node_name)
