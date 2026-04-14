"""Small JSON API server for the standalone DAGsmith UI."""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Mapping, Tuple
from urllib.parse import urlparse

from .validation import FlowValidationError
from .workspace import Workspace, WorkspaceLoadError

DEFAULT_UI_PORT = 8001
USER_ERROR_TYPES = (WorkspaceLoadError, FlowValidationError, ValueError, TypeError, KeyError)
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def resolve_workspace_root(workspace_root: Path | str) -> Path:
    """Resolve a workspace path from common launch locations.

    Relative paths normally resolve from the current working directory. As a
    convenience for the local `examples/` workspace used by the UI, if that
    lookup fails we also try resolving relative to the repository/package root.
    """

    raw = Path(workspace_root).expanduser()
    if raw.is_absolute():
        return raw.resolve()

    cwd_candidate = (Path.cwd() / raw).resolve()
    if cwd_candidate.exists():
        return cwd_candidate

    package_candidate = (PACKAGE_ROOT / raw).resolve()
    if package_candidate.exists():
        return package_candidate

    return cwd_candidate


def build_workspace_payload(workspace_root: Path | str) -> Dict[str, Any]:
    """Load and serialize a workspace for the frontend."""

    root = resolve_workspace_root(workspace_root)
    workspace = Workspace.from_directory(root)
    workspace_dict = workspace.to_dict()
    return {
        "workspace_root": str(root),
        "flow_count": len(workspace_dict["flows"]),
        "flows": workspace_dict["flows"],
    }


def build_error_payload(workspace_root: Path | str, error: Exception) -> Dict[str, Any]:
    """Return a stable error payload for UI consumption."""

    root = resolve_workspace_root(workspace_root)
    return {
        "workspace_root": str(root),
        "error": {
            "type": error.__class__.__name__,
            "message": str(error),
        },
    }


def get_workspace_response(
    workspace_root: Path | str,
    request_path: str,
) -> Tuple[HTTPStatus, Dict[str, Any]]:
    """Build the HTTP status and payload for a workspace API request."""

    parsed = urlparse(request_path)
    if parsed.path != "/api/workspace":
        return (
            HTTPStatus.NOT_FOUND,
            {"error": {"type": "NotFound", "message": "Unknown path %s" % parsed.path}},
        )

    try:
        return (HTTPStatus.OK, build_workspace_payload(workspace_root))
    except USER_ERROR_TYPES as exc:
        return (HTTPStatus.BAD_REQUEST, build_error_payload(workspace_root, exc))
    except Exception as exc:  # pragma: no cover - defensive fallback
        return (HTTPStatus.INTERNAL_SERVER_ERROR, build_error_payload(workspace_root, exc))


class DagsmithUIServer(ThreadingHTTPServer):
    """Threading HTTP server configured with a workspace root."""

    def __init__(
        self,
        server_address: Tuple[str, int],
        request_handler_class: type[BaseHTTPRequestHandler],
        *,
        workspace_root: Path | str,
    ) -> None:
        super().__init__(server_address, request_handler_class)
        self.workspace_root = Path(workspace_root)


class WorkspaceAPIHandler(BaseHTTPRequestHandler):
    """Serve a read-only JSON API for DAGsmith workspace data."""

    server: DagsmithUIServer

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_common_headers("application/json")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        status, payload = get_workspace_response(self.server.workspace_root, self.path)
        self._write_json(status, payload)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _write_json(self, status: HTTPStatus, payload: Mapping[str, Any]) -> None:
        encoded = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self._send_common_headers("application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_common_headers(self, content_type: str) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def create_ui_server(
    workspace_root: Path | str,
    *,
    host: str = "127.0.0.1",
    port: int = DEFAULT_UI_PORT,
) -> DagsmithUIServer:
    return DagsmithUIServer(
        (host, port),
        WorkspaceAPIHandler,
        workspace_root=workspace_root,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve DAGsmith workspace JSON for the UI.")
    parser.add_argument("--workspace", required=True, help="Path to a DAGsmith workspace root.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind.")
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_UI_PORT,
        help="Port to listen on for the UI API.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    server = create_ui_server(args.workspace, host=args.host, port=args.port)
    print(
        "Serving DAGsmith UI API for %s at http://%s:%s/api/workspace"
        % (resolve_workspace_root(args.workspace), args.host, args.port)
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
