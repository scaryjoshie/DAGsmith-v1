import type {
  LeafPane,
  OpenTabInput,
  OpenTabOptions,
  Pane,
  SplitPane,
  SplitTarget,
  Tab,
  TabsState,
} from './types';

let paneIdCounter = 0;
function nextPaneId(): string {
  paneIdCounter += 1;
  return `p${paneIdCounter}`;
}

export function resetPaneIdCounter(seed = 0): void {
  paneIdCounter = seed;
}

function tabIdFor(input: OpenTabInput): string {
  if (input.kind === 'flow') return input.flow_id;
  return `${input.flow_id}:${input.node_id}`;
}

function tabFrom(input: OpenTabInput): Tab {
  if (input.kind === 'flow') {
    return {
      kind: 'flow',
      id: input.flow_id,
      title: input.title ?? input.flow_id,
      flow_id: input.flow_id,
    };
  }
  return {
    kind: 'source',
    id: `${input.flow_id}:${input.node_id}`,
    title: input.title ?? input.node_id,
    flow_id: input.flow_id,
    node_id: input.node_id,
    source_path: input.source_path,
  };
}

export function makeEmptyState(): TabsState {
  resetPaneIdCounter();
  const rootId = nextPaneId();
  return {
    root: { kind: 'leaf', id: rootId, tabs: [], activeTabId: null },
    activePaneId: rootId,
  };
}

function walkPanes(root: Pane, fn: (p: Pane) => void): void {
  fn(root);
  if (root.kind === 'split') {
    walkPanes(root.first, fn);
    walkPanes(root.second, fn);
  }
}

export function findTab(root: Pane, tabId: string): {
  pane: LeafPane;
  tab: Tab;
} | null {
  let found: { pane: LeafPane; tab: Tab } | null = null;
  walkPanes(root, (p) => {
    if (found) return;
    if (p.kind === 'leaf') {
      const t = p.tabs.find((x) => x.id === tabId);
      if (t) found = { pane: p, tab: t };
    }
  });
  return found;
}

export function findPane(root: Pane, paneId: string): Pane | null {
  let found: Pane | null = null;
  walkPanes(root, (p) => {
    if (!found && p.id === paneId) found = p;
  });
  return found;
}

function mapPanes(root: Pane, fn: (p: Pane) => Pane): Pane {
  const mapped = fn(root);
  // If fn replaced this node, trust the replacement as-is — don't recurse into
  // its subtree. Recursing would infinite-loop when a pane is wrapped in a new
  // split that still contains it as a child.
  if (mapped !== root) return mapped;
  if (mapped.kind === 'split') {
    return {
      ...mapped,
      first: mapPanes(mapped.first, fn),
      second: mapPanes(mapped.second, fn),
    };
  }
  return mapped;
}

function updateLeaf(
  root: Pane,
  paneId: string,
  fn: (leaf: LeafPane) => LeafPane
): Pane {
  return mapPanes(root, (p) => {
    if (p.kind === 'leaf' && p.id === paneId) return fn(p);
    return p;
  });
}

function leavesOf(root: Pane): LeafPane[] {
  const out: LeafPane[] = [];
  walkPanes(root, (p) => {
    if (p.kind === 'leaf') out.push(p);
  });
  return out;
}

function collapseEmptyPanes(root: Pane): Pane {
  if (root.kind === 'leaf') return root;
  const first = collapseEmptyPanes(root.first);
  const second = collapseEmptyPanes(root.second);
  const firstEmpty = first.kind === 'leaf' && first.tabs.length === 0;
  const secondEmpty = second.kind === 'leaf' && second.tabs.length === 0;
  if (firstEmpty && secondEmpty) return first;
  if (firstEmpty) return second;
  if (secondEmpty) return first;
  return { ...root, first, second };
}

export type Action =
  | { type: 'open'; input: OpenTabInput; options?: OpenTabOptions }
  | { type: 'close'; paneId: string; tabId: string }
  | { type: 'activate'; paneId: string; tabId: string }
  | { type: 'focusPane'; paneId: string }
  | { type: 'move'; paneId: string; fromIndex: number; toIndex: number }
  | {
      type: 'split';
      paneId: string;
      target: SplitTarget;
      tabId?: string;
    }
  | {
      type: 'resizeSplit';
      splitId: string;
      sizes: [number, number];
    }
  | { type: 'hydrate'; state: TabsState }
  | { type: 'reset' };

export function reducer(state: TabsState, action: Action): TabsState {
  switch (action.type) {
    case 'open': {
      const input = action.input;
      const options = action.options ?? {};
      const tabId = tabIdFor(input);
      const existing = findTab(state.root, tabId);
      if (existing && !options.split) {
        const root = updateLeaf(state.root, existing.pane.id, (leaf) => ({
          ...leaf,
          activeTabId: tabId,
        }));
        return { ...state, root, activePaneId: existing.pane.id };
      }

      if (options.split) {
        const activePane = findPane(state.root, state.activePaneId);
        if (activePane && activePane.kind === 'leaf') {
          const direction = options.split === 'right' ? 'row' : 'column';
          const newLeafId = nextPaneId();
          const newLeaf: LeafPane = {
            kind: 'leaf',
            id: newLeafId,
            tabs: [tabFrom(input)],
            activeTabId: tabId,
          };
          const newSplit: SplitPane = {
            kind: 'split',
            id: nextPaneId(),
            direction,
            first: activePane,
            second: newLeaf,
            sizes: [50, 50],
          };
          const root = mapPanes(state.root, (p) =>
            p.id === activePane.id ? newSplit : p
          );
          return { ...state, root, activePaneId: newLeafId };
        }
      }

      const targetPaneId = state.activePaneId;
      const root = updateLeaf(state.root, targetPaneId, (leaf) => ({
        ...leaf,
        tabs: [...leaf.tabs, tabFrom(input)],
        activeTabId: tabId,
      }));
      return { ...state, root, activePaneId: targetPaneId };
    }

    case 'close': {
      const pane = findPane(state.root, action.paneId);
      if (!pane || pane.kind !== 'leaf') return state;
      const idx = pane.tabs.findIndex((t) => t.id === action.tabId);
      if (idx === -1) return state;
      const newTabs = [...pane.tabs.slice(0, idx), ...pane.tabs.slice(idx + 1)];
      let newActive: string | null = pane.activeTabId;
      if (pane.activeTabId === action.tabId) {
        const fallback = newTabs[idx] ?? newTabs[idx - 1] ?? null;
        newActive = fallback ? fallback.id : null;
      }
      const rootWithUpdate = updateLeaf(state.root, action.paneId, (leaf) => ({
        ...leaf,
        tabs: newTabs,
        activeTabId: newActive,
      }));
      const collapsed = collapseEmptyPanes(rootWithUpdate);
      const leaves = leavesOf(collapsed);
      const activePaneStillExists = leaves.some(
        (l) => l.id === state.activePaneId
      );
      const activePaneId = activePaneStillExists
        ? state.activePaneId
        : leaves[0]?.id ?? action.paneId;
      return { root: collapsed, activePaneId };
    }

    case 'activate': {
      const root = updateLeaf(state.root, action.paneId, (leaf) => {
        if (!leaf.tabs.some((t) => t.id === action.tabId)) return leaf;
        return { ...leaf, activeTabId: action.tabId };
      });
      return { ...state, root, activePaneId: action.paneId };
    }

    case 'focusPane': {
      if (!findPane(state.root, action.paneId)) return state;
      return { ...state, activePaneId: action.paneId };
    }

    case 'move': {
      const root = updateLeaf(state.root, action.paneId, (leaf) => {
        if (
          action.fromIndex < 0 ||
          action.fromIndex >= leaf.tabs.length ||
          action.toIndex < 0 ||
          action.toIndex >= leaf.tabs.length ||
          action.fromIndex === action.toIndex
        ) {
          return leaf;
        }
        const next = [...leaf.tabs];
        const [moved] = next.splice(action.fromIndex, 1);
        next.splice(action.toIndex, 0, moved);
        return { ...leaf, tabs: next };
      });
      return { ...state, root };
    }

    case 'split': {
      const pane = findPane(state.root, action.paneId);
      if (!pane || pane.kind !== 'leaf') return state;
      const tabId = action.tabId ?? pane.activeTabId;
      if (!tabId) return state;
      const tab = pane.tabs.find((t) => t.id === tabId);
      if (!tab) return state;

      const direction = action.target === 'right' ? 'row' : 'column';
      const remainingTabs = pane.tabs.filter((t) => t.id !== tabId);
      const remainingActive =
        pane.activeTabId === tabId
          ? remainingTabs[0]?.id ?? null
          : pane.activeTabId;

      const updatedOrigin: LeafPane = {
        ...pane,
        tabs: remainingTabs,
        activeTabId: remainingActive,
      };
      const newLeafId = nextPaneId();
      const newLeaf: LeafPane = {
        kind: 'leaf',
        id: newLeafId,
        tabs: [tab],
        activeTabId: tab.id,
      };
      const split: SplitPane = {
        kind: 'split',
        id: nextPaneId(),
        direction,
        first: updatedOrigin,
        second: newLeaf,
        sizes: [50, 50],
      };
      const root = mapPanes(state.root, (p) =>
        p.id === pane.id ? split : p
      );
      const collapsed = collapseEmptyPanes(root);
      return { root: collapsed, activePaneId: newLeafId };
    }

    case 'resizeSplit': {
      const root = mapPanes(state.root, (p) => {
        if (p.kind === 'split' && p.id === action.splitId) {
          return { ...p, sizes: action.sizes };
        }
        return p;
      });
      return { ...state, root };
    }

    case 'hydrate':
      return action.state;

    case 'reset':
      return makeEmptyState();

    default:
      return state;
  }
}
