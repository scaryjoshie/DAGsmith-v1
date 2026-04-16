# DAGsmith — agent notes

## Current state (branch `feat/subflows-chains-ui`)

### Backend: M1-M4 landed, 108 tests passing

- **M1 (IR + diagnostics):** `NodeSpec.kind` accepts `python` and `flow`; semantic raises removed from `NodeSpec._check_exits` and `FlowSpec._check_shape`; `dagsmith/diagnostics.py` has `Diagnostic` (with `computed_field` id, `derived_from`), `SourceLocation`, `UnresolvableRef` sentinel, closed `DiagnosticCode` literal.
- **M2 (runtime):** work-queue run loop with fan-out + visited-merge in `workspace.py`; `AmbiguousRoute` and `MultiplePublicExitsReached` exceptions; tracer hook on `run_flow`; Tarjan cross-flow cycle detection emitting `cross_flow_cycle` diagnostics; `unresolved_flow_ref` diagnostic at load.
- **M3 (permissive loader + registry):** all seven §6.4 gaps relaxed. `_BrokenFlow` sentinel for malformed flow.json (sibling flows still load); `UnresolvableRef` returned by `_resolve_ref_or_sentinel`; `_validate_flow_structure` emits diagnostics; shape diagnostics (`missing_entry_node`, `empty_exits`, `empty_public_exits`). `WorkspaceRegistry` extracted from server module global. `update_node_source` falls back to ref-string parsing. `add_edge` allows fan-out.
- **M4 (server split + endpoints):** `dagsmith/server/` is now a package — `app.py`, `registry.py`, `mutations.py`, `introspection.py`, `types_palette.py`, `schemas.py`, `_helpers.py`, and four route modules (`routes_read`, `routes_mutate`, `routes_run`, `routes_introspect`). New endpoints: `GET /workspaces/{w}/types` (palette), `POST/DELETE /flows/{fid}/group` (layout groups), `GET /flows/{fid}/diagnostics` + `GET /workspaces/{w}/diagnostics`, `GET /flows/{fid}/tree`. Diagnostics now included in `FlowView` and mutation responses per §6.3.

### Frontend: currently reverted to HEAD

The frontend was taken through M5 (IDE shell with tabs + panes + popover) and a Vercel-aesthetic pass, but both caused breakage and the user asked for a revert. Frontend is back to the pre-M5 state: single-flow canvas + right-sidebar NodePanel + inline RunPanel + AddNodeDialog. Builds clean.

## Working method (what I got wrong and what to do instead)

The user called out that this session degenerated into "bashing our heads against a wall and generating subpar code." Retrospective:

- **Too many concurrent refactors.** I chained design-pass + node redesign + dnd-kit install + dockview migration + AddNode rewrite without verifying each step. Don't do this.
- **Build-green is not feature-works.** Running `npm run build` does not confirm the user-facing behavior. Every UI change must be verified in a real browser via playwright-cli before moving on.
- **Scope creep.** "Minor design pass" became a full CSS overhaul. If the user asks for X, do X. Don't also "improve" Y.

**Going forward:**

1. One change at a time. User approves → implement → screenshot via playwright → user confirms keep → commit → next.
2. Dev server + playwright must be running for every UI change. Open the feature in a browser and use it before claiming done.
3. No unsolicited aesthetic changes.
4. Commit at each known-good state so we can bisect.

## Prefer libraries

For UI primitives (drag-and-drop, split panes, focus traps, command palettes) use an established library. Hand-rolled versions tend to be buggier and less accessible. Exception: skip a library only when it would make the code longer AND less readable AND less correct.

**Tried and rejected this session:**
- `@dnd-kit/*` for tab drag: installed, hit React-19 invalid-hook-call under Vite. Vite dedupe+alias fix worked.
- `dockview-react` for pane management: installed, migration incomplete (panel components stale-closure over renderTab, state subscription bug). Rolled back in favor of reverting to pre-M5 frontend.

## Permissive posture (SPEC §3)

Backend accepts any shape, emits diagnostics. Runtime raises at the point of violation. Never add a validator that *rejects* a semantic violation — emit a `Diagnostic` instead.

## Dev loop

- Backend: `uv run dagsmith ui examples.customer` (port 8001)
- Frontend: `cd frontend && npm run dev` (port 5173)
- Tests: `uv run pytest -q` from repo root (108 currently)
- Visual verify: `playwright-cli open --browser=chromium http://localhost:5173/?workspace=examples.customer` then `screenshot`

## Spec

`docs/SPEC.md` is the source of truth for feature scope. `docs/CORE_MODEL.md` and `docs/DESIGN.md` give the project philosophy (pro-code, DAG-only, pure-function flows).
