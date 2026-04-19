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

### Update — two substrates + pickle-BLOB model (2026-04-19, same session)

Third round of refinement. The thread has collapsed into a concrete-enough shape that someone could implement it. Details will change; the core idea is stable.

#### The core idea

**Store state. Let rows play back.** A storage unit persists payloads from flow runs. Every stored row is independently playable — click it, it seeds a flow invocation. That single move unifies three concerns into one mechanism:

- **Test fixtures** — rows authored by a generator flow or hand-curated, browsable via the UI, clickable to invoke the flow under test
- **Replay / debugging** — rows captured from production runs via a Storage write-attachment, clickable to reproduce failures
- **Dev interactive loop** — rows from prior runs available as "last known good input" without copy-paste

User's framing:

> *"rows of the database are fully playable (as in they alone, as well as manual injection, serve as the ways to start the pipeline)"*

A bucket browser in the UI exposes rows with a ▶ play affordance; combined with Start-node attachment, playing a row is equivalent to calling `run_flow(payload)` with the row's content. The previously-planned `Feeder` concept collapses entirely into "a Start node pointing at a Storage bucket."

#### Two substrates

- **ObjectStore** — the typed bucket store. Payloads are Pydantic-model (or arbitrary Python object) instances; round-trip is via pickle. Typed buckets: each bucket declares a `type_ref` on creation, writes validate, reads return that type. Primary substrate for flow plumbing (write-attachment on regular nodes, read-attachment on Start nodes). Playable.

- **SQLStore** — arbitrary user-defined tables accessed via Python's native `sqlite3` / SQLAlchemy / etc. Intentionally unconnected from the typed-bucket abstraction. Primary home for logs (the planned `Log` attachment writes here) and analytics queries.

  User's clarification:

  > *"my intention was for SQL storage to mainly be for use during dev testing. we'd want to find a way to remove the portions of the flows that are only for dev testing when pushing to prod."*

  SQLStore is dev-only by intent. If a user wants to feed SQL rows back into a flow they can write an adapter, but that's opt-in; the default shape is "SQL rows stay in SQL."

Both substrates share a single SQLite database file (`<workspace>/.dagsmith/store.db` or similar). ObjectStore uses a single conventional `object_store` table; SQLStore uses arbitrary user tables in the same DB.

#### ObjectStore schema (pickle BLOB inline, no file-refs)

```
object_store(
  id INTEGER PRIMARY KEY,
  bucket TEXT,
  timestamp REAL,
  type_ref TEXT,         -- canonical type for reconstruction (same shape as NodeSpec.exits[name])
  display_json TEXT,     -- JSON-nickname for bucket-browser preview; fallback to repr() if not JSON-serializable
  payload BLOB,          -- pickle bytes, inline
  pointer_refs JSON      -- nullable; list of object_store.id references for compound rows
)
```

User's framing on the write model:

> *"honestly it's not too difficult to store as a pickle object (and still make it so that you can store all your objects across the project in one SQLite database). the idea is that you'd store either a json list of pointer refs to pickle objects, or store the ref to a pickle object which is a tuple."*

Rationale for BLOB-inline over pickle-files-on-disk:

- **Small payload regime.** DAGsmith's expected payload sizes (test cases, replay records) are 1–10 KB pickled, with compound rows reaching maybe 100 KB. SQLite handles this range in single-digit microseconds per read.
- **Operational simplicity.** One file per workspace. No orphan file GC. Atomic insert in one WAL commit. Backups and `git-LFS`-able moves trivial.
- **Write overhead.** File-per-pickle incurs inode + dirent + fsync costs per record. SQLite WAL batches these.

Deferred optimization: if a user stores very large payloads (>5 MB per record), introduce a file-tier — write to `<workspace>/.dagsmith/blobs/<sha256>.pkl` and store a tagged ref like `b"FILE:<path>"` in the `payload` column. The reader detects the tag and fetches accordingly. **Not in v1.** File-tier opens the door to orphan-file GC, which we don't want to solve until forced.

#### Pointer refs — optional compositional shape

Most rows: `pointer_refs` is NULL, `payload` is a single pickled value.

Compound rows: `pointer_refs` is a JSON array of `object_store.id` values, each referencing another row. The top-level `payload` can be a pickled container (tuple, list, dict-by-key-string) whose elements ARE the referenced rows' payloads — or just a pickle of the composite structure directly with the pointer_refs acting as a dependency index.

Use cases this enables:
- Customer + orders + settings → one Test row referencing three payload rows
- Multi-step run captures → one "run" row referencing the sequence of emitted values
- Fixture composition → a Test row that references and combines smaller Fixture rows

Consumer / adapter decides whether to traverse pointer_refs or treat the top-level payload as opaque.

#### Single-column-per-row — topology concerns live in the graph

Base case locked: **1 storage row = 1 payload = 1 type**. Multi-exit producers, multi-input consumers, fan-out consumers — all of that is the graph's job, not the store's.

User's framing:

> *"if a storage unit is by itself playable, what if it wanted to play into a function with multiple inputs, or play into multiple chains? then it might make sense for there to be multiple exits, although perhaps this is the point of an adapter, and the base case of 1 storage 1 col 1 var should hold?"*

Resolution:
- **Play into multiple chains** → fan-out from the Start node's outgoing handle. One payload, multiple downstream paths. Already supported by the edge model.
- **Play into a multi-input function** → the future multi-param join feature (OPEN in CHANGES_2026-04.md) handles this in the consumer node, not the store. The store delivers one value; the join consumes from multiple upstreams (possibly multiple Storage buckets).
- **Reshape before consumption** → write a normal Python adapter node downstream. Takes the typed value out, produces whatever the next node wants.

Keeps the store simple and pushes complexity into graph topology, where it's already handled.

#### Adapter layer — type transformation, not serialization

Two concerns that should stay separate:

- **Serialization**: `payload BLOB ↔ typed Python object`. Framework plumbing. User never writes it. Storage uses the `type_ref` column to reconstruct at read time.
- **Transformation**: `bucket_type ↔ consumer_input_type`. User logic, only required when the bucket holds type `A` and the consumer expects type `B`. A normal Python node downstream of the Storage read-handle.

When types match → no adapter, identity pipe.
When types differ → user writes an adapter node (just a normal `kind="python"` node).

The adapter isn't a special primitive. It's just the place in the graph where type transformation happens, named explicitly.

#### Dev/prod separation (deferred, but flagged)

User:

> *"we'd want to find a way to remove the portions of the flows that are only for dev testing when pushing to prod."*

Two proposed axes, for whenever packaging-for-prod becomes a real workflow:

- **Per-flow flag**: `flow.dev_only: bool`. Whole flows (e.g., a generator flow that only exists to populate a test bucket) get excluded from prod packaging.
- **Per-attachment scope**: `attachment.scope: "dev" | "prod" | "both"` (default `both` for most, `dev` for SQLStore-write attachments). Fine-grained control over which attachments fire in which environment.

Initial implementation ignores this — assume "dev mode" is the only mode. Add the scope flags when a real prod-packaging path lands. Not a v1 blocker.

#### What v1 looks like concretely

A minimal shippable ObjectStore + playable rows:

1. **Backend**: `dagsmith/store.py` with `ObjectStore` class managing `<workspace>/.dagsmith/store.db`. API: `write(bucket, payload, type_ref, display_json, pointer_refs=None)`, `read(bucket, id)`, `browse(bucket)`, `play(bucket, id) → triggers flow run`.
2. **IR / attachment**: `NodeSpec.attachments.storage` optional field, records bucket name + direction (write on a regular node, read on a Start node).
3. **Runtime**: on each traversal of a node with a write Storage attachment, persist `(exit, payload)` to the configured bucket. On invocation of a flow whose Start has a read Storage attachment + no explicit caller payload, pull latest (or selected) row and use as input.
4. **UI**: a new Storage sidebar section listing buckets. Click a bucket → bucket browser (row list with display_json previews). Row row ▶ button → invokes flow with that row's payload. Storage pill on nodes when attachment present.
5. **SQLStore** skipped in v1 — all that's needed for the playable-rows core is ObjectStore.

#### The remaining open questions

Still undecided (but not blocking a v1 start):

- **Bucket namespacing**: flat-workspace-wide (one bucket per name) vs per-flow. Leans flat with a UI discovery layer.
- **Record selection policy on read**: "latest" only in v1; later add random, round-robin, predicate.
- **Bucket retention**: max-rows / max-age policy. Not v1; ship with unbounded, add knobs when someone needs them.
- **Cross-workspace bucket sharing**: probably out of scope forever. One DB per workspace.
- **Schema migration**: when the ObjectStore schema changes, existing rows handled how? Simplest: always recreate on schema version bump (dev tool, throwaway data). Re-evaluate if it ever becomes production state.
- **Concurrency**: one SQLite writer at a time (it's an exclusive lock). Fine for interactive dev; might matter if production Storage writes are high-throughput. Defer.

---

Captured across three turns on 2026-04-19. The shape is concrete enough to start implementing, though details are all still negotiable. Core invariant: **rows are playable, and that drives the whole UX.**
