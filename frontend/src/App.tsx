import { useCallback, useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { AddNodeDialog } from './components/AddNodeDialog';
import { Shell } from './components/Shell';
import { DockviewCanvas, openFlowPanel } from './components/DockviewCanvas';
import { LeftSidebar } from './components/LeftSidebar';
import { FloatingRunPanel } from './components/FloatingRunPanel';
import { Inspector } from './components/Inspector';
import { SelectionContext, type SelectedNode } from './SelectionContext';
import type { DockviewApi } from 'dockview';
import { getFlow, getWorkspace, listWorkspaces } from './api';
import type { FlowView, WorkspaceView } from './types';
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
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<FlowView | null>(null);
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
    setSelectedNode(null);
    setSelectedFlow(null);
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

  // When selectedNode changes, fetch the flow to back the Inspector
  useEffect(() => {
    if (!selectedNode) {
      setSelectedFlow(null);
      return;
    }
    let cancelled = false;
    getFlow(selectedNode.workspaceName, selectedNode.flowId)
      .then((f) => { if (!cancelled) setSelectedFlow(f); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedNode]);

  const handleNodeSelect = useCallback((node: SelectedNode | null) => {
    setSelectedNode(node);
  }, []);

  function handleWorkspaceChange(newName: string): void {
    if (newName === workspaceName) return;
    writeWorkspaceToURL(newName);
    setWorkspaceName(newName);
  }

  const handleActivePanelChange = useCallback((params: FlowPanelParams | null) => {
    setActiveFlow(params);
    // Clear selection when active panel changes
    setSelectedNode(null);
    setSelectedFlow(null);
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

  const handleOpenSource = useCallback((nodeId: string, split: boolean) => {
    const api = dockviewApiRef.current;
    if (!api || !activeFlow) return;
    const { workspaceName: ws, flowId } = activeFlow;
    const panelId = `source:${ws}:${flowId}:${nodeId}`;
    const existing = api.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.api.setActive();
      return;
    }
    if (split) {
      api.addPanel({
        id: panelId,
        component: 'source',
        title: nodeId,
        params: { workspaceName: ws, flowId, nodeId },
        position: { referencePanel: flowId, direction: 'right' },
      });
    } else {
      api.addPanel({
        id: panelId,
        component: 'source',
        title: nodeId,
        params: { workspaceName: ws, flowId, nodeId },
      });
    }
  }, [activeFlow]);

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

  const inspector = selectedNode ? (
    <Inspector
      selectedNode={selectedNode}
      flow={selectedFlow}
      onOpenSource={handleOpenSource}
    />
  ) : undefined;

  return (
    <SelectionContext.Provider value={{ selectedNode, onNodeSelect: handleNodeSelect }}>
      <Shell sidebarBody={sidebar} canvas={canvas} bottomPanel={inspector} />
      {showAddDialog && activeFlow && (
        <AddNodeDialog
          workspace={activeFlow.workspaceName}
          flowId={activeFlow.flowId}
          onClose={() => setShowAddDialog(false)}
          onCreated={() => setShowAddDialog(false)}
        />
      )}
    </SelectionContext.Provider>
  );
}
