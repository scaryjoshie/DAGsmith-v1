# DAGsmith — agent notes

## Stack

- **Backend**: Python + FastAPI + Pydantic v2. Server package at `dagsmith/server/` (app, registry, mutations, introspection, routes_*, schemas). Permissive posture (see below). 116 tests.
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + `@xyflow/react` + `dockview` + `@codemirror/*`. Dark Vercel-style aesthetic.
- **Design tokens** in `src/index.css` via `@theme inline`: `surface-0..3` (bg depth), `ink-0..3` (text/icons), `line-0..2` (borders), semantic `red / amber / amber-muted / green / blue`, `rounded-none/xs/sm`, `font-mono/sans`, `text-xs/sm/md/lg`. `--spacing` pinned to absolute `4px` (html font-size is 13px). Full rationale in `docs/CHANGES_2026-04.md` → Tailwind v4 migration.
- **Vendor overrides** in `src/vendor-overrides.css`: library quirks (CodeMirror, React Flow, Dockview) scoped under wrapper classes, wrapped in `@layer base` for `!important` cascade priority.

## Working method (non-negotiable)

1. **One change at a time.** User describes → implement → playwright-cli verify in browser → commit → next.
2. **Build-green ≠ feature-works.** `npm run build` passing does not mean it works. Always open in a browser.
3. **No unsolicited changes.** If asked for X, do X. Don't also "improve" Y.
4. **Agent teams for multi-step work.** `TeamCreate` + `TaskCreate` + spawn via `Agent` with `team_name`. Coordinate via `SendMessage`.
5. **Commit at every known-good state.** Uncommitted working tree is unrecoverable if something goes sideways.

## Permissive posture (SPEC §3)

Backend accepts any shape, emits diagnostics. Runtime raises at the point of violation. Never add a validator that *rejects* a semantic violation — emit a `Diagnostic` instead.

## Dev loop

- Backend: `uv run dagsmith ui examples.customer` (port 8001)
- Frontend: `cd frontend && npm run dev` (port 5173)
- Tests: `uv run pytest -q` from repo root
- Visual verify: `playwright-cli open --browser=chromium http://localhost:5173/?workspace=examples.customer` + `screenshot`
- Ad-hoc screenshots: save to `/screenshots/` (gitignored) or leave under playwright-cli's default `.playwright-cli/`. Never drop PNGs at repo root.

## Docs

- `docs/SPEC.md` — source of truth for scope (M1-M6 backend, frontend feature spec).
- `docs/CORE_MODEL.md` + `docs/DESIGN.md` — project philosophy (pro-code, DAG-only, pure-function flows).
- `docs/CHANGES_2026-04.md` — living session log. Latest work + forward plan live here.
- `docs/EDITOR_MERGE.md`, `NODE_TAXONOMY.md`, `ANNOTATIONS.md`, `SIDEBAR.md` — forward feature design.

## Transcripts as recovery

Claude Code stores conversation transcripts at `~/.claude/projects/-Users-joshua-dev-dagsmith/*.jsonl` with full `Write`/`Edit` tool inputs. If file contents get lost before committing, JSONL-grep for the relevant Write call and write the content back out.
