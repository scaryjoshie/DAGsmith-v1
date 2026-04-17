# Editor merge design note

**Status: design in progress — do not implement without explicit user approval.**

This doc captures the agreed direction and user reasoning across these design areas: tab-open behavior, Inspector-into-editor merge, attachment management, type hints as source of truth, emit/return semantics, and multi-param nodes.

---

## 1. Tab-open behavior (preview-tab pattern)

Node selection opens source as an ephemeral **preview tab** in the non-active pane, auto-creating a right-split if none exists. The preview tab is visually distinct (italic title or dashed outline). It gets reused as the selection moves — only one preview tab exists at a time.

| Action | Result |
|---|---|
| Click a node | Preview tab opens in non-active pane (right-split auto-created if needed) |
| Click a different node | Preview tab is reused for the new selection |
| Deselect (click canvas) | Preview tab closes |
| Type in the editor | Preview promotes to persistent |
| Focus the preview tab | Preview promotes to persistent |
| Double-click a node | Persistent tab from the start, no preview state |
| Shift+click a node | Opens persistent tab in the active pane instead |
| Close a preview tab explicitly | Same as deselect — preview gone |

A persistent tab is never auto-closed. It behaves like any other dockview tab: survives selection changes, can be split, reordered, closed manually.

---

## 2. Inspector → editor merge

The right Inspector sidebar is removed. All per-node metadata lives in the tab itself, above the source editor.

A **Python node tab** renders a metadata header:

```
NAME         enrich                               (editable)
PATH         examples.customer.onboarding/enrich  (display, workspace-relative)
REF          .enrich:process                      (editable)
EXITS        out → NormalizedCustomer             (editable list, +add exit)
ATTACHMENTS  [💾 off] [⚡ off]
──────────────────────────────────────────────────────
def process(c: RawCustomer) -> NormalizedCustomer: ...
```

A **flow tab** gets an analogous header: flow name, workspace path, input type. Subflow references and public exits are shown below the separator.

The header fields map directly to the PATCH /nodes mutation fields already implemented. Inline editing in the header fires the same endpoints as the old Inspector fields did.

**Selection state is retained** — the selected node is still tracked in app state (the Delete key still needs to know what to delete, and keyboard nav should still work). But the display responsibility moves entirely into the tab. Nothing is shown in a sidebar.

Diagnostics for the selected node surface in the header area (below the exits row), replacing the badge+popover in the old Inspector.

---

## 3. Attachment management in the merged editor

The ATTACHMENTS row in the header shows toggle pills for each available attachment type: `[💾 off] [⚡ off]`. Clicking a pill expands a config panel inline, directly below the header row. Clicking again collapses it.

**Why attachments belong in the header, not a separate sidebar:** attachments are node-scoped. Putting them in a separate panel that shows up elsewhere breaks the mental model that everything about a node is visible when its tab is open. The inline-expand pattern also avoids the modality problem of floating panels.

---

## 4. Attachment visual tiers

Not all attachments should appear as pills on the canvas node. The user's reasoning:

> *"the attachments look really big, so maybe only some should show externally."*

The proposed split:

- **Visible on canvas (corner pill):** runtime-behavior-changing attachments — Storage, Trigger, Breakpoint. These affect execution and the user needs to notice them at a glance while reading the graph.
- **Editor-header only (not on canvas):** documentation/metadata — inline Markdown docs for the node. These are useful in the editor but would clutter the graph if shown as pills. A node with extensive docs looks the same as one with none.

This keeps the canvas readable. The pill is a signal, not a summary.

---

## 5. Code as source of truth (revised)

An earlier version of this doc said "type hints are the source of truth." That was too strong. The corrected framing:

**Code is authoritative. `flow.json` is topology + cached types.**

The user's framing of why this matters:

> *"Should type hints really be source of truth? I'm not super opposed, but I do wonder if this is problematic. What could be cool though, is if as you added emits or other type hints, etc, that the inspector would automatically detect this and add them."*

That observation is the key: the interesting direction isn't just "read types from code" but **bidirectional sync where code is the write target**. The backend re-introspects on file save; the cached types in `flow.json` stay in sync. UI edits in the editor header (changing a type annotation via the EXITS field) rewrite the code, which re-derives. One source of truth (code), bidirectional in effect.

This means:
- `flow.json` exits/input fields are cache, not ground truth, when source is available.
- Unresolvable refs still fall back to `flow.json` values (permissive posture — no code, no introspection possible).
- The loader's existing re-introspect-on-reload path is the right hook for this.

---

## 6. Emits vs returns semantics

### The rule

**Single-exit node**: plain `return value`. The return annotation is the output type. No ceremony.

```python
def process(c: RawCustomer) -> NormalizedCustomer:
    return normalize(c)
```

**Multi-exit node**: `@exits(name=Type, ...)` decorator + `emit("name", value)` calls. No plain `return` in multi-exit functions.

```python
@exits(valid=NormalizedCustomer, invalid=ValidationError)
def validate_email(c: RawCustomer):
    if is_valid(c.email):
        emit("valid", normalize(c))
    else:
        emit("invalid", ValidationError(field="email", value=c.email))
```

Different types per exit are allowed and expected. The decorator is the source of truth for what exits a function exposes.

### Why the dichotomy

The split matches the visual dichotomy: single-handle nodes vs. switcher-strip nodes. Mixing `return` + `emit` in a multi-exit function would be ambiguous — what does `return` mean when two other exits already fired? Keeping them separate makes each mode unambiguous and maps cleanly to the graph rendering.

### Backend implications

- **Introspection**: the loader must detect the `@exits` decorator to know a function is multi-exit. This replaces the current `exits` dict in `flow.json` as the authoritative source when code is available — `flow.json` still carries exits for unresolvable refs.
- **Runtime**: `emit` is a hook captured by the executor. The tracer hook in SPEC §5.3 already captures `(exit_name, payload)` pairs; `emit` plugs into that path.
- **Permissive posture**: a `@exits`-decorated function that uses plain `return` instead of `emit` produces a diagnostic, not a load-time error. A function that calls `emit` without `@exits` similarly gets a diagnostic.

### OPEN: unresolved questions

- **Where does `emit` come from?** Import from `dagsmith` runtime (`from dagsmith import emit`)? A context variable injected by the executor? Decorator injection? The import form is most obvious but creates a dagsmith dependency in every node file.
- **Does `emit` return `None` or the payload?** Returning the payload allows `return emit("out", value)` as a style, but that re-introduces `return` in multi-exit functions — which the rule above forbids.
- **Async nodes?** An `async def` that calls `await emit(...)` requires the executor to be async-aware. Deferred.

---

## 7. Multi-param nodes (deferred)

**OPEN — do not implement without explicit approval.**

The user raised the idea of functions with multiple input parameters:

> *"for funcs with multiple params, if we would want to have a top switch as well, that represented all the params (which are demanded) for the func to begin."*

The concept: a top switcher strip (mirroring the bottom exit switcher) where each cell is a named input handle. A node with `def process(a: TypeA, b: TypeB)` would show two top handles. Edges from upstream nodes connect to specific named inputs.

**Runtime implication: join semantics.** The node fires only when *all* required inputs have arrived from upstream. This is a significant executor change — the current model assumes one input value flows through each node sequentially.

**Complications to flag:**
- **Deadlock risk:** if an upstream branch never fires a particular exit (e.g. `validate_email` routes to `invalid` but `process` needs the `valid` output), the join never completes. Need optional/required markers on inputs, or a timeout/cancel mechanism.
- **Fan-in topology:** joins introduce fan-in, which combined with fan-out can create diamond patterns. These are valid DAGs but the executor needs explicit join-point tracking.
- **Ordering:** if two inputs arrive at different times (because upstream branches have different lengths), does the second arrival trigger the join? What if a third value arrives on a previously-satisfied input handle before the other input arrives?

Flagged for future design discussion. Not in scope for current work.
