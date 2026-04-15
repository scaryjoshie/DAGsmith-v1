"""Tests for the dagsmith.model Pydantic IR."""

import pytest
from pydantic import ValidationError

from dagsmith.model import EdgeSpec, FlowSpec, NodeSpec


def _valid_node_raw() -> dict:
    return {
        "kind": "python",
        "ref": ".mod:func",
        "input": "pkg.Type",
        "exits": {"out": "pkg.Type"},
    }


def _valid_flow_raw() -> dict:
    return {
        "id": "test",
        "input": "pkg.In",
        "entry_node": "n",
        "nodes": {
            "n": _valid_node_raw(),
        },
        "edges": [
            {"from_node": "n", "from_exit": "out", "to_flow_exit": "end"},
        ],
        "public_exits": {"end": "pkg.Out"},
    }


class TestNodeSpec:
    def test_minimal_valid(self):
        node = NodeSpec.model_validate(_valid_node_raw())
        assert node.kind == "python"
        assert node.ref == ".mod:func"
        assert node.input_type == "pkg.Type"
        assert node.exits == {"out": "pkg.Type"}
        assert node.selector_ref is None

    def test_selector_alias(self):
        raw = _valid_node_raw()
        raw["selector"] = ".mod:pick"
        node = NodeSpec.model_validate(raw)
        assert node.selector_ref == ".mod:pick"

    def test_empty_exits_raises(self):
        raw = _valid_node_raw()
        raw["exits"] = {}
        with pytest.raises(ValidationError):
            NodeSpec.model_validate(raw)

    def test_extra_fields_ignored(self):
        raw = _valid_node_raw()
        raw["unknown_field"] = "whatever"
        node = NodeSpec.model_validate(raw)
        assert not hasattr(node, "unknown_field")


class TestEdgeSpec:
    def test_to_node(self):
        edge = EdgeSpec.model_validate({"from_node": "a", "to_node": "b"})
        assert edge.from_node == "a"
        assert edge.from_exit == "out"
        assert edge.to_node == "b"
        assert edge.to_flow_exit is None

    def test_to_flow_exit(self):
        edge = EdgeSpec.model_validate(
            {"from_node": "a", "to_flow_exit": "end"}
        )
        assert edge.to_flow_exit == "end"
        assert edge.to_node is None

    def test_both_set_raises(self):
        with pytest.raises(ValidationError):
            EdgeSpec.model_validate(
                {"from_node": "a", "to_node": "b", "to_flow_exit": "end"}
            )

    def test_neither_set_raises(self):
        with pytest.raises(ValidationError):
            EdgeSpec.model_validate({"from_node": "a"})


class TestFlowSpec:
    def test_round_trip(self):
        raw = _valid_flow_raw()
        spec = FlowSpec.model_validate(raw)
        dumped = spec.model_dump(by_alias=True)
        reparsed = FlowSpec.model_validate(dumped)
        assert reparsed == spec

    def test_unknown_entry_node_raises(self):
        raw = _valid_flow_raw()
        raw["entry_node"] = "nonexistent"
        with pytest.raises(ValidationError):
            FlowSpec.model_validate(raw)

    def test_empty_public_exits_raises(self):
        raw = _valid_flow_raw()
        raw["public_exits"] = {}
        with pytest.raises(ValidationError):
            FlowSpec.model_validate(raw)

    def test_layout_is_placeholder(self):
        raw = _valid_flow_raw()
        raw["layout"] = {"nodes": {"n": {"x": 100, "y": 200}}}
        spec = FlowSpec.model_validate(raw)
        assert spec.layout == {"nodes": {"n": {"x": 100, "y": 200}}}
