"""Tests for dagsmith.server FastAPI endpoints under the M3 permissive posture.

Covers the four §6.4 server-side gaps (6 & 7) plus the WorkspaceRegistry
extraction from gap §6.1:

    * update_node_source works for a healthy node (inspect path).
    * update_node_source works for an UnresolvableRef node (ref-string path).
    * add_edge accepts fan-out duplicates (§6.4 gap 7, §4.2).
    * WorkspaceRegistry caches + reloads as expected.
    * Mutations refresh diagnostics on the cached workspace (§6.3 spirit).

Shared fixtures (`server_pkg`, `client`, `make_workspace`, ...) live in
`tests/conftest.py`.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from dagsmith.diagnostics import UnresolvableRef
from dagsmith.server import WorkspaceRegistry, registry


# --- WorkspaceRegistry unit tests ----------------------------------------


class TestWorkspaceRegistry:
    def test_get_caches_same_instance(self, server_pkg: str) -> None:
        r = WorkspaceRegistry()
        ws1 = r.get(server_pkg)
        ws2 = r.get(server_pkg)
        assert ws1 is ws2

    def test_reload_returns_fresh_instance(self, server_pkg: str) -> None:
        r = WorkspaceRegistry()
        ws1 = r.get(server_pkg)
        ws2 = r.reload(server_pkg)
        assert ws2 is not ws1
        # and it caches the fresh one
        assert r.get(server_pkg) is ws2

    def test_list_returns_cached(self, server_pkg: str) -> None:
        r = WorkspaceRegistry()
        assert r.list() == []
        ws = r.get(server_pkg)
        assert r.list() == [ws]


# --- endpoint tests -------------------------------------------------------


class TestUpdateNodeSource:
    def test_healthy_node_writes_and_reloads(
        self, client: TestClient, server_pkg: str, tmp_path: Path
    ) -> None:
        # prime the cache so the endpoint has something to reload
        client.get(f"/api/workspaces/{server_pkg}").raise_for_status()
        new_source = (
            "from typing import Any\n\n\n"
            "def process(value: Any) -> Any:\n"
            "    return {'echoed': value}\n"
        )
        resp = client.put(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/greet/source",
            json={"source": new_source},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["path"].endswith("hello/greet.py")
        # file on disk reflects the new source
        assert Path(body["path"]).read_text() == new_source
        # and the workspace reloaded — a GET now reflects the new source
        view = client.get(f"/api/workspaces/{server_pkg}/flows/hello").json()
        assert view["nodes"]["greet"]["source_code"] == new_source

    def test_unresolvable_ref_node_writes_via_ref_path(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # confirm the node really is unresolvable before the write
        ws = registry.get(server_pkg)
        func = ws.node_callable("hello", "broken")
        assert isinstance(func, UnresolvableRef)

        new_source = (
            "from typing import Any\n\n\n"
            "def go(value: Any) -> Any:\n"
            "    return value\n"
        )
        resp = client.put(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/broken/source",
            json={"source": new_source},
        )
        # endpoint resolved the path from the `.broken:go` ref even though
        # there was no callable to inspect.getsourcefile on.
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["path"].endswith("hello/broken.py")
        assert Path(body["path"]).read_text() == new_source

        # after write the workspace reloads; the ref now resolves to a real
        # callable (broken.py was just created).
        ws2 = registry.get(server_pkg)
        assert not isinstance(ws2.node_callable("hello", "broken"), UnresolvableRef)


class TestAddEdgeFanOut:
    def test_second_edge_on_same_exit_allowed(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # first edge already exists (greet:out → flow-exit "out"). Adding a
        # second edge from the same (greet, out) port must succeed — this is
        # fan-out per §4.2.
        # add a second node to fan out INTO so the flow stays semantically
        # interesting:
        add_node = client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes",
            json={
                "name": "echo",
                "ref": ".echo:go",
                "input": "typing.Any",
                "exits": {"out": "typing.Any"},
                "create_stub": True,
            },
        )
        assert add_node.status_code == 200, add_node.text

        resp = client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/edges",
            json={
                "from_node": "greet",
                "from_exit": "out",
                "to_node": "echo",
            },
        )
        assert resp.status_code == 200, resp.text
        edges = resp.json()["edges"]
        fan = [e for e in edges if e["from_node"] == "greet" and e["from_exit"] == "out"]
        # two edges now share (greet, out): the original to flow-exit, plus the new one
        assert len(fan) == 2


class TestMutationRefreshesDiagnostics:
    """§6.3: after every mutation, diagnostics are re-run on the cached workspace.

    Covers the observable effect: adding a node with an unresolvable ref makes
    the workspace expose it as an UnresolvableRef after the reload triggered
    by the mutation. Diagnostics-in-response coverage is in
    `TestMutationResponseDiagnostics` below.
    """

    def test_add_node_with_missing_ref_becomes_unresolvable(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # a fresh node whose ref points at a non-existent module
        resp = client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes",
            json={
                "name": "ghost",
                "ref": ".does_not_exist:fn",
                "input": "typing.Any",
                "exits": {"out": "typing.Any"},
                "create_stub": False,
            },
        )
        assert resp.status_code == 200, resp.text

        ws = registry.get(server_pkg)
        func = ws.node_callable("hello", "ghost")
        assert isinstance(func, UnresolvableRef)


# --- M3 coverage gaps -----------------------------------------------------


class TestUnknownWorkspace404:
    """Any endpoint addressed to a nonexistent workspace returns 404."""

    def test_get_workspace_unknown_is_404(self, client: TestClient) -> None:
        resp = client.get("/api/workspaces/no_such_workspace_xyz")
        assert resp.status_code == 404

    def test_get_flow_unknown_workspace_is_404(self, client: TestClient) -> None:
        resp = client.get("/api/workspaces/no_such_workspace_xyz/flows/hello")
        assert resp.status_code == 404

    def test_add_node_unknown_workspace_is_404(self, client: TestClient) -> None:
        resp = client.post(
            "/api/workspaces/no_such_workspace_xyz/flows/hello/nodes",
            json={
                "name": "n",
                "ref": ".x:y",
                "input": "typing.Any",
                "exits": {"out": "typing.Any"},
            },
        )
        assert resp.status_code == 404


class TestUnknownFlow404:
    def test_get_flow_unknown_flow_is_404(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.get(f"/api/workspaces/{server_pkg}/flows/no_such_flow")
        assert resp.status_code == 404

    def test_update_node_source_unknown_flow_is_404(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.put(
            f"/api/workspaces/{server_pkg}/flows/no_such_flow/nodes/greet/source",
            json={"source": "x = 1\n"},
        )
        assert resp.status_code == 404

    def test_update_node_source_unknown_node_is_404(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.put(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/no_such_node/source",
            json={"source": "x = 1\n"},
        )
        assert resp.status_code == 404


class TestDeleteNode:
    """M3 mutation: delete_node removes the node and its incident edges."""

    def test_delete_node_removes_node_and_incident_edges(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # first add a second node + an edge greet→echo so echo has an incident
        # edge to delete. The `broken` node is already present with no edges.
        client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes",
            json={
                "name": "echo",
                "ref": ".echo:go",
                "input": "typing.Any",
                "exits": {"out": "typing.Any"},
                "create_stub": True,
            },
        ).raise_for_status()
        client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/edges",
            json={"from_node": "greet", "from_exit": "out", "to_node": "echo"},
        ).raise_for_status()

        resp = client.delete(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/echo"
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "echo" not in body["nodes"]
        # the incident edge to echo is gone; only the original greet→flow_exit remains
        edges_to_echo = [e for e in body["edges"] if e.get("to_node") == "echo"]
        assert edges_to_echo == []

    def test_delete_node_unknown_node_is_404(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.delete(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/no_such_node"
        )
        assert resp.status_code == 404

    def test_delete_entry_node_is_400(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # `greet` is the entry_node of the hello flow — deletion must fail.
        resp = client.delete(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/greet"
        )
        assert resp.status_code == 400


class TestDeleteEdge:
    """M3 mutation: delete_edge removes the first matching edge."""

    def test_delete_edge_removes_matching_edge(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.request(
            "DELETE",
            f"/api/workspaces/{server_pkg}/flows/hello/edges",
            json={"from_node": "greet", "from_exit": "out"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # only edge was greet:out→flow_exit; deletion removes it
        assert all(
            not (e["from_node"] == "greet" and e["from_exit"] == "out")
            for e in body["edges"]
        )

    def test_delete_edge_no_match_is_404(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.request(
            "DELETE",
            f"/api/workspaces/{server_pkg}/flows/hello/edges",
            json={"from_node": "greet", "from_exit": "ghost_exit"},
        )
        assert resp.status_code == 404


class TestUpdateSourceOutsideRoot:
    """§6.2: writes to a node whose source file resolves outside ws.root are 403."""

    def test_builtin_ref_returns_400_or_403(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # Add a node with an absolute ref to a stdlib module (json). The
        # resolved source path is outside ws.root, so update_node_source
        # should refuse. Either 403 (path outside root) or 400 (can't
        # determine source from an absolute ref) is acceptable — both
        # encode the "we won't write there" policy.
        client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes",
            json={
                "name": "stdnode",
                "ref": "json:loads",
                "input": "typing.Any",
                "exits": {"out": "typing.Any"},
                "create_stub": False,
            },
        ).raise_for_status()

        resp = client.put(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/stdnode/source",
            json={"source": "# evil\n"},
        )
        assert resp.status_code in (400, 403), resp.text


# --- M4 endpoint tests ----------------------------------------------------


class TestWorkspaceTypes:
    """GET /api/workspaces/{w}/types returns types grouped by scope."""

    def test_empty_workspace_returns_empty_list(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # `server_pkg` doesn't define any palette types — should be empty.
        resp = client.get(f"/api/workspaces/{server_pkg}/types")
        assert resp.status_code == 200
        assert resp.json() == {"types": []}

    def test_types_grouped_by_scope_and_ordered(
        self, client: TestClient, typed_server_pkg: str
    ) -> None:
        resp = client.get(f"/api/workspaces/{typed_server_pkg}/types")
        assert resp.status_code == 200, resp.text
        types = resp.json()["types"]
        assert types, "expected types to be discovered"

        by_scope: dict[str, list[dict[str, str]]] = {}
        for t in types:
            by_scope.setdefault(t["scope"], []).append(t)

        assert set(by_scope.keys()) == {"flow_local", "workspace", "shared"}

        flow_local_names = {t["qualified_name"].rsplit(".", 1)[-1] for t in by_scope["flow_local"]}
        assert "Mood" in flow_local_names
        assert "Snapshot" in flow_local_names
        for t in by_scope["flow_local"]:
            assert t["flow_id"] == "hello"

        ws_names = {t["qualified_name"].rsplit(".", 1)[-1] for t in by_scope["workspace"]}
        assert "WorkspaceCfg" in ws_names

        shared_names = {t["qualified_name"].rsplit(".", 1)[-1] for t in by_scope["shared"]}
        assert "SharedModel" in shared_names

        # ordering: scope groups contiguous, in flow_local → workspace → shared order
        scope_sequence = [t["scope"] for t in types]
        first_index = {
            scope: scope_sequence.index(scope) for scope in set(scope_sequence)
        }
        assert first_index["flow_local"] < first_index["workspace"] < first_index["shared"]

    def test_kind_classification(
        self, client: TestClient, typed_server_pkg: str
    ) -> None:
        types = client.get(f"/api/workspaces/{typed_server_pkg}/types").json()["types"]
        by_name = {t["qualified_name"].rsplit(".", 1)[-1]: t for t in types}
        assert by_name["Mood"]["kind"] == "enum"
        assert by_name["Snapshot"]["kind"] == "typed_dict"
        assert by_name["WorkspaceCfg"]["kind"] == "dataclass"
        assert by_name["SharedModel"]["kind"] == "pydantic"
        assert by_name["Point"]["kind"] == "named_tuple"


class TestGroupRoundTrip:
    """POST+DELETE /api/workspaces/{w}/flows/{fid}/group persist via flow.json."""

    def test_create_group_persists_and_returns_flow_view(
        self, client: TestClient, server_pkg: str, tmp_path: Path
    ) -> None:
        resp = client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/group",
            json={
                "id": "g1",
                "node_ids": ["greet", "broken"],
                "label": "Greeting cluster",
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # response is a FlowView; check layout carries the new group
        groups = body["layout"].get("groups", [])
        assert any(g["id"] == "g1" for g in groups)

        # round-trip: a fresh GET reflects the new group from flow.json
        view = client.get(f"/api/workspaces/{server_pkg}/flows/hello").json()
        assert any(g["id"] == "g1" for g in view["layout"].get("groups", []))

        # and the raw flow.json on disk has it too
        flow_json = Path(tmp_path / server_pkg / "hello" / "flow.json")
        on_disk = json.loads(flow_json.read_text())
        assert any(
            g.get("id") == "g1" for g in on_disk["layout"].get("groups", [])
        )

    def test_create_group_with_existing_id_replaces_in_place(
        self, client: TestClient, server_pkg: str
    ) -> None:
        url = f"/api/workspaces/{server_pkg}/flows/hello/group"
        client.post(
            url,
            json={"id": "g1", "node_ids": ["greet"], "label": "first"},
        ).raise_for_status()
        resp = client.post(
            url,
            json={"id": "g1", "node_ids": ["broken"], "label": "second"},
        )
        assert resp.status_code == 200, resp.text
        groups = resp.json()["layout"]["groups"]
        g1s = [g for g in groups if g["id"] == "g1"]
        assert len(g1s) == 1
        assert g1s[0]["node_ids"] == ["broken"]
        assert g1s[0]["label"] == "second"

    def test_delete_group_removes_it(
        self, client: TestClient, server_pkg: str
    ) -> None:
        client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/group",
            json={"id": "g1", "node_ids": ["greet"], "label": ""},
        ).raise_for_status()
        resp = client.delete(
            f"/api/workspaces/{server_pkg}/flows/hello/group/g1"
        )
        assert resp.status_code == 200, resp.text
        groups = resp.json()["layout"].get("groups", [])
        assert not any(g["id"] == "g1" for g in groups)

    def test_delete_group_unknown_id_is_404(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.delete(
            f"/api/workspaces/{server_pkg}/flows/hello/group/no_such_group"
        )
        assert resp.status_code == 404


class TestDiagnosticsEndpoints:
    """GET /api/workspaces/{w}[/flows/{fid}]/diagnostics."""

    def test_workspace_diagnostics_shape(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.get(f"/api/workspaces/{server_pkg}/diagnostics")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "diagnostics" in body
        # the `hello` fixture has an UnresolvableRef for the `broken` node
        codes = [d["code"] for d in body["diagnostics"]]
        assert "unresolved_ref" in codes
        # each diagnostic preserves core fields
        for d in body["diagnostics"]:
            assert "severity" in d
            assert "code" in d
            assert "message" in d

    def test_flow_diagnostics_filtered_to_flow(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.get(
            f"/api/workspaces/{server_pkg}/flows/hello/diagnostics"
        )
        assert resp.status_code == 200, resp.text
        diags = resp.json()["diagnostics"]
        assert diags, "expected at least one diagnostic for the `broken` ref"
        for d in diags:
            assert d["flow_id"] == "hello"

    def test_flow_diagnostics_unknown_flow_is_404(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.get(
            f"/api/workspaces/{server_pkg}/flows/no_such_flow/diagnostics"
        )
        assert resp.status_code == 404

    def test_diagnostics_preserve_detail(
        self, client: TestClient, server_pkg: str
    ) -> None:
        """`detail` (including `derived_from`-style free-form data) round-trips."""
        body = client.get(
            f"/api/workspaces/{server_pkg}/flows/hello/diagnostics"
        ).json()
        unresolved = next(
            d for d in body["diagnostics"] if d["code"] == "unresolved_ref"
        )
        assert unresolved["detail"].get("ref") == ".broken:go"
        assert unresolved["node_id"] == "broken"


class TestFlowTreeEndpoint:
    """GET /api/workspaces/{w}/flows/{fid}/tree — ancestors/siblings/subflows."""

    def test_root_flow_has_no_ancestors(
        self, client: TestClient, nested_server_pkg: str
    ) -> None:
        resp = client.get(
            f"/api/workspaces/{nested_server_pkg}/flows/parent/tree"
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["flow_id"] == "parent"
        assert body["label"] == "parent"
        assert body["ancestors"] == []
        # sibling is a root-level flow distinct from `parent`
        sibling_ids = {s["flow_id"] for s in body["siblings"]}
        assert "sibling" in sibling_ids
        # parent has a kind=flow subnode → subflows list includes parent.child
        sub_ids = {s["flow_id"] for s in body["subflows"]}
        assert "parent.child" in sub_ids
        call_child = next(
            s for s in body["subflows"] if s["flow_id"] == "parent.child"
        )
        assert call_child["node_id"] == "call_child"

    def test_nested_flow_has_parent_in_ancestors(
        self, client: TestClient, nested_server_pkg: str
    ) -> None:
        resp = client.get(
            f"/api/workspaces/{nested_server_pkg}/flows/parent.child/tree"
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["flow_id"] == "parent.child"
        assert body["label"] == "child"
        ancestor_ids = [a["flow_id"] for a in body["ancestors"]]
        assert ancestor_ids == ["parent"]
        # no siblings at parent.* depth
        assert body["siblings"] == []
        # leaf has no kind=flow subnodes
        assert body["subflows"] == []

    def test_tree_unknown_flow_is_404(
        self, client: TestClient, nested_server_pkg: str
    ) -> None:
        resp = client.get(
            f"/api/workspaces/{nested_server_pkg}/flows/no_such_flow/tree"
        )
        assert resp.status_code == 404


class TestMutationResponseDiagnostics:
    """§6.3 / T7: every mutation response carries refreshed `diagnostics`."""

    def test_add_node_with_bad_ref_puts_diagnostic_in_flow_view(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.post(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes",
            json={
                "name": "ghost",
                "ref": ".does_not_exist:fn",
                "input": "typing.Any",
                "exits": {"out": "typing.Any"},
                "create_stub": False,
            },
        )
        assert resp.status_code == 200, resp.text
        diags = resp.json()["diagnostics"]
        codes = [d["code"] for d in diags]
        assert "unresolved_ref" in codes
        ghost_diag = next(
            d for d in diags if d.get("node_id") == "ghost"
        )
        assert ghost_diag["flow_id"] == "hello"

    def test_update_source_response_has_diagnostics_field(
        self, client: TestClient, server_pkg: str
    ) -> None:
        # prime the cache
        client.get(f"/api/workspaces/{server_pkg}").raise_for_status()
        resp = client.put(
            f"/api/workspaces/{server_pkg}/flows/hello/nodes/greet/source",
            json={
                "source": (
                    "from typing import Any\n\n\n"
                    "def process(value: Any) -> Any:\n"
                    "    return value\n"
                )
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "diagnostics" in body
        # broken node's diagnostic is still present after a successful write
        codes = [d["code"] for d in body["diagnostics"]]
        assert "unresolved_ref" in codes

    def test_update_layout_response_has_diagnostics_field(
        self, client: TestClient, server_pkg: str
    ) -> None:
        resp = client.put(
            f"/api/workspaces/{server_pkg}/flows/hello/layout",
            json={"nodes": {"greet": {"x": 1.0, "y": 2.0}}},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert isinstance(body["diagnostics"], list)
        # server_pkg has a broken-ref node; that diagnostic survives layout writes
        codes = [d["code"] for d in body["diagnostics"]]
        assert "unresolved_ref" in codes
