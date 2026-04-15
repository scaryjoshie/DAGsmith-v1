# DAGsmith

Visual flowchart-based Python authoring tool. A flow is a DAG that behaves
as a pure Python function. See `docs/DESIGN.md` and `docs/CORE_MODEL.md`
for the full design.

## Install

```bash
uv sync --all-extras
```

The `ui` extras pull in FastAPI and uvicorn for the visual UI backend.
If you don't need the UI, plain `uv sync` is enough.

## Run the test suite

```bash
uv run pytest
```

## Try the minimal example from Python

```python
from examples.minimal import hello
from examples.minimal.hello.types.records import Greeting

hello(Greeting(name="Alice"))
# FlowResult(exit='formal', value=Reply(message='Good day, Alice', formal=True))

hello(Greeting(name="alice"))
# FlowResult(exit='casual', value=Reply(message='hi, alice', formal=False))
```

## Visual UI

The UI is a tiny FastAPI backend plus a React Flow + CodeMirror frontend.
Both run locally in dev mode.

**Terminal 1** — start the backend against a workspace package:

```bash
uv run dagsmith ui examples.minimal
```

This loads the workspace eagerly, prints the discovered flows, and
serves `http://127.0.0.1:8001` with three endpoints:

- `GET  /api/workspaces/{name}` — workspace info + flow list
- `GET  /api/workspaces/{name}/flows/{flow_id}` — flow graph + node source code
- `POST /api/workspaces/{name}/flows/{flow_id}/run` — run a flow with a JSON input

**Terminal 2** — start the frontend dev server:

```bash
cd frontend
npm install   # first time only
npm run dev
```

Vite serves the UI at `http://127.0.0.1:5173` (or similar). The frontend
defaults to the `examples.minimal` workspace — override with a URL param:
`http://127.0.0.1:5173/?workspace=your.workspace.package`.

What you can do in the UI:

- See the selected flow rendered as a graph (React Flow)
- Click a node to see its Python source (CodeMirror, read-only)
- Run the flow with a JSON input and see the `FlowResult` come back
- Switch flows via the dropdown in the top bar
