# Node and attachment taxonomy

**Status: design in progress — do not implement without explicit user approval.**

---

## Nodes

Nodes are the topology primitives. They appear as boxes in the graph, connected by edges. Each node has a `kind` field. The current set is `"python" | "flow" | "action"` (action is planned).

### Python (`kind: "python"`)

The standard compute node. `ref` points to a Python callable using `module:attribute` syntax — either absolute (`mypackage.utils:transform`) or workspace-relative (`.normalize:run`). The function receives the incoming value and returns a dict keyed by exit name.

Unconnected exit ports on a Python node are inferred as public exits of the flow (the "Infer" model — no explicit `public_exits` declaration needed; just leave the port unwired and it becomes a flow output).

### Subflow (`kind: "flow"`)

Embeds a child flow as a single step. `ref` is a dotted flow ID (`parent.child`). At runtime the child flow is invoked with the same input; its public exits map to this node's exits. The only composition primitive — there are no cross-graph node calls.

Subflow nodes also follow the Infer model: an unconnected exit port becomes a public exit of the parent flow.

### Start (planned)

A virtual entry node that injects a typed value into the graph without any user-written function. Intended for flows that need a specific input shape before the first Python node runs.

### Action (`kind: "action"` — planned)

An action node is a regular node that performs a side effect — logging, triggering a webhook, external API calls — but is **not** expected to emit a typed exit value. It does not count as a leaf node for the purposes of public-exit inference.

The user's framing:

> *"actions are just nodes, except we dont count them as leaf nodes so we dont expect an exit type from them. They would be for logging, triggering something, etc."*

**Why a `kind` flag rather than a separate concept:** action nodes reuse all existing node machinery (ref resolution, source editing, diagnostics, Inspector header). The only distinction is a flag that tells the runtime "don't route a typed value out of this node." This avoids duplicating node loading, rendering, and mutation code. Action nodes appear in `flow.json`'s `nodes` dict alongside Python and subflow nodes.

Action nodes connect to the main graph via either normal edges (chained after an upstream node) or via the **chained insertion point** pattern described below. They render visually as side-arrows on the connecting node, keeping the main data flow top-to-bottom and side effects visually horizontal.

---

## Insertion Points (two distinct concepts)

The term "insertion point" covers two different ideas that share a visual metaphor (side arrows on a node) but differ in when and how they run. It's important to distinguish them.

> *"there are probably insertion point type breaks where you run in the middle of the code with a certain exec state, and then there are insertions where you just chain an action after a node runs."*

> *"it would be nice if you could make this stick to the side of the node so your node sequences could still remain."*

### A. Chained action node (near-term)

A regular action node connected via a normal edge as a successor of some upstream node. Runs after the upstream node completes — not during it. The visual rendering places this connection as a side arrow on the upstream node rather than a downward exit handle, so the main data-flow column stays clean.

This requires no runtime changes — it's just an action-kind node connected with a normal edge and rendered with a horizontal arrow. Ships when action nodes land.

### B. Code insertion point (deferred)

A hook inserted **into** a node's function body at a specific source anchor. Runs with the exec state of the code at that point — i.e., local variables at that line are accessible.

The user's framing:

> *"I didnt mean for insertion points to run after a node runs. I meant for you to literally insert a point within the code itself that will execute at that point with the exec state of the code at that point."*

This is the more powerful and more complex variant. It requires AST instrumentation of the node's source, a way to specify the anchor (line number? label? decorator?), and executor support for injecting execution mid-function. Deferred to the Action system work (future SPEC.md §12).

Both variants share the visual side-arrow metaphor — the spatial distinction between "data flows down" and "side effects flow sideways" holds for both.

**OPEN:** How are insertion points connected at edit time? Drag from the side arrow? Right-click menu?

---

## Layout persistence

Node positions and other canvas layout state are stored in `flow.json`'s `layout` block.

```json
"layout": {
  "nodes": {
    "greet": { "x": 120, "y": 80 },
    "enrich": { "x": 120, "y": 240 }
  },
  "exits": {
    "validate": ["valid", "invalid"]
  }
}
```

**Merge semantics:** `PUT /layout` merges the incoming `nodes` dict over the existing one — a partial update with `{"greet": {...}}` does not erase positions for other nodes. This means the frontend can batch-save only moved nodes without clobbering the rest.

**BFS fallback:** when a node has no saved position in `layout.nodes`, the frontend falls back to BFS auto-layout to compute an initial position. Once the user moves the node, the new position is saved and the fallback no longer applies.

**Already shipped:** `layout.exits[nodeId] = [order]` stores the switcher-strip exit order for multi-exit nodes.

**Planned:** `layout.sticky_notes: [{id, x, y, w, h, markdown}]` for floating canvas annotations (see `ANNOTATIONS.md`).

---

## Attachments

Attachments are operational concerns that ride on a node without affecting graph topology. They carry no edges, do not transform data, and do not appear as boxes. Rendering: a small pill badge in the node's corner. Clicking the pill opens the attachment config in the editor header (see `EDITOR_MERGE.md`).

### Storage

A toggle on any node. When enabled, every traversal of that node's exits persists `{exit, payload, timestamp}` to a local store. Paired with a **replay** mode: stored records can be re-fed into the flow at the same point. Replay is the primary way to re-run a flow with real historical data or to resume after a failure.

Storage is close to being shippable — the local store model is straightforward and the replay loop is well-defined.

### Feeder (🧪 pill)

A dev-time testing attachment. Holds a configured sample payload; when the user selects "Run from here," the feeder injects that payload into the node's input instead of requiring data to flow from upstream.

The user's clarification (previously called "Trigger"):

> *"I was speaking about triggers as ways to inject example cases and types into the nodes mainly for testing."*

A Feeder is strictly a dev affordance — it would not be active in production runs.

### Invocation Endpoint (deferred, formerly "Trigger")

*(Renamed from "Trigger" to avoid confusion with the Feeder attachment above.)*

Declares how a flow gets invoked from outside in production: HTTP endpoint, cron schedule, webhook, or manual run. Typically attached to a Start node. Requires a service layer (background scheduler, ingress routing) and is deferred until that infrastructure is in place.

### Future extensions

- **Breakpoint** — pause execution at a node; inspect or mutate state before continuing. Visible on canvas (runtime-behavior-changing).
- **Log** — emit structured log lines on every traversal without any code change. Editor-header only.
- **Metric** — increment a counter or record a timing histogram at a named node. Editor-header only.
