# DAGsmith UI features — working spec

This doc captures the features we want to implement in the UI, ordered by priority. It's a **delta** on top of `docs/SPEC.md`: that doc defines milestones M1–M8; this one tracks work that either extends M5+ or was added during prototyping.

The section order is intended to be the implementation order unless otherwise noted.

---

## 1. Inspector rework — move off the right, conditional, bottom panel

**Priority: HIGH. Blocks §2.**

The right Inspector sidebar (currently always-visible, collapsible) is heavier than it needs to be. Move to a conditional bottom panel.

- Inspector lives in a new bottom area of the Shell, below the dockview canvas (full width).
- Shows **only** when a node is selected.
- Auto-dismisses on deselect — ESC, empty-canvas click, or re-clicking the selected node.
- Horizontal real estate → lay fields in rows instead of stacked (larger input targets).
- Delete the right-sidebar Inspector we just built (iteration cost).

**Implementation choice:**
- **A.** Add a dedicated `bottomArea` slot to `Shell.tsx`, render Inspector there when selection exists.
- **B.** Use dockview to own a bottom panel group. More flexible, more complex.

Recommend **A** for simplicity. The Inspector isn't a first-class tab; making it a dockview panel would invite the user to split/drag it in ways that don't fit the mental model.

---

## 2. Node + exit editing ("general editing" — M6 continuation)

**Priority: HIGH. Depends on §1 (needs bigger surface).**

The UI is a viewer today. Fields that should be editable in the Inspector:

| Field | Backend support | Notes |
|---|---|---|
| Node label (rename) | check routes_mutate | Renames the `.py` file + rewrites refs elsewhere that point to this node |
| Input type | types palette already exists at M4 | Dropdown sourced from the palette |
| Exit names (add / remove / rename) | check routes_mutate | Cascade: affects edge `from_exit` references |
| Exit types | types palette | Dropdown |
| Node ref (Python symbol) | backend accepts strings | Text input; later, autocomplete from source AST |

Verify which mutation endpoints exist before building the forms; stub missing ones with a clear "not supported yet" message. Do not block on building all of them — rename is the most visible, start there.

---

## 3. Node visual polish

**Priority: MEDIUM. CSS-heavy, no backend.**

### 3a. Bigger nodes
Current: `min-width: 220px`, body padding `10px 14px`, small label.
Target: `min-width: 260px`, body padding `12px 18px`, label ~1 size bigger.
Icon slot 14→16px.

### 3b. Handle visibility — cleanup the arrow-into-handle mess
Current: handles (small squares) are always visible, same color as edges. Arrow tip overlaps the handle → visually muddy.

Three options, pick one:

| Option | Description | Tradeoff |
|---|---|---|
| **Hide-on-idle** | Handles are invisible until node is hovered or a connection drag is in progress. Arrow terminates cleanly at the node edge. | Most "calm" — matches Figma/Linear. Downside: first-time users may not discover handles. |
| **Contrast recolor** | Keep handles always visible but recolor to a distinct color (e.g. accent blue on hover, lighter gray idle) so arrow tip stands out against them. | Discoverable but still some visual noise. |
| **Offset arrow** | Stop the arrow marker short of the handle with an explicit pixel gap. | Fixes overlap but handles still visually present. |

Recommend **Hide-on-idle** (option 1). Pattern: add `.react-flow__node:hover .handle { opacity: 1 }` rule; idle opacity 0. Also keep handles visible during a connection drag (xyflow adds a class for this globally — `react-flow__pane.dragging` or similar).

---

## 4. Graph editing actions

**Priority: MEDIUM.**

### 4a. Drag edges to reroute
xyflow has `reconnectEdge` util + `onReconnect` callback. Drag an edge endpoint to a different handle to move it. Wire `onReconnect` to delete the old edge + create a new one via existing API.

### 4b. Reorder switcher cells by drag
Drag a switcher cell left/right to reorder exits. Does not change code — only flow.json's exit-key order. Cascades: Inspector's exit list shows the new order. Backend: needs a "reorder exits" mutation or treats exits as ordered.

### 4c. Multi-select + bulk move/delete *(optional — low priority)*
xyflow supports via drag-box select.

---

## 5. Snap-stacking refinements

**Priority: MEDIUM. V1 shipped.**

### 5a. Behavior when target exit is already bound
**Decision: Refuse** (current behavior). If the target's exit is already connected, snap is rejected; user deletes the old edge manually first. Revisit if this becomes painful in practice — adding `Shift+drag` to force-replace would be an additive change.

### 5b. Snap above target's top?
Currently snaps only to target's *bottom*. Snapping above (reverse direction) complicates the mental model. Leave bottom-only.

### 5c. Chain visual indicator
When multiple stacked nodes form a chain, selecting one could show a subtle hint that they're connected. Defer until we feel the need.

### 5d. Discoverability
Currently you have to *know* the feature exists and have an eligible target. Add a one-line tooltip somewhere or a tiny hint in the empty-selection Inspector state: "Drag a node below a single-exit node to snap them together."

---

## 6. Tab polish

**Priority: LOW.**

- Python logo icon on source tabs (currently just text label).
- Flow glyph on flow tabs (a small DAG icon or similar).
- Dockview supports custom tab components — small refactor.

---

## 7. Canvas / general polish

- **Auto-fit on Add Node.** New nodes land at default coords off-screen if the canvas is scrolled. Either pan-to or position near cursor.
- **Error overlay dismissibility.** When a mutation fails (e.g. backend unreachable), FlowPanel shows a red overlay that looks like a crash. Make it a small toast or dismissible inline banner.
- **Edge color + stroke**: shipped. May revisit if §3b changes perception.

---

## 8. Spec milestones still open (from `docs/SPEC.md`)

These are out-of-scope for this file but listed for visibility.

### M6 (partial — switcher done, rest TODO)
- Fan-out edge visuals + warning pill
- Red/amber node rendering driven by diagnostics
- Root-cause grouped diagnostics in left sidebar
- Per-node diagnostics in Inspector (pair with §2)
- Run preflight modal

### M7
- Types palette drag-and-drop (onto nodes / exits / edges / Inspector fields — ties to §2 and §4b)
- Subflow "Enter subflow" opens new tab/split (dockview makes this easy now)
- Flow-tree subflow highlighting

### M8
- Group folding
- Playwright e2e baseline (note: we use `playwright-cli` for manual checks; spec calls for `@playwright/test` for CI)

---

## Implementation order recommendation

1. §1 Inspector rework *(structural — unblocks everything editing-related)*
2. §2 Node/exit editing *(the missing "general editing" affordance)*
3. §3 Node visual polish *(cheap wins)*
4. §4a Drag edges to reroute *(small, high-impact)*
5. §7 Error overlay + auto-fit *(quality fixes)*
6. §4b Switcher reorder *(medium)*
7. §5a snap modifier *(design+impl)*
8. §6 Tab icons *(cosmetic)*
9. M6 diagnostic rendering *(big, spec-driven)*
10. M7+ per spec

---

## Edge color semantics (decided)

Convention for edge stroke color:

| State | Color | Trigger |
|---|---|---|
| **Default** | gray (`--border-2` / ~`#6b7080`) | All edges that are well-formed |
| **Type mismatch** | red (`--severity-blocking`) | Edge's `from_exit` type is incompatible with the `to_node`'s input type. Driven by a backend diagnostic, not by local UI logic. |
| **Live execution** | green (`--success`, new token) | Only while a Run is actively crossing the edge. Requires the Future-list "Live execution visualization" work — tracer hook already exists per `SPEC.md §5.3 / §12`. Deferred. |
| **Selected** | blue (`--selection`), thicker stroke + × badge | Edge is user-selected; shows endpoint handles for reroute. |

Rules:
- These states are mutually exclusive at render time with this precedence: **Selected > Live execution > Type mismatch > Default**.
- Fan-out, snap-stacked, and other structural variations do NOT change stroke color.

## Open design questions

- Snap steal: confirm modifier approach vs refuse-only.
- Inspector: should edit fields commit on blur, Enter, or an explicit Save button? (Recommend: blur + Enter, no Save button — optimistic, rollback on backend error.)
- Switcher reorder: does backend need to preserve exit order, or is order a UI-only concern? (Impacts §4b and §2.)
