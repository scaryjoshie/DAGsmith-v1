# Node and attachment taxonomy

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

---

## Attachments

Attachments are operational concerns that ride on a node without affecting graph topology. They carry no edges, do not transform data, and do not appear as boxes. Rendering concept: a small pill badge in the node's corner (storage pill, trigger pill). Clicking the pill opens the attachment config in the Inspector.

### Storage

A toggle on any node. When enabled, every traversal of that node's exits persists `{exit, payload, timestamp}` to a local store. Paired with a **replay** mode: stored records can be re-fed into the flow at the same point, eliminating the need for a separate feeder node. Replay is the primary way to re-run a flow with real historical data or to resume after a failure.

Storage is close to being shippable — the local store model is straightforward and the replay loop is well-defined.

### Trigger

Declares how the flow is invoked from outside: HTTP endpoint, cron schedule, webhook, or manual run. Typically attached to a Start node, but can attach to any midpoint to enable partial runs from that node onward.

Trigger requires a service layer (background scheduler, ingress routing) and is deferred until that infrastructure is in place.

### Future extensions

- **Breakpoint** — pause execution at a node; inspect or mutate state before continuing.
- **Log** — emit structured log lines on every traversal without any code change.
- **Metric** — increment a counter or record a timing histogram at a named node.
