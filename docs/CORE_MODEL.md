# DAGsmith Core Model

This document captures the current minimal design for DAGsmith's internal model.

The goal is to preserve the project's core character:

- pro-code, not no-code
- DAG-only, no graph-level loops
- fully nestable/recursive
- visually organized, but still grounded in normal Python
- small enough that the runtime and compiler can both stay elegant

This is intentionally narrower and more concrete than the broader design vision.

## Core Principles

### 1. A flow is a function

A flow is not "like" a function. A flow is a function-shaped object:

- it has an input contract
- it has one or more named exits
- each exit has an output contract

This is the core unifying idea of the project.

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
- compilation tractable
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

In compiled mode:

- let Python exceptions propagate naturally

## Type System

The public type language should be Python types and Python annotations.

DAGsmith should not invent a new type language unless forced to.

### Supported kinds

The initial target set can be:

- primitives
- `list[T]`
- `dict[str, T]`
- unions like `T | U`
- `Optional[T]`
- `Literal[...]`
- `Enum`
- `dataclass`
- Pydantic `BaseModel`
- possibly `TypedDict`

### Type adapters

Internally, DAGsmith should have a small adapter interface for validation and serialization.

Example shape:

```python
class ValueAdapter:
    def validate(self, value: object, type_ref: TypeRef) -> object: ...
    def dump(self, value: object, type_ref: TypeRef) -> object: ...
    def json_schema(self, type_ref: TypeRef) -> dict: ...
```

Pydantic can be the first implementation backend because it already handles:

- `BaseModel`
- dataclasses
- unions
- enums
- literals

But DAGsmith should own the interface.

That keeps the system flexible even if Pydantic is the first implementation strategy.

### Source of truth

Declared types, not runtime instances, are the source of truth.

An instance only tells you what one value is right now. It does not tell you what the contract is supposed to be.

So the recommended flow is:

1. store type references in source form
2. resolve them into Python types at load time
3. validate actual values against those resolved types at runtime

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

### Separate namespaces by kind

At minimum:

- flows live in the flow namespace
- datatypes live in the datatype namespace
- shared helpers live in normal Python module namespaces

That means `datatypes.customer.Customer` and `flows.customer.validate` are not a collision.

### Fully qualified names

Every stored object should have a fully qualified identity.

Examples:

- `flows.customer_validation`
- `flows.customer.onboarding.validate`
- `flows.scoring.score_candidate`
- `datatypes.customer.Customer`
- `datatypes.shared.ValidationError`

Short names may exist for convenience, but fully qualified names should be the canonical identity.

### Reserved names

The validator should reject obviously problematic names early.

Examples worth reserving:

- `shared`
- `datatypes`
- `__pycache__`

The goal is not to over-police naming. The goal is to prevent confusing collisions.

## Filesystem Organization

The filesystem can be the primary source of truth.

That is both possible and desirable.

Benefits:

- simple mental model
- easy git diffing
- normal editor support
- easy loading
- easy JSON export/import

### Recommended layout

```text
my_flows/
  __init__.py
  dagsmith.json
  shared/
    __init__.py
    validation.py
  datatypes/
    __init__.py
    records.py
  customer_validation/
    flow.json
    shared/
      __init__.py
    datatypes/
      __init__.py
    load.py
    validate_email.py
    enrich.py
  scoring/
    flow.json
    score_candidate.py
```

This gives:

- a single directory as the unit of flow ownership
- shallow node modules inside the flow
- local shared helpers and datatypes beside the flow
- room for per-flow assets later

The package root is not itself a flow in v1. It may contain global `shared/` and `datatypes/`, but actual flows live below the root in directories that contain `flow.json`.

### Recommended v1 folder meaning

For v1, folders should carry real semantic meaning.

That means:

- a flow is a directory
- files directly inside that directory are part of that flow
- `shared/` and `datatypes/` are scoped support areas for that flow or subtree
- root-level `shared/` and `datatypes/` are global support areas
- subfolders should not be introduced purely for visual organization yet

This is a deliberate simplification.

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

The runtime and compiler should ignore `layout`. The UI owns it.

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

Reserved names like `shared` and `datatypes` should be structural rules enforced by DAGsmith itself, not configurable manifest entries.

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
my_flows/
  shared/
    __init__.py
    validation.py
  customer_validation/
    flow.json
```

Shared callable:

```python
# my_flows/shared/validation.py
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
      "ref": "my_flows.shared.validation:normalize_email",
      "input": "Record",
      "exits": {
        "out": "Record"
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
my_flows/
  shared/
    __init__.py
    validation.py
  customer_validation/
    flow.json
    validate_email.py
```

Shared callable:

```python
# my_flows/shared/validation.py
def validate_email(record):
    ...
```

Graph-local router:

```python
# my_flows/customer_validation/validate_email.py
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
      "ref": "my_flows.shared.validation:validate_email",
      "selector": ".validate_email:branch",
      "input": "Record",
      "exits": {
        "valid": "ValidationResult",
        "invalid": "ValidationResult"
      }
    }
  }
}
```

This keeps reusable business logic portable while making graph-local routing explicit.

### Nested flow as a node

Nested flows are referenced by flow ID, not imported as Python callables.

Example structure:

```text
my_flows/
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

### Parent shared imports

A nested flow may explicitly import from a parent `shared/` or `datatypes/` folder.

Example:

```text
my_flows/
  customer/
    onboarding/
      shared/
        __init__.py
        normalize.py
      datatypes/
        __init__.py
        candidate.py
      validate/
        flow.json
        check_email.py
```

Inside `customer/onboarding/validate/check_email.py`:

```python
from ..shared import normalize_email
from ..datatypes import Candidate, ValidationError
```

This is allowed, but it couples the nested flow to its parent subtree. The UI should show this as a parent/shared dependency.

### Recommended layout for utilities

A useful structure is:

```text
my_flows/
  shared/
    __init__.py
    validation.py
  datatypes/
    __init__.py
    records.py
  customer_validation/
    flow.json
    validate_email.py
    shared/
      __init__.py
      customer_helpers.py
    datatypes/
      __init__.py
      customer_records.py
```

This provides two utility scopes:

- global shared utilities and datatypes at the package root
- flow/subtree-local shared utilities and datatypes beside `flow.json`

### Utility scope model

The suggested model is:

- local utilities live near a flow namespace and are intended for that namespace
- shared utilities live in a clearly global shared area
- all utility usage is still explicit through imports or references

The important part is that utilities should not become ambient magic just because of folder location.

### Explicit imports over ambient access

Even when a flow is allowed to use:

- its own local utility module
- a namespace-level utility module
- a global shared utility module

those dependencies should still be explicit.

In other words:

- structured availability is good
- implicit global access is not

This keeps the codebase organized without taking away the "write normal Python" philosophy.

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
- `my_flows.shared.validation:function` for an absolute package import
- `myapp.validation:function` for an external project import

Examples:

```text
.load:process
.validate_email:branch
..shared:normalize_email
my_flows.shared.validation:validate_email
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
- eventual compilation

Node names and exit names are the keys in the containing dictionaries. They do not need to be duplicated inside `NodeSpec` or `ExitSpec`.

## Runtime Model

The runtime should stay small and unsurprising.

### Workspace

The loader builds a `Workspace` from the filesystem.

Example:

```python
class Workspace:
    flows: dict[str, FlowSpec]
    callable_refs: dict[str, Callable]
    diagnostics: list[Diagnostic]
```

### Runner

The runner executes a flow against input data.

Example:

```python
class Runner:
    def run_flow(self, flow_id: str, input_value: object) -> RunResult: ...
```

### Checkpoints

Checkpointing is runtime support, not business persistence.

At minimum, a checkpoint should capture:

- current flow id
- current node id
- active exit
- current payload

Possibly:

- a small trace log
- references to large external artifacts

Avoid treating checkpoints as the main durability layer for business data.

## What This Model Deliberately Avoids

This model intentionally does not include:

- graph-level loops
- concurrency
- retries
- typed exception hierarchies
- graph-level transactions
- no-code constraints
- forced tiny functions
- forced pure functions
- edges that pass execution state between nodes

Users can write tiny or large functions. The system should organize them, not police style.

Nodes communicate only through typed payloads on named exits. Passing frame locals or other implicit execution state across edges would break the graph-structure-equals-dependency-structure guarantee, defeat compilation to hand-written-looking Python, and make checkpoints unserializable. Shared data across nodes belongs in the payload type, or in a flow-level class's `__init__` when it is ambient context like a DB connection.

## Current Defaults

If a future implementation needs tie-breakers, these defaults are currently preferred:

- executable node kinds: only `python` and `flow`
- routing: named exits
- default exit: `out`
- direct branching: `emit(exit_name, value)`
- optional separate routing: graph-local selector on plain return value
- errors: normal Python exceptions
- graph shape: DAG only
- storage: importable Python package, filesystem-first, manifest as index
- type language: Python annotations, validated through adapters
- root `shared/` and `datatypes/`: global support scopes
- flow-local `shared/` and `datatypes/`: subtree support scopes

## Open Questions

These are still worth deciding later, but they do not block the core model:

1. Exact syntax for `TypeRef` in JSON.
2. Exact public API shape for `Emit` / `emit`.
3. Whether selectors need any metadata beyond "Python callable reference."
4. Exact `layout` shape for React Flow state.
5. Whether organization-only folders should ever be allowed, or whether subfolders should always imply real scope/subflow structure.
6. When and how compiled Python code should be generated.

The main point is that these questions now sit on top of a stable core model rather than replacing it.
