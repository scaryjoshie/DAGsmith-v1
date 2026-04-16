# SPEC: Subflows, Chains, Fan-out, and UI Overhaul

**Branch:** `feat/subflows-chains-ui`
**Status:** Draft — pending alignment
**Depends on:** `docs/CORE_MODEL.md`, `docs/DESIGN.md`

This spec extends DAGsmith from its Phase 1 (single-flow, single-next-edge, spartan UI) state toward the Phase 2/Phase 6 vision in `DESIGN.md`. It is scoped as one branch delivered in staged commits, not one monolithic PR.

---

## 1. Goals

1. **Subflows (`kind: "flow"`)** — a node that references another flow by ID. Loader + runner support. UI lets you click in, shows breadcrumbs.
2. **Chains** — a UI-level shortcut for a linear run of Python nodes, collapsed into one visual block for legibility. Semantically still a plain DAG segment.
3. **Fan-out** — a single node exit may have multiple outbound edges. Execution is either **sequential** (default) or **concurrent**, with a prominent "order is not guaranteed, don't rely on it" warning surfaced in the UI.
4. **Switcher visual** — any node with ≥2 exits gets a visual "switcher" strip attached to the bottom of its body, with one port per exit. Single-exit nodes keep the plain bottom port.
5. **Drag-and-drop types** — a side palette lists types discovered under `types/` folders (flow-local, parent, workspace-root, shared). User drags a type onto a node's input, an exit, or a new edge to set its `type_ref`.
6. **Sidebar redesign** — the left panel always shows *where you are* (flow nesting path, selected-node context, exits, inbound edges) and the right panel shows *what you're editing*. Today's sidebar does neither well.
7. **Server split + safety** — break `server.py` into API/mutations/introspection layers; syntax-validate Python before write; re-run structural validation after every mutation.
8. **E2E test baseline** — Playwright-driven tests covering the headline interactions (add subflow, fan-out edge creation, drag a type onto an exit, navigate into a subflow).

## 2. Non-goals

- Actions / AST rewrite (Phase 3).
- Jedi / editor intelligence (Phase 4) — the spec assumes today's CodeMirror view-only mode continues.
- Compilation, exports, hot-reload of running flows, authentication.
- LOD zoom animations — subflow "zoom in" is implemented as navigation (enter/exit), not continuous zoom.
- Cross-flow refactoring (rename a type everywhere). Manual for now.

## 3. Authoring posture: permissive save, strict run

**The core stance:** the author can draw any edge, connect any ports, rename any node, leave any hole. Nothing is rejected at save time for semantic reasons. Violations render as **red in the UI** with a diagnostic, and running the flow fails at the point the violation actually matters — exactly how broken Python behaves.

Concretely:
- A cycle in the graph? Edges draw red. Save succeeds. Running raises at the second visit.
- An edge into a nonexistent node? Draws dangling and red. Save succeeds. Running raises when traversal hits it.
- An incompatible type on an edge? Edge red. Save succeeds. Runtime raises when the payload is produced.
- A multi-exit node with no selector/`emit`/default? Node red. Save succeeds. Running raises *only if that node actually gets executed and returns a plain value*.
- Python syntax error in a node file? That node red (can't import it). Save succeeds. Running any flow that routes through it raises. Other flows still work.

The only save-time rejections are **schema-level**: JSON must parse, required keys present, types of the right shape. Anything semantic is a diagnostic, not a wall.

### Decisions (post cross-review)

**D1. Fan-out is sequential-only in v1.** Engine-level concurrency is cut. Users who need parallelism write a Python node that calls `ThreadPoolExecutor` themselves — keeps the flow a pure function and keeps the runtime minimal. The spec still frames fan-out as "order not guaranteed, don't rely on shared side effects" so the edge annotation and UI warning remain; what goes away is the sequential/concurrent toggle.

**D2. Fan-out reaching multiple public exits → runtime error `MultiplePublicExitsReached`.** Design-time diagnostic, runtime exception. Return contract stays "one exit, one value."

**D3. No `default_exit` IR field.** A multi-exit node with no selector and no `emit` just gets a diagnostic ("routes undefined for plain return"); runtime raises if it actually returns a plain value at runtime. Avoids adding a new routing primitive beyond what `CORE_MODEL` already defines.

**D4. "Chain" → "group".** `layout.groups` (not `layout.chains`). Pure UI layout metadata. Name "chain" stays unreserved for a possible future executable-unit concept per `CORE_MODEL` §36.

**D5. Type palette via introspection.** Already-imported modules walked for type kinds. PEP 695 aliases a known gap; AST fallback later.

**D6. Diagnostics are grouped by root cause.** Every diagnostic has an auto-generated `id` and optional `derived_from: id | None` edge. UI collapses derived under root. One syntax error → many "unresolved ref" diagnostics → one visible root-cause entry.

## 4. IR extensions

### 4.1 `NodeSpec` changes

```python
class NodeSpec:
    kind: Literal["python", "flow"]
    ref: str
    input_type: TypeRef
    exits: dict[str, ExitSpec]
    selector_ref: str | None = None
    label: str = ""
    description: str = ""
```

- `kind: "flow"` now supported end-to-end. `ref` is a flow ID like `customer.onboarding.validate`.
- No new routing fields. Multi-exit nodes with no selector and no `emit` get a design-time diagnostic; runtime raises `AmbiguousRoute` if a plain return is actually produced.

### 4.2 `EdgeSpec` unchanged, fan-out is plural edges

No schema change. Today's model already permits multiple `EdgeSpec` entries with the same `(from_node, from_exit)` — the runtime rejects it implicitly by picking the first match. We change the runtime, not the schema.

### 4.3 Fan-out execution

No new IR field. Fan-out is simply "more than one edge with the same `(from_node, from_exit)`." Execution is sequential in the order edges appear in `edges[]`. The UI surfaces "order not guaranteed — don't rely on shared side effects" on fan-out ports so users don't treat sequential order as a contract. Concurrent execution is future work and is opt-in via user-authored Python nodes, not an engine feature.

### 4.4 Subflow resolution

- Loader resolves `ref` as a flow ID (dot-joined path), looks up the target flow.
- Missing ref → diagnostic; the node remains in the spec but is marked `unresolved`. Running through it raises `UnresolvedFlowRef`.
- Cross-flow cycles: detected by DFS at load time, emitted as a diagnostic on every node participating in the cycle. Running a cycle raises at the second visit.
- Subflow's `public_exits` vs parent node's `exits`: mismatches (missing exit name, incompatible `type_ref`) emit diagnostics on the parent node. Runtime raises on exit selection if the reached exit isn't declared on the parent.

### 4.5 Group grouping (UI-only, stored in layout)

```json
"layout": {
  "nodes": { "...": { "x": 0, "y": 0 } },
  "groups": [
    { "id": "validate_block", "node_ids": ["normalize", "validate_email", "validate_age"], "label": "Validate" }
  ],
  "viewport": { ... }
}
```

- Runner ignores `groups` (same as today's `layout`).
- UI collapses the listed nodes into one visual block when the group is "folded." Each node is still independently addressable; unfolding restores the DAG view.
- Groups work best on linear runs. Creating a group that spans a branch point is allowed — a diagnostic flags it, and the group auto-unfolds until the structure is linear again. The "any edge drawable" stance applies.

"Chain" is intentionally **not** used as the term. It's reserved for a possible future executable-unit concept.

### 4.6 Diagnostic model

A shared struct used by loader, validator, and UI:

```python
class Diagnostic:
    id: str                          # auto: f"{flow_id}:{code}:{node_id or edge_index}:{hash}"
    severity: Literal["error", "warning", "info"]
    code: Literal[...]               # typed enum — no free strings, UI renders icons by code
    message: str                     # human-readable
    flow_id: str
    node_id: str | None
    edge_index: int | None
    source_location: SourceLocation | None  # {path, line, col} for syntax errors
    detail: dict = {}                # e.g. {"expected": "EnrichedCustomer", "got": "Customer"}
    derived_from: str | None = None  # id of the root-cause diagnostic this cascades from
```

Diagnostic `code` is a closed `Literal` so UIs and tests can exhaustive-match. When a load-time failure cascades (one `syntax_error` → many `unresolved_ref` in downstream nodes), the derived diagnostics set `derived_from` to the root's id. UI collapses derived under their root.

Diagnostics are computed at load and re-computed after every mutation (debounced; layout-only writes skip recomputation). Exposed at `GET /flow/{fid}/diagnostics` and `GET /workspace/{w}/diagnostics` (full graph; cross-flow causation means a per-flow view alone loses root-cause visibility).

Nothing in the load path throws for a semantic issue — only for JSON parse errors and request-schema shape violations.

### 4.7 Per-node import isolation

Node modules are imported individually with failure containment. If `nodes/validate_email.py` has a `SyntaxError` or import-time exception, that node's entry in `Workspace.callable_refs` is set to an `UnresolvableRef(diagnostic=...)` sentinel. Other top-level node modules still load.

**Caveat (be honest about the limit):** isolation is at the *node entry module* granularity, not transitively. If `validate_email.py` imports `shared/utils.py` and `utils.py` has a syntax error, every node whose module imports `utils.py` fails too — same as Python. The loader cannot make a broken helper selectively broken for some consumers. This is documented, not engineered around.

Implementation: use `importlib.util.spec_from_file_location` for node modules so failures are caught locally; shared helpers import normally via `importlib.import_module` with their failures captured as `syntax_error` diagnostics cascading (via `derived_from`) to every node that references them.

## 5. Runtime semantics

### 5.1 Subflow execution

`runtime._resolve_node_result` gains a branch: if `node.kind == "flow"`, look up the subflow in the workspace and invoke `run_flow(workspace, subflow_id, input_value)`. The subflow's reached public exit becomes the parent node's exit. Payload flows unchanged.

### 5.2 Fan-out execution (sequential only)

Implementation replaces today's single-next linear walk in `runtime.py` with a work-queue:

1. Initialize `queue = deque([(entry_node, input_value)])` and `visited: dict[str, Any] = {}`.
2. Pop `(node, payload)`. If `node in visited`, skip (first-writer wins — this is the merge point; deterministic because insertion order is edge order).
3. Run the node; record `visited[node] = result`.
4. Resolve exit (plain → `out`; selector → exit; `emit(...)` → exit; `AmbiguousRoute` if multi-exit plain with no selector).
5. Enqueue `(target, value)` for every edge matching `(node, exit)`. Multiple matches = fan-out.
6. When queue empties, return the payload from the node that reached a `to_flow_exit`.

If two different `to_flow_exit` targets are reached (fan-out without merge) → raise `MultiplePublicExitsReached`. Design-time diagnostic plus runtime exception.

Net diff vs today: ~30-40 lines. No lock, no executor, no tracer concurrency concern.

### 5.3 Tracer hook (foundation for checkpointing)

Add an optional `tracer` argument to `run_flow`. When provided, called on each edge crossing with `(flow_id, from_node, from_exit, to_node_or_exit, payload)`. No-op if absent. Keeps the hot path clean. Actual checkpointing UI is out of scope for this spec.

### 5.4 Cycle detection

- Within a flow: DFS at load; emit diagnostics on every edge/node in the cycle. No longer a hard load rejection — user can save a cyclic graph, UI draws it red.
- Across flows: same treatment — DFS over subflow refs, diagnostic per participating node.
- Within a run: the visited-map skip (§5.2 first-writer-wins) is also the cycle container. A true in-invocation cycle simply drains the queue without reaching any public exit → the runner raises `WorkspaceError("terminated without reaching any public exit")`. No dedicated `CycleDetected` exception — the merge skip and the cycle skip are the same mechanism, and the "no exit reached" error is the naturally honest diagnosis.

## 6. Server changes

### 6.1 Split

**First step (before file split):** extract the module-global workspace cache into a small `WorkspaceRegistry` class with explicit `get/reload/list` methods. Today `_reload_workspace()` is called from four endpoints and mutates a module global; splitting routes across files without extracting the cache first just scatters the global. Do the extract, *then* split.

```
src/dagsmith/server/
  __init__.py          # re-exports `create_app`
  app.py               # FastAPI wiring, CORS, lifespan
  registry.py          # WorkspaceRegistry (preloaded workspaces, reload)
  routes_read.py       # GET /workspaces, /workspace/{w}/flows, /flow/{...}
  routes_mutate.py     # POST/DELETE node, edge, layout, group
  routes_run.py        # POST /run, /run/trace
  routes_introspect.py # source, type palette, diagnostics
  mutations.py         # atomic JSON writes, stub creation
  introspection.py     # ref → source file, type discovery, ref resolution
```

Today's `server.py` stays as a thin shim that imports `create_app` for backwards compatibility.

### 6.2 New endpoints

- `GET /workspace/{w}/types` — introspected type palette. Returns `[{qualified_name, kind, module, source_file, is_generic}]` sorted by scope (flow-local → parent → workspace → shared).
- `POST /flow/{fid}/group` / `DELETE /flow/{fid}/group/{group_id}` — manage layout groups (node folding).
- `GET /flow/{fid}/diagnostics` — list of `Diagnostic` for this flow, with `derived_from` edges intact so the UI can render root-cause trees.
- `GET /workspace/{w}/diagnostics` — full workspace diagnostics. Needed when a root cause in flow A cascades into flow B.
- `GET /flow/{fid}/tree` — flow nesting tree (for sidebar breadcrumb + subflow nav).

### 6.3 Safety (permissive posture)

- Mutation endpoints **save regardless of semantic validity**. After write, re-run diagnostics; return the diagnostic list in the response so the UI re-renders red state immediately.
- Only reject for: malformed JSON body, missing required keys, type-shape violations of the *request* schema.
- Python source writes: `ast.parse()` is called, but a syntax error does **not** reject the write — file saved as given, node flagged with `syntax_error` diagnostic, subsequent runs through that node raise.
- Default bind host `127.0.0.1`; CORS permissive for local dev.

### 6.4 Current-code permissive-save gaps (M3 scope)

The reviewers identified seven places in today's code that break the permissive posture. All must be relaxed before shipping:

1. `FlowSpec._check_shape` (model.py) — raises on `entry_node not in nodes`. → Diagnostic.
2. `NodeSpec._check_exits` (model.py) — raises on empty `exits`. → Diagnostic.
3. `_validate_flow_structure` (workspace.py) — raises. → Produces diagnostics.
4. `_resolve_ref` (workspace.py) — raises on malformed or missing refs. → Returns `UnresolvableRef(diagnostic=...)`.
5. `load_workspace` (workspace.py) — aborts on any `FlowSpec.model_validate` failure. → Store broken flow as a sentinel so other flows still load.
6. `update_node_source` (server.py) — uses `inspect.getsourcefile(func)`, fails when ref is unresolvable. → Resolve source path from the `ref` string via `importlib.util.find_spec`.
7. `add_edge` (server.py) — rejects duplicate `(from_node, from_exit)`. → Allow; duplicate edges = fan-out per §4.2.

Each has a targeted test in M3.

## 7. UI

IDE-style layout. No persistent right sidebar — editing happens either inline on the canvas (quick edits) or via a **split pane** (heavier edits, source code, subflow viewing). VS Code pattern.

- **Left sidebar** — persistent. Inheritance tree + types palette + diagnostics summary + primary controls (Run, Add Node).
- **Top tab bar** — open views. Each opened flow or source file is a tab. Close, reorder, **split** (drag tab to canvas edge or right-click → "Split right / down").
- **Canvas** — the active tab (or active tabs, when split). A flow canvas, a source editor, or a subflow canvas.
- **Inline popover** — small floating card on the canvas for quick edits (rename, type drop targets, add/remove exit). Appears on selection; dismisses on click-away.
- **Floating run panel** — overlay at the bottom of the canvas when a flow runs; dismissable.

### 7.1 Left sidebar (persistent)

Four sections, stacked, each collapsible:

1. **Workspace** — picker at the top (stays today's dropdown).
2. **Flow tree** — the inheritance / nesting view. Workspace → flows → subflows. Current flow highlighted; click to open as a top tab; click a subflow node to enter it.
3. **Types palette** — types discovered by introspection, grouped by scope (flow-local → parent → workspace → shared), searchable. Drag-drop source. Collapsed by default once the user isn't actively editing types.
4. **Diagnostics** — workspace-wide summary count (errors/warnings), expands to a root-cause-grouped list. Click any entry to focus the offending flow + node.

**Controls pinned at the bottom of the sidebar:**
- **Run** (primary button; red dot + preflight modal when the active flow has errors on the entry-reachable subgraph).
- **Add Node**.

Sidebar is user-resizable; can collapse to a thin rail for max canvas.

### 7.2 Top tab bar (open views, splittable)

- Every opened artifact is a tab. View kinds in M5-M8: **flow canvas**, **source file**. (Future: types view, diagnostics view, trace view — tab system is extensible.)
- Open a tab by clicking a flow in the left tree, by double-clicking a Python node (opens its source file), or by entering a subflow via a subflow node.
- **Split:** right-click a tab → "Split right" / "Split down," or drag a tab to a canvas edge. The canvas area splits into two (or more) panes, each with its own tab set. Close the last tab in a pane to collapse the split.
- Tabs are closeable (X / Ctrl+W), reorderable, and survive refresh (persisted in local state).
- Canvas tabs show the flow's breadcrumb (`customer ▸ onboarding ▸ validate`) in the tab label; source tabs show the filename.
- Switching tabs preserves each tab's viewport, selection, and scroll.

**Common splits:**
- Canvas left, source file right — when editing a node's code while keeping the graph visible.
- Parent flow left, subflow right — when debugging across levels.
- Two flows side-by-side — when comparing or copying structure.

### 7.3 Inline popover (quick edits on canvas)

Selecting a node or edge shows a small floating card anchored to the selection. No persistent sidebar. Closes on click-away. Contents by selection:

| Selection | Popover content |
|---|---|
| **Node** (python) | Label (inline-editable), input type (drag-drop target), exits list (add/rename/delete, each is a drop target), "Open source →" action (opens source as a new tab; Shift-click opens as a split). |
| **Node** (flow-kind subflow) | Label, input type, ref to subflow ID, "Enter subflow →" (opens subflow canvas as new tab; Shift-click splits). |
| **Edge** | Source handle, target handle, inferred carried type (if resolvable), delete. |
| **Flow background** | "Flow contract" action → opens the flow's `input` + `public_exits` edit view as a new tab. |

Why not a sidebar: the popover stays close to what the user is editing, doesn't steal canvas width, and keeps quick edits quick. Heavy editing (source, full contract editor) is always "open as a tab," which can then be split.

### 7.4 Switcher strip

Unchanged from prior spec:
- Nodes with ≥2 exits render a `<SwitcherStrip>` anchored to the bottom edge — one port per exit, labeled, horizontally distributed, auto-widens the node.
- Single-exit nodes keep the plain bottom port.
- Matches classic flowchart vocabulary (diamond-at-the-bottom semantics, minus the diamond shape which doesn't scale to 3+ exits).

### 7.5 Fan-out edge UI

- Dragging a second edge from an already-connected switcher port creates a second edge (fan-out), not a replacement.
- Fan-out ports show a small fork/chevron badge to signal multiplicity.
- First fan-out edge on a port surfaces a dismissable warning pill: "Fan-out: order is not guaranteed. Don't rely on shared side effects." Dismissed per-port; re-surfaces if the port is edited later.
- No concurrent/sequential toggle (dropped — see D1). Port just fans out sequentially.

### 7.6 Drag-and-drop types

Type palette lives in the **left sidebar's Types section** (§7.1 (3)). Drag targets:

- Drop on a node in the canvas → sets `input_type`.
- Drop on an exit port → sets that exit's `type_ref`.
- Drop on an edge → promotes to the destination node's input type (the user's intent is "this edge carries X," which semantically lives on the target node's input). A subtle toast confirms.
- Drop on a row in the inline popover's exits list → sets that exit's type. Primary flow when editing an already-selected node.
- Drop on blank canvas → no-op.

Each type pill shows qualified name, icon-per-kind (Pydantic/dataclass/enum/etc.), and a scope color (flow-local/parent/workspace/shared).

### 7.7 Diagnostic rendering (red/amber)

**Canvas:**
- **Root error** diagnostics render their node with a red outline + red title-bar tint + ⚠ badge.
- **Derived** diagnostics (with `derived_from` set) render their node in **amber**. Glanceable triage: red = fix this, amber = this will clear up once red is fixed.
- Edges with error diagnostics (dangling target, cycle participant, type mismatch) render red + dashed. Fully editable.
- Warnings are amber/dashed for non-cascading issues (e.g. unused exit).

**Left sidebar Diagnostics section (§7.1 (4)):**
- Workspace-wide count at the header. Expand to see a root-cause-grouped list.
- Root causes listed bold; derived diagnostics indented and collapsed under their root by default.
- Click any entry to focus the flow (switches top-tab if needed) + node/edge.

**Inline popover per-node diagnostics:**
- When a node is selected, its own diagnostics appear in the popover below the exits list — compact summary with click-to-expand for details. No cross-flow context, just "what's wrong with this one."

**Preflight on Run (left sidebar bottom):**
- Run button shows a red dot when error-severity diagnostics exist on the entry-reachable subgraph of the active tab's flow (client-side BFS over edges; no server call).
- Clicking Run with errors present → lightweight modal: "This run will likely fail at `validate_email` (unresolved_ref). Run anyway?" One checkbox, "always run without asking." Dismissed once, don't nag.
- Clicking Run with no errors → runs directly, no modal.
- Runs never blocked. The modal is a nudge.

### 7.8 Group folding

- Select ≥2 linear nodes → "Group" button in a floating selection toolbar (or right-click menu). Prompt for label.
- Group renders as one rounded-rect block with label + node count; double-click unfolds (dashed enclosure on unfold so grouping is still visible).
- Grouping across a branch point is allowed: a diagnostic appears, group auto-unfolds until structure is linear again. "Any edge drawable" applies.
- If your branch is tight on M6, group folding is the first cut — not critical path.

## 8. Testing

### 8.1 Backend

- `tests/test_model.py` — extend for `default_exit`, fan-out edge collection, `fanout_policy` field.
- `tests/test_runtime.py` — new: subflow execution, sequential fan-out, concurrent fan-out, merge after fan-out, cycle across flows.
- `tests/test_workspace.py` — new: multi-flow workspace loading, subflow ref resolution, cycle rejection, exit compatibility check.
- `tests/test_server.py` — new: all mutation endpoints, syntax validation rejection, type palette listing.

### 8.2 Frontend

- Install Playwright into `frontend/` as a dev dep. Chromium only.
- `frontend/tests/e2e/` — new:
  - `canvas.spec.ts` — add node, add edge, delete both
  - `fanout.spec.ts` — drag second edge from same port, verify warning appears
  - `subflow.spec.ts` — enter/exit subflow via breadcrumb
  - `types.spec.ts` — drag a type onto an exit, verify `flow.json` updates via API poll
  - `switcher.spec.ts` — multi-exit node shows switcher strip with correct port count
- Backend started via a Playwright `webServer` block using the existing `dagsmith ui` CLI against the `examples/customer` workspace.

## 9. Milestones

Each milestone is a set of commits on this branch. No commit is created without tests passing and the feature being demoable.

**M0 — Spec + infra.** This doc, branch, Playwright scaffold.

**M1 — IR.** `kind:"flow"` support, `layout.groups` field, `Diagnostic` shape (with `derived_from`, typed `code`, `source_location`), `UnresolvableRef` sentinel. Relax model validators per §6.4 (1) and (2). Model tests.

**M2 — Runtime.** Subflow execution, sequential fan-out via work-queue, visited-nodes merge, `AmbiguousRoute` + `MultiplePublicExitsReached` exceptions, tracer hook, cross-flow cycle detection as diagnostic. Runtime + workspace tests.

**M3 — Permissive loader + server registry.** All seven §6.4 gaps relaxed. Extract `WorkspaceRegistry` from the server module global. Load + workspace tests confirm a malformed flow.json, a broken Python module, an unresolvable ref, and a fan-out edge all load without aborting the workspace.

**M4 — Server split + new endpoints.** Split into `server/` package. Types palette, flow tree, diagnostics (per-flow + per-workspace), group CRUD. Server endpoint tests.

**M5 — UI shell.** Left sidebar (workspace picker, flow tree, types palette placeholder, diagnostics placeholder, Run + Add Node). Top tab bar with tab-split support. Flow canvas and source tabs. Inline popover on selection. Floating run panel. No switcher/fan-out/types-wiring yet — this milestone is chrome and nav only.

**M6 — Switcher + fan-out + diagnostic rendering.** Switcher strip, fan-out edge visuals + warning pill, red/amber node rendering, root-cause grouped diagnostics section in left sidebar, per-node diagnostics in popover, Run-button preflight modal.

**M7 — Drag-and-drop types + subflow navigation.** Types palette section in left sidebar, drag targets (node, exit port, edge, popover exits list), subflow-node "Enter subflow" opens new tab / split, flow-tree subflow highlighting.

**M8 — Group folding + Playwright baseline.** Group UI (cut first if time-constrained). All e2e specs passing. Fix rough edges surfaced during M5-M7.

## 10. Migration

- Existing `examples/customer` flow: nothing to migrate. No IR fields added that require updates.
- Add a second example `examples/fanout_demo` exercising sequential fan-out, a subflow, and a group — doubles as a Playwright fixture.
- `minimal` example untouched.

## 11. Risks

- **Scope creep.** M5-M7 are frontend-heavy and easy to over-polish. Budget: each milestone lands in ≤4 commits.
- **Diagnostic noise.** Even with root-cause grouping, a large broken workspace could surface dozens of amber derived nodes. Mitigation: auto-collapse derived in the Diagnostics tab; canvas amber is low-saturation.
- **Subflow type compatibility.** String comparison on `type_ref` is brittle when types move modules. Mitigation: when both sides of a compatibility check resolve to real classes, compare classes; fall back to string match only when one side is unresolvable. Lift `_resolve_type` from server.py to workspace.py to share logic.
- **Per-node isolation limit.** Shared helpers that crash break all consumers — documented, not engineered around. Risk is "user thinks isolation is transitive and is surprised."
- **Playwright readiness.** `dagsmith ui` CLI blocks on `uvicorn.run` with no stdout signal. Mitigation: poll `/api/workspaces` for 200 as the readiness probe; use a unique port per test run to prevent cross-contamination.

## 12. Future (not in this spec)

Out of scope for this branch but worth capturing so we don't redesign them away:

- **Checkpointing.** Phase 2 per `CORE_MODEL.md` §Checkpoints. Tracer hook is already introduced in §5.3 as the foundation — every edge crossing calls the tracer, so edge-snapshot checkpointing is a matter of adding a concrete tracer impl, persistent storage, and a resume API. No further IR change needed.
- **Live execution visualization.** When a flow runs (or steps), the active edge animates — flowing dashed line, payload badge floating along it, the executing node pulses. Implementation hook: tracer emits events over WebSocket to the frontend; React Flow edges gain an `isActive`/`flowPhase` prop. Non-live execution stays unchanged — this is purely a UI overlay on top of the tracer.
- **Step / step-into / resume.** UI controls alongside Run — step one node, step into a subflow, pause, resume from a checkpoint. Depends on checkpointing infra.
- **Concurrent fan-out.** Explicitly cut from v1 (D1). If a real use case emerges, either a new node kind ("parallel fan-out") or per-port opt-in with a different visual treatment. Sequential fan-out's "order not guaranteed" framing keeps the door open.
- **Action system.** Phase 3 per `DESIGN.md`. AST rewrite, anchors, observer snippets. Completely orthogonal to this spec.
- **Editor intelligence (Jedi).** Phase 4. Synthetic-prefix completions for node source and, later, actions.
- **LOD zoom.** Continuous zoom-to-subflow instead of tab-based navigation. Non-goal today; real nesting UX once the base navigation is comfortable.
- **Trace view tab.** A dedicated tab kind that shows the edge-payload history of the most recent run — deep-link into checkpoint data, re-run from any point. Natural pairing with live-exec animation.
- **Types registry.** `type_ref` comparison today is string-based with a class-resolution fallback (§11). A real registry lets rename refactors propagate.

Each of these has at least one hook already in the spec (tracer, `Diagnostic`, tab system, left-sidebar sections), so adding them later does not require re-architecture.

## 13. Ready-to-start checklist

- [ ] User reviews §3 decisions (D1-D6); overrides any they disagree with
- [ ] User signs off on §7 UI shape (left sidebar + top tabs with splits + inline popover, no right sidebar)
- [ ] User signs off on milestone ordering
- [ ] Install Playwright in `frontend/` (`npm i -D @playwright/test && npx playwright install chromium`)
- [ ] Begin M1
