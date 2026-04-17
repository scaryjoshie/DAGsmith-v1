# Sidebar — activity bar proposal

**Status: design in progress — do not implement without explicit user approval.**

---

## Activity bar

The leftmost column is a narrow (~48px) strip of icon buttons, one per major section. Clicking an icon opens or closes the corresponding contextual side panel. This is the VS Code / Cursor pattern: the activity bar is always visible; the panel content swaps based on what's active.

Proposed sections:

- **Workspace** — workspace switcher, recent flows
- **Files** — file tree (see below)
- **Types** — type palette (see below)
- **Diagnostics** — workspace-level diagnostic list
- **Settings** — editor preferences, keybindings, theme

The activity bar replaces the current single always-visible sidebar, which has everything stacked in one column. The benefit: each section gets full panel height when active; sections don't compete for vertical space.

---

## File tree

The file panel renders the workspace as a folder tree, mirroring the on-disk layout: `workspace / flow / node.py`. This makes it natural to navigate to a specific node file, open it in the editor, and see where it lives relative to other nodes in the same flow.

The tree is not a raw filesystem view — it filters to files the workspace knows about (node Python files, flow.json files, type modules). Unrecognized files are hidden by default.

---

## Types panel

The types panel surfaces the workspace's type palette. The user's question about scoping:

> *(paraphrased) Should the types panel be per-workspace or per-flow?*

This is **OPEN**. Arguments for workspace-scoped: types defined in shared modules are available to all flows; showing the full palette gives context. Arguments for flow-scoped: most of the time you care about types relevant to the flow you're editing; the list is shorter and more focused.

A middle path: show workspace types by default, with a filter chip to narrow to the current flow's local types. The existing types palette endpoint already returns a `scope` field (`flow_local`, `workspace`, `shared`) that could drive this.

### Types as a floating modal (OPEN)

The user raised the idea of the types palette as a draggable floating modal rather than a sidebar panel — something you could pop open, position near the canvas, then dismiss. This would let you drag a type directly onto a node's exit or input handle.

This is noted but unresolved. The sidebar panel and the floating modal are not mutually exclusive — the panel could have a "pop out" button.

---

## OPEN questions

- **Workspace vs. flow scope for Types:** does the panel show all workspace types, or just types relevant to the open flow?
- **Floating modal vs. panel:** can the types palette be detached from the sidebar into a floating window?
- **Activity bar icon set:** which icons, and is there a "collapse all" gesture that hides the panel without changing the active section?
