import { useCallback, useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { AddNodeDialog } from './components/AddNodeDialog';
import { Shell } from './components/Shell';
import { DockviewCanvas, openFlowPanel } from './components/DockviewCanvas';
import { LeftSidebar } from './components/LeftSidebar';
import { FloatingRunPanel } from './components/FloatingRunPanel';
import type { DockviewApi } from 'dockview';
import { getWorkspace, listWorkspaces } from './api';
import type { WorkspaceView } from './types';
import type { FlowPanelParams } from './panels/FlowPanel';

const DEFAULT_WORKSPACE = 'examples.minimal';

function readWorkspaceFromURL(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('workspace') ?? DEFAULT_WORKSPACE;
}

function writeWorkspaceToURL(name: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('workspace', name);
  window.history.replaceState(null, '', url.toString());
}

export default function App() {
  const [workspaceName, setWorkspaceName] = useState(readWorkspaceFromURL);
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceView[]>([]);
  const [activeFlow, setActiveFlow] = useState<FlowPanelParams | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const dockviewApiRef = useRef<DockviewApi | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkspaces()
      .then((list) => { if (!cancelled) setAllWorkspaces(list.workspaces); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWorkspace(null);
    setActiveFlow(null);
    setRunPanelOpen(false);
    getWorkspace(workspaceName)
      .then((ws) => {
        if (cancelled) return;
        setWorkspace(ws);
        setAllWorkspaces((prev) =>
          prev.some((w) => w.name === ws.name) ? prev : [...prev, ws]
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceName]);

  function handleWorkspaceChange(newName: string): void {
    if (newName === workspaceName) return;
    writeWorkspaceToURL(newName);
    setWorkspaceName(newName);
  }

  const handleActivePanelChange = useCallback((params: FlowPanelParams | null) => {
    setActiveFlow(params);
    if (!params) {
      setRunPanelOpen(false);
      setShowAddDialog(false);
    }
  }, []);

  const handleOpenFlow = useCallback((flowId: string) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    openFlowPanel(api, workspaceName, flowId);
  }, [workspaceName]);

  const handleApiReady = useCallback((api: DockviewApi) => {
    dockviewApiRef.current = api;
  }, []);

  const sidebar = (
    <LeftSidebar
      workspaceName={workspaceName}
      workspace={workspace}
      allWorkspaces={allWorkspaces}
      onWorkspaceChange={handleWorkspaceChange}
      onOpenFlow={handleOpenFlow}
      onRunClick={() => setRunPanelOpen((v) => !v)}
      onAddNodeClick={() => setShowAddDialog(true)}
      canRun={!!activeFlow}
      canAddNode={!!workspace && !!activeFlow}
    />
  );

  const canvas = (
    <>
      <DockviewCanvas
        workspaceName={workspaceName}
        workspace={workspace}
        onApiReady={handleApiReady}
        onActivePanelChange={handleActivePanelChange}
      />
      {runPanelOpen && activeFlow && (
        <FloatingRunPanel
          workspace={activeFlow.workspaceName}
          flowId={activeFlow.flowId}
          onClose={() => setRunPanelOpen(false)}
        />
      )}
    </>
  );

  return (
    <>
      <Shell sidebarBody={sidebar} canvas={canvas} />
      {showAddDialog && activeFlow && (
        <AddNodeDialog
          workspace={activeFlow.workspaceName}
          flowId={activeFlow.flowId}
          onClose={() => setShowAddDialog(false)}
          onCreated={() => setShowAddDialog(false)}
        />
      )}
    </>
  );
}
