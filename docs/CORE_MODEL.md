# DAGsmith Core Model

This document captures the current minimal design for DAGsmith's internal model.

The goal is to preserve the project's core character:

- pro-code, not no-code
- DAG-only, no graph-level loops
- fully nestable/recursive
- visually organized, but still grounded in normal Python
- small enough that the runtime can stay elegant

A DAGsmith workspace is a normal Python package. Flows are pure functions: same input, same output, no persistent state, no lifecycle hooks, no `__init__`. The workspace hosts multiple pure-function flows and the runtime interprets them — DAGsmith is a runtime library, not a compiler.

This is intentionally narrower and more concrete than the broader design vision.

## Core Principles

### 1. A flow is a pure function

A flow is not "like" a function. A flow *is* a function — and specifically a pure one:

- it has an input contract
- it has one or more named exits
- each exit has an output contract
- same input produces the same output
- there is no persistent flow state, no `__init__`, no lifecycle hooks

This is the core unifying idea of the project. A subflow (when added later) is also a pure function, not a self-contained package that owns its own lifecycle. Ambient context (DB connections, config) belongs in the payload that flows into the flow, not on a flow object.

Because of this:

- a Python-backed node can appear inside a flow
- a flow-backed node can appear inside a flow
- nesting is recursive
- a chain is just another callable unit with declared I/O

### 2. DAGs only

Each flow is a directed acyclic graph.

Graph-level loops are explicitly out of scope.

If a user wants iteration, they write a normal Python loop inside a Python-backed node and may call other flows from inside that loop.

This constraint is a feature, not a limitation. It keeps:

- execution order simple
- validation simple
- live stepping simple
- the visual model legible

### 3. DAGsmith organizes code visually

DAGsmith does not try to replace Python.

Users decide when something should be:

- a normal Python function
- a visual flow

Some logic is better organized as code in files. Some logic is better organized as a diagram. DAGsmith exists for the second case without taking away the first.

### 4. The graph should not force ugly code

Python node code should look like normal Python as often as possible.

The graph model should not require users to:

- invent wrapper types just for routing
- bury control-flow logic inside payload objects
- turn ordinary functions into mini runtimes

The graph is responsible for organizing execution. Node code is responsible for doing useful work.

## Executable Units

There are only two executable node kinds in the core model:

- `python`
- `flow`

### `python` node

A `python` node points to Python code.

Its meaning is:

- take an input value of the declared input type
- run the referenced Python callable
- produce either a plain output value or an explicit routed result

Visually, this can use a Python icon.

### `flow` node

A `flow` node points to another DAGsmith flow.

Its meaning is:

- take an input value of the declared input type
- run the referenced flow
- produce one of that flow's public exits

Visually, this can use a chain icon.

This is not a "lesser" concept than a Python node. A flow is a first-class callable unit.

**Phase 1 note:** `NodeSpec.kind` still accepts the literal `"flow"`, but the Phase 1 loader raises `NotImplementedError` for any node with `kind == "flow"`. Subflows land in a later phase; the schema is forward-compatible.

## Routing Model

Routing is the most important part of the runtime contract.

The design goal is:

- keep payload types clean
- keep ordinary nodes simple
- allow nodes to route directly when they already know the route

### Plain return

Most nodes should behave like ordinary functions:

```python
def clean_record(record: Record) -> CleanRecord:
    ...
    return cleaned
```

If a node returns a plain value, the runtime sends that value through the default exit, usually `out`.

### Explicit routed return

If a node naturally knows which branch to take, it should be able to say so directly.

The current preferred model is:

- `Emit` is the runtime data type
- `emit(exit_name, value)` is the user-facing helper

Example:

```python
from dagsmith import emit

def validate(record: Record):
    if not record.email:
        return emit("invalid", ValidationError(reason="missing email"))
    return emit("valid", ValidatedRecord.model_validate(record))
```

This avoids computing the route twice.

Conceptually, `emit(...)` simply constructs an `Emit` object that the runtime can recognize unambiguously.

### Optional selector

Sometimes a node should return a normal typed payload, and a separate routing rule should inspect that payload and choose the branch.

Example:

```python
def validate(record: Record) -> ValidationResult:
    ...

def choose_validation_path(result: ValidationResult) -> Literal["valid", "invalid"]:
    ...
```

This is useful when:

- the business payload should stay clean
- routing is a separate concern from processing
- users want the Python function to remain a normal "input to output" function

### Recommended runtime rule

The minimal runtime rule is:

1. Run the node.
2. If it returns `Emit(exit_name, value)`, route to `exit_name`.
3. Otherwise, if the node has a selector, run the selector on the plain value to choose an exit.
4. Otherwise, route through the default exit `out`.

This gives DAGsmith three important properties:

- normal nodes stay normal
- branching nodes can branch directly
- routing can be separated when that is cleaner

### Data plane vs control plane

This split is important.

- The payload is the business data.
- The exit name is control-flow metadata.

Users should not need to pollute payload types with routing information unless they explicitly want to.

Bad pattern:

```python
class ValidationEnvelope(BaseModel):
    route: Literal["valid", "invalid"]
    value: ValidationResult | ValidationError
```

This mixes control-flow mechanics into the business payload.

Preferred pattern:

- return a clean payload
- route separately with a selector

or:

- return `emit(exit_name, payload)` when the node naturally knows the route

## Exits

Nodes and flows expose named exits.

Examples:

- `out`
- `yes` / `no`
- `valid` / `invalid`
- `csv` / `json`

Each exit has a declared payload type.

This is cleaner than saying a flow "returns the union of all possible leaves."

Instead, the model is:

- a callable unit has one or more named exits
- each exit carries a payload type

So a flow's public interface is not just "input type and output type." It is:

- input type
- exit set
- payload type per exit

This makes the flow model more explicit and easier to validate.

## Merges

Merging is allowed.

This is why the right mental model is a DAG or control-flow graph, not a tree.

### Important distinction

A tree does not merge back.

A DAG can split and rejoin.

DAGsmith needs to support both:

- exclusive branching
- optional/guarded detours that return to a main line

### Validation rule for merges

If multiple edges feed into one node, the incoming exit payloads must be compatible with that node's declared input type.

That means merge handling belongs primarily in validation, not in node code.

The node should not need to know how many upstream branches converged into it.

### Main-line intuition

Many graphs will feel like a "main thread" carrying a current typed value.

Some branches:

- replace that value
- refine that value
- optionally detour and then return to the main line

This is still a DAG. It is not a separate threading model.

## Error Model

The error model should stay extremely small.

### Expected outcomes are exits

If something is a normal business outcome, it should be modeled as an exit.

Examples:

- `valid` / `invalid`
- `found` / `missing`
- `accepted` / `rejected`

These are not errors.

### Unexpected failures are exceptions

If code crashes, imports fail, serialization fails, or a snippet raises, that is a normal Python exception.

For v1:

- no typed exception system
- no graph-level error algebra
- no error edges by default

In live mode:

- the node turns red
- execution stops
- the UI shows the exception type and message

In ordinary (non-live) execution, Python exceptions simply propagate up through the runner to the caller, like any normal function call.

## Type System

The public type language is Python types and Python annotations. DAGsmith does not invent a new type language.

### One rule for type placement

**Types live with the flow whose code uses them.**

Concretely:

- Each flow may have an optional `types/` folder beside its `flow.json`. It is created on demand — nothing forces a flow to have one.
- The workspace root may have a `types/` folder for workspace-wide types.
- Reusable callables under `shared/` may carry their own `types/` for the shapes they expose.

### Import rules

- Nodes use `from .types import X` to pull in their own flow's types (relative sibling import).
- Nodes use `from ..types import X` to pull in parent-flow types (single level up). This is a **local operation, not a smell** — it explicitly expresses subtree coupling.
- Nodes use absolute imports (`my_workspace.types.X`, `my_workspace.shared.foo.types.Y`) for workspace-root types and types owned by a shared callable.
- `...` or deeper relative imports are **not allowed**. Two or more levels up is a smell: promote the type to the workspace root `types/` instead.

### Class identity across unrelated flows

Class identity across unrelated subflows is **not** automatic. If two unrelated flows happen to want the same shape, either:

- one flow owns the type and the other imports it, or
- the type is explicitly promoted to the workspace-root `types/`.

The runtime does not magically unify structurally-identical types from different modules.

### Supported type kinds

All of the following are supported on equal footing:

- Pydantic `BaseModel`
- `@dataclass`
- `Enum`, `StrEnum`, `IntEnum`, `Flag`
- `NamedTuple`
- `TypedDict`
- PEP 695 type aliases (`type X = ...`)

Plus the usual annotation machinery — primitives, `list[T]`, `dict[str, T]`, unions (`T | U`), `Optional[T]`, `Literal[...]`.

### Phase 1 type handling

In Phase 1:

- `flow.json` stores `type_ref` as **fully qualified Python import paths** (e.g. `my_workspace.customer_validation.types.Customer`).
- The Phase 1 runtime does **not** resolve or validate `type_ref` values. They are documentation at this stage.
- Runtime validation is whatever Python's own type machinery gives you — Pydantic validates on construction, dataclasses don't, and so on. That is intentional: users write normal Python.
- There is no type registry, no discovery pass, no schema export. Type registry / discovery is a later UI concern, not Phase 1.

### Reusable code vs graph-local code

This distinction is important.

Reusable utility code should normally:

- return plain business data
- avoid graph-local routing behavior
- avoid selectors

Graph-local node code may:

- call reusable utility functions
- use selectors
- return `emit(exit_name, value)` when it needs to control routing directly

In other words:

- reusable code should stay reusable
- graph-aware routing belongs at the node integration layer

This keeps business logic portable while still allowing a node to opt into explicit graph behavior when needed.

## Namespaces

Namespaces matter, but they do not need to be painful.

### Fully qualified names

Every stored object should have a fully qualified identity derived from its location in the workspace package.

Examples:

- `my_workspace.customer_validation` (a flow)
- `my_workspace.customer.onboarding.validate` (a nested flow)
- `my_workspace.scoring.score_candidate` (a callable)
- `my_workspace.customer_validation.types.Customer` (a flow-local type)
- `my_workspace.types.ValidationError` (a workspace-root type)

Short names may exist for convenience, but fully qualified Python import paths are the canonical identity.

### Reserved names

The validator should reject obviously problematic folder names early.

Reserved names are:

- `shared`
- `__pycache__`

`types/` is **not** reserved — it is a convention, and flows pick it up only when they choose to. The goal is not to over-police naming. The goal is to prevent confusing collisions with DAGsmith's structural slots.

## Filesystem Organization

A DAGsmith workspace **is a normal Python package**. Installing it with `uv sync` (uv project mode) makes it importable like any other package. The filesystem is the source of truth; `dagsmith.json` is a manifest/config, not a database.

Benefits:

- simple mental model
- easy git diffing
- normal editor support
- easy loading
- easy JSON export/import
- works with normal Python tooling, including type checkers and `uv`

### Recommended layout

```text
my_workspace/
  __init__.py
  pyproject.toml
  dagsmith.json
  types/                  # workspace-wide types (optional)
    __init__.py
    errors.py
  shared/                 # reusable callables (optional)
    __init__.py
    validation.py
    types/                # types owned by the shared callables
      __init__.py
      validation_result.py
  customer_validation/
    __init__.py
    flow.json
    load.py
    validate_email.py
    enrich.py
    types/                # flow-local types (optional — only when needed)
      __init__.py
      customer.py
  scoring/
    __init__.py
    flow.json
    score_candidate.py
```

This gives:

- a single directory as the unit of flow ownership
- shallow node modules directly inside the flow
- a flow-local `types/` only if the flow actually has flow-local types
- a workspace-root `types/` for shapes shared across unrelated flows
- room for per-flow assets later

Flows are discovered by walking the package and finding every directory that contains a `flow.json`. A flow's ID is the dot-joined relative path from the workspace root. The workspace root itself is not a flow.

### Folder meaning

Folders carry real semantic meaning:

- a flow is a directory containing `flow.json`
- files directly inside that directory are part of that flow
- `types/` inside a flow directory holds flow-local types
- workspace-root `types/` holds workspace-wide types
- `shared/` holds reusable callables, with its own `types/` for shapes those callables expose
- subfolders should not be introduced purely for visual organization yet

If a subfolder exists in the flow tree, it should mean something real about ownership, scope, or reuse. It should not merely mean "these files felt related."

### Why keep folder meaning strict in v1

Allowing two different kinds of subfolders too early:

- semantic subfolders, such as real subflows or scoped shared areas
- purely organizational subfolders

would make path meaning ambiguous and complicate both the UI and the loader.

The current preference is:

- keep v1 strict and simple
- let subfolders mean real structure
- discover flows by scanning for `flow.json`
- derive flow IDs from the relative path to the package root
- revisit organization-only folders later if they become necessary

This keeps the model easier to explain and avoids a second classification problem in the loader.

### Layout state

The flow file should contain semantic graph data and UI layout data in separate top-level sections.

Example:

```json
{
  "id": "customer_validation",
  "input": "RawCustomer",
  "nodes": {
    "load": {
      "kind": "python",
      "ref": ".load:process",
      "input": "RawCustomer",
      "exits": {
        "out": "Customer"
      }
    }
  },
  "edges": [],
  "entry_node": "load",
  "public_exits": {
    "out": "Customer"
  },
  "layout": {
    "nodes": {
      "load": { "x": 120, "y": 80 }
    },
    "viewport": { "x": 0, "y": 0, "zoom": 1.0 }
  }
}
```

The runtime should ignore `layout`. The UI owns it.

### Manifest

A manifest is still useful, but it should be an index, not the only storage layer.

The manifest can track:

- discovered flows
- datatype modules
- callable refs
- dependency edges
- metadata for the UI

The intended split is:

- `dagsmith.json` is project-level configuration and indexing
- each `flow.json` is the source of truth for one actual flow graph

Reserved names like `shared` are structural rules enforced by DAGsmith itself, not configurable manifest entries.

An `exports` field may exist later if the package wants a curated public flow surface, but that is optional and not part of the core v1 structure.

If it drifts, it should be rebuildable from disk.

## Code Ownership And Utilities

Code reuse needs a clear ownership model or the workspace will become confusing.

The key distinction is:

- owned node code
- shared utility code

These are not the same thing and should not be treated the same way in the UI or runtime model.

### Owned node code

By default, a Python node owns its code.

That means:

- the node points to a local file
- editing that code edits the file owned by that node/flow area
- the code is understood as part of that flow's implementation

This should be the default authoring mode.

### Shared utility code

Sometimes multiple nodes should call the same reusable Python function.

That is allowed, but it should be explicit.

Shared utility code means:

- multiple nodes may reference the same callable
- editing that callable changes behavior everywhere it is referenced
- the UI should make this visible

Shared utility code should not be the default behavior for ordinary node editing.

### Node instance vs callable

This distinction matters:

- a callable is reusable code
- a node is a specific occurrence of that code inside a specific flow

The runner tracks execution by node instance, not only by callable reference.

So if two nodes point to the same shared function, the runtime still knows which flow and node are currently active.

### Reuse rules

The recommended reuse rules are:

- a Python node may reference any allowed callable
- multiple nodes may reference the same shared callable
- a flow node may reference another flow through that flow's public interface
- flows should not reach into another flow's private internal nodes directly

This preserves encapsulation while still allowing code reuse.

### Direct shared callable node

A node may point directly at shared code when it does not need graph-local routing or customization.

Example structure:

```text
my_workspace/
  shared/
    __init__.py
    validation.py
  customer_validation/
    flow.json
```

Shared callable:

```python
# my_workspace/shared/validation.py
def normalize_email(record):
    ...
```

Flow node:

```json
{
  "nodes": {
    "normalize_email": {
      "label": "normalize_email",
      "kind": "python",
      "ref": "my_workspace.shared.validation:normalize_email",
      "input": "my_workspace.types.Record",
      "exits": {
        "out": "my_workspace.types.Record"
      }
    }
  }
}
```

No local node file is needed in this case.

### Shared callable with local routing

If a shared callable needs graph-local routing, the router should live beside the flow that uses it.

Example structure:

```text
my_workspace/
  shared/
    __init__.py
    validation.py
  customer_validation/
    flow.json
    validate_email.py
```

Shared callable:

```python
# my_workspace/shared/validation.py
def validate_email(record):
    ...
```

Graph-local router:

```python
# my_workspace/customer_validation/validate_email.py
def branch(result):
    return "valid" if result.ok else "invalid"
```

Flow node:

```json
{
  "nodes": {
    "validate_email": {
      "label": "validate_email",
      "kind": "python",
      "ref": "my_workspace.shared.validation:validate_email",
      "selector": ".validate_email:branch",
      "input": "my_workspace.types.Record",
      "exits": {
        "valid": "my_workspace.customer_validation.types.ValidationResult",
        "invalid": "my_workspace.customer_validation.types.ValidationResult"
      }
    }
  }
}
```

This keeps reusable business logic portable while making graph-local routing explicit.

### Nested flow as a node

Nested flows are referenced by flow ID, not imported as Python callables. (Phase 1 loads the spec but raises `NotImplementedError` when executing a `flow` node — subflows arrive in a later phase.)

Example structure:

```text
my_workspace/
  customer/
    onboarding/
      flow.json
      validate/
        flow.json
        check_email.py
```

The parent flow can call the nested flow:

```json
{
  "nodes": {
    "validate": {
      "kind": "flow",
      "ref": "customer.onboarding.validate",
      "input": "Candidate",
      "exits": {
        "valid": "ValidatedCandidate",
        "invalid": "ValidationError"
      }
    }
  }
}
```

The folder nesting gives namespace and ownership. It does not automatically execute the child flow.

### Parent-flow type imports

A nested flow may explicitly import types from its parent flow's `types/` folder using a single-level relative import:

```text
my_workspace/
  customer/
    onboarding/
      flow.json
      types/
        __init__.py
        candidate.py
      validate/
        flow.json
        check_email.py
```

Inside `customer/onboarding/validate/check_email.py`:

```python
from ..types import Candidate, ValidationError
```

This is allowed and is considered a **local operation, not a smell** — it explicitly expresses that the child flow is coupled to its parent subtree. The UI can still show this as a parent-type dependency, but authors should not feel guilty about it.

What is *not* allowed is going two or more levels up (`...types`, `....types`). If a type wants to be used that widely, it should be promoted to the workspace-root `types/`.

### Recommended layout for utilities and types

A useful structure is:

```text
my_workspace/
  types/                      # workspace-wide types
    __init__.py
    errors.py
  shared/                     # reusable callables
    __init__.py
    validation.py
    types/                    # types owned by the shared callables
      __init__.py
      validation_result.py
  customer_validation/
    flow.json
    validate_email.py
    types/                    # flow-local types
      __init__.py
      customer.py
```

This provides three type scopes:

- **flow-local** types in a flow's own `types/`
- **shared** types owned by reusable callables under `shared/*/types/`
- **workspace-wide** types in the root-level `types/`

### Scope model

The suggested model is:

- flow-local types live with the flow whose code uses them
- shared callables and the types they expose live in a clearly global shared area
- workspace-wide types live at the root
- all usage is still explicit through Python imports

The important part is that types should not become ambient magic just because of folder location.

### Explicit imports over ambient access

Even when a flow is allowed to use:

- its own flow-local types
- parent-flow types (one level up)
- workspace-root types
- shared-callable types

those dependencies should still be explicit imports. Structured availability is good; implicit global access is not. This keeps the codebase organized without taking away the "write normal Python" philosophy.

### Default policy

The current recommended default policy is:

- local node modules are private by default
- namespace-level utility files are allowed
- global shared utility files are allowed
- shared callable references are explicit, not accidental
- editing shared code should be visually distinguishable from editing owned node code

This is a deliberate tradeoff in favor of maintainability and clear ownership.

## Reference Syntax

References should stay small and explicit.

DAGsmith should distinguish:

- Python callable refs
- flow refs

### Python callable refs

A Python callable ref points to a function or callable object.

Recommended v1 forms:

- `.module:function` for a module beside the current flow's `flow.json`
- `..module:function` for an explicit parent-package relative import
- `package.module:function` for an absolute package import (either inside the workspace package or from an external project)

Examples:

```text
.load:process
.validate_email:branch
..shared:normalize_email
my_workspace.shared.validation:validate_email
myapp.validation:validate_email
```

The `.` and `..` forms are resolved relative to the flow directory's Python package. Absolute refs are resolved through normal Python import machinery.

### Flow refs

A flow ref points to another DAGsmith flow ID, not a Python function.

Example:

```text
customer.onboarding.validate
```

Flow IDs are derived from directories containing `flow.json`.

### Node ID and label

Every node has a node ID because it needs a stable identity in the graph.

The node ID is the key in `flow.json`:

```json
{
  "nodes": {
    "validate_email": {
      "label": "Validate email",
      "kind": "python",
      "ref": ".validate_email:process"
    }
  }
}
```

The `label` is optional UI metadata. If it is omitted, the UI can display the node ID.

The node ID should not be automatically changed every time the label changes. If the user explicitly renames the node ID, the UI should treat that as a structural rename and update graph refs carefully.

### Local adapter files

When a node owns local behavior, the local Python file should usually be named after the node ID.

Example:

```text
customer_validation/
  flow.json
  validate_email.py
```

This file may contain:

```python
def process(record):
    ...

def branch(result):
    ...
```

If the node points directly at a shared callable and does not need a selector/router, no local adapter file is required.

## Minimal Data Model

The core IR can stay very small.

```python
TypeRef = str

class ExitSpec:
    type_ref: TypeRef

class NodeSpec:
    kind: Literal["python", "flow"]
    ref: str
    input_type: TypeRef
    exits: dict[str, ExitSpec]
    selector_ref: str | None = None
    label: str = ""
    description: str = ""

class EdgeSpec:
    from_node: str
    from_exit: str = "out"
    to_node: str | None = None
    to_flow_exit: str | None = None

class FlowSpec:
    id: str
    input_type: TypeRef
    nodes: dict[str, NodeSpec]
    edges: list[EdgeSpec]
    entry_node: str
    public_exits: dict[str, ExitSpec]
    description: str = ""
```

This is enough to support:

- nesting
- routing
- validation
- serialization
- interpretation

Node names and exit names are the keys in the containing dictionaries. They do not need to be duplicated inside `NodeSpec` or `ExitSpec`.

Phase 1 stores `type_ref` as a fully qualified Python import path (for example `my_workspace.customer_validation.types.Customer`). The Phase 1 loader does not resolve or validate these — they are documentation for humans and the UI. Runtime type enforcement, if any, comes from Python itself (Pydantic on construction, etc).

## Runtime Model

The runtime is a small, stateless interpreter. DAGsmith is a runtime library, not a compiler — flows are interpreted, not emitted to `.py` files.

### Workspace

`load_workspace()` walks the filesystem once, parses every `flow.json`, and eagerly imports every referenced Python module. Large imports (DB clients, model weights, config) pay their cost **once** at workspace load time, never during flow execution. Users put imports wherever they normally would — at the top of a node file, or deferred inside a function body. That is a normal Python choice, not a DAGsmith one.

Example:

```python
class Workspace:
    flows: dict[str, FlowSpec]
    callable_refs: dict[str, Callable]
    diagnostics: list[Diagnostic]
```

The hot path has **zero import machinery**. Execution is just "look up a cached callable and call it."

### Runner

The runner is a pure function: same workspace, same flow, same input → same output. There is no runner state, no `__init__`, no context object by default.

Example shape:

```python
def run_flow(workspace: Workspace, flow_id: str, input_value: object) -> object: ...
```

An optional tracer parameter may be added later for step/live mode, but it is explicitly optional and absent from the default path.

### Checkpoints (later phases)

Checkpointing is runtime support, not business persistence, and is **not in Phase 1**.

When added, a checkpoint captures values flowing **on edges**, not "flow-object state" — because there is no flow-object state to capture. At minimum a checkpoint records:

- current flow id
- current node id
- active exit
- current payload

Possibly also a small trace log, or references to large external artifacts. Checkpoints are not the durability layer for business data.

## What This Model Deliberately Avoids

This model intentionally does not include:

- graph-level loops
- concurrency
- retries
- typed exception hierarchies
- graph-level transactions
- no-code constraints
- forced tiny functions
- forced pure *node* functions
- edges that pass execution state between nodes
- class-based / stateful flows — flows are pure functions, not methods on a class
- compilation to standalone `.py` files (DAGsmith is a runtime library, not a compiler)

Users can write tiny or large functions. The system should organize them, not police style. Node functions themselves may do whatever normal Python does (I/O, mutation of their own locals, calls into the rest of the codebase); it is the *flow* that is pure, because a flow has no persistent state of its own.

Nodes communicate only through typed payloads on named exits. Passing frame locals or other implicit execution state across edges would break the graph-structure-equals-dependency-structure guarantee and make checkpoints unserializable. Shared data across nodes belongs in the payload type. Ambient context like a DB connection belongs in the payload flowing into the flow (or is captured at import time by a node module), not on a flow object — because there is no flow object.

## Current Defaults

If a future implementation needs tie-breakers, these defaults are currently preferred:

- flows are **pure functions** — no `__init__`, no persistent state, no lifecycle hooks
- executable node kinds: only `python` and `flow` (Phase 1 raises `NotImplementedError` on `flow` kind)
- routing: named exits
- default exit: `out`
- direct branching: `emit(exit_name, value)`
- optional separate routing: graph-local selector on plain return value
- errors: normal Python exceptions
- graph shape: DAG only
- storage: the workspace **is** a Python package, installed editable via `uv sync`, filesystem-first, `dagsmith.json` as index/config
- type language: Python annotations (Pydantic, dataclass, Enum/StrEnum/IntEnum/Flag, NamedTuple, TypedDict, PEP 695 aliases); Phase 1 does not validate `type_ref` — Python's own type system does that
- **eager imports** at workspace load; zero import machinery in the execution hot path
- Python **3.13+** required (for PEP 667 `f_locals` used by the Phase 3 action system)
- **no compiler** in the current design — DAGsmith is a runtime library (~750 lines plus Pydantic)
- workspace-root `types/` and `shared/` are global support scopes; flow-local `types/` is a subtree support scope

## Open Questions

These are still worth deciding later, but they do not block the core model:

1. Exact syntax for `TypeRef` in JSON beyond "fully qualified Python import path."
2. Exact public API shape for `Emit` / `emit`.
3. Whether selectors need any metadata beyond "Python callable reference."
4. Exact `layout` shape for React Flow state.
5. Whether organization-only folders should ever be allowed, or whether subfolders should always imply real scope/subflow structure.

The main point is that these questions now sit on top of a stable core model rather than replacing it.
