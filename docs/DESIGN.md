# DAGsmith: Visual Flowchart-Based Python Authoring Tool

> For the current minimal execution and storage model, see `docs/CORE_MODEL.md`.

## Vision

DAGsmith is a tool for authoring Python code as executable flowcharts. It is **not** a no-code tool — it is explicitly **pro-code**. The goal is to make branchy, sequential info-processing pipelines legible and maintainable by representing them visually. A flow is a pure function: same input produces same output, with no persistent state, no `__init__`, and no lifecycle hooks. DAGsmith is a runtime library that interprets flows — it is not a compiler.

> "I don't really want cluttered flow charts, it would actually be to represent code in a very simple way, especially things like tree-type decision making in a really easy to understand & visualize way."

> "My goal is to make this simplest code possible for this. Also, we do need to store state at any given point in time."

> "At the end of the day, the goal isn't to use this to develop your whole system. It's to use several of these graphs to fill in for info processing pipelines when needed, so that you have good viz."

The pitch: **write Python, but when a chunk of your logic is branchy or sequential enough that a flowchart would explain it better than code, use this instead, and get a real function back.** It's not a framework. It's an authoring tool for a specific shape of code.

---

## Core Mental Model

**A flow is a pure function. A function is a flow.** This uniformity is the entire design.

- A **flow** is a DAG of nodes.
- A **node** is either a Python callable or a reference to another flow.
- A **flow is a pure function** — same input, same output, no persistent state, no lifecycle hooks.
- A subflow (when added in Phase 2) is also a pure function — not a self-contained package that owns its own types or state.
- Since both Python nodes and flows are just function-shaped units, they are interchangeable from the graph's perspective.

> "Every node is a function call regardless of whether the target is three lines of Python or an entire sub-flow."

### Analogy

Think of the graph as the program and the payload as the value being transformed. Each node is a pure function; each edge carries a typed value from one node to the next. Keeping the graph acyclic means you always make forward progress, and because nothing is stateful there is no hidden context to reason about.

---

## Packaging

DAGsmith is a **standalone Python package** installed as a normal runtime dependency. A workspace IS a normal Python package: you install DAGsmith, your workspace imports it, and flows run interpreted. There is no compiled artifact to ship separately.

```
pip install dagsmith
```

A workspace is installed editable via `uv sync` (uv project mode). The filesystem is the source of truth; `dagsmith.json` is a manifest/config file.

### CLI

- **`dagsmith init my_flows`** — scaffolds an importable DAGsmith workspace package
- **`dagsmith run my_flows/customer_validation/flow.json --input data.json`** — interpreted execution
- **`dagsmith ui`** — launches the React Flow web editor (local web app)

### Package Contents

- The **data model** (Python) — `FlowSpec`, `NodeSpec`, `EdgeSpec`, and friends
- The **workspace loader** (Python) — discovers flows, eagerly imports referenced modules
- The **runner** (Python) — pure-function interpreter that walks the DAG
- The **web UI** (bundled React app, served locally) — visual editor
- The **CLI** entry point

DAGsmith ships as a small runtime library (~750 lines plus Pydantic). It has no compiler. Workspaces depend on DAGsmith at both author time and runtime.

---

## Architecture

### Workspace Structure

A DAGsmith workspace is a normal importable Python package. The package root is the project/workspace root, not itself a flow. It is installed editable via `uv sync` so flows can be imported from anywhere in the host codebase.

```
my_flows/
  __init__.py
  dagsmith.json
  shared/                 # global reusable helpers
    __init__.py
    validation.py
    types/                # types used by shared helpers
      __init__.py
      records.py
  types/                  # workspace-wide types
    __init__.py
    records.py
    errors.py
  customer_validation/    # flow: contains flow.json
    flow.json
    load.py
    validate_email.py
    enrich.py
    types/                # types used by this flow
      __init__.py
      customer_records.py
  scoring/                # another flow
    flow.json
    score_candidate.py
```

The root package may contain a global `shared/` directory and a global `types/` directory. Since the root is not a flow, `types/` at the root is unambiguously a workspace-wide types folder. Actual flows live in subdirectories containing `flow.json`, and each flow may have its own `types/` folder beside `flow.json`.

The workspace IS the runtime target. DAGsmith is a normal runtime dependency; there is no compiled/exported artifact.

### Discovery

The simple discovery rule is:

- every directory below the package root containing `flow.json` is a flow
- flow ID is the relative path from the package root, joined with dots
- the package root itself is not a flow in v1, so root-level `flow.json` is not allowed
- `shared/` is a reserved support folder, not a flow name

Types folders are not a reserved name — the convention is `types/`, but users can call the folder anything; DAGsmith does not enforce the name.

Example:

```
my_flows/
  customer/
    onboarding/
      flow.json
      validate/
        flow.json
```

discovered as:

```
customer.onboarding
customer.onboarding.validate
```

Folder nesting represents ownership/scope/namespace. Execution still comes only from explicit edges and flow refs in `flow.json`.

### Manifest (`dagsmith.json`)

A root-level manifest is still useful, but it should be an index/config file, not the only source of truth.

It can track:

- workspace name and version
- discovered flow IDs and paths
- dependency/ref indexes for UI warnings
- optional metadata and settings

The important split is:

- `dagsmith.json` is project-level truth
- each `flow.json` is flow-level truth

`dagsmith.json` should not store the actual node/edge graph for every flow. Real graph structure belongs in each flow directory's `flow.json`.

The loader should read `dagsmith.json` first as the project marker/config file, then discover and parse `flow.json` files from disk.

Reserved structural names (currently just `shared`) should be hardcoded in DAGsmith, not user-editable config in `dagsmith.json`. Types folders are a user convention, not a reserved name.

An `exports` concept may be useful later for deciding which flows are re-exported from the top-level package API, but it is probably unnecessary in v1.

If the manifest drifts, the CLI should be able to rebuild it from disk.

### Shared Helpers And Types

The rule for types is simple: **types live with the flow whose code uses them.**

- Each flow may have an optional `types/` folder beside its `flow.json`.
- The workspace root may have a `types/` folder for workspace-wide types.
- Reusable callables in `shared/` have their own `types/` — consumers use absolute imports to reach them.

Imports remain explicit Python imports. For types local to the current flow:

```python
from .types import Candidate
```

For workspace-level types (single-level parent), local is the right word — this is the only non-local relative import allowed:

```python
from ..types import Candidate
```

Deeper relative imports (`...types`, etc.) are not allowed. Anything further than one level up must use an absolute import like `from my_flows.shared.types import Candidate`.

Supported type kinds include Pydantic `BaseModel`, `@dataclass`, `Enum`, `NamedTuple`, `TypedDict`, and PEP 695 type aliases. DAGsmith does not invent its own type system.

From a nested flow (Phase 2 territory), parent shared code is allowed but visibly coupling. The UI should classify that as a parent/shared dependency, not hide it as ambient scope.

### Key Architectural Rules

1. **The workspace root is a Python package.** It contains `__init__.py`, `dagsmith.json`, optional global `shared/`, optional global `types/`, and one or more flow directories.
2. **A flow is a directory containing `flow.json`.** Node modules usually live shallowly beside `flow.json`.
3. **`shared/` is a reserved support folder.** It is not a valid flow name. `types/` is a convention, not a reserved name.
4. **Execution is a DAG; ownership/scope is a tree.** Folder nesting does not execute anything by itself.
5. **DAGsmith is a runtime dependency.** The workspace imports DAGsmith and runs flows interpreted — there is no separate compiled artifact.

---

## Type System

The type system uses **ordinary Python types** — no invented type language.

**One rule:** types live with the flow whose code uses them. Each flow has an optional `types/` folder, and the workspace root has a `types/` folder for workspace-wide types. Users can call the folder anything; `types/` is a convention, not a reserved name.

- Import flow-local types with `from .types import X`.
- Import workspace-level types with `from ..types import X` (single-level up is still considered local).
- Deeper relative imports are not allowed. Anything further uses absolute imports.
- Reusable callables in `shared/` carry their own `types/` — consumers reach them with absolute imports.

Supported type kinds:

- Pydantic `BaseModel`
- `@dataclass`
- `Enum`
- `NamedTuple`
- `TypedDict`
- PEP 695 type aliases
- primitives, `list[T]`, `dict[str, T]`, unions like `T | U`, `Optional[T]`, `Literal[...]`
- an `Any` escape hatch

Every edge in the graph carries a specific type. The editor validates type compatibility at design time — incompatible connections are flagged immediately. Merge points require incoming exit payloads to be compatible with the downstream node's declared input.

Type annotations are stored as strings in `flow.json` and resolved against the Python types that are imported at workspace load time.

> "Type compatibility should be caught during design."
> "We can also add an 'any' type just because it's nice to have a workaround."
> "I would like to be able to give return types such as 'None | ExampleType'."

### Type Validation

Python's `typing` module plus Pydantic handles the heavy lifting. Pydantic is one supported backend for validation and serialization, but DAGsmith also accepts dataclasses, enums, TypedDicts, and NamedTuples. `beartype` is a potential optional layer for runtime type checking.

**Phase 1 does not build a type registry.** Types are reached by ordinary Python imports — the loader resolves the type annotation strings by looking up names in the modules that were eagerly imported when the workspace loaded. A richer type registry can come later if the UI needs one.

---

## Flow File Format

Each flow is stored in a `flow.json` file inside its flow directory. JSON is human-readable, git-diffable, and simple.

A flow file contains both **semantic graph data** (what the runner needs) and **UI layout state** (what React Flow needs). Layout should be top-level and opaque to the runtime:

```json
{
  "id": "customer_validation",
  "description": "Validate and enrich customer records.",
  "input": "RawCustomer",
  "entry_node": "load",
  "nodes": {
    "load": {
      "kind": "python",
      "label": "load",
      "ref": ".load:process",
      "input": "RawData",
      "exits": {
        "out": "Customer"
      }
    },
    "validate_email": {
      "kind": "python",
      "label": "validate_email",
      "ref": ".validate_email:process",
      "selector": ".validate_email:branch",
      "input": "Customer",
      "exits": {
        "valid": "Customer",
        "invalid": "ValidationError"
      }
    },
    "enrich": {
      "kind": "flow",
      "label": "enrich",
      "ref": "customer_validation.enrich",
      "input": "Customer",
      "exits": {
        "out": "EnrichedCustomer"
      }
    }
  },
  "edges": [
    { "from_node": "load", "from_exit": "out", "to_node": "validate_email" },
    { "from_node": "validate_email", "from_exit": "valid", "to_node": "enrich" }
  ],
  "layout": {
    "nodes": {
      "load": { "x": 100, "y": 80 },
      "validate_email": { "x": 100, "y": 240 },
      "enrich": { "x": 100, "y": 400 }
    },
    "viewport": { "x": 0, "y": 0, "zoom": 1.0 }
  }
}
```

Under the **Infer model** (SPEC §12 line 425), public exits are derived from unconnected source handles: `validate_email.invalid` and `enrich.out` are left without outgoing edges, so they become the flow's public exits `invalid: ValidationError` and `out: EnrichedCustomer` automatically.

The `layout` key is **opaque to the runner** — it just passes through. React Flow reads/writes it. The runner only cares about `id`, `input`, `entry_node`, `nodes`, and `edges`; public exits are derived.

---

## Compilation

DAGsmith currently has no compiler. Flows are loaded and run as interpreted Python functions via the pure-function runtime. Compilation to standalone code is **deferred indefinitely** — it may return as an optional export feature if a concrete use case emerges, but it is not on the current roadmap.

**Rationale:** the runtime is small (~750 lines), Pydantic is already a dependency, so the dependency cost of keeping DAGsmith as a runtime library is trivial. A compiler would be significant additional code with a much lower payoff than the features ahead of it (subflows, checkpointing, actions, editor intelligence, canvas).

This removes the previous dual "compiled mode / live mode" framing. There is only one mode: interpreted, with an optional tracer hook for future checkpointing.

---

## Graph Semantics

### DAG Constraint

Each individual graph is a **DAG** (directed acyclic graph). No cycles within a single flow.

> "My assumption is that this is a simple state diagram with only one active state at a time (think of a TM, with a DFA + tape for storing data), and so we just checkpoint by storing the states when checkpoints are given."

Benefits:
- Topological sort → trivial execution order
- Guaranteed termination within a single graph
- Simple execution model: "what's the next node?" always has a well-defined answer

### No Upward/Sibling Recursion

Flows can call other flows (downward nesting), but **a sub-flow cannot call its parent callers**. The call graph between flows is also a DAG.

> "I don't know if flows should be able to call their parent callers. This would mean we could end up with some pretty weird recursion. I'm not trying to do everything with this. It's mainly for decision-tree based processing tasks where it's nice to map things out."

### Loops

Loops are handled **inside Python node code**, not at the graph level. A Python node can loop over data and call another flow (which is just a function) on each iteration:

```python
# inside a Python node
from my_flows import score_candidate

results = []
for candidate in input.candidates:
    result = score_candidate(CandidateInput(candidate=candidate))
    results.append(result)
return ScoredCandidates(results=results)
```

> "You can make the loop call another one of your graphs since you have recursion. This means that code snippets aren't necessarily the lowest level structure."

This means Python nodes are **not** necessarily the leaf level — a node can invoke a flow, which has its own sub-graph. The nesting is flexible.

### Routing

Routing is modeled with named exits. A Python node can branch in two ways:

- return normal data and let an optional graph-local selector choose an exit
- return `emit(exit_name, value)` when the node itself already knows the route

The flow owns the edges. Python node code does not store pointers to downstream nodes.

---

## Execution

DAGsmith has a single execution mode: the workspace is a Python package, the loader builds a `Workspace`, and the runner calls flows as pure functions.

Example package entry:

```python
# my_flows/__init__.py
from dagsmith import load_workspace

_workspace = load_workspace(__file__)

validate_and_transform = _workspace.flow("customer_validation")
score_candidate = _workspace.flow("scoring")
```

The loader anchors itself from `__file__`, not the current working directory. It:

1. finds the package root
2. reads `dagsmith.json`
3. discovers `flow.json` files
4. eagerly imports every referenced Python module exactly once
5. resolves callable and type refs against those imported modules
6. validates the workspace
7. exposes flow callables

### Runtime characteristics

- **Pure-function runner, stateless.** The runner takes a `FlowSpec` and an input value and returns a result. It holds no state between calls. Two invocations with the same input produce the same output.
- **Eager imports.** All referenced Python modules are imported once at `load_workspace()` time. Flow execution has **zero import machinery in the hot path** — no `importlib.import_module` calls, no module cache lookups, nothing.
- **Python 3.13+.** Required for PEP 667 (reliably writable `f_locals`), which the Phase 3 action system depends on.
- **Optional tracer.** The runner accepts an optional tracer/hook argument that will be used for checkpointing in Phase 2. If no tracer is passed, the runner has zero overhead beyond the per-node function call.

The target use case is straightforward: you're building an info processing pipeline, not sure about your branching logic. You throw test data at it, watch it flow through the graph in the UI, and inspect intermediate values at each step. The same interpreted runner powers both CLI execution and UI-driven debugging.

---

## Debugging & Checkpointing

### Flow-Level Debugging

At the flow level, debugging is trivially simple:

- **Step** = call the next node and stop
- **Step into** (on a sub-flow node) = enter that sub-flow's node list and step through it
- **Step into** (on a Python node) = hand off to Python's native debugger (pdb, IDE debugger)

> "At the flow level, it's almost embarrassingly simple — you're literally just iterating through a list of function calls with pauses between them."

### Checkpointing

Checkpoints are **snapshots of the values flowing along edges**, not snapshots of persistent flow state. Because flows are pure functions with no state, there is no "flow instance" to capture — only the payload currently being passed from one node to the next.

At each edge crossing, the runner (when given a tracer) records:

- the edge (source node, source exit, target node)
- the payload value that just crossed it
- a serialized form of that payload for replay

Since payloads are ordinary Python values (Pydantic models, dataclasses, enums, primitives), they serialize through their normal mechanisms. This gives:

- **Replay** — re-run from any edge checkpoint by re-invoking the downstream subgraph with the captured payload.
- **Time-travel debugging** — inspect any value that crossed any edge.
- **Recovery** — resume from a failure point without re-running everything upstream.

There is no `ctx` object with persistence semantics. The tracer is an observer of values, not a storage layer for flow state. If no tracer is passed to the runner, execution has zero overhead beyond the per-node call.

Checkpointing ships in Phase 2, not Phase 1. Phase 1 runs the flow end-to-end with no tracer.

### Call Stack for Nested Flows

When a flow calls a sub-flow (Phase 2), the tracer pushes a new frame for the child flow's edge snapshots and pops on return. The checkpoint model is a stack of per-flow edge snapshot lists.

---

## Actions & Editor Authoring

> **Phase note:** Actions are a Phase 3 feature, not Phase 1. The Phase 1 runtime has no action system. This section describes the target design the schema and runtime are being built toward.

Actions are observer code — logging, metrics, audit trails, breakpoints — that runs at specific points inside node bodies without living in the node's source file. The goal: keep business code clean. Logging and observability normally uglify code; actions move that concern into a separate layer.

### Model

- An **anchor** is a named spot between two statements inside a Python node. Anchors are tracked by DAGsmith's own state, not by comments or markers in the source. The `.py` file on disk stays clean Python.
- An **action** is a Python snippet attached to an anchor. It can reference any variable alive at that point in the host function.
- Actions are **observers, not participants.** They can read execution state freely. They cannot alter control flow of the host function.

### Injection Mechanism

At load time DAGsmith parses each node module with the stdlib `ast` module, looks up attached actions, and rewrites the tree:

1. The action body is compiled into a hidden function whose parameters are the variables it references.
2. A single-line call to that function is inserted at the anchor point.
3. The rewritten module is imported normally.

Conceptually, the injected line looks like:

```python
_dagsmith_action_3(cleaned=cleaned, record=record)
```

Python's normal scoping rules provide control-flow isolation: a `return` inside the action returns from the action function, not from the host. `break` and `continue` become syntax errors because no enclosing loop exists. Reassigning a local only affects the action's own scope, not the host's.

Full execution state is available via `sys._getframe()` plus `frame.f_locals` if an action needs more than its declared parameters. Python 3.13+ (PEP 667) makes `f_locals` reliably readable and writable.

### Authoring Actions in the Editor

Actions are written inline in the DAGsmith UI — a panel pinned to the anchor. The user types what looks like ordinary inline code:

```python
print(f"cleaned email: {cleaned.email}")
```

The editor must offer full language intelligence against the host function's scope — autocomplete, hover types, undefined-name diagnostics — even though the snippet is not a complete Python file and references names that do not exist in the snippet itself.

The approach is **synthetic-prefix composition.** When the editor requests completions at cursor position N inside an action snippet, the backend constructs a temporary synthetic source file:

```python
def process(record):
    ...lines of the host function body up to the anchor...
    <action snippet, with cursor at position N>
```

Jedi runs static analysis over this synthetic source. Because the prefix is real Python code, Jedi sees `cleaned`, `record`, `self`, and every other in-scope name as a genuine local with real inferred types. The response flows back to the editor as:

- autocomplete — names plus inferred types
- hover tooltips — types and docstrings
- lint diagnostics — undefined names and type errors

A single backend endpoint with the contract `{source, anchor, cursor} -> completions` covers all three concerns. The editor itself does not need to know anything about the host function.

This is the same technique Jupyter uses to give REPL cells access to kernel-resident names.

### Current Editor Stack

- **Frontend editor:** CodeMirror 6 with the Python language extension, wrapped in React.
- **Intelligence backend:** Jedi, exposed through the existing `ui_server.py` sidecar.
- **Display-only code:** Shiki, for read-only snippets where a live editor is overkill.
- **Runtime Python:** 3.13 or later, for reliable frame access.

Chosen for cheap per-instance mounting (React Flow spawns many editors at once), small bundle size, and first-class Lezer-based Python highlighting. The editor seam is isolated to one React component and the intelligence seam is isolated to one HTTP endpoint, so swapping CodeMirror for Monaco or Jedi for Pyright-over-LSP would be a single-module change at each seam.

---

## Flows as Methods on a Class

This was considered and decided against. Flows are pure functions, not methods on a class with persistent state. Shared resources (DB connections, loaded models, configuration) are handled via normal Python module-level imports, which already give you singleton semantics without dragging a class lifecycle into the flow model.

---

## Codebase Integration

A DAGsmith workspace IS a normal Python package. Callers import the workspace and call flows as normal functions — no compiled artifact, no separate build step, no special deployment. The workspace is installed editable via `uv sync` and DAGsmith is loaded as an ordinary runtime dependency.

```python
# From a FastAPI endpoint
from my_flows import validate_and_transform
result = validate_and_transform(FlowInput(records=records))

# From a CLI script
from my_flows import run_pipeline
run_pipeline(PipelineInput(path="data.csv"))

# From a test
def test_validation():
    result = validate_and_transform(FlowInput(records=test_records))
    assert len(result.rejected) == 0
```

DAGsmith is always loaded at import time; there is no separate compiled artifact to ship. This is the intentional tradeoff: a small runtime dependency in exchange for a much simpler, smaller codebase.

---

## UI Requirements

### Technology
- **React Flow** for the canvas (built for exactly this)

### Visual Vocabulary
- Classic flowchart aesthetics: **rounded rectangles** (process), **diamonds** (decisions), **start/end terminals**
- Top-down layout, clean and readable — **not** a cluttered node-graph wiring UI

### Key Features
- **LOD (Level of Detail) scaling** — zoom out collapses sub-flows to single labeled nodes, zoom in expands them
- **Nesting navigation** — click into a sub-flow node to see its inner graph, back button to return
- **Type-aware connections** — the UI knows available types, validates connections at design time
- **Good naming** — high ability to name/label nodes, edges, and flows
- **Code editor per snippet node** — inline editing of Python code
- **Run button** — interprets the flow with visualization; there is no compile step
- **Types palette** — browse, create, and drag-drop types from `types/` folders onto node edges

### Proposed Workspace Layout

The current UI shape that seems most aligned with the project is:

- **Main canvas** in the center for the current flow
- **Top bar or popup tray** for shared/global helpers, types, and reusable flow-local resources
- **Left sidebar** showing nesting/ownership context so you can always tell where you are in the inheritance tree
- **Right editor panel** for the selected node's code, docstring, dependencies, and configuration

This supports the key mental split:

- execution is a DAG
- ownership and scope form a tree

The UI should make both visible at the same time without forcing the user to leave the current flow view.

> "I also think a lot of these programs are no-code, when I explicitly want to be pro-code, just want to model decisions in an intuitive and beautiful way, for instance with a high ability to name nodes, good LOD scaling, etc."

### Persistent UI State

The `flow.json` stores UI layout alongside semantic data (node positions, viewport, collapsed/expanded states, labels, colors). This ensures the visual organization persists across sessions and is version-controlled with the flow.

---

## Error Handling

Not fully decided. Options discussed:

1. **Let Python exceptions be Python exceptions.** A node throws, the flow fails at that node. Checkpointing gives you retry-from-failure for free. Simplest option.
2. **Explicit error edges** — a red path out of a node for error routing. More visual, more complex.
3. **Hybrid** — default to option 1, with an optional error output port on nodes that want explicit error handling.

Recommendation: start with option 1.

---

## What This Is NOT

- **Not a general-purpose visual programming language.** It's for decision-tree processing pipelines.
- **Not a no-code tool.** You write Python. The graph is the organizational structure.
- **Not for building entire systems.** You use it for specific chunks of branchy logic within a larger codebase.
- **Not a workflow orchestrator** (Airflow, Prefect, Dagster). Those manage task scheduling and infrastructure. This manages code structure.
- **Not a dataflow node editor** (ComfyUI, Ryven). Those wire up complex port graphs. This is clean top-down flowcharts.

---

## Prior Art & Influences

| Tool | Relevant Aspect | Limitation |
|------|-----------------|------------|
| **LangGraph** | Nodes are functions, conditional edges, `.compile()`, typed state | LLM-coupled ecosystem, shared-state-bag (not typed I/O per node), viz is output not authoring surface, no standalone compilation |
| **ComfyUI** | Proves Python execution DAG + typed ports works at scale | No nesting, domain-specific (image gen) |
| **Harel Statecharts** | Hierarchical nesting with zoom in/out, formal visual formalism | Event/state-oriented, not sequential-processing |
| **Control Flow Graphs** | Compiler IR that is exactly this — basic blocks + directed edges | Only ever used as analysis output, never as authoring tool |
| **XState / Stately** | Visual statechart editor, exports to code | State-machine-oriented, JavaScript |
| **Flyde** | Pro-code visual flow programming, VSCode integration, version controlled | TypeScript only, dataflow paradigm |
| **Nevalang** | Compiled, statically typed dataflow language | Whole new language, not Python |
| **Node-RED** | Gold standard flow-based UX | JavaScript/IoT focused |

> "Nobody has built a tool that combines all of: classic flowchart visual vocabulary (not a node-graph wiring UI), pro-code Python with Pydantic typing, recursive nesting with LOD scaling, and a pure-function runtime that drops cleanly into ordinary Python."

### Key distinction from LangGraph

> "LangGraph thinks in terms of 'evolving a state object through a graph.' You're thinking in terms of 'piping typed data through a flowchart.' Those lead to very different authoring experiences even if the runtime mechanics are similar."

---

## Build Plan

### Phase 1 — Schema + Loader + Runtime (~500 lines source + ~300 lines tests)

The minimum viable core. No frontend, no HTTP server, no actions, no compiler, no subflows.

- Define the `flow.json` and `dagsmith.json` schemas (Pydantic models)
- `load_workspace()` — discover flows, eagerly import referenced Python modules, resolve callable and type refs, validate
- Pure-function runner — walk the DAG, call nodes, honor `emit(...)` and selectors, handle merges
- One Python-only example workspace exercising plain returns, `emit`, selectors, and merges
- Unit tests for schema, loader, and runner

`NodeSpec.kind` still accepts the literal `"flow"` in the schema, but the Phase 1 loader raises `NotImplementedError` on any node with `kind == "flow"`. Subflows land in Phase 2.

### Phase 2 — Subflows + Checkpointing
- Flow nodes (subflow references) in the loader and runner
- Tracer hook for edge-snapshot checkpointing
- Step / step-into / resume from checkpoint
- Call-stack model for nested flow execution

### Phase 3 — Actions (AST rewrite, `sys._getframe`, PEP 667)
- Anchor model tracked in DAGsmith state, not in source comments
- `ast`-level rewrite of each node module at load time to inject action calls at anchors
- Runtime plumbing for action functions to read host locals via `sys._getframe` and PEP 667 `f_locals`

### Phase 4 — Editor Intelligence Backend
- Jedi over HTTP via the `ui_server.py` sidecar
- `{source, anchor, cursor} -> completions` endpoint used for both action authoring and node body editing
- Synthetic-prefix composition so Jedi sees real in-scope names and types

### Phase 5 — Frontend Editor Component
- CodeMirror 6 with the Python language extension, wrapped in React
- Completions, hover types, and lint diagnostics wired to the Phase 4 endpoint
- Shiki for read-only display-only snippets

### Phase 6 — React Flow Canvas
- Classic flowchart vocabulary (rounded rects, diamonds, terminals)
- Nodes, edges, drag-and-drop, types palette
- LOD zoom, nesting navigation, persistent layout in `flow.json`
- Run button, run visualization via the tracer

There is no compiler phase. If a concrete use case for a standalone code exporter ever emerges, it can be added later as an optional side feature — it is not on the current roadmap.

---

## Open Design Questions

1. **Conditional node interface** — Does the selector function receive the same input as the node itself, or the node's output? Currently the output, for uniformity with `emit`-style routing.
2. **Error handling model** — Exceptions propagate naturally (simple) vs. explicit error edges (visual)?
3. **Node authoring** — Separate `.py` files referenced by import path? Inline in the UI? Both?
4. **Import path mechanics** — Exact callable ref grammar and path resolution for `.module:function`, `..module:function`, and absolute forms.
