# UX Redesign Proposal — Visual & Interaction Angle

> **Historical.** Brainstorm proposals that informed Tier 1 (shipped).
> Preserved for the reasoning they capture. Current direction: see EDITOR_MERGE.md + CHANGES_2026-04.md.

*Written from the impl-polish perspective. Meant to pair with impl-structure's abstraction-angle draft.*

---

## 1. Moments of friction today

**The graph reorganizes itself.** The `fitView` call on every node add resets the viewport even when the user was deliberately zoomed into a subgraph. This feels like the app "taking the wheel" — hostile to flow state. Separate issue: the auto-layout BFS assigns Y levels based on graph traversal, so adding or removing an edge can change level assignments and visually jump nodes that had fixed positions.

**Edges are painted, not touchable.** There is no `onEdgeClick`, no `edgesFocusable` prop, no visual affordance that edges are interactive objects. The user can't click an edge to select it, can't press Delete to remove it, and the drag-to-reconnect behavior (which IS wired up via `onReconnect`) can't be discovered because clicking the edge doesn't even focus it first. The edge interaction zone exists in the DOM (`.react-flow__edge-interaction`) but produces no feedback on click — no highlight, no selection ring, nothing.

**The inspector at the bottom is fighting the canvas.** A bottom panel means every time you select a node, you lose canvas real estate at the bottom of your view — exactly where the downstream nodes are. The mental model "click node, see details on right" matches every visual IDE the user has ever used. Bottom panels work for terminals and logs, not property panels.

**The `ref` field is exposed raw.** A user sees `.normalize:process` and has to know that `.` means "relative to this flow's module", `:` separates module from function name, and that they need to know Python module paths to wire anything. This is the biggest "I don't want to see all this Python" signal.

**The hidden "flush-stacked" edge is invisible state.** When two nodes snap together perfectly (edge length 0), the connecting edge is hidden. This means a connected pair looks identical to a disconnected pair that happen to be co-located. The user cannot tell, by looking, whether nodes are wired up or just nearby.

---

## 2. Edges as first-class objects

**The fix is three lines of props** on `<ReactFlow>`: add `edgesFocusable`, remove the condition that gates drag-start on a prior hover, and wire `onEdgeClick` to call `onSelectNode(null)` + set an `selectedEdgeId` state (which highlights the edge and shows a delete affordance).

**Visual selection state for edges**: a selected edge should change to `--selection` blue stroke + slightly thicker, with a small `×` badge at its midpoint (or just rely on Delete key once the edge has focus). The `×` badge is more discoverable for users who don't know keyboard shortcuts.

**Flush-stacked hidden edges: roll back.** The "snap two nodes together and the edge disappears" trick is clever code but produces invisible state. The fix is simpler: when nodes are flush-stacked, render the edge as a short stub or just show it normally — xyflow handles overlapping edges fine. Removing invisible state is worth the minor aesthetic tradeoff.

**Reconnect drag:** already wired (`onReconnect` → `reconnectEdge`). The problem is discoverability — you have to hover the edge handle endpoint precisely. Once edges are clickable (selected state), a subtle glow on the endpoints of a selected edge would signal "drag me to reroute."

---

## 3. Layout stability

**The rule should be: never move a node you didn't explicitly move.** Specifically:

- Node positions are preserved through rename, ref change, exit mutation, anything
- Auto-layout (BFS Y-level assignment) only runs on the very first render of a flow that has no saved positions at all
- `fitView` on node-add is removed; replace with a pan-to-new-node that just brings the new node into view without rescaling the whole viewport
- Exit reorder, severity update, fan-out detection: zero effect on node positions

The viewport cache already gives us per-flow position memory across tab switches. We just need to stop calling `fitView` aggressively.

---

## 4. Fan-out and severity signaling

**Red severity borders: keep, but soften.** The red border on a broken node is the right affordance — it matches every linting/error UI the user knows. But the border is thin (1px) and easy to miss at normal zoom. Thicken to 2px for `blocking`, 1.5px for `warning`, and add a very subtle red/amber inner glow (box-shadow) to make it legible at small sizes.

**Dashed amber fan-out edges: cut.** This was our implementation but the user's reaction ("what are these different colored edges?") confirms it's noise. Fan-out is a valid flow construct that users explicitly create — it doesn't need a warning signal at all. Regular edges should all look the same. The `⇉` indicator on the node is worth keeping (it communicates structure without coloring all the wires), but the dashed amber stroke should revert to the standard gray.

**The `⇉` pill itself is small and cryptic.** Replace with a plain count badge in the exit cell: `out ×2` means "this exit fans to 2 targets." That's readable without knowing what `⇉` means.

---

## 5. What's working / honest assessment

**Tab icons (B3):** Working and subtle — the Python logo and flow glyph give instant visual identity to tabs. Keep.

**Handle visibility on hover (B1):** Works well. Handles appearing only on hover reduces clutter. The one failure mode is during connection drag — handles on other nodes appear, but the visual is slightly jumpy because they pop in all at once. A CSS transition would smooth it.

**Snap-to-place on node drop:** The snap target highlight is good. But the confirmation (edge auto-wired) is invisible — the edge appears but there's no momentary flash or confirmation. Users aren't sure if the auto-wire happened.

**Toast errors (B5):** Working and appropriately unobtrusive. Keep.

**Switcher strip drag-reorder (B6):** Clever but hard to discover. No affordance that cells are draggable. A `⠿` drag handle icon (6-dot grip) on hover would signal "this is draggable."

---

## 6. Three fixes to make this actually usable

**1. Move the Inspector to the right sidebar.** This single change fixes the "inspector should be on the side" complaint, stops the canvas from shrinking on selection, and matches the spatial model of every node-graph tool. The implementation is a CSS flex-direction change in Shell + replacing the bottom panel slot with a right panel slot in DockviewCanvas or Shell. One afternoon of work.

**2. Make edges clickable and deletable.** Add `edgesFocusable` to `<ReactFlow>`, wire `onEdgeClick` to set selected edge state (highlight + show delete affordance), and show a `×` badge on the selected edge. This directly addresses "why can't I select edges at all?" and unlocks reconnect discovery. One hour of work.

**3. Lock node positions.** Remove `fitView` on node-add (replace with pan-to-node), ensure that no code path calls `setNodes` with recomputed positions for existing nodes, and remove the flush-stacked edge-hiding hack. This directly addresses "the graph keeps reorganizing itself." Mostly deletions — removing the fitView call and the isFlushStacked logic.

Everything else (ref abstraction, type locality, Python hiding) is important but requires backend model changes. These three are pure frontend and fix the three loudest usability complaints in direct proportion to implementation cost.
