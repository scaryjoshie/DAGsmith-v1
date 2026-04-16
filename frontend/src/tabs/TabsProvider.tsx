import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import {
  findTab,
  makeEmptyState,
  reducer,
  resetPaneIdCounter,
  type Action,
} from './reducer';
import type {
  OpenTabInput,
  OpenTabOptions,
  Pane,
  Tab,
  TabsState,
} from './types';

interface TabsContextValue {
  state: TabsState;
  dispatch: (a: Action) => void;
  openTab: (input: OpenTabInput, options?: OpenTabOptions) => void;
  closeTab: (paneId: string, tabId: string) => void;
  setActiveTab: (paneId: string, tabId: string) => void;
  focusPane: (paneId: string) => void;
  moveTab: (paneId: string, fromIndex: number, toIndex: number) => void;
  splitPane: (paneId: string, target: 'right' | 'down', tabId?: string) => void;
  reset: () => void;
  findTabById: (tabId: string) => { pane: Pane; tab: Tab } | null;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const STORAGE_PREFIX = 'dagsmith.tabs.';
const STORAGE_VERSION = 1;

interface StoredBlob {
  v: number;
  state: TabsState;
  seed: number;
}

function storageKey(workspace: string): string {
  return `${STORAGE_PREFIX}${workspace}`;
}

function maxPaneSeed(state: TabsState): number {
  let max = 0;
  const visit = (p: Pane): void => {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
    if (p.kind === 'split') {
      visit(p.first);
      visit(p.second);
    }
  };
  visit(state.root);
  return max;
}

function loadStored(workspace: string): TabsState | null {
  try {
    const raw = window.localStorage.getItem(storageKey(workspace));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBlob;
    if (parsed.v !== STORAGE_VERSION || !parsed.state) return null;
    resetPaneIdCounter(parsed.seed ?? maxPaneSeed(parsed.state));
    return parsed.state;
  } catch {
    return null;
  }
}

function saveStored(workspace: string, state: TabsState): void {
  try {
    const blob: StoredBlob = {
      v: STORAGE_VERSION,
      state,
      seed: maxPaneSeed(state),
    };
    window.localStorage.setItem(storageKey(workspace), JSON.stringify(blob));
  } catch {
    // ignore — storage may be full or blocked
  }
}

interface TabsProviderProps {
  workspace: string;
  children: ReactNode;
}

export function TabsProvider({ workspace, children }: TabsProviderProps) {
  const [state, dispatch] = useReducer(
    reducer,
    null,
    () => loadStored(workspace) ?? makeEmptyState()
  );

  const workspaceRef = useRef(workspace);
  useEffect(() => {
    if (workspaceRef.current === workspace) return;
    workspaceRef.current = workspace;
    const next = loadStored(workspace) ?? makeEmptyState();
    dispatch({ type: 'hydrate', state: next });
  }, [workspace]);

  useEffect(() => {
    saveStored(workspace, state);
  }, [workspace, state]);

  const openTab = useCallback(
    (input: OpenTabInput, options?: OpenTabOptions) => {
      dispatch({ type: 'open', input, options });
    },
    []
  );
  const closeTab = useCallback((paneId: string, tabId: string) => {
    dispatch({ type: 'close', paneId, tabId });
  }, []);
  const setActiveTab = useCallback((paneId: string, tabId: string) => {
    dispatch({ type: 'activate', paneId, tabId });
  }, []);
  const focusPane = useCallback((paneId: string) => {
    dispatch({ type: 'focusPane', paneId });
  }, []);
  const moveTab = useCallback(
    (paneId: string, fromIndex: number, toIndex: number) => {
      dispatch({ type: 'move', paneId, fromIndex, toIndex });
    },
    []
  );
  const splitPane = useCallback(
    (paneId: string, target: 'right' | 'down', tabId?: string) => {
      dispatch({ type: 'split', paneId, target, tabId });
    },
    []
  );
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const findTabById = useCallback(
    (tabId: string) => findTab(state.root, tabId),
    [state.root]
  );

  const value = useMemo<TabsContextValue>(
    () => ({
      state,
      dispatch,
      openTab,
      closeTab,
      setActiveTab,
      focusPane,
      moveTab,
      splitPane,
      reset,
      findTabById,
    }),
    [
      state,
      openTab,
      closeTab,
      setActiveTab,
      focusPane,
      moveTab,
      splitPane,
      reset,
      findTabById,
    ]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used within a TabsProvider');
  return ctx;
}
