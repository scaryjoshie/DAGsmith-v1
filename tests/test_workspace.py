"""Tests for workspace loading and validation.

Under the Infer model (SPEC §12 line 425), public exits are derived from
unconnected source handles. Tests use unconnected handles to create leaves;
there's no `to_flow_exit` anywhere.
"""

from __future__ import annotations

import importlib
import json
import sys
import textwrap
from pathlib import Path

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


# --- cross-flow cycle diagnostic tests ------------------------------------


class TestCrossFlowCycleDiagnostics:
    def test_no_cycles_yields_no_diagnostics(
        self, tmp_path, make_workspace, passthrough_node, flow_ref_node
    ):
        """A diamond of flow refs is acyclic; no diagnostics emitted."""
        mod = make_workspace(
            tmp_path,
            "ws_diamond",
            flows={
                "a": {
                    "nodes": {
                        "call_b": flow_ref_node("b"),
                        "call_c": flow_ref_node("c"),
                        "merge": passthrough_node(),
                    },
                    "edges": [
                        {"from_node": "call_b", "from_exit": "out", "to_node": "merge"},
                        {"from_node": "call_c", "from_exit": "out", "to_node": "merge"},
                    ],
                    "entry_node": "call_b",
                },
                "b": {
                    "nodes": {"call_d": flow_ref_node("d")},
                    "edges": [],
                    "entry_node": "call_d",
                },
                "c": {
                    "nodes": {"call_d": flow_ref_node("d")},
                    "edges": [],
                    "entry_node": "call_d",
                },
                "d": {
                    "nodes": {"leaf": passthrough_node()},
                    "edges": [],
                    "entry_node": "leaf",
                },
            },
        )
        assert mod._workspace.diagnostics == []

    def test_self_cycle_emits_diagnostic(self, tmp_path, make_workspace, flow_ref_node):
        """A flow referencing itself emits a cross_flow_cycle diagnostic (no raise)."""
        mod = make_workspace(
            tmp_path,
            "ws_self_cycle",
            flows={
                "a": {
                    "nodes": {"call_self": flow_ref_node("a")},
                    "edges": [],
                    "entry_node": "call_self",
                },
            },
        )
        diags = mod._workspace.diagnostics
        assert len(diags) == 1
        d = diags[0]
        assert d.code == "cross_flow_cycle"
        assert d.severity == "error"
        assert d.flow_id == "a"
        assert d.node_id == "call_self"
        assert d.detail["cycle"] == ["a"]

    def test_two_flow_cycle_emits_diagnostic_on_each_flow_kind_node(
        self, tmp_path, make_workspace, flow_ref_node
    ):
        """A <-> B: both flow-kind nodes get a diagnostic."""
        mod = make_workspace(
            tmp_path,
            "ws_two_cycle",
            flows={
                "a": {
                    "nodes": {"call_b": flow_ref_node("b")},
                    "edges": [],
                    "entry_node": "call_b",
                },
                "b": {
                    "nodes": {"call_a": flow_ref_node("a")},
                    "edges": [],
                    "entry_node": "call_a",
                },
            },
        )
        diags = mod._workspace.diagnostics
        assert len(diags) == 2
        assert all(d.code == "cross_flow_cycle" for d in diags)
        by_flow = {d.flow_id: d for d in diags}
        assert by_flow["a"].node_id == "call_b"
        assert by_flow["b"].node_id == "call_a"
        assert by_flow["a"].detail["cycle"] == ["a", "b"]
        assert by_flow["b"].detail["cycle"] == ["a", "b"]

    def test_three_flow_cycle_emits_diagnostic_per_flow_kind_node(
        self, tmp_path, make_workspace, flow_ref_node
    ):
        """A -> B -> C -> A: three diagnostics, one per participating flow-kind node."""
        mod = make_workspace(
            tmp_path,
            "ws_three_cycle",
            flows={
                "a": {
                    "nodes": {"call_b": flow_ref_node("b")},
                    "edges": [],
                    "entry_node": "call_b",
                },
                "b": {
                    "nodes": {"call_c": flow_ref_node("c")},
                    "edges": [],
                    "entry_node": "call_c",
                },
                "c": {
                    "nodes": {"call_a": flow_ref_node("a")},
                    "edges": [],
                    "entry_node": "call_a",
                },
            },
        )
        diags = mod._workspace.diagnostics
        assert len(diags) == 3
        assert {d.flow_id for d in diags} == {"a", "b", "c"}
        for d in diags:
            assert d.code == "cross_flow_cycle"
            assert d.detail["cycle"] == ["a", "b", "c"]

    def test_cycle_does_not_raise_at_load_time(
        self, tmp_path, make_workspace, flow_ref_node
    ):
        """Permissive posture: a cross-flow cycle loads; diagnostics, not exceptions."""
        mod = make_workspace(
            tmp_path,
            "ws_no_raise",
            flows={
                "a": {
                    "nodes": {"call_a": flow_ref_node("a")},
                    "edges": [],
                    "entry_node": "call_a",
                },
            },
        )
        assert "a" in mod._workspace.flow_ids

    def test_acyclic_chain_yields_no_diagnostics(
        self, tmp_path, make_workspace, passthrough_node, flow_ref_node
    ):
        """A -> B -> C (no back-edge) produces no cycle diagnostics."""
        mod = make_workspace(
            tmp_path,
            "ws_chain",
            flows={
                "a": {
                    "nodes": {"call_b": flow_ref_node("b")},
                    "edges": [],
                    "entry_node": "call_b",
                },
                "b": {
                    "nodes": {"call_c": flow_ref_node("c")},
                    "edges": [],
                    "entry_node": "call_c",
                },
                "c": {
                    "nodes": {"leaf": passthrough_node()},
                    "edges": [],
                    "entry_node": "leaf",
                },
            },
        )
        assert mod._workspace.diagnostics == []


class TestSubflowResolution:
    def test_two_flows_parent_calls_child_loads_and_runs(self, tmp_path):
        """A parent flow referencing a child via kind='flow' loads and executes."""
        pkg_name = "ws_subflow_ok"
        pkg_root = tmp_path / pkg_name
        pkg_root.mkdir()
        (pkg_root / "dagsmith.json").write_text(
            json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
        )
        (pkg_root / "__init__.py").write_text(
            textwrap.dedent(
                """
                from dagsmith import load_workspace

                _workspace = load_workspace(__name__)
                parent = _workspace.flow("parent")
                child = _workspace.flow("child")
                """
            ).lstrip(),
            encoding="utf-8",
        )

        child_dir = pkg_root / "child"
        child_dir.mkdir()
        (child_dir / "__init__.py").write_text("", encoding="utf-8")
        (child_dir / "impl.py").write_text(
            "def double(x):\n    return x * 2\n", encoding="utf-8"
        )
        (child_dir / "flow.json").write_text(
            json.dumps(
                {
                    "id": "child",
                    "nodes": {
                        "_start": {
                            "kind": "start",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "doubler": {
                            "kind": "python",
                            "ref": ".impl:double",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [
                        {"from_node": "_start", "from_exit": "out", "to_node": "doubler"}
                    ],
                }
            ),
            encoding="utf-8",
        )

        parent_dir = pkg_root / "parent"
        parent_dir.mkdir()
        (parent_dir / "__init__.py").write_text("", encoding="utf-8")
        (parent_dir / "flow.json").write_text(
            json.dumps(
                {
                    "id": "parent",
                    "nodes": {
                        "_start": {
                            "kind": "start",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "call_child": {
                            "kind": "flow",
                            "ref": "child",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [
                        {"from_node": "_start", "from_exit": "out", "to_node": "call_child"}
                    ],
                }
            ),
            encoding="utf-8",
        )

        sys.path.insert(0, str(tmp_path))
        try:
            for mod in list(sys.modules):
                if mod == pkg_name or mod.startswith(pkg_name + "."):
                    del sys.modules[mod]
            module = importlib.import_module(pkg_name)
            assert module._workspace.diagnostics == []
            assert set(module._workspace.flow_ids) == {"parent", "child"}
            assert module.child(21).value == 42
            assert module.parent(10).value == 20
        finally:
            if str(tmp_path) in sys.path:
                sys.path.remove(str(tmp_path))


class TestWorkspaceDiagnosticsField:
    def test_unresolved_flow_ref_emits_diagnostic(
        self, tmp_path, make_workspace, flow_ref_node
    ):
        mod = make_workspace(
            tmp_path,
            "ws_unresolved",
            flows={
                "caller": {
                    "nodes": {"go": flow_ref_node("missing")},
                    "edges": [],
                    "entry_node": "go",
                },
            },
        )
        diags = mod._workspace.diagnostics
        codes = [d.code for d in diags]
        assert "unresolved_flow_ref" in codes
        assert "cross_flow_cycle" not in codes  # unresolved must not mask as a cycle
        bad = next(d for d in diags if d.code == "unresolved_flow_ref")
        assert bad.flow_id == "caller"
        assert bad.node_id == "go"
        assert bad.detail["target_flow"] == "missing"


# --- M3 permissive-loader tests -------------------------------------------


class TestPermissiveShapeDiagnostics:
    """SPEC §6.4 gaps (1) and (2): shape-level problems load as diagnostics."""

    def test_start_edge_to_missing_node_emits_dangling_diagnostic(
        self, tmp_path, make_workspace, passthrough_node
    ):
        """The conftest helper wires _start → entry_node; if `entry_node`
        names a non-existent node, the edge is dangling → dangling_edge_target
        diagnostic."""
        mod = make_workspace(
            tmp_path,
            "ws_dangling_start_edge",
            flows={
                "f": {
                    "nodes": {"leaf": passthrough_node()},
                    "edges": [],
                    "entry_node": "ghost",
                },
            },
        )
        diags = mod._workspace.diagnostics
        codes = [d.code for d in diags]
        assert "dangling_edge_target" in codes
        # workspace still loads; flow is listed
        assert "f" in mod._workspace.flow_ids
        # strict run: invoking the flow raises when the edge is followed
        with pytest.raises(WorkspaceError, match="edge target 'ghost' not declared"):
            mod._workspace.flow("f")(None)

    def test_plain_return_node_routes_through_implicit_out(
        self, tmp_path, make_workspace
    ):
        """A 0-exit plain-return node is a valid shape (SPEC §5: plain -> out).

        The runtime routes its return value through the implicit DEFAULT_EXIT_NAME
        handle. The implicit "out" handle on such nodes becomes an inferred
        public exit by default.
        """
        mod = make_workspace(
            tmp_path,
            "ws_plain_return",
            flows={
                "f": {
                    "nodes": {
                        "silent": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {},
                        }
                    },
                    "edges": [],
                    "entry_node": "silent",
                },
            },
        )
        diags = mod._workspace.diagnostics
        # No unknown_edge_exit diagnostic; the implicit "out" is an inferred
        # public exit and there are no edges.
        assert not [d for d in diags if d.code == "unknown_edge_exit"]
        # The derived public exits contain "out" (the implicit handle on a
        # 0-exit plain-return node).
        assert dict(mod._workspace.public_exits("f")) == {"out": "typing.Any"}
        # Runtime routes plain return through implicit "out" and reaches the
        # public exit without raising. (builtins:id returns an int, so we just
        # verify the flow completes; the exact return value isn't the point.)
        mod._workspace.flow("f")("hello")

    def test_flow_with_no_public_exits_emits_diagnostic(
        self, tmp_path, make_workspace, passthrough_node
    ):
        """A flow where every source handle is connected (no leaves) has no
        inferred public exit — emit `no_public_exits`."""
        mod = make_workspace(
            tmp_path,
            "ws_no_public_exits",
            flows={
                "f": {
                    "nodes": {
                        "a": passthrough_node(),
                        "b": passthrough_node(),
                    },
                    # Both "out" handles are connected to each other → no leaves.
                    "edges": [
                        {"from_node": "a", "from_exit": "out", "to_node": "b"},
                        {"from_node": "b", "from_exit": "out", "to_node": "a"},
                    ],
                    "entry_node": "a",
                },
            },
        )
        diags = mod._workspace.diagnostics
        hits = [d for d in diags if d.code == "no_public_exits"]
        assert len(hits) == 1
        assert hits[0].flow_id == "f"


class TestInferPublicExits:
    """SPEC §12 line 425 (Infer model): public exits are derived from
    unconnected source handles, merged by name."""

    def test_derive_public_exits_from_unconnected_handles(
        self, tmp_path, make_workspace
    ):
        """Each unconnected (node, exit) contributes one public exit named
        after the exit, typed from the source handle."""
        mod = make_workspace(
            tmp_path,
            "ws_infer_simple",
            flows={
                "f": {
                    "nodes": {
                        "gate": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {
                                "valid": "mymod.Customer",
                                "invalid": "mymod.Error",
                            },
                        },
                    },
                    "edges": [],
                    "entry_node": "gate",
                },
            },
        )
        exits = dict(mod._workspace.public_exits("f"))
        assert exits == {"valid": "mymod.Customer", "invalid": "mymod.Error"}
        # No type-mismatch warnings since each exit has a single contributor.
        codes = [d.code for d in mod._workspace.diagnostics]
        assert "merged_exit_type_mismatch" not in codes

    def test_derive_public_exits_merges_by_name(self, tmp_path, make_workspace):
        """Two leaves with the same exit_name merge into one public exit."""
        mod = make_workspace(
            tmp_path,
            "ws_infer_merge",
            flows={
                "f": {
                    "nodes": {
                        "entry": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "check_a": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"invalid": "mymod.Error"},
                        },
                        "check_b": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"invalid": "mymod.Error"},
                        },
                    },
                    "edges": [
                        {"from_node": "entry", "from_exit": "out", "to_node": "check_a"},
                        {"from_node": "entry", "from_exit": "out", "to_node": "check_b"},
                        # check_a.invalid and check_b.invalid are both unconnected
                        # with matching types → merge into a single public "invalid".
                    ],
                    "entry_node": "entry",
                },
            },
        )
        exits = dict(mod._workspace.public_exits("f"))
        assert exits == {"invalid": "mymod.Error"}
        # Types agree, so no merged_exit_type_mismatch warning.
        codes = [d.code for d in mod._workspace.diagnostics]
        assert "merged_exit_type_mismatch" not in codes

    def test_merged_exit_type_mismatch_warns(self, tmp_path, make_workspace):
        """Two leaves sharing a name but with different types: merge to
        typing.Any and emit a `merged_exit_type_mismatch` warning."""
        mod = make_workspace(
            tmp_path,
            "ws_infer_mismatch",
            flows={
                "f": {
                    "nodes": {
                        "entry": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "check_a": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"invalid": "mymod.TypeA"},
                        },
                        "check_b": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"invalid": "mymod.TypeB"},
                        },
                    },
                    "edges": [
                        {"from_node": "entry", "from_exit": "out", "to_node": "check_a"},
                        {"from_node": "entry", "from_exit": "out", "to_node": "check_b"},
                    ],
                    "entry_node": "entry",
                },
            },
        )
        exits = dict(mod._workspace.public_exits("f"))
        assert exits == {"invalid": "typing.Any"}
        warnings = [
            d for d in mod._workspace.diagnostics
            if d.code == "merged_exit_type_mismatch"
        ]
        assert len(warnings) == 1
        w = warnings[0]
        assert w.severity == "warning"
        assert w.flow_id == "f"
        assert w.detail["exit_name"] == "invalid"
        assert sorted(w.detail["contributing_nodes"]) == ["check_a", "check_b"]
        assert sorted(w.detail["types"]) == ["mymod.TypeA", "mymod.TypeB"]

    def test_runtime_terminates_at_inferred_public_exit(self, tmp_path):
        """An unconnected source handle is a public exit; the runtime
        terminates there rather than raising 'no outgoing edge'."""
        pkg_name = "ws_infer_run"
        pkg_root = tmp_path / pkg_name
        pkg_root.mkdir()
        (pkg_root / "dagsmith.json").write_text(
            json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
        )
        (pkg_root / "__init__.py").write_text(
            "from dagsmith import load_workspace\n"
            "_workspace = load_workspace(__name__)\n",
            encoding="utf-8",
        )
        flow_dir = pkg_root / "f"
        flow_dir.mkdir()
        (flow_dir / "__init__.py").write_text("", encoding="utf-8")
        (flow_dir / "impl.py").write_text(
            "def echo(x):\n    return x\n", encoding="utf-8"
        )
        (flow_dir / "flow.json").write_text(
            json.dumps(
                {
                    "id": "f",
                    "nodes": {
                        "_start": {
                            "kind": "start",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "only": {
                            "kind": "python",
                            "ref": ".impl:echo",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [
                        {"from_node": "_start", "from_exit": "out", "to_node": "only"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        sys.path.insert(0, str(tmp_path))
        try:
            for m in list(sys.modules):
                if m == pkg_name or m.startswith(pkg_name + "."):
                    del sys.modules[m]
            module = importlib.import_module(pkg_name)
        finally:
            if str(tmp_path) in sys.path:
                sys.path.remove(str(tmp_path))
        result = module._workspace.flow("f")(42)
        assert result.exit == "out"
        assert result.value == 42


class TestPermissiveStructuralDiagnostics:
    """SPEC §6.4 gap (3): edge structural problems are diagnostics, not raises."""

    def test_dangling_to_node_emits_diagnostic(
        self, tmp_path, make_workspace, passthrough_node
    ):
        mod = make_workspace(
            tmp_path,
            "ws_dangle_to",
            flows={
                "f": {
                    "nodes": {"a": passthrough_node()},
                    "edges": [
                        {"from_node": "a", "from_exit": "out", "to_node": "ghost"}
                    ],
                    "entry_node": "a",
                },
            },
        )
        hits = [d for d in mod._workspace.diagnostics if d.code == "dangling_edge_target"]
        assert any(d.detail.get("to_node") == "ghost" for d in hits)
        # strict run: invoking raises when the edge is followed to the ghost target
        with pytest.raises(WorkspaceError, match="edge target 'ghost' not declared"):
            mod._workspace.flow("f")(None)

    def test_unknown_from_exit_emits_diagnostic(
        self, tmp_path, make_workspace, passthrough_node
    ):
        mod = make_workspace(
            tmp_path,
            "ws_bad_exit",
            flows={
                "f": {
                    "nodes": {
                        "a": passthrough_node(),
                        "b": passthrough_node(),
                    },
                    "edges": [
                        {"from_node": "a", "from_exit": "nope", "to_node": "b"}
                    ],
                    "entry_node": "a",
                },
            },
        )
        hits = [d for d in mod._workspace.diagnostics if d.code == "unknown_edge_exit"]
        assert len(hits) == 1
        assert hits[0].detail["from_exit"] == "nope"


class TestUnresolvableRefs:
    """SPEC §6.4 gap (4) + §4.7: broken refs become UnresolvableRef sentinels."""

    def test_bad_module_yields_unresolvable_ref_and_diagnostic(
        self, tmp_path, make_workspace
    ):
        mod = make_workspace(
            tmp_path,
            "ws_bad_module",
            flows={
                "f": {
                    "nodes": {
                        "n": {
                            "kind": "python",
                            "ref": "definitely_not_a_real_module_xyz:f",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [],
                    "entry_node": "n",
                },
            },
        )
        from dagsmith.diagnostics import UnresolvableRef

        cb = mod._workspace.node_callable("f", "n")
        assert isinstance(cb, UnresolvableRef)
        codes = [d.code for d in mod._workspace.diagnostics]
        assert "unresolved_ref" in codes

    def test_missing_function_yields_unresolvable_ref(self, tmp_path, make_workspace):
        mod = make_workspace(
            tmp_path,
            "ws_missing_func",
            flows={
                "f": {
                    "nodes": {
                        "n": {
                            "kind": "python",
                            "ref": "builtins:definitely_not_a_builtin_xyz",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [],
                    "entry_node": "n",
                },
            },
        )
        from dagsmith.diagnostics import UnresolvableRef

        assert isinstance(mod._workspace.node_callable("f", "n"), UnresolvableRef)

    def test_malformed_ref_yields_unresolvable_ref(self, tmp_path, make_workspace):
        mod = make_workspace(
            tmp_path,
            "ws_bad_ref_syntax",
            flows={
                "f": {
                    "nodes": {
                        "n": {
                            "kind": "python",
                            "ref": "no_colon_here",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [],
                    "entry_node": "n",
                },
            },
        )
        from dagsmith.diagnostics import UnresolvableRef

        assert isinstance(mod._workspace.node_callable("f", "n"), UnresolvableRef)

    def test_running_through_unresolvable_ref_raises_at_the_point(
        self, tmp_path, make_workspace
    ):
        mod = make_workspace(
            tmp_path,
            "ws_run_unresolved",
            flows={
                "f": {
                    "nodes": {
                        "n": {
                            "kind": "python",
                            "ref": "builtins:not_a_real_func_asdf",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [],
                    "entry_node": "n",
                },
            },
        )
        run = mod._workspace.flow("f")
        with pytest.raises(RuntimeError, match="unresolvable"):
            run(42)

    def test_transitive_syntax_error_yields_syntax_error_diagnostic(self, tmp_path):
        """A node module with a SyntaxError gets a `syntax_error` diagnostic,
        distinguishable from a plain `unresolved_ref`."""
        pkg_name = "ws_syntax_err"
        pkg_root = tmp_path / pkg_name
        pkg_root.mkdir()
        (pkg_root / "__init__.py").write_text(
            "from dagsmith import load_workspace\n_workspace = load_workspace(__name__)\n",
            encoding="utf-8",
        )
        (pkg_root / "dagsmith.json").write_text(
            json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
        )
        flow_dir = pkg_root / "f"
        flow_dir.mkdir()
        (flow_dir / "__init__.py").write_text("", encoding="utf-8")
        # Valid Python syntax at import of the ref module would just resolve; we
        # need the imported module to have a SyntaxError so importlib raises it.
        (flow_dir / "broken.py").write_text(
            "def go(x)\n    return x\n",  # missing colon → SyntaxError
            encoding="utf-8",
        )
        (flow_dir / "flow.json").write_text(
            json.dumps(
                {
                    "id": "f",
                    "input": "typing.Any",
                    "entry_node": "n",
                    "nodes": {
                        "n": {
                            "kind": "python",
                            "ref": ".broken:go",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [],
                }
            ),
            encoding="utf-8",
        )
        sys.path.insert(0, str(tmp_path))
        try:
            if pkg_name in sys.modules:
                del sys.modules[pkg_name]
            for mod_name in list(sys.modules):
                if mod_name.startswith(pkg_name + "."):
                    del sys.modules[mod_name]
            module = importlib.import_module(pkg_name)
            codes = [d.code for d in module._workspace.diagnostics]
            assert "syntax_error" in codes
            assert "unresolved_ref" not in codes
        finally:
            if str(tmp_path) in sys.path:
                sys.path.remove(str(tmp_path))


class TestTolerantLoad:
    """SPEC §6.4 gap (5): broken flow.json doesn't abort the workspace."""

    def _base_pkg(self, tmp_path: Path, pkg_name: str) -> Path:
        pkg_root = tmp_path / pkg_name
        pkg_root.mkdir()
        (pkg_root / "__init__.py").write_text(
            textwrap.dedent(
                """
                from dagsmith import load_workspace

                _workspace = load_workspace(__name__)
                """
            ).lstrip(),
            encoding="utf-8",
        )
        (pkg_root / "dagsmith.json").write_text(
            json.dumps({"name": pkg_name, "version": "0.1.0"}),
            encoding="utf-8",
        )
        return pkg_root

    def _import(self, tmp_path: Path, pkg_name: str):
        sys.path.insert(0, str(tmp_path))
        try:
            for m in list(sys.modules):
                if m == pkg_name or m.startswith(pkg_name + "."):
                    del sys.modules[m]
            return importlib.import_module(pkg_name)
        finally:
            if str(tmp_path) in sys.path:
                sys.path.remove(str(tmp_path))

    def test_invalid_json_loads_as_broken_sentinel(self, tmp_path):
        pkg_root = self._base_pkg(tmp_path, "ws_bad_json")
        bad = pkg_root / "broken"
        bad.mkdir()
        (bad / "__init__.py").write_text("", encoding="utf-8")
        (bad / "flow.json").write_text("{not valid json", encoding="utf-8")
        mod = self._import(tmp_path, "ws_bad_json")
        assert "broken" in mod._workspace.flow_ids
        codes = [d.code for d in mod._workspace.diagnostics]
        assert "malformed_flow_json" in codes
        # calling the broken flow raises with the diagnostic's message
        with pytest.raises(WorkspaceError, match="failed to load"):
            mod._workspace.flow("broken")(None)

    def test_invalid_spec_loads_as_broken_sentinel(self, tmp_path):
        pkg_root = self._base_pkg(tmp_path, "ws_bad_spec")
        bad = pkg_root / "broken"
        bad.mkdir()
        (bad / "__init__.py").write_text("", encoding="utf-8")
        # valid JSON, but missing required FlowSpec fields
        (bad / "flow.json").write_text(
            json.dumps({"id": "broken", "not_a_real_key": 1}),
            encoding="utf-8",
        )
        mod = self._import(tmp_path, "ws_bad_spec")
        assert "broken" in mod._workspace.flow_ids
        codes = [d.code for d in mod._workspace.diagnostics]
        assert "invalid_flow_spec" in codes
        with pytest.raises(WorkspaceError, match="failed to load"):
            mod._workspace.flow("broken")(None)

    def test_other_flows_still_load_alongside_broken_flow(self, tmp_path):
        pkg_root = self._base_pkg(tmp_path, "ws_mixed")
        # broken flow
        bad = pkg_root / "broken"
        bad.mkdir()
        (bad / "__init__.py").write_text("", encoding="utf-8")
        (bad / "flow.json").write_text("{not valid", encoding="utf-8")
        # good flow
        good = pkg_root / "good"
        good.mkdir()
        (good / "__init__.py").write_text("", encoding="utf-8")
        (good / "impl.py").write_text(
            "def triple(x):\n    return x * 3\n", encoding="utf-8"
        )
        (good / "flow.json").write_text(
            json.dumps(
                {
                    "id": "good",
                    "nodes": {
                        "_start": {
                            "kind": "start",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "t": {
                            "kind": "python",
                            "ref": ".impl:triple",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        }
                    },
                    "edges": [
                        {"from_node": "_start", "from_exit": "out", "to_node": "t"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        mod = self._import(tmp_path, "ws_mixed")
        assert set(mod._workspace.flow_ids) == {"broken", "good"}
        # good flow runs fine
        assert mod._workspace.flow("good")(5).value == 15
        # broken flow raises at invocation
        with pytest.raises(WorkspaceError):
            mod._workspace.flow("broken")(None)
        # flow_spec on broken raises, flow_spec on good returns spec
        with pytest.raises(WorkspaceError):
            mod._workspace.flow_spec("broken")
        # entry_node is computed from the start sentinel (SPEC §12 line 427).
        assert mod._workspace.flow_spec("good").entry_node == "_start"


class TestTypeMismatchDiagnostics:
    """type_mismatch diagnostic: emitted when exit type != target input type."""

    def test_clean_edge_no_diagnostic(self, tmp_path, make_workspace):
        mod = make_workspace(
            tmp_path,
            "ws_type_clean",
            flows={
                "f": {
                    "nodes": {
                        "a": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"out": "mymod.Foo"},
                        },
                        "b": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "mymod.Foo",
                            "exits": {"out": "typing.Any"},
                        },
                    },
                    "edges": [
                        {"from_node": "a", "from_exit": "out", "to_node": "b"},
                    ],
                    "entry_node": "a",
                },
            },
        )
        mismatches = [d for d in mod._workspace.diagnostics if d.code == "type_mismatch"]
        assert mismatches == [], "matching types should not produce type_mismatch"

    def test_mismatched_types_emit_diagnostic(self, tmp_path, make_workspace):
        mod = make_workspace(
            tmp_path,
            "ws_type_mismatch",
            flows={
                "f": {
                    "nodes": {
                        "a": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"out": "mymod.TypeA"},
                        },
                        "b": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "mymod.TypeB",
                            "exits": {"out": "typing.Any"},
                        },
                    },
                    "edges": [
                        {"from_node": "a", "from_exit": "out", "to_node": "b"},
                    ],
                    "entry_node": "a",
                },
            },
        )
        mismatches = [d for d in mod._workspace.diagnostics if d.code == "type_mismatch"]
        assert len(mismatches) == 1
        d = mismatches[0]
        assert d.severity == "warning"
        # conftest prepended the _start → a edge at index 0; the a→b edge is
        # the second in the edges list.
        assert d.edge_index == 1
        assert d.node_id == "a"
        assert d.detail["source_type"] == "mymod.TypeA"
        assert d.detail["target_type"] == "mymod.TypeB"

    def test_typing_any_on_either_side_suppresses_diagnostic(self, tmp_path, make_workspace):
        # typing.Any is always compatible — no diagnostic for Any→concrete or concrete→Any
        mod = make_workspace(
            tmp_path,
            "ws_type_any",
            flows={
                "f": {
                    "nodes": {
                        "a": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "b": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "mymod.SomeType",
                            "exits": {"out": "typing.Any"},
                        },
                    },
                    "edges": [
                        {"from_node": "a", "from_exit": "out", "to_node": "b"},
                    ],
                    "entry_node": "a",
                },
            },
        )
        mismatches = [d for d in mod._workspace.diagnostics if d.code == "type_mismatch"]
        assert mismatches == [], "typing.Any source should never produce type_mismatch"


class TestStartNode:
    """SPEC §12 line 427: kind="start" is a virtual entry sentinel. Exactly
    one per flow; the runtime passes the input payload straight through its
    implicit "out" exit without ref resolution."""

    def test_start_node_routes_through_out(self, tmp_path):
        pkg_name = "ws_start_routes"
        pkg_root = tmp_path / pkg_name
        pkg_root.mkdir()
        (pkg_root / "dagsmith.json").write_text(
            json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
        )
        (pkg_root / "__init__.py").write_text(
            "from dagsmith import load_workspace\n"
            "_workspace = load_workspace(__name__)\n",
            encoding="utf-8",
        )
        flow_dir = pkg_root / "f"
        flow_dir.mkdir()
        (flow_dir / "__init__.py").write_text("", encoding="utf-8")
        (flow_dir / "impl.py").write_text(
            "def bump(x):\n    return x + 1\n", encoding="utf-8"
        )
        (flow_dir / "flow.json").write_text(
            json.dumps(
                {
                    "id": "f",
                    "nodes": {
                        "_start": {
                            "kind": "start",
                            "input": "int",
                            "exits": {"out": "int"},
                        },
                        "bump": {
                            "kind": "python",
                            "ref": ".impl:bump",
                            "input": "int",
                            "exits": {"out": "int"},
                        },
                    },
                    "edges": [
                        {"from_node": "_start", "from_exit": "out", "to_node": "bump"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        sys.path.insert(0, str(tmp_path))
        try:
            for m in list(sys.modules):
                if m == pkg_name or m.startswith(pkg_name + "."):
                    del sys.modules[m]
            module = importlib.import_module(pkg_name)
        finally:
            if str(tmp_path) in sys.path:
                sys.path.remove(str(tmp_path))
        # entry_node is computed to the start id; input_type is computed to
        # start.exits["out"].
        spec = module._workspace.flow_spec("f")
        assert spec.entry_node == "_start"
        assert spec.input_type == "int"
        # runtime: start passes the payload unchanged through "out".
        result = module._workspace.flow("f")(10)
        assert result.value == 11  # bump(10)

    def test_missing_start_node_emits_diagnostic(
        self, tmp_path, make_workspace, passthrough_node
    ):
        # make_workspace's helper auto-adds a start; bypass it by writing a
        # flow.json directly without a start node.
        pkg_name = "ws_no_start"
        pkg_root = tmp_path / pkg_name
        pkg_root.mkdir()
        (pkg_root / "dagsmith.json").write_text(
            json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
        )
        (pkg_root / "__init__.py").write_text(
            "from dagsmith import load_workspace\n"
            "_workspace = load_workspace(__name__)\n",
            encoding="utf-8",
        )
        flow_dir = pkg_root / "f"
        flow_dir.mkdir()
        (flow_dir / "__init__.py").write_text("", encoding="utf-8")
        (flow_dir / "flow.json").write_text(
            json.dumps(
                {
                    "id": "f",
                    "nodes": {
                        "leaf": {
                            "kind": "python",
                            "ref": "builtins:id",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                    },
                    "edges": [],
                }
            ),
            encoding="utf-8",
        )
        sys.path.insert(0, str(tmp_path))
        try:
            for m in list(sys.modules):
                if m == pkg_name or m.startswith(pkg_name + "."):
                    del sys.modules[m]
            module = importlib.import_module(pkg_name)
        finally:
            if str(tmp_path) in sys.path:
                sys.path.remove(str(tmp_path))
        codes = [d.code for d in module._workspace.diagnostics]
        assert "missing_start_node" in codes
        # invoking raises (no unique start node).
        import pytest as _pt
        with _pt.raises(WorkspaceError, match="no unique start node"):
            module._workspace.flow("f")(None)

    def test_ambiguous_start_node_emits_diagnostic(self, tmp_path):
        pkg_name = "ws_two_starts"
        pkg_root = tmp_path / pkg_name
        pkg_root.mkdir()
        (pkg_root / "dagsmith.json").write_text(
            json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
        )
        (pkg_root / "__init__.py").write_text(
            "from dagsmith import load_workspace\n"
            "_workspace = load_workspace(__name__)\n",
            encoding="utf-8",
        )
        flow_dir = pkg_root / "f"
        flow_dir.mkdir()
        (flow_dir / "__init__.py").write_text("", encoding="utf-8")
        (flow_dir / "flow.json").write_text(
            json.dumps(
                {
                    "id": "f",
                    "nodes": {
                        "_start_a": {
                            "kind": "start",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                        "_start_b": {
                            "kind": "start",
                            "input": "typing.Any",
                            "exits": {"out": "typing.Any"},
                        },
                    },
                    "edges": [],
                }
            ),
            encoding="utf-8",
        )
        sys.path.insert(0, str(tmp_path))
        try:
            for m in list(sys.modules):
                if m == pkg_name or m.startswith(pkg_name + "."):
                    del sys.modules[m]
            module = importlib.import_module(pkg_name)
        finally:
            if str(tmp_path) in sys.path:
                sys.path.remove(str(tmp_path))
        diags = module._workspace.diagnostics
        hits = [d for d in diags if d.code == "ambiguous_start_node"]
        assert len(hits) == 1
        assert sorted(hits[0].detail["start_nodes"]) == ["_start_a", "_start_b"]
