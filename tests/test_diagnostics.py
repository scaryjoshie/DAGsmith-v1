import pytest

from dagsmith.diagnostics import Diagnostic, SourceLocation, UnresolvableRef


def _make(**overrides) -> Diagnostic:
    base = dict(
        severity="error",
        code="unresolved_ref",
        message="ref not found",
        flow_id="customer.onboarding",
        node_id="validate_email",
    )
    base.update(overrides)
    return Diagnostic(**base)


class TestDiagnosticId:
    def test_deterministic_for_same_inputs(self):
        a = _make()
        b = _make()
        assert a.id == b.id

    def test_changes_with_node_id(self):
        a = _make(node_id="validate_email")
        b = _make(node_id="enrich")
        assert a.id != b.id

    def test_changes_with_message(self):
        a = _make(message="x")
        b = _make(message="y")
        assert a.id != b.id

    def test_changes_with_code(self):
        a = _make(code="unresolved_ref")
        b = _make(code="type_mismatch")
        assert a.id != b.id

    def test_changes_with_flow_id(self):
        a = _make(flow_id="alpha")
        b = _make(flow_id="beta")
        assert a.id != b.id

    def test_changes_with_edge_index(self):
        a = _make(node_id=None, edge_index=0)
        b = _make(node_id=None, edge_index=1)
        assert a.id != b.id

    def test_severity_does_not_affect_id(self):
        a = _make(severity="error")
        b = _make(severity="warning")
        assert a.id == b.id

    def test_id_format(self):
        d = _make()
        assert d.id.startswith("customer.onboarding:unresolved_ref:validate_email:")

    def test_uses_edge_index_when_no_node_id(self):
        d = _make(node_id=None, edge_index=3)
        assert ":3:" in d.id

    def test_falls_back_to_flow_locus(self):
        d = _make(node_id=None, edge_index=None)
        assert ":flow:" in d.id


class TestDiagnosticFields:
    def test_derived_from_accepts_another_id(self):
        root = _make()
        derived = _make(code="type_mismatch", derived_from=root.id)
        assert derived.derived_from == root.id

    def test_derived_chain_three_levels(self):
        root = _make(code="syntax_error", message="bad import")
        level_one = _make(code="unresolved_ref", node_id="n1", derived_from=root.id)
        level_two = _make(code="type_mismatch", node_id="n2", derived_from=level_one.id)
        assert level_one.derived_from == root.id
        assert level_two.derived_from == level_one.id
        assert len({root.id, level_one.id, level_two.id}) == 3

    def test_source_location_attached(self):
        loc = SourceLocation(path="a.py", line=10, col=4)
        d = _make(source_location=loc)
        assert d.source_location == loc


class TestSourceLocation:
    def test_frozen(self):
        loc = SourceLocation(path="a.py", line=1, col=0)
        with pytest.raises(Exception):
            loc.line = 99  # type: ignore[misc]


class TestUnresolvableRef:
    def test_call_raises_with_message(self):
        d = _make(message="missing module foo")
        ref = UnresolvableRef(d)
        with pytest.raises(RuntimeError) as exc:
            ref()
        assert "missing module foo" in str(exc.value)

    def test_call_with_args_still_raises(self):
        d = _make(message="broken")
        ref = UnresolvableRef(d)
        with pytest.raises(RuntimeError):
            ref({"payload": 1}, opt=True)

    def test_carries_diagnostic(self):
        d = _make()
        ref = UnresolvableRef(d)
        assert ref.diagnostic is d

    def test_repr_includes_id(self):
        d = _make()
        ref = UnresolvableRef(d)
        assert d.id in repr(ref)
