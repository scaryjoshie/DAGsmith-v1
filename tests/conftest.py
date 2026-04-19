"""Shared test fixtures for dagsmith tests.

`make_workspace` builds a synthetic workspace package on disk from a flows
dict and imports it. `passthrough_node` / `flow_ref_node` produce node
dicts used by the workspace-level tests. `server_pkg` / `client` support
server endpoint tests.
"""

from __future__ import annotations

import importlib
import json
import sys
import textwrap
from pathlib import Path
from typing import Any, Callable

import pytest


def _write_flow(
    root: Path,
    flow_id: str,
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    entry_node: str,
) -> None:
    """Write a flow.json under root/flow_id/ (dots become nested dirs).

    Under the Infer model (SPEC §12 line 425), public_exits is derived from
    unconnected source handles — the caller does not pass it. Shape leafage
    is controlled by what's in `edges`.
    """
    flow_dir = root / Path(*flow_id.split("."))
    flow_dir.mkdir(parents=True, exist_ok=True)
    (flow_dir / "__init__.py").write_text("", encoding="utf-8")
    (flow_dir / "flow.json").write_text(
        json.dumps(
            {
                "id": flow_id,
                "input": "typing.Any",
                "entry_node": entry_node,
                "nodes": nodes,
                "edges": edges,
            }
        ),
        encoding="utf-8",
    )


def _import_pkg(tmp_path: Path, pkg_name: str) -> Any:
    """Import `pkg_name` from tmp_path after purging any prior cached modules."""
    sys.path.insert(0, str(tmp_path))
    try:
        for mod in list(sys.modules):
            if mod == pkg_name or mod.startswith(pkg_name + "."):
                del sys.modules[mod]
        return importlib.import_module(pkg_name)
    finally:
        if str(tmp_path) in sys.path:
            sys.path.remove(str(tmp_path))


@pytest.fixture
def make_workspace() -> Callable[..., Any]:
    """Factory fixture: build a synthetic workspace package and import it.

    Signature: make_workspace(tmp_path, pkg_name, flows) -> module

    `flows` maps flow_id -> {"nodes", "edges", "entry_node"}. Public exits
    are derived from unconnected source handles (SPEC §12 line 425).
    """

    def _make(
        tmp_path: Path, pkg_name: str, flows: dict[str, dict[str, Any]]
    ) -> Any:
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
            json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
        )
        for flow_id, data in flows.items():
            _write_flow(
                pkg_root,
                flow_id,
                nodes=data["nodes"],
                edges=data["edges"],
                entry_node=data["entry_node"],
            )
        # make intermediate dirs along every dotted flow_id valid packages
        for flow_id in flows:
            parts = flow_id.split(".")
            for i in range(1, len(parts)):
                init = pkg_root.joinpath(*parts[:i], "__init__.py")
                init.parent.mkdir(parents=True, exist_ok=True)
                init.touch()

        return _import_pkg(tmp_path, pkg_name)

    return _make


@pytest.fixture
def passthrough_node() -> Callable[..., dict[str, Any]]:
    """Factory fixture: python-kind node that echoes input to the named exit.

    (Unused at runtime in workspace-structure tests — only exercises load-time
    validation.)
    """

    def _node(exit_name: str = "out") -> dict[str, Any]:
        return {
            "kind": "python",
            "ref": "builtins:id",
            "input": "typing.Any",
            "exits": {exit_name: "typing.Any"},
        }

    return _node


@pytest.fixture
def flow_ref_node() -> Callable[..., dict[str, Any]]:
    """Factory fixture: kind=flow node referencing another flow_id."""

    def _node(target_flow_id: str, exit_name: str = "out") -> dict[str, Any]:
        return {
            "kind": "flow",
            "ref": target_flow_id,
            "input": "typing.Any",
            "exits": {exit_name: "typing.Any"},
        }

    return _node


# --- server-side fixtures --------------------------------------------------


def _build_server_workspace(tmp_path: Path, pkg_name: str) -> Path:
    """Build a workspace with one flow (`hello`) and two nodes:

        greet  - a resolvable python node (ref `.greet:process`)
        broken - an unresolvable ref (module exists in flow.json but no .py)
    """
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
        json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
    )

    flow_dir = pkg_root / "hello"
    flow_dir.mkdir()
    (flow_dir / "__init__.py").write_text("", encoding="utf-8")
    (flow_dir / "greet.py").write_text(
        textwrap.dedent(
            """
            from typing import Any

            def process(value: Any) -> Any:
                return value
            """
        ).lstrip(),
        encoding="utf-8",
    )
    (flow_dir / "trailer.py").write_text(
        textwrap.dedent(
            """
            from typing import Any

            def run(value: Any) -> Any:
                return value
            """
        ).lstrip(),
        encoding="utf-8",
    )
    (flow_dir / "flow.json").write_text(
        json.dumps(
            {
                "id": "hello",
                "input": "typing.Any",
                "entry_node": "greet",
                "nodes": {
                    "greet": {
                        "kind": "python",
                        "ref": ".greet:process",
                        "input": "typing.Any",
                        "exits": {"out": "typing.Any"},
                    },
                    "trailer": {
                        "kind": "python",
                        "ref": ".trailer:run",
                        "input": "typing.Any",
                        "exits": {"out": "typing.Any"},
                    },
                    "broken": {
                        "kind": "python",
                        "ref": ".broken:go",
                        "input": "typing.Any",
                        "exits": {"out": "typing.Any"},
                    },
                },
                "edges": [
                    {"from_node": "greet", "from_exit": "out", "to_node": "trailer"},
                ],
            }
        ),
        encoding="utf-8",
    )
    return pkg_root


@pytest.fixture
def server_pkg(tmp_path: Path):
    """Yield a unique workspace package name importable from tmp_path.

    Used by server endpoint tests. Clears server.registry cache entries on
    teardown so repeated runs don't leak state.
    """
    from dagsmith import server

    pkg_name = f"ws_server_test_{abs(hash(tmp_path))}"
    _build_server_workspace(tmp_path, pkg_name)

    sys.path.insert(0, str(tmp_path))
    server.registry._cache.pop(pkg_name, None)
    for mod in list(sys.modules):
        if mod == pkg_name or mod.startswith(pkg_name + "."):
            del sys.modules[mod]

    try:
        yield pkg_name
    finally:
        if str(tmp_path) in sys.path:
            sys.path.remove(str(tmp_path))
        server.registry._cache.pop(pkg_name, None)
        for mod in list(sys.modules):
            if mod == pkg_name or mod.startswith(pkg_name + "."):
                del sys.modules[mod]


@pytest.fixture
def client():
    """FastAPI TestClient against the dagsmith server app."""
    from fastapi.testclient import TestClient

    from dagsmith.server import app

    return TestClient(app)


def _register_server_pkg(tmp_path: Path, pkg_name: str):
    """Prep sys.path / sys.modules / registry cache for a server test package.

    Returns a cleanup callable.
    """
    from dagsmith import server

    sys.path.insert(0, str(tmp_path))
    server.registry._cache.pop(pkg_name, None)
    for mod in list(sys.modules):
        if mod == pkg_name or mod.startswith(pkg_name + "."):
            del sys.modules[mod]

    def _cleanup() -> None:
        if str(tmp_path) in sys.path:
            sys.path.remove(str(tmp_path))
        server.registry._cache.pop(pkg_name, None)
        for mod in list(sys.modules):
            if mod == pkg_name or mod.startswith(pkg_name + "."):
                del sys.modules[mod]

    return _cleanup


def _base_pkg_init(pkg_root: Path, pkg_name: str) -> None:
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
        json.dumps({"name": pkg_name, "version": "0.1.0"}), encoding="utf-8"
    )


@pytest.fixture
def nested_server_pkg(tmp_path: Path):
    """Build a workspace with nested flows (`parent`, `parent.child`, `sibling`).

    `parent` has one kind=flow node referencing `parent.child`.
    All flows use `builtins:id` as the python ref for load simplicity.
    """
    pkg_name = f"ws_nested_test_{abs(hash(tmp_path))}"
    pkg_root = tmp_path / pkg_name
    _base_pkg_init(pkg_root, pkg_name)

    # parent flow — has a kind=flow subnode ref'ing parent.child
    parent_dir = pkg_root / "parent"
    parent_dir.mkdir()
    (parent_dir / "__init__.py").write_text("", encoding="utf-8")
    (parent_dir / "flow.json").write_text(
        json.dumps(
            {
                "id": "parent",
                "input": "typing.Any",
                "entry_node": "call_child",
                "nodes": {
                    "call_child": {
                        "kind": "flow",
                        "ref": "parent.child",
                        "input": "typing.Any",
                        "exits": {"out": "typing.Any"},
                    }
                },
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    child_dir = parent_dir / "child"
    child_dir.mkdir()
    (child_dir / "__init__.py").write_text("", encoding="utf-8")
    (child_dir / "flow.json").write_text(
        json.dumps(
            {
                "id": "parent.child",
                "input": "typing.Any",
                "entry_node": "leaf",
                "nodes": {
                    "leaf": {
                        "kind": "python",
                        "ref": "builtins:id",
                        "input": "typing.Any",
                        "exits": {"out": "typing.Any"},
                    }
                },
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    # sibling root-level flow (to exercise sibling list in the tree endpoint)
    sibling_dir = pkg_root / "sibling"
    sibling_dir.mkdir()
    (sibling_dir / "__init__.py").write_text("", encoding="utf-8")
    (sibling_dir / "flow.json").write_text(
        json.dumps(
            {
                "id": "sibling",
                "input": "typing.Any",
                "entry_node": "leaf",
                "nodes": {
                    "leaf": {
                        "kind": "python",
                        "ref": "builtins:id",
                        "input": "typing.Any",
                        "exits": {"out": "typing.Any"},
                    }
                },
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    cleanup = _register_server_pkg(tmp_path, pkg_name)
    try:
        yield pkg_name
    finally:
        cleanup()


@pytest.fixture
def typed_server_pkg(tmp_path: Path):
    """Workspace that places types at multiple scopes for the palette endpoint.

    Layout:
        <root>/shared/shared_types.py           — pydantic model (shared scope)
        <root>/workspace_types.py               — dataclass (workspace scope)
        <root>/hello/types/local.py             — enum + typed_dict (flow_local)
        <root>/hello/flow.json                  — one flow `hello`
    """
    pkg_name = f"ws_typed_test_{abs(hash(tmp_path))}"
    pkg_root = tmp_path / pkg_name
    _base_pkg_init(pkg_root, pkg_name)

    (pkg_root / "workspace_types.py").write_text(
        textwrap.dedent(
            """
            from dataclasses import dataclass

            @dataclass
            class WorkspaceCfg:
                name: str
            """
        ).lstrip(),
        encoding="utf-8",
    )

    shared = pkg_root / "shared"
    shared.mkdir()
    (shared / "__init__.py").write_text("", encoding="utf-8")
    (shared / "shared_types.py").write_text(
        textwrap.dedent(
            """
            from pydantic import BaseModel

            class SharedModel(BaseModel):
                id: int
            """
        ).lstrip(),
        encoding="utf-8",
    )

    flow_dir = pkg_root / "hello"
    flow_dir.mkdir()
    (flow_dir / "__init__.py").write_text("", encoding="utf-8")
    types_dir = flow_dir / "types"
    types_dir.mkdir()
    (types_dir / "__init__.py").write_text("", encoding="utf-8")
    (types_dir / "local.py").write_text(
        textwrap.dedent(
            """
            import enum
            from typing import NamedTuple, TypedDict

            class Mood(enum.Enum):
                HAPPY = "happy"
                SAD = "sad"

            class Snapshot(TypedDict):
                label: str
                count: int

            class Point(NamedTuple):
                x: int
                y: int
            """
        ).lstrip(),
        encoding="utf-8",
    )
    (flow_dir / "impl.py").write_text(
        "def run(x):\n    return x\n", encoding="utf-8"
    )
    (flow_dir / "flow.json").write_text(
        json.dumps(
            {
                "id": "hello",
                "input": "typing.Any",
                "entry_node": "go",
                "nodes": {
                    "go": {
                        "kind": "python",
                        "ref": ".impl:run",
                        "input": "typing.Any",
                        "exits": {"out": "typing.Any"},
                    }
                },
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    # Import the type modules explicitly so they land in sys.modules — the
    # palette only walks already-imported modules. load_workspace itself only
    # imports ref targets.
    cleanup = _register_server_pkg(tmp_path, pkg_name)
    try:
        importlib.import_module(pkg_name)
        importlib.import_module(f"{pkg_name}.workspace_types")
        importlib.import_module(f"{pkg_name}.shared.shared_types")
        importlib.import_module(f"{pkg_name}.hello.types.local")
        yield pkg_name
    finally:
        cleanup()
