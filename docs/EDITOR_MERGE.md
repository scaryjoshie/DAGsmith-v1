# Editor merge design note

**Status: spec in progress — do not implement without explicit user approval.**

This doc captures the agreed direction across three related design areas: tab-open behavior, Inspector-into-editor merge, and emit/return semantics for multi-exit nodes.

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
NAME   enrich                               (editable)
PATH   examples.customer.onboarding/enrich  (display, workspace-relative)
REF    .enrich:process                      (editable)
EXITS  out → NormalizedCustomer             (editable list, +add exit)
──────────────────────────────────────────────────────
def process(c: RawCustomer) -> NormalizedCustomer: ...
```

A **flow tab** gets an analogous header: flow name, workspace path, input type. Subflow references and public exits are shown below the separator.

The header fields map directly to the PATCH /nodes mutation fields already implemented. Inline editing in the header fires the same endpoints as the old Inspector fields did.

**Selection state is retained** — the selected node is still tracked in app state (the Delete key still needs to know what to delete, and keyboard nav should still work). But the display responsibility moves entirely into the tab. Nothing is shown in a sidebar.

Diagnostics for the selected node surface in the header area (below the exits row, for example), replacing the badge+popover in the old Inspector.

---

## 3. Emits vs returns semantics

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

### Rationale

The dichotomy matches the visual dichotomy: single-handle nodes vs. switcher-strip nodes. Mixing `return` + `emit` in a multi-exit function would be ambiguous — what does `return` mean when two other exits already fired? Keeping them separate makes each mode unambiguous.

### Backend implications

- **Introspection**: the loader must detect the `@exits` decorator to know a function is multi-exit. This replaces the current `exits` dict in flow.json as the authoritative source when code is available — though flow.json still carries exits for unresolvable refs.
- **Runtime**: `emit` is a hook captured by the executor. The tracer hook in SPEC §5.3 already captures `(exit_name, payload)` pairs; `emit` plugs into that path. The executor collects all emitted pairs and routes each one.
- **Permissive posture**: a `@exits`-decorated function that uses plain `return` instead of `emit` produces a diagnostic, not a load-time error. A function that calls `emit` without `@exits` similarly gets a diagnostic.

### Open questions (not resolved here)

- **Where does `emit` come from?** Import from `dagsmith` runtime (`from dagsmith import emit`)? A context variable injected by the executor? Decorator injection that replaces the function body? The import form is most obvious but creates a dagsmith dependency in every node file.
- **Does `emit` return `None` or the payload?** Returning the payload would allow `return emit("out", value)` as a style, but that re-introduces `return` into multi-exit functions which the rule above forbids.
- **Async nodes?** An `async def` that calls `await emit(...)` would require the executor to be async-aware. Deferred question.
