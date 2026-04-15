"""End-to-end tests for flow execution via the minimal example."""

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
