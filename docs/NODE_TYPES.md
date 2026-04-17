# Node type catalog

A node is the atomic unit of a DAGsmith flow. Each node has a `kind` field
that determines how the runtime resolves and calls it.

---

## Python (`kind: "python"`)

The standard compute node. `ref` points to a Python callable using
`module:attribute` syntax — either absolute (`mypackage.utils:transform`) or
workspace-relative (`.normalize:run`). The function receives the incoming
value and returns a dict keyed by exit name, e.g. `{"out": result}`.

All business logic lives in Python nodes. They are pure functions: no side
effects on the flow graph, no shared mutable state between invocations.

## Subflow (`kind: "flow"`)

A subflow node embeds an entire child flow as a single step. `ref` is a
dotted flow ID (`parent.child`). At runtime the child flow is invoked with
the same input value; its public exits map to this node's exits. This is
the only composition primitive — there is no concept of "calling" a node
directly from another node outside of subflow embedding.

Subflow nodes enable hierarchical decomposition: a top-level flow can
delegate large segments to child flows while keeping the parent graph
readable.

---

## Planned (not yet implemented)

### Start (future)

A virtual entry node that injects a typed value into the graph without any
user-written function. Intended for cases where the input needs
normalization or deserialization before the first real node runs.

### Storage (deferred)

A node that reads from or writes to a named storage slot (database row,
blob, queue message). Deferred pending the storage layer design in SPEC §8.

### Feeder (deferred)

A source node that produces multiple outputs from a collection — fan-out
over a list or paginated cursor. Deferred pending the streaming/batch
execution model.
