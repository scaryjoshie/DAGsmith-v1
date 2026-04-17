import { useCallback, useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { AddNodeDialog } from './components/AddNodeDialog';
import { Shell } from './components/Shell';
import { DockviewCanvas, openFlowPanel } from './components/DockviewCanvas';
import { LeftSidebar } from './components/LeftSidebar';
import { FloatingRunPanel } from './components/FloatingRunPanel';
import type { DockviewApi } from 'dockview';
import { getFlow, getWorkspace, listWorkspaces } from './api';
import type { FlowView, WorkspaceView } from './types';

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
  const [activeFlow, setActiveFlow] = useState<FlowView | null>(null);
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

  const handleOpenFlow = useCallback((flowId: string) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    openFlowPanel(api, workspaceName, flowId);
    // Track the active flow for FloatingRunPanel / AddNodeDialog
    getFlow(workspaceName, flowId)
      .then(setActiveFlow)
      .catch(() => {});
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
      />
      {runPanelOpen && workspace && activeFlow && (
        <FloatingRunPanel
          workspace={workspace.name}
          flowId={activeFlow.id}
          inputType={activeFlow.input_type}
          onClose={() => setRunPanelOpen(false)}
        />
      )}
    </>
  );

  return (
    <>
      <Shell sidebarBody={sidebar} canvas={canvas} />
      {showAddDialog && workspace && activeFlow && (
        <AddNodeDialog
          workspace={workspace.name}
          flowId={activeFlow.id}
          onClose={() => setShowAddDialog(false)}
          onCreated={(updated) => setActiveFlow(updated)}
        />
      )}
    </>
  );
}
