import json
import tempfile
import unittest
from pathlib import Path

from dagsmith import Workspace
from dagsmith.workspace import WorkspaceLoadError


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def make_flow_payload(flow_id: str) -> dict:
    return {
        "id": flow_id,
        "input": "Record",
        "nodes": {
            "validate": {
                "kind": "python",
                "ref": ".validate:process",
                "input": "Record",
                "exits": {"out": "ValidatedRecord"},
            }
        },
        "edges": [
            {
                "from_node": "validate",
                "from_exit": "out",
                "to_flow_exit": "out",
            }
        ],
        "entry_node": "validate",
        "public_exits": {"out": "ValidatedRecord"},
        "layout": {"nodes": {"validate": {"x": 120, "y": 80}}},
    }


class WorkspaceLoaderTests(unittest.TestCase):
    def test_from_directory_discovers_nested_flows(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "__init__.py").write_text("", encoding="utf-8")
            write_json(root / "dagsmith.json", {"name": "demo"})
            write_json(
                root / "customer" / "onboarding" / "flow.json",
                make_flow_payload("customer.onboarding"),
            )
            write_json(root / "customer" / "score" / "flow.json", make_flow_payload("customer.score"))

            workspace = Workspace.from_directory(root)

            self.assertEqual(sorted(workspace.flows), ["customer.onboarding", "customer.score"])
            self.assertEqual(workspace.get_flow("customer.onboarding").entry_node, "validate")
            self.assertEqual(
                workspace.to_dict()["flows"]["customer.onboarding"]["layout"]["nodes"]["validate"]["x"],
                120,
            )

    def test_from_directory_allows_missing_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "__init__.py").write_text("", encoding="utf-8")
            write_json(root / "customer" / "flow.json", make_flow_payload("customer"))

            workspace = Workspace.from_directory(root)

            self.assertEqual(sorted(workspace.flows), ["customer"])

    def test_from_directory_rejects_root_level_flow_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "__init__.py").write_text("", encoding="utf-8")
            write_json(root / "flow.json", make_flow_payload("root"))

            with self.assertRaises(WorkspaceLoadError):
                Workspace.from_directory(root)

    def test_from_directory_rejects_reserved_support_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "__init__.py").write_text("", encoding="utf-8")
            write_json(
                root / "customer" / "shared" / "flow.json",
                make_flow_payload("customer.shared"),
            )

            with self.assertRaises(WorkspaceLoadError):
                Workspace.from_directory(root)

    def test_from_directory_rejects_mismatched_declared_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "__init__.py").write_text("", encoding="utf-8")
            write_json(
                root / "customer" / "onboarding" / "flow.json",
                make_flow_payload("customer.wrong"),
            )

            with self.assertRaises(WorkspaceLoadError):
                Workspace.from_directory(root)


if __name__ == "__main__":
    unittest.main()
