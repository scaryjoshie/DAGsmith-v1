# Changes — April 2026 session log

This is a living log of everything implemented and decided since the UX redesign started. Each section captures what changed, why, and the user's reasoning where expressed. Honest about things that shipped broken and had to be fixed.

---

## Implementation work

### Dockview migration

The original shell used a hand-rolled `PaneTree` + `TabsProvider` + `@dnd-kit` split-pane system. It had a known single-tab split bug (splitting with one tab open collapsed the origin pane) and the tab state got unwieldy to reason about. The migration replaced it with [dockview](https://dockview.dev), an established library for IDE-style multi-pane split layouts.

- `b0a8392` — background bleed fix (dockview panel bodies were leaking behind panel borders)
- `287431b` — wired panel rendering to `FlowPanel` component
- `952386d` — active-panel sync: `onDidActivePanelChange` feeds the app-level `activeFlow` state
- `25f818a` — layout persistence: dockview serializes to `localStorage` per workspace on `onDidLayoutChange` (debounced 400ms)
- `100874f` — removed legacy `PaneTree` / `TabsProvider` / `@dnd-kit` tab code
- `226b752` — reconcile panels on workspace switch + source panel wired through dockview

A split-pane registry stomping bug emerged: `flowRefetchRegistry` and `panToNodeRegistry` were keyed by `flowId`, so opening the same flow in two split panes meant both shared the same registry entry and one would stomp the other. Fixed (`e26a7a9`) by keying registries on `panelApi.id` (dockview's per-panel unique ID) instead of `flowId`.

### Polish pass

- `eff3ffc` — types palette in the left sidebar
- `10aea1b` — node selection ring + terminal styling cleanup
- `426ce5e` — Inspector moved to the right sidebar (3-column Shell grid)

### Grid snap + switcher flex width (`7fb1bad`)

Node drag snaps to a 20px grid, giving the canvas a more structured feel without locking positions completely. The switcher strip (bottom exit bar on multi-exit nodes) was also made flex-width so exit pill labels don't get truncated on long names.

### Snap-stacking feature

The most involved visual feature of this session: nodes can be dragged close together and "stack" — their handles connect flush with zero visual gap, representing a tight data handoff. The feature went through several iterations:

- `7ccd770` — initial snap-stacking: proximity threshold triggers a snap
- `f02a5c6` (T1-i) — allow snap between already-connected node pairs (was previously refused)
- `eec7f69` (T2-a) — fixed a network error on snap (the snap mutation fired before the layout had settled)
- `d58bcb1` (T2-b) — visual fusion of snapped-stacked nodes (shared border, no gap rendering)
- `9678fb3` (T2-c) — dragging the top node of a snapped chain moves the whole chain
- `6ee1efb` (T4-a) — fixed drift: after a snap, nodes would visually drift a few pixels from their stated positions on re-render
- `cf341a3` (T4-b) — chain-snap follower state: when a chain head snaps to a new target, all followers update their snap relationships correctly

**Known limitation:** an edge between two flush-stacked nodes has a zero-width interaction area — it's visually invisible and can't be clicked. The stacked layout makes the edge unnecessary visually, but it's still in the data model.

**Snap-stealing** (when you drag a node close to a node that's already snapped to something else) currently refuses the snap by default. A shift-modifier to override was discussed but not shipped.

### Node size, arrow visibility, handle position (`cca5923`)

Node boxes were made slightly taller; the exit arrows were made more visible (increased opacity + slight scale); handle positions were moved to cleaner attachment points on the node border.

### Edge interactions

- `446765a` (B2) — edge reconnect: dragging an edge endpoint to a new node rewires the edge
- `6c7d387` (T1-d) — edges are clickable and deletable; edge handles appear on hover
- `485b9da` — edge-type warning: edges to untyped targets get a visual indicator

### Auto-fit and toast

- `3c07333` (B4) — auto-fit viewport on flow load (shipped, then broke)
- `ecdee02` — B4 fix: the auto-fit fired before nodes had rendered positions, causing it to fit an empty bounding box; fixed by waiting for layout to stabilize
- `a5b0e34` (B5) — floating toast for mutation errors (first pass)
- `52567b4` — B5 fix: toast z-index and positioning
- `ed3b458` — real floating `Toast` component (`position: fixed; top: 12px; left: 50%`) replacing the inline canvas-blocking error banner

The B4 auto-fit broke and was fixed twice. The first fix moved the fit call into a `useEffect` with a `setTimeout`; the second adjusted the dependency list to avoid double-firing on re-renders.

### Editing system

The Inspector (first as a bottom bar, then as a right sidebar) grew progressively through this session:

- `c465006` (A4) — node rename via Inspector
- `6f1db99` (A5) — ref + input type editing
- `8d6aa3e` — A4/A5 bug fix: a transient crash where `shortName` was called on `undefined` (the selected node's data wasn't yet loaded when the Inspector mounted)
- `9646004` (A6) — exit add/remove in Inspector
- `4b5fe69` (A7) — diagnostics sidebar: per-flow diagnostic list in the left sidebar
- `adabc01` (A8) — diagnostic badge on selected node in Inspector (severity dot + count)
- `4274d69` (A9) — run preflight modal: errors block run, warnings ask for confirmation, clean goes direct
- `c340e70` (B7) — severity border: error nodes get a red left border, warning nodes get amber
- `92eb55d` (B8) — fan-out edge revert + count: instead of drawing all fan-out edges explicitly (visually overwhelming), show a count badge on the exit handle
- `073abcf` — type_mismatch backend emitter: `_validate_flow_structure` in `workspace.py` now emits `code="type_mismatch" severity="warning"` with `edge_index` when exit type ≠ target input type (both non-`typing.Any`). The frontend's red-edge rendering was waiting for this.

**Note on type_mismatch severity:** the diagnostic is `warning` (not `error`) because type incompatibility doesn't prevent execution — Python's duck typing means it might still work. The frontend renders the edge red regardless of severity level, which is a display choice. This asymmetry is intentional but worth revisiting.

### Tier 1 redesign

- `e26a7a9` (T1-a) — registry keyed by panel ID (fix split-pane stomping, described above)
- `8768752` (T1-b) — Inspector moved to right sidebar
- `452670c` (T1-c/e/f) — node position locking (nodes don't float freely after BFS layout), fan-out edge style revert, B7 severity border hover specificity fix
- `c69f5b6` (T1-j) — idempotent `POST /edges`: duplicate edge submissions return the existing flow view instead of appending a second edge
- `09cfd83` (T1-h) — red mismatch edges: frontend renders `type_mismatch`-diagnosed edges in red

### Cleanup (`d8ca37e`)

- Deleted 10 stub `.py` files left from interactive testing in `examples/customer/onboarding/`
- Deleted dead `NodePanel.tsx` + `NodePanel.module.css` (never imported)
- Collapsed `selectedFlow` + `activeFlowView` duplication in `App.tsx` into single `activeFlowView`
- Extracted shared `shortName()` to `src/lib/typeRefs.ts`; removed local copies in `Inspector` and `RunPanel`
- Removed unused Shell slot props (`sidebarHeader`, `sidebarFooter`) and their dead CSS
- Annotated two `eslint-disable` lines in `DockviewCanvas.tsx` with reasons
- Fixed stale CLAUDE.md content (dockview was described as "rolled back" — it's live)
- Removed `react-icons` from `package.json` (unused dependency)

Also: `ee0822a` added 5 PATCH /nodes tests (rename cascade, ref change, input type change, exit rename cascade, exit reconciliation with dangling edge deletion). 116 tests total passing.

---

## Design decisions

### Preview-tab pattern for node → source

Node selection opens source as an ephemeral preview tab in the non-active pane (auto-creating a right-split if needed). Typing or focusing the tab promotes it to persistent. Double-click = persistent from the start. Deselect = preview closes. One preview tab reused across selections. Full behavior table in `docs/EDITOR_MERGE.md`.

### Inspector → editor merge

The right Inspector sidebar goes away. All per-node metadata (name, path, ref, exits, attachments, diagnostics) lives in a header above the source editor in the node's tab. Flow tabs get an analogous header. Selection state is retained for keyboard ops (Delete key) but display moves entirely to the tab.

### Emits vs returns

Single-exit nodes: plain `return value`. Multi-exit nodes: `@exits(name=Type, ...)` decorator + `emit("name", value)` calls. No mixing. The dichotomy matches the visual dichotomy (single handle vs. switcher strip). Open questions around where `emit` is imported from and async support captured in `EDITOR_MERGE.md`.

### Action nodes as `kind: "action"`

> *"actions are just nodes, except we dont count them as leaf nodes so we dont expect an exit type from them. They would be for logging, triggering something, etc."*

Action is a `kind` flag on a regular node, not a separate subsystem. Reuses all existing node machinery. Does not emit a typed exit value; not counted for public-exit inference.

### Insertion points: two distinct concepts

> *"I didnt mean for insertion points to run after a node runs. I meant for you to literally insert a point within the code itself that will execute at that point with the exec state of the code at that point."*

(A) **Chained action node** — regular action node connected via a normal edge, runs after the upstream node, renders as a side arrow. Ships with action kind. (B) **Code insertion point** — mid-function hook with exec state access, requires AST instrumentation. Deferred to §12 Action system.

### Trigger → Feeder renaming

> *"I was speaking about triggers as ways to inject example cases and types into the nodes mainly for testing."*

The "Trigger" attachment was renamed **Feeder** (🧪 pill) — dev-time payload injection for "Run from here." The production invocation concept is now **Invocation Endpoint** (deferred). This avoids the collision between "trigger a test" and "trigger in production."

### Public exits: Infer model

Unconnected exit ports become public exits automatically. No explicit `public_exits` declaration needed in the common case. Agreed over the "Tag" model (explicit annotation required).

### Storage and Trigger as attachments, not nodes

Storage and Invocation Endpoint would clutter the graph if rendered as boxes with edges, because they do no data transformation. As attachments (corner pill badges), they're node-scoped operational concerns that don't affect topology.

### Activity bar sidebar

VS Code / Cursor pattern: ~48px leftmost strip with section icons (Workspace, Files, Types, Diagnostics, Settings). Click to open contextual panel. Replaces the current always-visible stacked sidebar. Full notes in `docs/SIDEBAR.md`.

### Sticky notes for graph documentation

> *"If you have really consistent node locations, we could literally have documentation in the graph, or in the flow, which would be so cool."*

Free-floating Markdown blocks on the canvas, stored in `flow.json` layout block as `sticky_notes`. Not tied to any node. Distinct from node-level docs (which appear in the editor header). Full notes in `docs/ANNOTATIONS.md`.

### Multi-param join semantics — OPEN

> *"for funcs with multiple params, if we would want to have a top switch as well, that represented all the params (which are demanded) for the func to begin."*

Top switcher strip for multi-input nodes. Requires join semantics in the executor (fire when all inputs arrive). Deadlock risk when a branch never fires. Flagged as deferred — not to be implemented without explicit approval.

### End nodes removed

Explicit end/terminal nodes were removed. Leaf nodes (nodes with no outgoing edges to other nodes) are implicitly flow exits under the Infer model. The graph is simpler without terminal-node ceremony.

### Start node explicit ▶

A virtual Start node (explicit entry with a ▶ icon) is planned for flows that need a specific input shape injected before the first Python node runs. Not yet implemented.

---

## Known limitations

- **Zero-width edge between flush-stacked nodes.** The edge exists in the data model but is visually invisible and unclickable when nodes are snapped flush. Not blocking, but edge delete requires workaround (Inspector or direct flow.json edit).
- **No Inspector Delete button.** Node deletion is keyboard-only (Delete/Backspace). Intentional for now but not surfaced in the UI.
- **Drag can't be completed via playwright synthetic events.** xyflow uses pointer capture which Playwright's synthetic drag events don't satisfy. Visual verification of snap/drag features requires manual browser testing.
- **type_mismatch severity asymmetry.** The diagnostic is `warning` but the frontend renders the edge red — the same red as errors. A reader looking at the canvas can't distinguish "structural error" from "type mismatch" without opening the diagnostics panel.
