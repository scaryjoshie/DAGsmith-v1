# Node and attachment taxonomy

**Status: design in progress — do not implement without explicit user approval.**

---

## Nodes

Nodes are the topology primitives. They appear as boxes in the graph, connected by edges. Each node has a `kind` field.

### Python (`kind: "python"`)

The standard compute node. `ref` points to a Python callable using `module:attribute` syntax — either absolute (`mypackage.utils:transform`) or workspace-relative (`.normalize:run`). The function receives the incoming value and returns a dict keyed by exit name.

Unconnected exit ports on a Python node are inferred as public exits of the flow (the "Infer" model — no explicit `public_exits` declaration needed; just leave the port unwired and it becomes a flow output).

### Subflow (`kind: "flow"`)

Embeds a child flow as a single step. `ref` is a dotted flow ID (`parent.child`). At runtime the child flow is invoked with the same input; its public exits map to this node's exits. The only composition primitive — there are no cross-graph node calls.

Subflow nodes also follow the Infer model: an unconnected exit port becomes a public exit of the parent flow.

### Start (planned)

A virtual entry node that injects a typed value into the graph without any user-written function. Intended for flows that need a specific input shape before the first Python node runs.

### Action (`kind: "action"` — planned)

An action node performs a side effect but does not forward data in the main pipeline. It is invoked via **insertion points** (see below), not via the normal top/bottom data handles. Examples: logging, webhooks, external API calls, notifications.

The user's framing:

> *"something called an action node, which is a node that exists to perform an action, but does not [forward data]."*

Why this is a separate kind rather than a Python node with no exits: the intent is to make side effects legible in the graph. A Python node that silently fires a webhook is invisible; an action node connected via a side-arrow insertion point is explicit. The kind distinction also lets the runtime skip action nodes in the normal data-routing pass.

**OPEN:** Do action nodes appear in `flow.json`'s `nodes` dict, or in a separate `flow.actions` key? The `nodes` dict approach is simpler for the loader; the separate key keeps the data-flow graph topologically clean.

---

## Insertion Points (planned)

An insertion point is a side arrow on a node — left or right edge, distinct from the top (input) and bottom (exit) handles. Firing an insertion point is a side effect triggered when the node executes. Insertion points connect to action nodes or subflow calls.

The user's framing:

> *"I wonder if we can have insertion points appear as arrows coming out of the node's side? That would be intuitive. This could also be used to represent calling nodes or chains within the script as well."*

**Rationale:** keeping main data flow top-to-bottom and side effects left-to-right makes graph reading fast. A horizontal arrow signals "this is a consequence, not a route." This also makes it natural to represent script-level calls (calling a helper function from within a node) as visible graph structure without polluting the DAG topology.

**OPEN:** How are insertion points created at edit time? Drag from the side arrow? Right-click → "Add insertion point"?

---

## Attachments

Attachments are operational concerns that ride on a node without affecting graph topology. They carry no edges, do not transform data, and do not appear as boxes. Rendering concept: a small pill badge in the node's corner. Clicking the pill opens the attachment config in the editor header (see `EDITOR_MERGE.md`).

### Storage

A toggle on any node. When enabled, every traversal of that node's exits persists `{exit, payload, timestamp}` to a local store. Paired with a **replay** mode: stored records can be re-fed into the flow at the same point. Replay is the primary way to re-run a flow with real historical data or to resume after a failure.

Storage is close to being shippable — the local store model is straightforward and the replay loop is well-defined.

### Feeder (🧪 pill)

A dev-time testing attachment. Holds a configured sample payload; when the user selects "Run from here," the feeder injects that payload into the node's input instead of requiring data to flow from upstream.

The user's clarification (previously this was called "Trigger"):

> *"I was speaking about triggers as ways to inject example cases and types into the nodes mainly for testing."*

This is distinct from the production invocation concept (renamed below). A Feeder is strictly a dev affordance — it would not be active in production runs.

### Invocation Endpoint (deferred, formerly "Trigger")

*(Renamed from "Trigger" to avoid confusion with the Feeder attachment above.)*

Declares how a flow gets invoked from outside in production: HTTP endpoint, cron schedule, webhook, or manual run. Typically attached to a Start node. Requires a service layer (background scheduler, ingress routing) and is deferred until that infrastructure is in place.

### Future extensions

- **Breakpoint** — pause execution at a node; inspect or mutate state before continuing. Visible on canvas (runtime-behavior-changing).
- **Log** — emit structured log lines on every traversal without any code change. Editor-header only.
- **Metric** — increment a counter or record a timing histogram at a named node. Editor-header only.
