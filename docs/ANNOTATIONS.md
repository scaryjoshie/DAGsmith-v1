# Annotations — sticky notes on the canvas

**Status: design in progress — do not implement without explicit user approval.**

---

## Concept

A sticky note is a free-floating Markdown block positioned on the canvas. It is not tied to any node and has no edges. It exists purely as documentation embedded in the graph itself.

The user's framing:

> *"If you have really consistent node locations, we could literally have documentation in the graph, or in the flow, which would be so cool."*

> *"I could write sticky notes with headers or many Markdown files inside the flow or inside the graph at certain places, just to kind of mark things."*

The motivating observation: once node positions are stable (layout stability now shipped), the spatial relationship between a sticky note and nearby nodes carries meaning. A note placed above a cluster of validation nodes is self-evidently about that cluster, without needing an explicit link.

---

## Behavior

- **Draggable and resizable.** Position and dimensions are user-controlled on the canvas.
- **Markdown text.** Content is plain Markdown, rendered in-place. Click to edit (transitions to a plain text editor for the markdown source).
- **Faint background panel.** Visually distinct from nodes — lower contrast, no exit handles, no selection ring. Feels like a Post-it on the graph rather than a first-class node.
- **No edges, no topology.** A sticky note cannot be connected to anything. It does not participate in execution.

---

## Storage

Sticky notes live in `flow.json`'s `layout` block:

```json
"layout": {
  "nodes": { ... },
  "sticky_notes": [
    { "id": "note_1", "x": 120, "y": 40, "w": 240, "h": 120, "markdown": "## Validation cluster\nThese three nodes handle..." }
  ]
}
```

Fields: `id` (unique within the flow), `x`, `y` (canvas coordinates), `w`, `h` (dimensions in pixels), `markdown` (raw Markdown string).

**Why `layout`, not `nodes`?** Sticky notes have no runtime presence. They don't appear in diagnostics, they don't participate in the executor, they have no `ref` or `exits`. Putting them in `layout` keeps the `nodes` dict semantically clean — everything there is something the runtime knows about.

---

## Difference from node-docs

Node-level documentation (inline Markdown describing a specific node's purpose, parameters, caveats) is a separate concept. It's scoped to a node and shown in the editor header when that node's tab is open. It does not appear on the canvas.

Sticky notes are canvas-scoped. They document spatial regions, flows of control, or anything the author wants to call out at the graph level. The two complement each other: node-docs for per-node detail, sticky notes for graph-level narration.

---

## Dependencies

- **Layout stability** — a prerequisite, now shipped. Sticky notes only make sense when node positions are persistent and trustworthy.
- **Canvas mutation API** — a new `PUT /layout` call that accepts `sticky_notes` updates (or the existing layout endpoint extended to handle them).
- **Renderer** — sticky notes rendered as xyflow `<foreignObject>` custom nodes (non-connectable, non-selectable in the node sense).

---

## OPEN questions

- **Creation UX:** right-click canvas → "Add sticky note"? A toolbar button? Double-click on empty canvas?
- **Minimum size:** should there be a minimum `w`/`h` to prevent accidentally tiny notes?
- **Z-order:** should sticky notes always render behind nodes, or should they be freely stackable?
- **Multi-note edit:** if a user wants the same note text on two flows, copy-paste is the answer for now.
