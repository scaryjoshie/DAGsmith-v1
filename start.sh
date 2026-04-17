#!/usr/bin/env bash
# Start DAGsmith backend (:8001) and frontend (:5173) together.
# Ctrl-C once to stop both.
#
# Usage:
#   ./start.sh                      # defaults to examples.customer
#   ./start.sh examples.minimal     # pick a different preloaded workspace
set -euo pipefail

cd "$(dirname "$0")"

WORKSPACE="${1:-examples.customer}"

# Kill child processes on exit/interrupt so ^C cleans up both.
trap 'kill 0' EXIT INT TERM

echo "==> backend   uv run dagsmith ui $WORKSPACE   (:8001)"
uv run dagsmith ui "$WORKSPACE" &

echo "==> frontend  cd frontend && npm run dev      (:5173)"
(cd frontend && npm run dev) &

wait
