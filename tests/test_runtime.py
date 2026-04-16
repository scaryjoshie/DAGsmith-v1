"""End-to-end tests for flow execution via the minimal example."""

from __future__ import annotations

import pytest

from dagsmith.runtime import (
    AmbiguousRoute,
    DagsmithRuntimeError,
    MultiplePublicExitsReached,
    _resolve_node_result,
    emit,
)
from examples.minimal import hello
from examples.minimal.hello.types.records import Greeting, Reply


def test_formal_routing():
    result = hello(Greeting(name="Alice"))
    assert result.exit == "formal"
    assert isinstance(result.value, Reply)
    assert result.value.formal is True
    assert "Alice" in result.value.message
    assert "Good day" in result.value.message


def test_casual_routing():
    result = hello(Greeting(name="alice"))
    assert result.exit == "casual"
    assert isinstance(result.value, Reply)
    assert result.value.formal is False
    assert "alice" in result.value.message
    assert "hi" in result.value.message


def test_ambiguous_route_raised_for_multi_exit_plain_return():
    exits = {"valid": "X", "invalid": "Y"}
    with pytest.raises(AmbiguousRoute) as excinfo:
        _resolve_node_result(
            42,
            "out",
            None,
            flow_id="f",
            node_id="n",
            exits=exits,
        )
    exc = excinfo.value
    assert isinstance(exc, DagsmithRuntimeError)
    assert exc.flow_id == "f"
    assert exc.node_id == "n"
    assert exc.exits == exits
    assert "f" in str(exc) and "n" in str(exc)
    assert "valid" in str(exc) and "invalid" in str(exc)


def test_ambiguous_route_not_raised_when_selector_present():
    exits = {"a": "X", "b": "Y"}
    exit_name, value = _resolve_node_result(
        42,
        "out",
        lambda _: "a",
        flow_id="f",
        node_id="n",
        exits=exits,
    )
    assert exit_name == "a"
    assert value == 42


def test_ambiguous_route_not_raised_for_emit():
    exits = {"a": "X", "b": "Y"}
    exit_name, value = _resolve_node_result(
        emit("b", 99),
        "out",
        None,
        flow_id="f",
        node_id="n",
        exits=exits,
    )
    assert exit_name == "b"
    assert value == 99


def test_ambiguous_route_not_raised_for_single_exit_plain_return():
    exit_name, value = _resolve_node_result(
        7,
        "out",
        None,
        flow_id="f",
        node_id="n",
        exits={"out": "X"},
    )
    assert exit_name == "out"
    assert value == 7


def test_multiple_public_exits_reached_payload():
    exc = MultiplePublicExitsReached(flow_id="f", exits_reached=["valid", "invalid"])
    assert isinstance(exc, DagsmithRuntimeError)
    assert exc.flow_id == "f"
    assert exc.exits_reached == ["valid", "invalid"]
    msg = str(exc)
    assert "f" in msg
    assert "valid" in msg and "invalid" in msg
