# DAGsmith: Visual Flowchart-Based Python Authoring Tool

> For the current minimal execution and storage model, see `docs/CORE_MODEL.md`.

## Vision

DAGsmith is a tool for authoring Python code as executable flowcharts. It is **not** a no-code tool — it is explicitly **pro-code**. The goal is to make branchy, sequential info-processing pipelines legible and maintainable by representing them visually, while compiling to plain Python that slots into any codebase.

> "I don't really want cluttered flow charts, it would actually be to represent code in a very simple way, especially things like tree-type decision making in a really easy to understand & visualize way."

> "My goal is to make this simplest code possible for this. Also, we do need to store state at any given point in time."

> "At the end of the day, the goal isn't to use this to develop your whole system. It's to use several of these graphs to fill in for info processing pipelines when needed, so that you have good viz."

The pitch: **write Python, but when a chunk of your logic is branchy or sequential enough that a flowchart would explain it better than code, use this instead, and get a real function back.** It's not a framework. It's an authoring tool for a specific shape of code.

---

## Core Mental Model

**A flow is a function. A function is a flow.** This uniformity is the entire design.

- A **flow** is a DAG of nodes.
- A **node** is either a Python callable or a reference to another flow.
- A **flow compiles to a Python function** (or method).
- Since both Python nodes and flows are just function-shaped units, they are interchangeable from the graph's perspective.

> "The compiled output is beautifully uniform — every node compiles to a function call regardless of whether the target is three lines of Python or an entire sub-flow."

### Analogy

Think of it like a Turing machine: a DFA (the DAG) plus a tape (the checkpointed Pydantic state). The graph is the program. The snapshots are the tape. Keeping the graph acyclic means you always make forward progress.

---

## Packaging

DAGsmith is a **standalone Python package** — a dev tool you install, not a library you import in application code. It's like a compiler: you install the compiler, but your compiled output doesn't depend on it.

```
pip install dagsmith
```

### CLI

- **`dagsmith init my_flows`** — scaffolds an importable DAGsmith package
- **`dagsmith compile my_flows/customer_validation/flow.json`** — emits plain Python output
- **`dagsmith run my_flows/customer_validation/flow.json --input data.json`** — interpreted/live execution
- **`dagsmith ui`** — launches the React Flow web editor (local web app)

### Package Contents

- The **compiler** (Python) — JSON flow → `.py` file
- The **interpreter/runner** (Python) — executes flows with stepping/checkpointing
- The **web UI** (bundled React app, served locally) — visual editor
- The **CLI** entry point

The compiled output has **zero dependency on DAGsmith itself.** The only dependency is Pydantic, which the project already uses for type definitions.

---

## Architecture

### Workspace Structure

A DAGsmith workspace should be a normal importable Python package. The package root is the project/workspace root, not itself a flow.

```
my_flows/
  __init__.py
  dagsmith.json
  shared/                 # global reusable helpers
    __init__.py
    validation.py
  datatypes/              # global reusable datatypes/contracts
    __init__.py
    records.py
    errors.py
  customer_validation/    # flow: contains flow.json
    flow.json
    load.py
    validate_email.py
    enrich.py
    shared/               # shared within this flow/subtree
      __init__.py
      customer_helpers.py
    datatypes/            # datatypes within this flow/subtree
      __init__.py
      customer_records.py
  scoring/                # another flow
    flow.json
    score_candidate.py
```

The root package may contain global `shared/` and `datatypes/` directories. Since the root is not a flow, those names are unambiguously global. Actual flows live in subdirectories containing `flow.json`.

This gives us both:

- an importable Python module during live/runtime authoring
- an optional path to compiled/exported plain Python later

The core promise becomes: source workspaces may depend on DAGsmith; compiled/exported output should not.

### Discovery

The simple discovery rule is:

- every directory below the package root containing `flow.json` is a flow
- flow ID is the relative path from the package root, joined with dots
- the package root itself is not a flow in v1, so root-level `flow.json` is not allowed
- `shared/` and `datatypes/` are reserved support folders, not flow names

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

Reserved names such as `shared` and `datatypes` should be hardcoded structural rules in DAGsmith, not user-editable config in `dagsmith.json`.

An `exports` concept may be useful later for deciding which flows are re-exported from the top-level package API, but it is probably unnecessary in v1.

If the manifest drifts, the CLI should be able to rebuild it from disk.

### Shared Helpers And Datatypes

Every level can have the same support structure:

- `shared/` for reusable helper code
- `datatypes/` for reusable contracts/models

At the package root, these are global. Inside a flow directory, they are local to that flow/subtree.

Imports remain explicit Python imports:

```python
from .shared import normalize_email
from .datatypes import Candidate
```

From a nested flow, parent shared code is allowed but visibly coupling:

```python
from ..shared import normalize_email
from ..datatypes import Candidate
```

The UI should classify that as a parent/shared dependency, not hide it as ambient scope.

### Key Architectural Rules

1. **The workspace root is a Python package.** It contains `__init__.py`, `dagsmith.json`, optional global `shared/`, optional global `datatypes/`, and one or more flow directories.
2. **A flow is a directory containing `flow.json`.** Node modules usually live shallowly beside `flow.json`.
3. **`shared/` and `datatypes/` are reserved support folders.** They are not valid flow names.
4. **Execution is a DAG; ownership/scope is a tree.** Folder nesting does not execute anything by itself.
5. **Live/runtime mode may depend on DAGsmith.** Compiled/exported output should be self-contained plain Python.

---

## Type System

Uses **Pydantic models** for all I/O typing. Supports union types (e.g., `None | ExampleType`).

- Define a set of named models/contracts in `datatypes/`.
- Each node declares which Pydantic model it takes in and which it puts out.
- Every edge in the graph carries a specific type — no ambiguity.
- The editor validates type compatibility at **design time** — incompatible connections are flagged immediately.
- An **`Any` type** exists as an escape hatch.
- Union types like `None | ExampleType` are supported — type annotations are stored as strings in the flow JSON, resolved at compile/design time against known datatypes.
- Merge points (where branches converge) require both branches to output the same or compatible types for the downstream node.

> "Type compatibility should be caught during design. Perhaps we define a set of simple (non-functional) types globally, then we ensure that the outputs fill those types?"
> "We can also add an 'any' type just because it's nice to have a workaround."
> "I would like to be able to give return types such as 'None | ExampleType'."

### Type Validation

Python's `typing` module plus Pydantic handles the heavy lifting. Type annotations are stored as strings, resolved against the known type registry. `beartype` is a potential optional layer for runtime type checking in interpreted/live mode. No custom type system needed.

Pydantic gives us serialization for free (`.model_dump()` / `.model_validate()`), which directly enables checkpointing.

---

## Flow File Format

Each flow is stored in a `flow.json` file inside its flow directory. JSON is human-readable, git-diffable, and simple.

A flow file contains both **semantic graph data** (what the runner/compiler needs) and **UI layout state** (what React Flow needs). Layout should be top-level and opaque to the runtime:

```json
{
  "id": "customer_validation",
  "description": "Validate and enrich customer records.",
  "input": "RawCustomer",
  "public_exits": {
    "valid": "EnrichedCustomer",
    "invalid": "ValidationError"
  },
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
    { "from_node": "validate_email", "from_exit": "valid", "to_node": "enrich" },
    { "from_node": "validate_email", "from_exit": "invalid", "to_flow_exit": "invalid" },
    { "from_node": "enrich", "from_exit": "out", "to_flow_exit": "valid" }
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

The `layout` key is **opaque to the runner/compiler** — it just passes through. React Flow reads/writes it. The runner/compiler only cares about `id`, `input`, `public_exits`, `entry_node`, `nodes`, and `edges`.

---

## Compilation

### What the Compiler Does

The compiler takes a `flow.json` and emits a `.py` file. The output should look like **code you'd write by hand**.

**Steps:**

1. Parse the `flow.json`
2. Topological sort the DAG
3. Identify regions — linear chains, branching points (decision nodes), merge points (where branches reconverge)
4. Emit Python: linear chains → sequential calls, decision nodes → `if/elif`, merge points → variable assignment from each branch
5. Wrap in a function with Pydantic type annotations
6. Prepend imports from datatypes, shared helpers, external libraries, and referenced flows

### Compilation Examples

**Sequential:**

```
[Load] → [Validate] → [Transform] → [Write]
```
```python
def pipeline(input: RawData) -> WriteResult:
    loaded = load(input)
    validated = validate(loaded)
    transformed = transform(validated)
    return write(transformed)
```

**Conditionals — decision node returns a routing key, compiler emits if/elif:**

```
[Load] → <Valid?> → yes → [Transform] → [Write]
                  → no  → [LogError]  → [WriteReport]
```
```python
def pipeline(input: RawData) -> WriteResult | ErrorReport:
    loaded = load(input)
    route = check_valid(loaded)
    if route == "yes":
        transformed = transform(loaded)
        return write(transformed)
    elif route == "no":
        error = log_error(loaded)
        return write_report(error)
```

**Merging branches — branches that reconverge:**

```
[Load] → <Format?> → csv  → [ParseCSV]  ↘
                   → json → [ParseJSON] → [Validate] → [Write]
```
```python
def pipeline(input: RawData) -> WriteResult:
    loaded = load(input)
    route = check_format(loaded)
    if route == "csv":
        parsed = parse_csv(loaded)
    elif route == "json":
        parsed = parse_json(loaded)
    validated = validate(parsed)
    return write(validated)
```

**Sub-flow calls — a node referencing another flow is just a function call:**

```python
    # this node references the scoring flow, which compiled to score()
    scored = score(ScoreInput(candidate=candidate))
```

### Merge Point Detection

The hardest compiler problem: if two branches converge back to the same node, the compiler must figure out that downstream code uses a variable set by either branch. This is essentially "dominance frontier" analysis from compiler theory, but for user-authored DAGs it's likely simple enough to handle without the full algorithm.

> "If this takes any more than a few thousand lines to write, we're probably doing something wrong."

---

## Graph Semantics

### DAG Constraint

Each individual graph is a **DAG** (directed acyclic graph). No cycles within a single flow.

> "My assumption is that this is a simple state diagram with only one active state at a time (think of a TM, with a DFA + tape for storing data), and so we just checkpoint by storing the states when checkpoints are given."

Benefits:
- Topological sort → trivial compilation
- Guaranteed termination within a single graph
- Simple execution model: "what's the next node?" always has a well-defined answer

### No Upward/Sibling Recursion

Flows can call other flows (downward nesting), but **a sub-flow cannot call its parent callers**. The call graph between flows is also a DAG.

> "I don't know if flows should be able to call their parent callers. This would mean we could end up with some pretty weird recursion. I'm not trying to do everything with this. It's mainly for decision-tree based processing tasks where it's nice to map things out."

### Loops

Loops are handled **inside Python node code**, not at the graph level. A Python node can loop over data and call a compiled flow (which is just a function) on each iteration:

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

## Execution Modes

### Importable Runtime Mode

A DAGsmith workspace can be imported as a normal Python package during development/runtime mode. This mode may depend on the DAGsmith library.

Example package entry:

```python
# my_flows/__init__.py
from dagsmith import load_project

_project = load_project(__file__)

validate_and_transform = _project.flow("customer_validation")
score_candidate = _project.flow("scoring")
```

The loader should anchor itself from `__file__`, not the current working directory. It can then:

1. find the package root
2. read `dagsmith.json`
3. discover `flow.json` files
4. resolve callable refs
5. validate the workspace
6. expose flow callables

The preferred default is eager loading: resolve and cache callable refs when the project loads, then execute from the cached registry. A later `strict=False` mode can collect diagnostics for the UI instead of failing fast.

### Compiled Mode

A flow compiles to a **standalone `.py` file** with zero DAGsmith runtime dependencies. The output should look like code you'd write by hand.

Example compiled output:

```python
# compiled from: customer_validation/flow.json
from my_flows.datatypes.records import Record, ValidationResult
from my_flows.datatypes.output import FlowOutput

def validate_and_transform(input: FlowInput) -> FlowOutput:
    validated = validate_schema(input.records)
    if validated.has_errors:
        return FlowOutput(clean=[], rejected=validated.records)
    enriched = enrich_records(validated.records)
    return FlowOutput(clean=enriched, rejected=[])
```

### Live / Interpreted Mode

The same graph, interpreted at runtime. The engine walks the DAG, calls each node, and captures state between steps. Enables:

- **Step + step-into** (like assembly-level debugging)
- **Real-time visualization** of data flowing through the graph in the UI
- **Checkpointing** at each node boundary

> "Could probably do this assembly style, with step + step into, hooks and checkpointing."

Both modes produce identical results. Live mode adds visualization and debugging overhead.

> "We could probably make this work compiled + live."

The live mode is the killer feature for the target use case: you're building an info processing pipeline, not sure about your branching logic, you throw test data at it in live mode and watch it flow through the graph, inspect intermediate Pydantic objects at each step. Once it works, compile it and drop it into your codebase as a normal import.

---

## Debugging & Checkpointing

### Flow-Level Debugging

At the flow level, debugging is trivially simple:

- **Step** = call the next node and stop
- **Step into** (on a sub-flow node) = enter that sub-flow's node list and step through it
- **Step into** (on a Python node) = hand off to Python's native debugger (pdb, IDE debugger)

> "At the flow level, it's almost embarrassingly simple — you're literally just iterating through a list of function calls with pauses between them."

### Checkpointing

Before each node executes, serialize the current state (Pydantic `.model_dump()`). Key by node ID or execution index. Resume from checkpoint N = deserialize snapshot, start from node N+1.

State is fully serializable by definition (all data is Pydantic models). This gives you:
- **Replay** — re-run from any checkpoint
- **Time-travel debugging** — inspect any intermediate state
- **Recovery** — resume from failure without re-running everything

The compiled function optionally accepts a context/tracer:

```python
def validate_and_transform(input: FlowInput, ctx: FlowContext | None = None) -> FlowOutput:
    validated = validate_schema(input.records)
    if ctx: ctx.record("validate_schema", input=input.records, output=validated)
    ...
```

If no context is passed, it's a normal function with zero overhead.

### Call Stack for Nested Flows

When a flow calls a sub-flow, push a new checkpoint context. Pop when returning. The checkpoint model is a **stack of flat lists**, not just a flat list.

---

## Actions & Editor Authoring

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

## Class / Module Compilation

Flows can optionally be grouped into a **module** that compiles to a Python class:

- The module defines init state (db connections, config, etc.)
- Each flow in the module becomes a **method**
- Flows can be marked **public or private** (private → `_`-prefixed methods)

```python
# compiled from: candidate_processor.module.json
class CandidateProcessor:
    def __init__(self, config: ProcessorConfig):
        self.db = connect(config.db_url)
        self.threshold = config.score_threshold
    
    def score(self, input: CandidateInput) -> ScoreResult:
        # compiled from scoring/flow.json
        ...
    
    def _validate(self, input: ValidationInput) -> ValidationResult:
        # private helper, compiled from validation/flow.json
        ...
```

> "You could literally check off what flows you want to be public methods as well, which would be cool."
> "Maybe we call it funcs though, to be more standard?"

**Note:** This may be premature for v1. Functions-only covers most of the use case. Classes can be added later if needed.

---

## Codebase Integration

Since flows are importable in runtime mode and can compile to plain Python functions/classes, they integrate like any other Python module:

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

Runtime/import mode may depend on DAGsmith. Compiled/exported mode should produce plain Python with no DAGsmith runtime dependency.

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
- **Type-aware connections** — the UI knows available datatypes, validates connections at design time
- **Good naming** — high ability to name/label nodes, edges, and flows
- **Code editor per snippet node** — inline editing of Python code
- **Compile button** — generates the `.py` output
- **Live run button** — interprets the flow with visualization
- **Public/private toggle** on flows within a module

### Proposed Workspace Layout

The current UI shape that seems most aligned with the project is:

- **Main canvas** in the center for the current flow
- **Top bar or popup tray** for shared/global helpers, datatypes, and reusable flow-local resources
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

> "Nobody has built a tool that combines all of: classic flowchart visual vocabulary (not a node-graph wiring UI), pro-code Python with Pydantic typing, recursive nesting with LOD scaling, and compilation to standalone Python."

### Key distinction from LangGraph

> "LangGraph thinks in terms of 'evolving a state object through a graph.' You're thinking in terms of 'piping typed data through a flowchart.' Those lead to very different authoring experiences even if the runtime mechanics are similar."

---

## Build Plan

### Phase 1 — Schema + Compiler (~500 lines Python)
- Define the `flow.json` schema (nodes, edges, conditions, metadata)
- Define the `dagsmith.json` manifest schema
- Write a compiler: JSON → Python function with Pydantic types
- Hand-write 3 real flows in JSON, compile them, verify output is code you'd write by hand

### Phase 2 — Interpreter + Checkpointing (~300 lines)
- Walk the DAG, call nodes, capture state between steps
- Step / step-into / resume from checkpoint
- Validates the execution model before building UI

### Phase 3 — React Flow UI (bulk of work)
- Flow editor with classic flowchart vocabulary
- LOD zoom: collapse/expand sub-flows
- Type-aware connections
- Inline code editor per node
- Compile + live-run buttons
- Persistent layout in `flow.json`

---

## Open Design Questions

1. **Conditional node interface** — Does the condition function receive the same Pydantic input as a regular node? Probably yes, for uniformity.
2. **Error handling model** — Exceptions propagate naturally (simple) vs. explicit error edges (visual)?
3. **Node authoring** — Separate `.py` files referenced by import path? Inline in the UI? Both?
4. **Class compilation** — Ship in v1 or defer?
5. **Import path mechanics** — Exact callable ref grammar, path resolution, and compiled-output import strategy.
