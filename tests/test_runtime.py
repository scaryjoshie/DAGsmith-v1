import unittest

from dagsmith import emit, resolve_node_result


class RuntimeTests(unittest.TestCase):
    def test_emit_bypasses_selector(self) -> None:
        selector_calls = []

        def selector(value):
            selector_calls.append(value)
            return "valid"

        result = resolve_node_result(emit("invalid", {"reason": "missing email"}), selector=selector)

        self.assertEqual(result.exit_name, "invalid")
        self.assertEqual(result.value, {"reason": "missing email"})
        self.assertTrue(result.emitted)
        self.assertEqual(selector_calls, [])

    def test_selector_routes_plain_values(self) -> None:
        def selector(value):
            return "valid" if value["ok"] else "invalid"

        result = resolve_node_result({"ok": True}, selector=selector)

        self.assertEqual(result.exit_name, "valid")
        self.assertEqual(result.value, {"ok": True})
        self.assertFalse(result.emitted)


if __name__ == "__main__":
    unittest.main()
