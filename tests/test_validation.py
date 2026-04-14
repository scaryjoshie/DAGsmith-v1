import unittest

from dagsmith import EdgeSpec, FlowSpec, NodeSpec, TypeRef, validate_flow
from dagsmith.validation import FlowValidationError


def make_valid_flow() -> FlowSpec:
    validate = NodeSpec(
        kind="python",
        ref="customer.validate:process",
        input_type=TypeRef("Record"),
        exits={
            "valid": "ValidatedRecord",
            "invalid": "ValidationError",
        },
    )
    enrich = NodeSpec(
        kind="python",
        ref="customer.enrich:process",
        input_type=TypeRef("ValidatedRecord"),
        exits={"out": "EnrichedRecord"},
    )
    return FlowSpec(
        id="customer.pipeline",
        input_type=TypeRef("Record"),
        nodes={"validate": validate, "enrich": enrich},
        edges=[
            EdgeSpec(from_node="validate", from_exit="valid", to_node="enrich"),
            EdgeSpec(from_node="validate", from_exit="invalid", to_flow_exit="invalid"),
            EdgeSpec(from_node="enrich", from_exit="out", to_flow_exit="valid"),
        ],
        entry_node="validate",
        public_exits={
            "valid": "EnrichedRecord",
            "invalid": "ValidationError",
        },
    )


class ValidationTests(unittest.TestCase):
    def test_validate_flow_accepts_valid_graph(self) -> None:
        flow = make_valid_flow()

        self.assertIs(validate_flow(flow), flow)

    def test_validate_flow_rejects_type_mismatch(self) -> None:
        flow = make_valid_flow()
        broken = FlowSpec(
            id=flow.id,
            input_type=flow.input_type,
            nodes={
                "validate": flow.nodes["validate"],
                "enrich": NodeSpec(
                    kind="python",
                    ref="customer.enrich:process",
                    input_type=TypeRef("OtherType"),
                    exits={"out": "EnrichedRecord"},
                ),
            },
            edges=flow.edges,
            entry_node=flow.entry_node,
            public_exits=flow.public_exits,
        )

        with self.assertRaises(FlowValidationError):
            validate_flow(broken)

    def test_validate_flow_rejects_cycles(self) -> None:
        first = NodeSpec(
            kind="python",
            ref="first:process",
            input_type=TypeRef("Record"),
            exits={"out": "Record"},
        )
        second = NodeSpec(
            kind="python",
            ref="second:process",
            input_type=TypeRef("Record"),
            exits={"out": "Record"},
        )
        flow = FlowSpec(
            id="cyclic.flow",
            input_type=TypeRef("Record"),
            nodes={"first": first, "second": second},
            edges=[
                EdgeSpec(from_node="first", from_exit="out", to_node="second"),
                EdgeSpec(from_node="second", from_exit="out", to_node="first"),
            ],
            entry_node="first",
            public_exits={"out": "Record"},
        )

        with self.assertRaises(FlowValidationError):
            validate_flow(flow)


if __name__ == "__main__":
    unittest.main()
