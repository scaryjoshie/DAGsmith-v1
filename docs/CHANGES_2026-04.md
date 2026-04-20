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

### Position persistence (`080920d`)

Node positions were not surviving HMR (hot module reload) or page refresh because the frontend only saved positions on drag-end and the save was debounced. After a reload, positions reverted to BFS auto-layout. Fixed by saving positions immediately to `flow.json` via `PUT /layout` on the first render of each node that doesn't yet have a saved position. Positions are now stable across reloads.

### Gitignore and cleanup (`1e33408`)

Expanded `.gitignore` to exclude the large collection of verifier screenshot PNGs that had accumulated in the repo root and `frontend/`. Also removed other debris left by the agent verification passes.

### Fusion single-border fix (`5858849`, `a7cdf38`)

The snap-stacking visual fusion (shared border between stacked nodes) had a double-border artifact: both the bottom border of the upper node and the top border of the lower node were rendering, producing a visually thick seam. Fixed by suppressing one side. `a7cdf38` also hid the edge that runs between flush-stacked nodes (it was rendering through the gap and looked like a line artifact). The edge still exists in the data model; it's just invisible when nodes are flush.

### SPEC currency + doc close-out (`ee0a3ae`)

SPEC.md updated: M5 and M6 marked complete with accurate descriptions, §9.5 added covering the full 2026-04 redesign work, §12 extended with the session's design decisions. Archive headers added to three superseded docs (`UI_FEATURES.md`, `UX_REDESIGN.md`, `UX_REDESIGN_visual.md`).

### Tailwind CSS v4 migration (`731ab49` … `801561c`, plus `30df82a` prune)

Ported all 14 frontend components from CSS Modules to Tailwind CSS v4 utilities over 16 commits. Zero `.module.css` files remain in `frontend/src/`. Visual state is pixel-identical to pre-migration — the Vercel dark aesthetic preserved verbatim. Also consolidated the color palette and pruned several superseded drafting docs + the throwaway `mockup/` tree.

**Why**: app is about to grow substantially (subflows, chains, inspector expansion, command palettes). At ~20 components with 1,900 lines of CSS Modules, scaling to ~60 would have made file-hopping painful. Tailwind utility-first is the modern "clean product" stack for a pro-code IDE tool; prerequisite for eventually adopting shadcn/ui-style primitives.

**Design discipline**: preserve look exactly. Every CSS rule was translated 1:1 to Tailwind utilities backed by a `@theme inline` bridge against the existing `:root` vars. Non-tokenized values (specific shadows, exact pixel padding) used arbitrary `[bracket]` syntax to keep pixels verbatim.

**Foundation fixes caught on the Toast pilot** (`eec5b5b`), before scaling to 13 more components:
- Unlayered `* { padding: 0 }` was stomping every Tailwind padding utility silently — wrapped all global CSS in `@layer base` so utilities (in `@layer utilities`, a later cascade layer) win.
- `text-*` utilities were bundling unwanted line-heights (Tailwind v4 default ties line-height to font-size) — set `--text-*--line-height: normal` to preserve inherited browser-normal line-heights.
- `--spacing: 0.25rem` rendered as 3.25px because html font-size is 13px, making `p-3` = 9.75px instead of 12px — pinned `--spacing: 4px` absolute so the familiar 4/8/12/16 step sizing holds regardless of font-size.

**Vendor boundaries**: `src/vendor-overrides.css` holds four library-scoped blocks (CodeMirror, React Flow, Dockview chrome, Dockview tabs), each under a component-specific wrapper class (`.source-tab-editor`, `.flow-graph-canvas`, `.wf-process` / `.wf-terminal`, `.dagsmith-theme`). All rules wrapped in `@layer base` for consistent `!important` cascade priority (per CSS Cascade L5, earlier-declared layer wins for `!important`).

**Color consolidation** (`cf8c08b`, `801561c`):
- Three reds → one `--red: #e5484d`. Dropped `--severity-blocking` token + orphan `#e05252` hex literal.
- Two ambers kept by semantic role: `--amber: #f59e0b` (bright, for node borders + decoration) and `--amber-muted: #d97706` (darker, for small diagnostic indicators where bright amber would be visually loud at 4×4 px). Dropped `--severity-warning`.
- Added `--green: #4caf50` for the "✓ No issues" marker.
- Removed dead `--accent` token (defined, referenced nowhere).
- Merged `--selection` into `--blue: #3b82f6` (Tailwind blue-500 replaces the old Vercel blue `#0070f3`). One blue for both focus accents and selection state.
- Dormant Dockview `.dv-tab.active-tab` rule (wrong class name `active-tab` vs the actual `dv-active-tab`; never fired in production) removed.

**Gotchas worth remembering**:
- Tailwind's `break-words` isn't equivalent to `word-break: break-word` (the utility only breaks at word boundaries); use the arbitrary `[word-break:break-word]` to preserve aggressive mid-token wrap.
- Tailwind v4 utilities sit in a single cascade bucket where source-order in the generated stylesheet wins — NOT class-string order on the element. If a shared base constant includes a color/utility that variants need to swap, the variant may silently lose. Set color/utility per call site, not in a shared base.
- Preflight sets `svg { display: block }` which breaks library icon-next-to-text markup (Dockview tabs). Restore `display: inline-block` on targeted selectors in vendor-overrides.
- Tokens survive migration if you reference them via `@theme inline` (values embed directly). Without `inline`, variable chains may not resolve.

**Token palette (final)**:

| Category | Tokens |
|---|---|
| Surfaces | `surface-0..3`, `surface-hover` |
| Text / icons | `ink-0..3` |
| Borders | `line-0..2` |
| Semantic | `blue`, `red`, `amber`, `amber-muted`, `green` |
| Radii | `none`, `xs`, `sm` |
| Fonts | `mono`, `sans` |
| Text sizes | `xs`, `sm`, `md`, `lg` |

**Verification**: each component port paired with a verifier pass (visual diff against baseline screenshots + computed-style spot checks). Three real bugs caught pre-commit: RunPanel word-break semantic mismatch, LeftSidebar chevron class-order bug, WorkflowNode severity+selection conflict. Post-merge interactive walkthrough (10 flows: load, selection, inspector, dialogs, editor, toast, preflight, tabs, delete-cancel) verdict: "Looks solid, OK to ship."

**Prune pass** (`30df82a`): removed `mockup/` (throwaway SPEC-drafting tree, per its own README), four superseded `docs/*.md` files (`UI_FEATURES.md`, `UX_REDESIGN.md`, `UX_REDESIGN_visual.md` explicitly self-labeled "Historical"; `AUDIT_2026-04.md` a point-in-time snapshot). Dropped `.gitignore`'s blanket `*.png` rule in favor of a scoped `/screenshots/` convention so legitimate PNG assets (favicons, illustrations) can be tracked (`a9a2d78`).

### Infer model + leaf cue (Phase 2)

> *"All of this stuff is just examples to draft and visualize while we're developing this live. And so there's no need for you to think about backwards compatibility."*

Explicit terminal nodes and the stored `public_exits` dict were removed in favor of the **Infer model** (SPEC §12 line 425): any source handle with no outgoing edge is a public exit of the flow. The field is derived, not stored.

- `a5102b6` — backend IR + runtime + tests + examples, folded into one commit because the IR and runtime changes are inseparable (dropping `EdgeSpec.to_flow_exit` breaks the old "terminate when edge targets a public exit" runtime path, and the test suite uses `examples/minimal/hello` end-to-end). One combined commit was safer than a deliberately-broken intermediate state.
  - `dagsmith/model.py`: `EdgeSpec.to_node: str` required; `to_flow_exit` gone; `FlowSpec.public_exits` gone.
  - `dagsmith/workspace.py`: new `_derive_public_exits` scans unconnected handles, merges by name, emits `merged_exit_type_mismatch` (new warning code) when contributors disagree on type (collapses to `typing.Any`). `_run` now terminates on unmatched exits — the exit name IS the public exit name. `Workspace.public_exits(flow_id)` accessor exposes the derived map.
  - `dagsmith/runtime.py::_resolve_node_result`: single-exit nodes route plain returns through that exit's declared name (was `DEFAULT_EXIT_NAME`). Necessary so the inferred public exit name matches what the node declares.
  - Diagnostic rename: `empty_public_exits` → `no_public_exits` (emitted when every handle is connected).
  - Server: `EdgeView.to_flow_exit` + `AddEdgeRequest.to_flow_exit` gone; `FlowView.public_exits` populated from the derived map.
  - Examples: both `examples/minimal/hello/flow.json` and `examples/customer/onboarding/flow.json` rewritten in-place. Customer's `validate_email.invalid` and `validate_age.invalid` merge-by-name into a single `invalid` public exit (matching types, no warning).
  - Tests: 108 → 118 passing (new coverage: `test_derive_public_exits_from_unconnected_handles`, `test_derive_public_exits_merges_by_name`, `test_merged_exit_type_mismatch_warns`, `test_runtime_terminates_at_inferred_public_exit`, `test_legacy_to_flow_exit_rejected`, `test_stored_public_exits_field_stripped`, plus rewrites).

- `6039b22` — frontend dead-branch cleanup: removed all 11 `startsWith('exit:')` guards in `FlowGraph.tsx` (snap candidate, drag dispatch, chain walk, position save, delete filter, click branch, stackFlags), removed the synthetic `exit:*` node synthesis in `layoutFlow`, removed the `variant: 'terminal'` branch and `TERMINAL_BASE` constant in `WorkflowNode.tsx`, removed the `.wf-terminal` selection rule. Net delta −78/+15.

- `bb3d848` — chevron leaf cue. Under-handle ▾ glyph on every inferred public exit. New `leafMap` memo in `FlowGraph.tsx` feeds `leafExits: Set<string>` to each node; `WorkflowNode.tsx` renders `LeafChevron` as a **sibling** of `<Handle>` (not a child) because Handle's `!opacity-0` base state would otherwise inherit onto the chevron. Suppressed on flush-stacked single-exit tops (the follower is the effective downstream). Verified on both example workspaces.

**Merge-by-name semantics.** The Infer model has to answer "what if two leaves share an exit name?" — the chosen answer is: they share the public exit. This matches the common multi-validation case (`validate_email.invalid` + `validate_age.invalid` both feed the same `invalid` flow exit). Type agreement is required for a clean merge; mismatched types surface as a warning-level diagnostic rather than a hard error, since the runtime does not actually type-check values at public exits today.

**Chevron rationale.** With terminal nodes gone, a leaf handle and a not-yet-connected handle look identical — both are "unconnected source." The ▾ glyph reads universally as "flow exits here" and doesn't fight any existing border/color treatment (severity, selection, snap target, fan-out). Text-ink-2 so it's subtle; `pointer-events-none` so it doesn't steal hover.

### Start node (▶) (Phase 3)

Phase 2 removed terminal nodes in favor of the Infer model. Phase 3 adds a complementary concept at the other end: an explicit `kind="start"` sentinel for the flow's entry point. Rationale: the flow's input type used to live on a top-level `input` field with no visual representation in the graph; now it lives ON a node the user can see, select, and edit.

- `5aebd0e` — backend IR + runtime + tests + examples. `NodeSpec.kind` gains `"start"`; `ref` defaults to `""` so start nodes validate without a custom validator. `FlowSpec.entry_node` and `FlowSpec.input_type` become `@computed_field` properties derived from the unique start node; stored values in flow.json are stripped (`extra="ignore"`). Runtime `_run` short-circuits for `kind=="start"` — no ref resolution, no callable lookup, payload passes through the implicit `out` handle. Diagnostics: `missing_start_node` / `ambiguous_start_node`. Server: `AddNodeRequest.kind: Literal["python", "flow"]` rejects start; `DELETE /nodes/{start_id}` returns 400 (structural, not permissive); rename refused. Tests: `TestStartNode` class covers routing, missing, ambiguous, delete-protection; `test_model.py` replaces the old stored-entry_node round-trip with three computed-field cases. `conftest._write_flow` auto-prepends a `_start` sentinel for test ergonomics (not runtime synth). Test churn: 118 → 123.
- `fa9c69d` — `StartNode.tsx`. Compact `▶ shortName(input_type)` pill, single bottom handle (no top handle — flow begins here), muted border. `GraphNode = WorkflowNodeType | StartNodeType` union in FlowGraph's nodes state. `decoratedNodes` short-circuits for start (only `snapTarget` applies; no exit/severity/fanOut/stack/leaf decoration). Selection-ring rule in `vendor-overrides.css` now matches `.wf-start` in addition to `.wf-process`.
- `3e3bcfe` — `StartInspector.tsx`. Sibling component, NOT a branch of Inspector. Single INPUT TYPE field bound to `start.exits["out"]`; `updateNode(.., {exits: {out: newType}})` on commit. Header `▶ START`. No ref/source/exits/diagnostics. App-level dispatch picks between `<StartInspector>` and `<Inspector>` via `selectedKind === "start"`; `Inspector.tsx` untouched.
- `c8238e5` — delete protection + snap eligibility + fitView tuning. `handleBeforeDelete` filters kind="start" out of the deletable set. When the selection was start-only, a toast fires (`Start node cannot be deleted`) and the delete is refused. Mixed selections return the filtered `{nodes, edges}` — React Flow v12's `OnBeforeDelete` supports this return shape. Start IS a valid snap *source* (0-exit → implicit "out" passes the existing `exits.length <= 1` filter, no kind-based reject). Start is NOT a valid snap *target* (no top handle in `StartNode`). Bumped `fitViewOptions.padding` from 0.15 → 0.25 so the customer example's start node shows on initial fit.

**Dual-state resolution: `entry_node` + `input_type` are BOTH computed.** Early drafts kept one stored and computed the other. The simpler design is: whatever the user sees as "the start" (a node in the graph they can click on) is the authoritative source of both facts. `entry_node` is just the start's id; `input_type` is just `start.exits["out"]`. The old flow-level `entry_node` field created a second way to express "where does this flow begin?" that could drift from the actual graph. Computing both eliminates that divergence.

**Why a separate StartInspector instead of a branch in Inspector.** Inspector's code is already dense (rename, ref, input, exits CRUD, source button, diagnostics popover). Branching on `kind === "start"` inside would mean half of every feature gets a guard. Keeping start-specific code in its own file keeps both files focused.

**Why the `_start` id isn't enforced.** The task spec originally named the sentinel `__start__`; examples shipped as `_start`. Since the id is arbitrary (entry_node is computed from whatever kind="start" node exists), picking a convention rather than enforcing one keeps the spec permissive and avoids hard-coded-name fragility.

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

**Update 2026-04-19:** shipped in Phase 3 (commits `5aebd0e`, `fa9c69d`, `3e3bcfe`, `c8238e5`, `4904cc8`). `kind="start"` in the IR; `FlowSpec.entry_node` and `input_type` became `@computed_field` properties derived from the unique start node. Dedicated `StartNode` React Flow node type + `StartInspector` sibling component. See `SPEC.md §12 line 427` and `NODE_TAXONOMY.md` Start section.

### Start + Feeder + Storage composition (design thread — 2026-04-19)

Open thread captured during post-Phase-3 discussion. Two compositional moves that could meaningfully improve the test-data authoring loop:

1. **Start inherits from Feeder.** Today's Start is a virtual sentinel; a Start with a Feeder attached would both trigger the chain AND hold a configured sample payload. Runs with no caller-supplied input fall back to the Feeder payload. Same Feeder attachment shape; no new IR.

2. **Feeder sources payloads from Storage.** Today's Feeder holds a static JSON literal; if the dev needs generated/randomized test cases they write an external Python script and paste the output back. A Feeder that reads from a named Storage bucket instead makes test-data generation a first-class flow activity — generator flows produce fixtures, consumer flows' Feeders pull from the same bucket. Also naturally unlocks "replay against real data" because the mechanism is the same.

User's framings preserved verbatim in `NODE_TAXONOMY.md` (see "Design thread: Start + Feeder + Storage composition"). Open questions: payload-config schema (static vs Storage-ref vs both), Storage addressing and namespacing, record-selection policy (random/latest/predicate), cross-flow bucket sharing, production behavior. Not yet prioritized against EDITOR_MERGE or other Phase 4+ work.

---

## Known limitations

**BLOCKING — fix before next session:**

- **Backend `flow.json` write corruption on DELETE.** After a DELETE mutation (node or edge), the file is written with valid JSON followed by trailing `}\n}\n` garbage. The file remains parseable in the current backend session, but on the next startup the extra braces cause a load error and the workspace fails to start entirely. Recovery requires manually truncating the file. Root cause: likely a double-close or `json.dump` called twice in `dagsmith/server/routes_mutate.py`. **Priority 0.**

**In progress (impl-polish pass):**

- **Edge selection doesn't recolor arrowhead.** When an edge is selected, the stroke turns the selection color but the arrowhead marker retains its default color.
- **Delete-node cancel doesn't preserve connected edges.** Cancelling out of the delete confirmation still removes edges connected to the node in some cases.

**Open:**

- **Inspector stale after node deletion.** When you delete the currently-selected node, the Inspector panel keeps showing its fields instead of auto-dismissing. Low priority cosmetic issue.
- **No undo/redo system.** The biggest structural gap in the editing system. Every mutation writes directly to `flow.json` with no history. Adding undo/redo requires either a command stack on the frontend or a versioned mutation log on the backend. Not in scope for this session.
- **Zero-width edge between flush-stacked nodes.** The edge exists in the data model but is visually invisible and unclickable when nodes are snapped flush. The fusion visual hides it intentionally (`a7cdf38`); edge delete requires the Inspector or direct `flow.json` edit.
- **Drag can't be completed via Playwright synthetic events.** xyflow uses pointer capture which Playwright's synthetic drag events don't satisfy. Visual verification of snap/drag features requires manual browser testing.
- **type_mismatch severity asymmetry.** The diagnostic is `warning` but the frontend renders the edge red — the same as structural errors. A reader can't distinguish the two without opening the diagnostics panel.

---

## Handoff to next agent session

The branch is `feat/subflows-chains-ui`. Backend tests: `uv run pytest -q` (116 passing). Frontend build: `npm run build` in `frontend/`.

### Where to find context

| What | Where |
|---|---|
| Milestone scope | `docs/SPEC.md` |
| Session history + reasoning | `docs/CHANGES_2026-04.md` (this file) |
| Forward UI design | `docs/EDITOR_MERGE.md` |
| Node/attachment model | `docs/NODE_TAXONOMY.md` |
| Sticky notes | `docs/ANNOTATIONS.md` |
| Sidebar activity bar | `docs/SIDEBAR.md` |

### Team conventions

- **impl-structure** — backend (`dagsmith/`), app state, `App.tsx`, Inspector, API layer
- **impl-polish** — canvas rendering (`FlowGraph`, `WorkflowNode`, `DockviewCanvas`), visual fixes, animations
- **verifier** — browser verification via Playwright; takes screenshots, validates visual state

### Remaining work (forward plan)

0. **FIX: backend JSON corruption on DELETE** — trailing `}\n}\n` appended to `flow.json` after DELETE mutations causes load failure on next restart. Fix in `dagsmith/server/routes_mutate.py` before anything else.
1. **Full editor-merge implementation** — preview-tab on node selection, Inspector-into-editor header, attachment config inline. Specified in `EDITOR_MERGE.md`; not yet started.
2. **Undo/redo** — biggest structural gap. No design yet.
3. **Start node** — virtual ▶ entry node. Backend: new `kind: "start"`. Frontend: distinct rendering.
4. **Action node** — `kind: "action"` flag, side-arrow rendering for chained actions.
5. **Storage attachment** — toggle + local store + replay mode. Near-shippable per `NODE_TAXONOMY.md`.
6. **Sticky notes** — free-floating Markdown on canvas, stored in `layout.sticky_notes`. Specified in `ANNOTATIONS.md`.
7. **Activity bar sidebar** — swap current stacked sidebar for VS Code-style icon strip. Specified in `SIDEBAR.md`.
8. **M7 drag-and-drop types** — types palette drag targets (node input, exit port, edge). Per original `SPEC.md`.
9. **M8 group folding + Playwright baseline** — per original `SPEC.md`.

---

## Handoff 2026-04-19 (post-Phase-3, post-Storage-thread)

This supersedes the earlier handoff section above. Read this one if you're picking up the project fresh.

### Current state

- **Branch**: `main`. Working tree clean. Local main = `origin/main`.
- **Tip commit**: `1720c84` (latest at handoff time — `git log --oneline -1` for current).
- **Tests**: `uv run pytest -q` → 123 passing.
- **Frontend build**: `npm run build --prefix frontend` → green.
- **Lint**: 14 pre-existing problems (React Hooks rules + setState-in-effect). Not introduced this session; predates Tailwind migration. Easy follow-up PR.
- **Dev servers** (none auto-started; spin up as needed):
  - Backend: `uv run dagsmith ui examples.customer examples.minimal` → port 8001. **No auto-reload** — restart required after any `dagsmith/` change.
  - Frontend: `cd frontend && npm run dev` → typically port 5173 (Vite picks next available; previous sessions ended up on 5177-5178).
- **Playwright session**: opens fresh. Earlier sessions used `-s=tw` as the persistent session name; not load-bearing.

### What this session shipped

1. **Tailwind v4 migration** — 14 components ported from CSS Modules to utilities, full `@theme` token bridge (`surface-*`, `ink-*`, `line-*`, semantic colors, font/text/radius scales), vendor-overrides pattern for library chrome. Color consolidation (3 reds → 1, 3 ambers → 2 named + new `--green`, dropped `--accent` and `--selection`).
2. **0-exit plain-return as first-class** — backend allows it, runtime routes via implicit `"out"` exit, frontend AddNodeDialog defaults to `exits: {}`, snap accepts 0-exit sources, 1-exit shows pill. The whole "nodes can declare zero exits" story.
3. **Phase 2: Infer model + leaf cue** — dropped `FlowSpec.public_exits` and `EdgeSpec.to_flow_exit`. Public exits derived from unconnected source handles (with merge-by-name semantics for shared exit names). Runtime terminates at inferred leaves instead of raising. Terminal dashed nodes removed. Chevron `▾` cue on leaf source handles.
4. **Phase 3: Start node ▶** — `NodeSpec.kind="start"`, `FlowSpec.entry_node` and `input_type` are `@computed_field` derived from the unique start. `StartNode` as its own React Flow node type. `StartInspector` as sibling component (Inspector untouched). Delete-protected, snap-source-eligible.
5. **Repo cleanup** — deleted `mockup/`, 3 historical `docs/UX_*.md` files, `docs/AUDIT_2026-04.md`. Retired `feat/subflows-chains-ui` and `feat/tailwind-migration` branches (local + remote). Rewrote `CLAUDE.md` (73 → 39 lines). Scoped `.gitignore`: dropped blanket `*.png`, added `screenshots/` convention.
6. **Storage design thread** — three rounds of refinement captured in `docs/NODE_TAXONOMY.md` ("Design thread: Start + Feeder + Storage composition"). Concrete enough to implement; details still negotiable. Core invariant: **store state, let rows play back**.

### Critical conventions and gotchas

#### User stance — load-bearing

> *"All of this stuff is just examples to draft and visualize while we're developing this live. And so there's no need for you to think about backwards compatibility. We are making the compatibility right right now. So you just experiment break things. When things break, rewrite them."*

**No migration code, no legacy tolerance, no compat shims.** When schema changes, rewrite the example flow.json files by hand and rewrite tests. The only consumers are these examples; they're drafts.

#### Permissive posture (SPEC §3) — load-bearing too

Backend accepts any shape and emits diagnostics. Runtime raises at the point of violation. **Never add a validator that rejects a semantic violation** — emit a `Diagnostic` instead. The single allowed structural reject is start-node deletion (sentinel cannot be removed via API), and that's documented as exceptional.

#### Tailwind v4 cascade gotchas (real, learned the hard way)

- **`@layer base` wins for `!important`** vs unlayered styles. Per CSS Cascade L5, layered `!important` from an early layer beats unlayered `!important`. We use this in `vendor-overrides.css` to override Dockview's unlayered defaults.
- **`text-*` utilities bundle line-heights** by default. Without `--text-*--line-height: normal` in `@theme`, every `text-sm` injects a line-height that cascades over inherited values. We override all four sizes.
- **`--spacing` is rem-based by default**; with html font-size 13px, `p-3` renders as 9.75px not 12px. We pin `--spacing: 4px` absolute in `@theme`.
- **CodeMirror `theme="dark"` injects `#282c34`** at the same specificity as our `.cm-editor` rule. Use `!important` (in @layer base) to win.
- **DockviewReact auto-applies `.dockview-theme-abyss`** as an inner wrapper inside our `.dagsmith-theme`. CSS variable inheritance cascades by DOM proximity, so the inner abyss vars beat outer overrides at normal priority. Solution: scope var overrides to BOTH wrappers, plus `!important` on the variables that conflict (e.g., `--dv-separator-border`).
- **React Flow `<Handle>` children inherit `!opacity-0`** in idle state. To render decorations on a handle (we use this for the leaf chevron), render as a SIBLING of `<Handle>` inside a `position: relative` parent.

#### Backend dev workflow

- Backend has no auto-reload. After ANY `dagsmith/` edit you must `lsof -ti:8001 | xargs kill && uv run dagsmith ui examples.customer examples.minimal &`.
- The live backend writes mutations to `flow.json` files. **Mid-session UI testing will modify the example flow.json files.** `git checkout HEAD -- examples/*/flow.json` before committing if you didn't intend the drift.
- Test fixtures use `_write_flow` and `_flow` helpers in `tests/conftest.py` and `tests/test_runner.py`. They auto-prepend a `_start` sentinel node to any flow that doesn't define one — so existing tests don't need to know about start-node ceremony. Keep this convention if you add helpers.

### Where things live

| What | Where |
|---|---|
| Live SPEC for scope | `docs/SPEC.md` (esp. §3 permissive, §5 runtime, §12 design decisions) |
| Project philosophy | `docs/CORE_MODEL.md` + `docs/DESIGN.md` |
| Living session log | `docs/CHANGES_2026-04.md` (this file) |
| Forward UI design | `docs/EDITOR_MERGE.md` |
| Node + attachment model + Storage spec | `docs/NODE_TAXONOMY.md` |
| Sticky notes (planned) | `docs/ANNOTATIONS.md` |
| Activity-bar sidebar (planned) | `docs/SIDEBAR.md` |
| Agent conventions / dev loop | `CLAUDE.md` |

### Agent-team workflow that worked this session

The pattern that landed Phase 2 + Phase 3 cleanly:

1. **Plan agent** (single, `Plan` subagent_type) produces a v1 plan document.
2. **3 reviewers** in parallel (`general-purpose` agents): backend, frontend, spec-adherence. Each gets the plan + a focused prompt. Independent critiques.
3. **Team-lead consolidates critiques** and sends back to Plan agent via SendMessage for v2 (planner stays warm).
4. **Implementation team** (`TeamCreate` + spawn `migrator` + `verifier` via `Agent` with `team_name`). Migrator does work, pings verifier per task, commits when verifier clears.
5. **Verifier was flaky this session** — team-lead stepped in directly multiple times. If verifier fails to respond to "please verify" within a few seconds, just have the migrator route to team-lead. Don't keep flipping back and forth.
6. **One commit per task** is the default rule, but **fold tightly-coupled tasks** (e.g., dropping a field + the runtime change that depends on it) into one commit even if tasks were split. Tests-green-at-every-boundary is the harder constraint.

### Recommended next steps (user direction at handoff)

User explicitly wants frontend polish + the preview-tab UX, NOT functionality work. Two passes proposed and approved-in-principle:

#### Pass A — visual / code-quality cleanup (no functional change)

1. **Fix the 14 pre-existing lint errors** (React Hooks rules + setState-in-effect). Touches `App.tsx`, `FlowGraph.tsx`, `Inspector.tsx`, `SourceTab.tsx`, `FlowPanel.tsx`. Each is a focused fix.
2. **Collapse `:root` vars into `@theme inline` directly** — currently we have `:root { --bg-0: #000 }` and `@theme { --color-surface-0: var(--bg-0) }`. The two-step indirection is vestigial; move literal values into `@theme` and drop `:root`. One source of truth for color values.
3. **Promote 2 repeated shadow patterns to tokens**: `shadow-[0_4px_16px_rgba(0,0,0,0.5)]` (Toast) and `shadow-[0_12px_40px_rgba(0,0,0,0.5)]` (modals) → `--shadow-sm` and `--shadow-lg`. Replace 4-5 arbitrary literals.
4. **Sweep for dead code**: any leftover branches from the migration (variant fields, etc.) that the IDE shows as "unused but exported."

Pass A is low-risk and high-quality-of-life. ~4-6 small commits.

#### Pass B — preview-tab behavior (the easy slice of EDITOR_MERGE)

Implements the click-a-node → preview tab UX without touching the Inspector dissolution (which is the heavy part of EDITOR_MERGE proper).

- Single-click a node → opens its source as a **preview tab** (italic title, Dockview supports this)
- Single-click a different node → preview tab is **replaced** in-place (not accumulated)
- Double-click node OR modify the source → preview becomes a permanent tab
- If only the flow tab is open → auto-split right and place preview there
- The existing "Open source →" button still creates permanent tabs directly

Implementation surface: `DockviewCanvas.tsx` + `FlowPanel.tsx` + a small `previewPanelId` state ref. Inspector untouched. ~150-250 lines of focused diff.

Skip in this round: Inspector → tab header dissolution, attachment pills, `@exits`/`emit()` runtime, Storage v1.

### What NOT to do

- Don't touch Inspector.tsx unless you're ready to dissolve it into the tab header (full EDITOR_MERGE — bigger commitment).
- Don't ship Storage yet — design thread is concrete in NODE_TAXONOMY but actual implementation is a separate effort.
- Don't add migration code or compat shims for any IR change — user has explicitly disclaimed compat needs.
- Don't add `*.png` to .gitignore as a blanket rule — we deliberately scoped it to `screenshots/` so legitimate PNG assets can be tracked.

### Storage thread reading order (if/when you implement)

`docs/NODE_TAXONOMY.md` → "Design thread: Start + Feeder + Storage composition" section. Three "Update" subsections in order:
1. Initial capture: Start inherits from Feeder; Feeder reads from Storage.
2. Unification + serialization: collapse Feeder into Storage; hybrid SQLite-metadata + file-refs sketched.
3. **Two substrates + pickle-BLOB model** (most current): ObjectStore + SQLStore, pickle BLOBs inline in SQLite (no file-refs in v1), playable rows as the core invariant, concrete v1 sketch with API surface, open questions enumerated.

Read all three in order; the third reflects the latest user thinking and is the closest to implementable.

---

## Editor-merge execution plan (agreed 2026-04-19)

Replaces the earlier "Pass B first, merge later" split. Reasoning: a preview tab that only shows source is incoherent — the thing that pops up on node click is exactly what Inspector currently does. So we build the merged editor-tab (metadata header + source) with preview-tab mechanics in one coherent pass, keep Inspector rendering in the sidebar as a safety net, and retire it after parity is confirmed.

### Decisions

- **Commit split**: 6 commits, keep 5 and 6 separate (flag-off, then delete) for revert granularity.
- **Editor read-only in v1**: CodeMirror stays `editable={false}`. Promotion-on-typing won't fire; OK to ship. Save wiring lands with the later code-as-truth phase.
- **Header diagnostics**: inline list below EXITS. More horizontal room in the tab header than the sidebar — drop the badge+popover pattern; show the error list directly.
- **Preview tab visual**: italic tab title (VS Code pattern). Dockview supports this via tab component params.
- **Click disambiguation**: React Flow ships `onNodeDoubleClick` natively — separate handler, no timing hacks. Single-click = preview (ephemeral, non-active pane). Shift+click = persistent in active pane. Double-click = persistent in non-active pane.
- **Dev-server state note**: Tailwind v4 on the currently-running :5175 is emitting 0 utility classes — needs a restart before any visual verification. Independent of this plan.

### Commit sequence

1. **Extract shared inspector field primitives** — move `EditField`, `ExitPill`, `AddExitRow`, and PATCH helpers from `Inspector.tsx` into `frontend/src/components/inspector/NodeFields.tsx`. Inspector re-imports; no behavior change. ~320 lines touched, net ~0.
2. **Add `NodeEditorPanel`** — new `frontend/src/panels/NodeEditorPanel.tsx` composing `NodeFields` header over `<CodeMirror>`. Register as `components.nodeEditor` + a `NodeEditorTabHeader` with italic title when `params.preview === true`. Start-node variant uses `StartInspector`'s INPUT-TYPE-only field. No caller yet. ~120 lines.
3. **Wire node selection to open `NodeEditorPanel`** — `openNodePreview(api, ws, flowId, nodeId)` in `DockviewCanvas`: finds and removes current preview, inserts new panel in non-active pane (auto-right-split if only one pane). Preview panel ID stable (`nodeEditor-preview:${ws}:${flowId}`). Single-click → preview; shift+click → persistent in active; `onNodeDoubleClick` → persistent in non-active; canvas deselect → preview closes. Inspector still co-renders. ~150 lines.
4. **Promote preview on focus / type / dblclick** — CodeMirror `onUpdate` (if `update.docChanged`), outer container `onFocus`, dockview `panelApi.onDidActiveChange`. Promotion clears the preview ref and removes the italic. Gate with `mountedRef` so programmatic focus on mount doesn't instantly promote. ~50 lines.
5. **Feature-flag Inspector sidebar off** — `INSPECTOR_IN_SIDEBAR = false` in `App.tsx`; sidebar no longer renders. All fields now edit via header through the same PATCH path. Delete key + Escape still wired; Escape clears selection which closes preview via step 3's logic. ~20 lines.
6. **Delete Inspector, StartInspector, SourceTab, SourcePanel, old `source` panel type** — remove registrations in `DockviewCanvas`, fold `onNodeRenamed`/`handleOpenSource` into `NodeFields`. Strip `source:*` panel IDs from `loadLayout` so stale localStorage layouts don't reference a dead component. ~300 lines removed.

### Open threads (do NOT implement yet)

- **Context menus (custom right-click)**: nodes, edges, canvas, tabs each need bespoke context menus. Scope this as a separate thread after merge ships. Noted 2026-04-19 by user.
- **Edit-and-save** for CodeMirror: deferred to the code-as-truth phase (§5 of `EDITOR_MERGE.md`) — requires re-introspection on save.
- **Attachments, emit/return, multi-param**: per EDITOR_MERGE §3-§7, all deferred.
