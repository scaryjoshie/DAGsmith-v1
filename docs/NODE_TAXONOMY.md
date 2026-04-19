# Node and attachment taxonomy

**Status: design in progress — do not implement without explicit user approval.**

---

## Nodes

Nodes are the topology primitives. They appear as boxes in the graph, connected by edges. Each node has a `kind` field. The current set is `"python" | "flow" | "action"` (action is planned).

### Python (`kind: "python"`)

The standard compute node. `ref` points to a Python callable using `module:attribute` syntax — either absolute (`mypackage.utils:transform`) or workspace-relative (`.normalize:run`). The function receives the incoming value and returns a dict keyed by exit name.

Unconnected exit ports on a Python node are inferred as public exits of the flow (the "Infer" model, shipped in Phase 2 — see SPEC §12 line 425 and commits `a5102b6`/`6039b22`/`bb3d848`). No explicit `public_exits` declaration is needed; just leave the port unwired and it becomes a flow output. Two leaves with the same exit name merge into one public exit (merge-by-name); divergent types downgrade to `typing.Any` with a `merged_exit_type_mismatch` warning. The UI renders a ▾ chevron under each leaf handle as a visual cue.

### Subflow (`kind: "flow"`)

Embeds a child flow as a single step. `ref` is a dotted flow ID (`parent.child`). At runtime the child flow is invoked with the same input; its public exits map to this node's exits. The only composition primitive — there are no cross-graph node calls.

Subflow nodes also follow the Infer model: an unconnected exit port becomes a public exit of the parent flow.

### Start (`kind: "start"` — shipped in Phase 3)

A virtual entry sentinel (▶). Every flow declares exactly one start node — it is the flow's sole entry point. It holds no `ref`, no callable, no source file: the runtime short-circuits through its implicit `out` handle, passing the flow's input payload unchanged downstream.

- **Exits.** One implicit `out` whose type is the flow's declared input type. Authors set the type via the StartInspector (writes to `start.exits["out"]`).
- **Computed flow fields.** `FlowSpec.entry_node` and `FlowSpec.input_type` are `@computed_field` properties derived from the start node; they aren't stored in `flow.json`. Legacy top-level `entry_node` / `input` keys are stripped via `extra="ignore"`.
- **Diagnostics.** Zero or multiple starts surface `missing_start_node` / `ambiguous_start_node` (both errors). Invoking such a flow raises `WorkspaceError("no unique start node")` at the entry-check.
- **UI.** `StartNode` component renders a compact `▶ <shortName(input_type)>` pill with a single bottom handle (no top handle — flow begins here). `StartInspector` shows only an input-type field; no ref, no source, no exit list, no diagnostics panel.
- **Mutation rules.** Server refuses `DELETE /nodes/{start_id}` with HTTP 400 (structural, not permissive-posture). `AddNodeRequest.kind: Literal["python", "flow"]` — start cannot be user-added via the UI dialog. Rename is refused (structural invariant).
- **Snap eligibility.** Start IS a valid snap *source* (0 declared exits → implicit "out" → passes the existing `exits.length <= 1` filter). Start is NOT a valid snap *target* — no top handle exists.

Shipped commits: `5aebd0e` (backend), `fa9c69d` (StartNode), `3e3bcfe` (StartInspector), `c8238e5` (delete protection + snap + fitView padding).

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

---

## Design thread: Start + Feeder + Storage composition

*Open thread — not yet shipped.* Two observations that compose into a cleaner authoring loop for test data.

### Start inherits from Feeder

Today's `kind="start"` is a virtual sentinel: no attached data, runtime just passes the caller's payload through. A Start with a Feeder attached would do both jobs at once — trigger the chain AND hold a configured sample payload that fires when invoked without explicit input (e.g., "Run" from the sidebar without a paste-in-payload).

User's framing:

> *"wonder if start nodes could 'inherit' from feeder nodes, so they get the benefit of being able to pipe objects in while also being the trigger for starting the chain?"*

Clean factoring: Feeder is still the same attachment shape (🧪 pill); Start is still the same node kind. Adding a Feeder to a Start is just attaching the pill to that node. Runtime precedence: explicit `run_flow(payload)` still wins; Feeder payload only fills in when no caller-supplied payload is present.

Implications:
- No IR change to Start beyond what already exists. `kind="start"` + optional `attachments.feeder` field.
- Collapses the "Run" button's behavior: today it prompts for a payload or fails; with a Start-Feeder configured, it just runs with the feeder payload as the default.
- Production `Invocation Endpoint` attachments (deferred) would typically attach to a Start too, forming a triple: Start + Feeder (dev) + Invocation Endpoint (prod). Same node, different attachments active in different contexts.

### Feeder sources payloads from Storage

Today's Feeder holds a **static** sample payload — the dev pastes JSON into it. For non-trivial test cases (randomized records, realistic edge cases, large fixtures) users end up writing external Python scripts that generate test data, then paste the output back into the Feeder. Round-trip is awkward.

User's observation:

> *"perhaps feeder nodes should have some relationship with storage nodes, because this would let you create chains whose purpose would be to generate test cases basically, but it could all be done inline and in python, without having to run external scripts then paste them into the feeder nodes."*

Proposed direction: a Feeder can be configured to source its payload from a named Storage bucket instead of holding a literal value. Concretely:

- **Generator flow**: a regular flow whose purpose is producing test fixtures. Runs via normal nodes (`faker`, property-based generators, fixtures from `conftest.py`, whatever). Its output node has a `Storage` attachment writing to bucket `test_cases/high_risk` (or whichever).
- **Consumer flow**: the flow under test. Its Start node has a Feeder attached. The Feeder's config: "read one record from bucket `test_cases/high_risk`." Possibly with selection modes: random, round-robin, nth, latest, filter-by-predicate.
- **Net effect**: test data generation is a first-class flow authoring activity. No external scripts. No paste cycles. The same Storage-attachment mechanism that supports replay (per the existing Storage section) supports test sourcing.

This also blurs the production/test boundary in a useful way: a Storage bucket populated from real production runs can feed a Feeder for "re-run against real data," which is exactly the replay use case plus a Feeder indirection.

### What needs to be decided before shipping

- **Feeder payload schema**: static-literal vs Storage-reference vs both-available. Probably "both, via a tagged union in the attachment config."
- **Storage addressing**: flat bucket names vs namespaced-per-workspace vs namespaced-per-flow. Tension between reusability and isolation.
- **Storage record selection**: the Feeder needs a way to pick one record. Random? Latest? User-configurable predicate? Keep minimal at first — just "latest" — and extend.
- **Cross-flow references**: can Flow A's Feeder read from a bucket written by Flow B? Almost certainly yes, but there's a discoverability question (how does the user find which buckets exist). UI needs a "Storage browser."
- **Production behavior**: Feeders are dev-only. But a Feeder-sourced-from-Storage *could* be useful in prod as "use the last known good payload if upstream is down." Defer.

Captured `2026-04-19` in the post-Phase-3 discussion. Not yet prioritized against EDITOR_MERGE work or other Phase 4+ items.

### Update — unification + serialization tension (2026-04-19, same session)

Follow-on refinement: maybe Feeder isn't a separate attachment concept at all. **Storage units *are* the feeders.** The UI affordance is "choose which Storage option you want to pipe in," and that's the whole Feeder API. One concept instead of two.

User's framing:

> *"Could be the case that storage units are feeders, and you choose which storage option you want to pipe in?"*

This also settles the write-side question that was dangling: Feeders are **read-only consumers**, not producers. Storage attachments on regular nodes are the only write path. User:

> *"having feeders read from storage is nice, having feeders store things would be more undefined/dispersed probably."*

So the shape becomes:

- **Storage attachment (on a regular node)**: WRITE side. Every traversal of the node's exit persists a record to a named bucket.
- **"Feeder" (on a Start node)**: READ side. Points at a named Storage bucket; at invocation time, pulls one record and pipes it in as the flow input. May not even need a distinct pill — could just be the Storage pill in a "source" mode, or a single pill that picks direction by context (Start → read, regular node → write).

One concept, two roles picked by where it's attached. Much cleaner than a separate Feeder type.

### Serialization tension: Pydantic ↔ SQLite ↔ logs

Storage needs to persist `{exit, payload, timestamp}`. The payload is typically a Pydantic model. Two competing constraints:

User's framing:

> *"pydantic types are not super compatible with sqlite by default, maybe we will do pickles + file refs, but I also want logging to be able to benefit from sqlite, so unless we can come up with something absolutely genius may still need some sort of adapter between storage units and the node itself."*

- **Structured payloads** (Pydantic models, possibly deep/nested/union-typed) don't map cleanly to SQLite columns. Faithful round-trip likely requires pickle (or `model_dump_json()` if the user is happy with JSON-only) + file-ref storage. Binary blob per record, metadata row in SQLite indexing it.
- **Structured logs** (timestamp, level, node, edge, flow, trace id, etc.) are exactly what SQLite is good at — predictable columns, indexable, queryable via SQL.

Proposed direction — a **hybrid**:
- SQLite holds the metadata row per stored record: `(bucket, id, timestamp, exit_name, flow_id, node_id, type_ref, payload_ref)`. `payload_ref` is either `inline:<json>` for small/simple payloads or `file:<path>` for pickled blobs.
- On read: query SQLite for the matching record, resolve the payload_ref.
- Logs ride on the same SQLite DB (different tables) and get full query power.

Alternative: push the serialization decision down to the Storage attachment's config — "JSON only," "pickle blobs," "JSON with fallback to pickle." Let the user pick per-bucket based on what they're storing.

Either way, an **adapter layer between the Storage bucket and the node** is likely inescapable — the node emits a typed Pydantic value, the bucket stores bytes with metadata, and the Feeder (when it reads back) needs to reconstruct the typed value. Type reconstruction requires the `type_ref` to be recorded at write time and looked up at read time — which is exactly what `NodeSpec.exits[name]` already carries. So the adapter has a clean source of truth.

### Net shape after this refinement

- **Storage** is the single attachment. Present on any node (regular or Start).
- Attached to a regular node → WRITE mode: persist each `(exit, payload)` to a bucket.
- Attached to a Start node → READ mode (aka "Feeder" in the old vocabulary): at invocation, pull a record from a bucket and use its payload as the flow input.
- **No separate Feeder attachment.** The old Feeder-as-static-literal becomes "a bucket with one manually-inserted record," which is odd — so either keep a *lightweight* static-payload mode as a quality-of-life shortcut, or lean into always-use-a-bucket and ship a "paste-to-bucket" editor UI.
- **Adapter layer** between the node's typed value and the bucket's stored bytes. Uses `NodeSpec.exits[name]` as the type_ref for reconstruction. Serialization backend is hybrid: SQLite for metadata + indexing + logs, file-refs for pickled payloads when JSON-only doesn't round-trip.

Captured `2026-04-19`. Still pre-shipping; pushes the design closer to concrete but leaves the "genius serialization idea" seat open.
