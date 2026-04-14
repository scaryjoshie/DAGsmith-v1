import json
import tempfile
import unittest
from pathlib import Path

from dagsmith.ui_server import build_workspace_payload, get_workspace_response, resolve_workspace_root

from tests.test_workspace import make_flow_payload, write_json


class UIServerTests(unittest.TestCase):
    def test_resolve_workspace_root_falls_back_to_package_root_examples(self) -> None:
        original_cwd = Path.cwd()
        ui_dir = original_cwd / "ui"
        try:
            import os

            os.chdir(ui_dir)
            resolved = resolve_workspace_root("examples/customer_workspace")
        finally:
            os.chdir(original_cwd)

        self.assertEqual(
            resolved,
            (original_cwd / "examples" / "customer_workspace").resolve(),
        )

    def test_build_workspace_payload_serializes_layout(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "__init__.py").write_text("", encoding="utf-8")
            write_json(root / "customer" / "flow.json", make_flow_payload("customer"))

            payload = build_workspace_payload(root)

            self.assertEqual(payload["flow_count"], 1)
            self.assertEqual(payload["workspace_root"], str(root.resolve()))
            self.assertEqual(payload["flows"]["customer"]["layout"]["nodes"]["validate"]["x"], 120)

    def test_api_returns_workspace_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "__init__.py").write_text("", encoding="utf-8")
            write_json(root / "customer" / "flow.json", make_flow_payload("customer"))

            status, payload = get_workspace_response(root, "/api/workspace")

            self.assertEqual(status, 200)
            self.assertEqual(payload["flow_count"], 1)
            self.assertIn("customer", payload["flows"])

    def test_api_returns_structured_error_for_invalid_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            status, payload = get_workspace_response(root, "/api/workspace")

            self.assertEqual(status, 400)
            self.assertEqual(payload["error"]["type"], "WorkspaceLoadError")
            self.assertIn("__init__.py", payload["error"]["message"])

    def test_api_returns_not_found_for_unknown_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            status, payload = get_workspace_response(root, "/api/missing")

            self.assertEqual(status, 404)
            self.assertEqual(payload["error"]["type"], "NotFound")


if __name__ == "__main__":
    unittest.main()
