# UX Redesign Proposal — impl-structure perspective

> **Historical.** Brainstorm proposals that informed Tier 1 (shipped).
> Preserved for the reasoning they capture. Current direction: see EDITOR_MERGE.md + CHANGES_2026-04.md.

## 1. What's Broken Today

**Inspector placement.** The bottom bar forces the user to read a narrow horizontal strip while their eyes are on the graph above. Fields are cramped, exits scroll off-screen. The shape fights how people actually read: top-to-bottom, not left-to-right.

**Exposed internals.** REF (`examples.customer.onboarding.nodes.enrich:enrich`), INPUT (`examples.customer.onboarding.types.CustomerRecord`), and source paths are leaking internal filesystem details to every user of every node. A new user sees these and has no idea what workspace they belong to, whether they're correct, or how to change them. They're noise at best, deterrents at worst.

**Edges can't be interacted with.** Clicking an edge does nothing. There's no way to select or delete an edge without going through some other affordance. Standard graph tools let you click-select-delete; the absence of this feels like a bug.

**Graph reorganizes unexpectedly.** Adding or renaming a node can trigger a layout recalculation that moves other nodes. Users lose their mental map of the graph every time they make a small edit. Position state is not preserved through all mutations.

**Add Node is nearly unusable.** The dialog creates a node but defaults leave it in a broken state (invalid ref, missing input type). The user sees a diagnostic immediately after adding. There's no guided flow to complete the node.

**Diagnostics are present but actionless.** The sidebar lists errors. The badge shows them in the Inspector. But the user's next move — "fix this" — has no clear path from a diagnostic to an edit affordance.

---

## 2. The Core Abstraction Change: Types Without Python

### What is a "type" from the user's perspective?

A type is a named record with named fields. That's it. The user gives it a name (`CustomerRecord`), adds fields (`name: str`, `age: int`, `email: str`), and optionally an example value. They never see a module path.

Under the hood, dagsmith writes `types/customer_record.py` containing a Pydantic `BaseModel`. The user never sees this file directly.

### Where do types live in the UI?

The existing **Types** section in the left sidebar becomes real. Clicking "Types" expands a list of type names defined in this workspace. A `+ New type` button at the bottom opens a small inline editor: name + field list (field name, field type as a simple dropdown: `str`, `int`, `float`, `bool`, or another type name). No module paths, no Python imports.

### How does the Inspector show input/output?

The INPUT field becomes a dropdown populated only from the workspace's defined types. Selecting `CustomerRecord` is all the user does — the ref string is generated automatically and stored in `flow.json`, never displayed. The REF field is removed from the Inspector entirely (the node name IS the ref for any node the user creates).

For `kind: flow` nodes (subflow references), the input type is inferred from the referenced flow's own input type — no user action needed.

### What happens on the filesystem?

- `types/customer_record.py` — auto-generated Pydantic model, never hand-edited
- `flow.json` still stores the FQN internally (needed for runtime), but the UI never renders it
- The source code panel shows the actual Python function body only — no class definition preamble

### Migration path for the customer example

The existing FQNs in `flow.json` stay as-is. The UI reads them to determine which workspace type they map to (by scanning the types directory) and displays just the short name. If no match is found, it falls back to showing the last segment of the FQN with a warning badge. This is a display-layer shim — no schema migration needed on day one.

---

## 3. Inspector Placement

**Right sidebar, revealed on node click.** When no node is selected, the right side of the canvas is empty (or shows a lightweight "select a node to inspect" placeholder). Clicking a node slides in (or simply shows) a right panel, roughly 280–320px wide.

The canvas width shrinks to accommodate it — xyflow already supports dynamic container sizing. This is preferable to an overlay because it doesn't obscure the graph.

**Vertical field layout:**

```
[KIND chip]  node_name
─────────────────────────
INPUT        CustomerRecord  ▾
─────────────────────────
EXITS
  ▸ valid    →  validate_age
  ▸ invalid  →  [unconnected]
  + Add exit
─────────────────────────
[Open source]  [Delete node]
```

Fields stack vertically. Each exit row shows the exit name and its connected target (editable inline). This gives each field enough room to be legible without horizontal scrolling.

---

## 4. Edge Interaction

Edges should be click-selectable. A selected edge highlights (thicker stroke, accent color). Pressing Delete or Backspace removes it. Right-clicking shows a small context menu: "Delete edge".

xyflow supports custom edge components with `onClick` already — this is a one-afternoon change. The harder part is ensuring that deleting an edge calls the correct backend mutation (`DELETE /flows/{id}/edges/{index}`) and triggers a refetch.

No edge labels on the edge itself — the exit name already lives on the source node's switcher strip.

---

## 5. Layout Stability

The root cause of unexpected reorganization is that auto-layout runs whenever the flow is refetched after a mutation. The fix: **auto-layout only runs once per node, on initial placement.** After that, the persisted `layout.nodes` positions are always used.

Concretely:
- On `addNode`, place the new node at a position near the cursor or at a sensible default offset from the entry node. Write that position to `layout.nodes` immediately via the PATCH layout endpoint.
- On rename/exit changes, never touch `layout.nodes`.
- On `addEdge` or `deleteEdge`, never touch `layout.nodes`.
- The auto-layout algorithm runs only when `layout.nodes` is missing for a node (first load of old flows).

---

## 6. Minimum Shipping Cut

Ranked by impact-to-effort:

1. **Inspector to right sidebar.** Highest user-visible impact. One afternoon of layout work in Shell.tsx + App.tsx. No backend changes.
2. **Layout stability (no re-layout on mutation).** Stops the most jarring behavior. Backend: don't recalculate positions on update. Frontend: remove the auto-layout trigger on refetch.
3. **Edge click-to-delete.** One afternoon. Adds a fundamental graph interaction that users expect.
4. **Hide REF and INPUT FQN from Inspector.** Display-only change. Show short name derived from the FQN. Dropdown from workspace types replaces the raw input field.
5. **Add Node guided flow.** After name entry, immediately open the Inspector for the new node so the user can set input type and exits before dismissing. No separate step.
6. **Types sidebar section (basic).** List existing types by short name. No editing yet — just visibility. Removes the sense that INPUT is a magic string.

Items 1–3 are the usability floor. Items 4–6 are the abstraction layer. Together they address every piece of user feedback above.
