"""DAGsmith command-line entry point.

Currently supports one subcommand: `dagsmith ui <workspace_package>` to
launch the visual UI backend. Requires the `ui` optional extras.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="dagsmith",
        description="DAGsmith: visual flowchart-based Python authoring tool",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ui_parser = sub.add_parser(
        "ui",
        help="Launch the DAGsmith visual UI backend",
    )
    ui_parser.add_argument(
        "workspaces",
        nargs="+",
        help=(
            "One or more workspace package names to preload "
            "(e.g., examples.minimal examples.customer)"
        ),
    )
    ui_parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind (default: 127.0.0.1)",
    )
    ui_parser.add_argument(
        "--port",
        type=int,
        default=8001,
        help="Port to bind (default: 8001)",
    )

    args = parser.parse_args(argv)

    if args.command == "ui":
        return _run_ui(args.workspaces, args.host, args.port)

    return 1


def _run_ui(workspaces: list[str], host: str, port: int) -> int:
    try:
        import uvicorn
    except ImportError:
        print(
            "error: the 'ui' extras are not installed.\n"
            "install with: uv sync --all-extras  "
            "(or: pip install 'dagsmith[ui]')",
            file=sys.stderr,
        )
        return 1

    # Ensure the current working directory is on sys.path so workspace
    # packages like `examples.minimal` resolve when running from the repo
    # root. Normal Python scripts get this by default; console-script
    # entry points don't.
    import os

    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    from .server import app, preload_workspace

    for workspace in workspaces:
        try:
            ws = preload_workspace(workspace)
        except Exception as exc:
            print(
                f"error: could not load workspace {workspace!r}: {exc}",
                file=sys.stderr,
            )
            return 1
        print(
            f"[dagsmith] loaded {workspace!r}: "
            f"{len(ws.flow_ids)} flow(s): {ws.flow_ids}"
        )

    print(f"[dagsmith] backend: http://{host}:{port}")
    print("[dagsmith] frontend dev: `cd frontend && npm run dev`")

    uvicorn.run(app, host=host, port=port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
