import { useCallback, useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { AddNodeDialog } from './components/AddNodeDialog';
import { Shell } from './components/Shell';
import {
  DockviewCanvas,
  openFlowPanel,
  openNodePreview,
  openNodeEditorPersistent,
  closeNodePreview,
} from './components/DockviewCanvas';
import { LeftSidebar } from './components/LeftSidebar';
import { FloatingRunPanel } from './components/FloatingRunPanel';
import { RunPreflightModal } from './components/RunPreflightModal';
import { Inspector } from './components/Inspector';
import { StartInspector } from './components/StartInspector';
import { SelectionContext, type SelectedNode, type OpenEditorMode } from './SelectionContext';
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

// Registries keyed by dockview panel ID so split panes with the same flowId don't stomp each other.
interface RefetchEntry { flowId: string; refetch: () => void; }
const flowRefetchRegistry = new Map<string, RefetchEntry>();

export function registerFlowRefetch(panelId: string, flowId: string, refetch: () => void): () => void {
  flowRefetchRegistry.set(panelId, { flowId, refetch });
  return () => flowRefetchRegistry.delete(panelId);
}

interface PanEntry { flowId: string; pan: (nodeId: string) => void; }
const panToNodeRegistry = new Map<string, PanEntry>();

export function registerPanToNode(panelId: string, flowId: string, pan: (nodeId: string) => void): () => void {
  panToNodeRegistry.set(panelId, { flowId, pan });
  return () => panToNodeRegistry.delete(panelId);
}

export default function App() {
  const [workspaceName, setWorkspaceName] = useState(readWorkspaceFromURL);
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceView[]>([]);
  const [activeFlow, setActiveFlow] = useState<FlowPanelParams | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  // Single source of truth for the active flow's FlowView — used by Inspector, sidebar, and preflight.
  const [activeFlowView, setActiveFlowView] = useState<FlowView | null>(null);
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
    setPreflightOpen(false);
    setSelectedNode(null);
    setActiveFlowView(null);
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

  const handleNodeSelect = useCallback((node: SelectedNode | null) => {
    setSelectedNode(node);
  }, []);

  function handleWorkspaceChange(newName: string): void {
    if (newName === workspaceName) return;
    writeWorkspaceToURL(newName);
    setWorkspaceName(newName);
  }

  // Fetch activeFlowView whenever active panel changes (sidebar diagnostics + Inspector).
  useEffect(() => {
    if (!activeFlow) { setActiveFlowView(null); return; }
    let cancelled = false;
    getFlow(activeFlow.workspaceName, activeFlow.flowId)
      .then((f) => { if (!cancelled) setActiveFlowView(f); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeFlow]);

  // When FlowPanel reports a mutation, refresh canvas panels and activeFlowView.
  const handleFlowMutatedWithView = useCallback((_workspaceName: string, flowId: string) => {
    for (const entry of flowRefetchRegistry.values()) {
      if (entry.flowId === flowId) entry.refetch();
    }
    if (activeFlow?.flowId === flowId) {
      getFlow(activeFlow.workspaceName, flowId)
        .then(setActiveFlowView)
        .catch(() => {});
    }
  }, [activeFlow]);

  const handleRunClick = useCallback(() => {
    if (!activeFlow) return;
    const diags = activeFlowView?.diagnostics ?? [];
    const hasErrors = diags.some((d) => d.severity === 'error');
    const hasWarnings = diags.some((d) => d.severity === 'warning');
    if (hasErrors || hasWarnings) {
      setPreflightOpen(true);
    } else {
      setRunPanelOpen((v) => !v);
    }
  }, [activeFlow, activeFlowView]);

  const handleActivePanelChange = useCallback((params: FlowPanelParams | null) => {
    setActiveFlow(params);
    setSelectedNode(null);
    if (!params) {
      setRunPanelOpen(false);
      setPreflightOpen(false);
      setShowAddDialog(false);
    }
  }, []);

  const handlePanToNode = useCallback((nodeId: string) => {
    if (!activeFlow) return;
    for (const entry of panToNodeRegistry.values()) {
      if (entry.flowId === activeFlow.flowId) {
        entry.pan(nodeId);
        break;
      }
    }
  }, [activeFlow]);

  const handleOpenFlow = useCallback((flowId: string) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    openFlowPanel(api, workspaceName, flowId);
  }, [workspaceName]);

  const handleApiReady = useCallback((api: DockviewApi) => {
    dockviewApiRef.current = api;
  }, []);

  const handleOpenNodeEditor = useCallback((target: SelectedNode, mode: OpenEditorMode) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const { workspaceName: ws, flowId, nodeId } = target;
    if (mode === 'preview') {
      openNodePreview(api, ws, flowId, nodeId);
    } else if (mode === 'persistent-active') {
      openNodeEditorPersistent(api, ws, flowId, nodeId, true);
    } else {
      closeNodePreview(api, ws, flowId);
      openNodeEditorPersistent(api, ws, flowId, nodeId, false);
    }
  }, []);

  // Close the preview panel when the user deselects (canvas click → null).
  useEffect(() => {
    if (selectedNode) return;
    const api = dockviewApiRef.current;
    if (!api || !activeFlow) return;
    closeNodePreview(api, activeFlow.workspaceName, activeFlow.flowId);
  }, [selectedNode, activeFlow]);

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
        tabComponent: 'source',
        title: nodeId,
        params: { workspaceName: ws, flowId, nodeId },
        position: { referencePanel: flowId, direction: 'right' },
      });
    } else {
      api.addPanel({
        id: panelId,
        component: 'source',
        tabComponent: 'source',
        title: nodeId,
        params: { workspaceName: ws, flowId, nodeId },
      });
    }
  }, [activeFlow]);

  const handleNodeRenamed = useCallback((oldName: string, newName: string) => {
    setSelectedNode((prev) =>
      prev && prev.nodeId === oldName ? { ...prev, nodeId: newName } : prev
    );
    // activeFlowView will be refreshed by handleFlowMutatedWithView called from Inspector
  }, []);

  const sidebar = (
    <LeftSidebar
      workspaceName={workspaceName}
      workspace={workspace}
      allWorkspaces={allWorkspaces}
      activeFlowView={activeFlowView}
      onWorkspaceChange={handleWorkspaceChange}
      onOpenFlow={handleOpenFlow}
      onRunClick={handleRunClick}
      onAddNodeClick={() => setShowAddDialog(true)}
      onPanToNode={handlePanToNode}
      onNodeSelect={handleNodeSelect}
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

  // C5: Inspector sidebar retired — node metadata now lives in the merged
  // NodeEditorPanel tab header. Flip this flag on to re-render the sidebar
  // while we validate parity; delete Inspector + StartInspector + handlers
  // in C6 once the flag has been off across a working session.
  const INSPECTOR_IN_SIDEBAR = false;

  const selectedKind = selectedNode
    ? activeFlowView?.nodes[selectedNode.nodeId]?.kind
    : undefined;
  const inspectorRefetch = () => {
    if (activeFlow) handleFlowMutatedWithView(activeFlow.workspaceName, activeFlow.flowId);
  };
  const inspector = INSPECTOR_IN_SIDEBAR && selectedNode ? (
    selectedKind === 'start' ? (
      <StartInspector
        selectedNode={selectedNode}
        flow={activeFlowView}
        onDismiss={() => setSelectedNode(null)}
        onFlowRefetch={inspectorRefetch}
      />
    ) : (
      <Inspector
        selectedNode={selectedNode}
        flow={activeFlowView}
        onOpenSource={handleOpenSource}
        onDismiss={() => setSelectedNode(null)}
        onNodeRenamed={handleNodeRenamed}
        onFlowRefetch={inspectorRefetch}
      />
    )
  ) : undefined;

  return (
    <SelectionContext.Provider value={{ selectedNode, onNodeSelect: handleNodeSelect, onFlowMutated: handleFlowMutatedWithView, onOpenNodeEditor: handleOpenNodeEditor }}>
      <Shell sidebarBody={sidebar} canvas={canvas} rightPanel={inspector} />
      {preflightOpen && activeFlow && activeFlowView && (
        <RunPreflightModal
          flowId={activeFlow.flowId}
          diagnostics={activeFlowView.diagnostics}
          onRunAnyway={() => {
            setPreflightOpen(false);
            setRunPanelOpen(true);
          }}
          onDismiss={() => setPreflightOpen(false)}
          onSelectNode={(nodeId) => {
            handleNodeSelect({ nodeId, flowId: activeFlow.flowId, workspaceName });
            handlePanToNode(nodeId);
          }}
        />
      )}
      {showAddDialog && activeFlow && (
        <AddNodeDialog
          workspace={activeFlow.workspaceName}
          flowId={activeFlow.flowId}
          onClose={() => setShowAddDialog(false)}
          onCreated={() => {
            setShowAddDialog(false);
            if (activeFlow) handleFlowMutatedWithView(activeFlow.workspaceName, activeFlow.flowId);
          }}
        />
      )}
    </SelectionContext.Provider>
  );
}
