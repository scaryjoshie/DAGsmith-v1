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
        "edges": [],
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

    def test_empty_exits_accepted_and_round_trips(self):
        raw = _valid_node_raw()
        raw["exits"] = {}
        node = NodeSpec.model_validate(raw)
        assert node.exits == {}
        assert NodeSpec.model_validate(node.model_dump(by_alias=True)) == node

    def test_flow_kind_accepted(self):
        raw = _valid_node_raw()
        raw["kind"] = "flow"
        raw["ref"] = "customer.onboarding.validate"
        node = NodeSpec.model_validate(raw)
        assert node.kind == "flow"
        assert NodeSpec.model_validate(node.model_dump(by_alias=True)) == node


class TestEdgeSpec:
    def test_to_node(self):
        edge = EdgeSpec.model_validate({"from_node": "a", "to_node": "b"})
        assert edge.from_node == "a"
        assert edge.from_exit == "out"
        assert edge.to_node == "b"

    def test_missing_to_node_raises(self):
        with pytest.raises(ValidationError):
            EdgeSpec.model_validate({"from_node": "a"})

    def test_legacy_to_flow_exit_rejected(self):
        """SPEC §12 line 425: `to_flow_exit` is gone. An edge must target
        another node; public exits are inferred from unconnected handles."""
        with pytest.raises(ValidationError):
            EdgeSpec.model_validate({"from_node": "a", "to_flow_exit": "end"})


class TestFlowSpec:
    def test_round_trip(self):
        raw = _valid_flow_raw()
        spec = FlowSpec.model_validate(raw)
        dumped = spec.model_dump(by_alias=True)
        reparsed = FlowSpec.model_validate(dumped)
        assert reparsed == spec

    def test_entry_node_is_computed_from_start_node(self):
        """SPEC §12 line 427: `entry_node` is a computed field, derived from
        the unique `kind="start"` node. Legacy stored `entry_node` values
        in flow.json are stripped (extra='ignore')."""
        raw = _valid_flow_raw()
        raw["entry_node"] = "legacy_ignored_name"
        raw["nodes"]["_start"] = {
            "kind": "start",
            "input": "pkg.In",
            "exits": {"out": "pkg.In"},
        }
        spec = FlowSpec.model_validate(raw)
        assert spec.entry_node == "_start"

    def test_entry_node_empty_when_no_start(self):
        raw = _valid_flow_raw()
        spec = FlowSpec.model_validate(raw)
        assert spec.entry_node == ""

    def test_entry_node_empty_when_multiple_starts(self):
        raw = _valid_flow_raw()
        raw["nodes"]["_start_a"] = {
            "kind": "start", "input": "pkg.In", "exits": {"out": "pkg.In"},
        }
        raw["nodes"]["_start_b"] = {
            "kind": "start", "input": "pkg.In", "exits": {"out": "pkg.In"},
        }
        spec = FlowSpec.model_validate(raw)
        assert spec.entry_node == ""

    def test_unknown_top_level_field_tolerated(self):
        raw = _valid_flow_raw()
        raw["future_field"] = {"anything": 1}
        spec = FlowSpec.model_validate(raw)
        assert not hasattr(spec, "future_field")

    def test_stored_public_exits_field_stripped(self):
        """SPEC §12 line 425: `public_exits` is derived, not stored. Legacy
        flow.json with the field should be tolerated (extra='ignore') and
        the attribute should not be exposed on the parsed spec."""
        raw = _valid_flow_raw()
        raw["public_exits"] = {"legacy": "pkg.Out"}
        spec = FlowSpec.model_validate(raw)
        assert not hasattr(spec, "public_exits")

    def test_layout_groups_round_trip(self):
        raw = _valid_flow_raw()
        raw["layout"] = {
            "nodes": {"n": {"x": 0, "y": 0}},
            "groups": [
                {"id": "g1", "node_ids": ["n"], "label": "Group"},
            ],
        }
        spec = FlowSpec.model_validate(raw)
        dumped = spec.model_dump(by_alias=True)
        assert dumped["layout"]["nodes"] == {"n": {"x": 0, "y": 0}}
        assert dumped["layout"]["groups"] == [
            {"id": "g1", "node_ids": ["n"], "label": "Group"},
        ]
        assert FlowSpec.model_validate(dumped) == spec
