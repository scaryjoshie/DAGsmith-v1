"""Tests for workspace loading and validation."""

import pytest

from dagsmith import WorkspaceError, load_workspace


def test_load_minimal_example_smoke():
    """The minimal example workspace loads without error via its __init__."""
    import examples.minimal as ws

    assert hasattr(ws, "hello")
    assert callable(ws.hello)


def test_unknown_package_raises():
    with pytest.raises(WorkspaceError):
        load_workspace("definitely_not_a_real_package_12345")


def test_unknown_flow_raises():
    import examples.minimal as ws

    with pytest.raises(WorkspaceError):
        ws._workspace.flow("no_such_flow")
