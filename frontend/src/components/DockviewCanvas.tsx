import { useCallback, useEffect, useRef } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type SerializedDockview } from 'dockview';
import { FlowPanel, type FlowPanelParams } from '../panels/FlowPanel';
import { SourcePanel } from '../panels/SourcePanel';
import type { WorkspaceView } from '../types';
import styles from './DockviewCanvas.module.css';

interface DockviewCanvasProps {
  workspaceName: string;
  workspace: WorkspaceView | null;
  onApiReady?: (api: DockviewApi) => void;
  onActivePanelChange?: (params: FlowPanelParams | null) => void;
}

const components = {
  flow: FlowPanel,
  source: SourcePanel,
};

const LAYOUT_KEY = (ws: string) => `dagsmith.dockview.${ws}`;
const OLD_TABS_KEY = (ws: string) => `dagsmith.tabs.${ws}`;
const DEBOUNCE_MS = 300;

function saveLayout(api: DockviewApi, workspaceName: string): void {
  try {
    localStorage.setItem(LAYOUT_KEY(workspaceName), JSON.stringify(api.toJSON()));
  } catch {
    // quota exceeded — ignore
  }
}

function loadLayout(workspaceName: string): SerializedDockview | null {
  // one-shot migration: remove old tabs key
  localStorage.removeItem(OLD_TABS_KEY(workspaceName));
  const raw = localStorage.getItem(LAYOUT_KEY(workspaceName));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SerializedDockview;
  } catch {
    localStorage.removeItem(LAYOUT_KEY(workspaceName));
    return null;
  }
}

function reconcileStale(api: DockviewApi, workspaceName: string, workspace: WorkspaceView): void {
  const validIds = new Set(workspace.flow_ids);
  for (const panel of [...api.panels]) {
    const p = panel.params as Partial<FlowPanelParams>;
    // Only reconcile flow panels (source panels have id prefix "source:")
    if (p.flowId && !p.flowId.startsWith('source:') && !validIds.has(p.flowId)) {
      api.removePanel(panel);
    }
  }
  if (api.panels.length === 0 && workspace.flow_ids.length > 0) {
    const firstId = workspace.flow_ids[0];
    api.addPanel({
      id: firstId,
      component: 'flow',
      title: firstId.split('.').pop() ?? firstId,
      params: { workspaceName, flowId: firstId } satisfies FlowPanelParams,
    });
  }
}

function restoreOrDefault(api: DockviewApi, workspaceName: string, workspace: WorkspaceView): void {
  const saved = loadLayout(workspaceName);
  if (saved) {
    try {
      api.fromJSON(saved);
      reconcileStale(api, workspaceName, workspace);
      return;
    } catch {
      localStorage.removeItem(LAYOUT_KEY(workspaceName));
    }
  }
  // fall back: open first flow
  if (workspace.flow_ids.length === 0) return;
  const firstId = workspace.flow_ids[0];
  api.addPanel({
    id: firstId,
    component: 'flow',
    title: firstId.split('.').pop() ?? firstId,
    params: { workspaceName, flowId: firstId } satisfies FlowPanelParams,
  });
}

export function DockviewCanvas({ workspaceName, workspace, onApiReady, onActivePanelChange }: DockviewCanvasProps) {
  const apiRef = useRef<DockviewApi | null>(null);
  const workspaceNameRef = useRef(workspaceName);
  const saveTimerRef = useRef<number | null>(null);
  const onActivePanelChangeRef = useRef(onActivePanelChange);
  onActivePanelChangeRef.current = onActivePanelChange;

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    workspaceNameRef.current = workspaceName;
    onApiReady?.(event.api);

    event.api.onDidActivePanelChange((panel) => {
      onActivePanelChangeRef.current?.(panel ? (panel.params as FlowPanelParams) : null);
    });

    event.api.onDidLayoutChange(() => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        const api = apiRef.current;
        if (api) saveLayout(api, workspaceNameRef.current);
      }, DEBOUNCE_MS);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When workspace changes: clear canvas, restore saved layout (or open first flow).
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !workspace) return;

    // Save any pending layout for the *previous* workspace before clearing
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      saveLayout(api, workspaceNameRef.current);
    }

    workspaceNameRef.current = workspaceName;
    api.clear();
    restoreOrDefault(api, workspaceName, workspace);
  // workspace object identity changes on each load; workspaceName drives the key effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  return (
    <div className={`${styles.wrapper} dagsmith-theme`}>
      <DockviewReact components={components} onReady={onReady} />
    </div>
  );
}

export function openFlowPanel(api: DockviewApi, workspaceName: string, flowId: string): void {
  const existing = api.panels.find((p) => p.id === flowId);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel({
    id: flowId,
    component: 'flow',
    title: flowId.split('.').pop() ?? flowId,
    params: { workspaceName, flowId } satisfies FlowPanelParams,
  });
}
