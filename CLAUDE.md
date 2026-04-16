# DAGsmith — agent notes

## Current state

### Backend (commit `d8cd3b4`): M1-M4 landed, 108 tests passing

- **M1**: IR + `dagsmith/diagnostics.py` (Diagnostic with `computed_field` id, `derived_from`, SourceLocation, UnresolvableRef, closed `DiagnosticCode` literal). `NodeSpec.kind` accepts `"python" | "flow"`. Semantic raises removed.
- **M2**: Work-queue `_run` with sequential fan-out + visited-merge; `AmbiguousRoute` / `MultiplePublicExitsReached` exceptions; tracer hook on `run_flow`; Tarjan cross-flow cycle detection emitting `cross_flow_cycle` diagnostics; `unresolved_flow_ref` at load.
- **M3**: Permissive loader. All seven §6.4 gaps relaxed. `_BrokenFlow` sentinel; `_resolve_ref_or_sentinel` returns `UnresolvableRef` (with `syntax_error` discriminated from `unresolved_ref`); shape diagnostics emitted; `WorkspaceRegistry` extracted.
- **M4**: `dagsmith/server/` package (app, registry, mutations, introspection, types_palette, schemas, _helpers, routes_read/mutate/run/introspect). New endpoints: types palette, group CRUD, per-flow + workspace diagnostics, flow tree. Diagnostics included in `FlowView` and mutation responses.

### Frontend (uncommitted working tree — NEEDS COMMIT)

**At the "pre-dockview good state":**
- Vercel design tokens in `src/index.css` (black bg, thin borders, mono, sharp corners)
- IDE shell (`Shell.tsx` + `Shell.module.css`): left sidebar + canvas area
- `LeftSidebar` with Workspace / Flows / Types / Diagnostics sections + pinned Run & Add node
- Top tab bar (`TabBar.tsx`) with dnd-kit sortable tabs + context menu (Split right / Split down / Close)
- `PaneTree` renders nested split panes
- `TabsProvider` + `reducer` with `mapPanes` early-out (fixes split-tab stack overflow), localStorage persistence, split keeps origin tab (doesn't move it)
- `FlowGraph` wrapped in `<ReactFlowProvider>` per-instance, viewport cache per flow_id, brighter grid + edges than the aesthetic-pass version
- `WorkflowNode` has the **switcher strip** at the bottom for multi-exit nodes (cells with per-exit labels + handles — no more overlapping labels)
- `NodePopover` on canvas selection: kind chip, input, ref, exits, "Open source →"
- `SourceTab` (read-only CodeMirror)
- `FloatingRunPanel` overlay
- `AddNodeDialog` simplified to one name field, Enter to create (backend defaults the rest)
- `vite.config.ts` has `resolve.dedupe` + `resolve.alias` + `optimizeDeps.include` for `@dnd-kit/*` (fixes invalid-hook-call under React 19 Vite HMR)

**Deliberately NOT at this state (these came later and broke things):**
- `flowCache` multi-flow state (each tab fetches its own flow independently)
- Per-instance tab IDs (same flow can appear in multiple panes)
- dockview migration (attempted, rolled back)
- Frontend Ctrl/Cmd+W keybinding + focus-visible rings (cheap to add if wanted)

### Known limitations at the current frontend state

- **Single-tab split is a visual no-op.** `split` action removes the tab from origin, new pane gets it, origin collapses. Need 2+ tabs open before split shows two panes. Fix requires rethinking split semantics.
- **Stale tab on workspace switch.** Tabs saved per-workspace in localStorage but if you switch workspace and a flow with the same ID doesn't exist there, you see a "loading…" forever. Known.
- `classify` auto-layout packs the 3 exit pills horizontally, tight but not overlapping anymore.

## Working method (non-negotiable)

This session wrecked a working state by chaining too many rewrites. Going forward:

1. **One change at a time.** User describes → you implement → playwright-cli verify in browser → commit → next.
2. **Build-green is NOT feature-works.** `npm run build` passing does not mean the feature works. Always open in a browser.
3. **No unsolicited aesthetic changes.** If user asks for X, do X. Don't also "improve" Y.
4. **Agent teams by default** for multi-step work. Use `TeamCreate` + `TaskCreate` + spawn via `Agent` with `team_name`. Agents coordinate via `SendMessage`.
5. **Commit at every known-good state.** Uncommitted working tree is unrecoverable if something goes sideways.

## Prefer libraries

For UI primitives (drag-and-drop, split panes, focus traps, command palettes): use an established library. Hand-rolled versions tend to be buggier and less accessible. Skip the library only when it would make code longer AND less readable AND less correct.

Currently in use:
- `@dnd-kit/*` for tab reordering (needs Vite `dedupe` + `optimizeDeps.include` to avoid React 19 invalid-hook-call)
- `@xyflow/react` for the flow graph canvas
- `@codemirror/*` + `@uiw/react-codemirror` for source editing
- Pydantic v2 + FastAPI on backend

## Permissive posture (SPEC §3)

Backend accepts any shape, emits diagnostics. Runtime raises at the point of violation. Never add a validator that *rejects* a semantic violation — emit a `Diagnostic` instead.

## Dev loop

- Backend: `uv run dagsmith ui examples.customer` (port 8001)
- Frontend: `cd frontend && npm run dev` (port 5173)
- Tests: `uv run pytest -q` from repo root
- Visual verify: `playwright-cli open --browser=chromium http://localhost:5173/?workspace=examples.customer` + `screenshot`

## Spec

`docs/SPEC.md` is source of truth for scope. `docs/CORE_MODEL.md` + `docs/DESIGN.md` have project philosophy (pro-code, DAG-only, pure-function flows).

## Transcripts as recovery

Claude Code stores conversation transcripts at `~/.claude/projects/-Users-joshua-dev-dagsmith/*.jsonl` with full `Write`/`Edit` tool inputs. If file contents get lost to an `rm` or `git checkout --` before committing, the exact content can be extracted by JSONL-grepping for the right Write call and writing the content back out. Prefer this over rewriting from memory.
