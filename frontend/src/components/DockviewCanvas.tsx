import { useCallback, useEffect, useRef } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelHeaderProps, type SerializedDockview } from 'dockview';
import { FlowPanel, type FlowPanelParams } from '../panels/FlowPanel';
import { SourcePanel } from '../panels/SourcePanel';
import { FlowIcon, PythonIcon } from '../icons/BrandIcons';
import type { WorkspaceView } from '../types';
import styles from './DockviewCanvas.module.css';

function FlowTab({ api }: IDockviewPanelHeaderProps) {
  return (
    <div className="dv-default-tab">
      <div className="dv-default-tab-content">
        <FlowIcon size={12} />
        <span style={{ marginLeft: 5 }}>{api.title}</span>
      </div>
      <div
        className="dv-default-tab-action"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => { e.preventDefault(); api.close(); }}
      >
        <svg width="11" height="11" viewBox="0 0 28 28" fill="currentColor">
          <path d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z" />
        </svg>
      </div>
    </div>
  );
}

function SourceTabHeader({ api }: IDockviewPanelHeaderProps) {
  return (
    <div className="dv-default-tab">
      <div className="dv-default-tab-content">
        <PythonIcon size={12} />
        <span style={{ marginLeft: 5 }}>{api.title}</span>
      </div>
      <div
        className="dv-default-tab-action"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => { e.preventDefault(); api.close(); }}
      >
        <svg width="11" height="11" viewBox="0 0 28 28" fill="currentColor">
          <path d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z" />
        </svg>
      </div>
    </div>
  );
}

const tabComponents = {
  flow: FlowTab,
  source: SourceTabHeader,
};

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
      tabComponent: 'flow',
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
    tabComponent: 'flow',
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
      <DockviewReact components={components} tabComponents={tabComponents} onReady={onReady} />
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
    tabComponent: 'flow',
    title: flowId.split('.').pop() ?? flowId,
    params: { workspaceName, flowId } satisfies FlowPanelParams,
  });
}
