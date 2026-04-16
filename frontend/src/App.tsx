import { useCallback, useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import type { Connection } from '@xyflow/react';
import { FlowGraph } from './components/FlowGraph';
import { AddNodeDialog } from './components/AddNodeDialog';
import { Shell } from './components/Shell';
import { PaneTree } from './components/PaneTree';
import { LeftSidebar } from './components/LeftSidebar';
import { SourceTab } from './components/SourceTab';
import { FloatingRunPanel } from './components/FloatingRunPanel';
import { TabsProvider, useTabs } from './tabs/TabsProvider';
import type { Tab } from './tabs/types';
import {
  addEdge,
  deleteEdge,
  deleteNode,
  getFlow,
  getWorkspace,
  listWorkspaces,
  updateLayout,
} from './api';
import type { FlowView, LayoutPositions, WorkspaceView } from './types';
import styles from './App.module.css';

const DEFAULT_WORKSPACE = 'examples.minimal';
const LAYOUT_DEBOUNCE_MS = 500;

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
  return (
    <TabsProvider workspace={workspaceName}>
      <AppInner
        workspaceName={workspaceName}
        setWorkspaceName={setWorkspaceName}
      />
    </TabsProvider>
  );
}

interface AppInnerProps {
  workspaceName: string;
  setWorkspaceName: (name: string) => void;
}

function AppInner({ workspaceName, setWorkspaceName }: AppInnerProps) {
  const { openTab, state: tabsState, closeTab } = useTabs();
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceView[]>([]);
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [, setSelectedNode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [runPanelOpen, setRunPanelOpen] = useState(false);

  const pendingLayoutRef = useRef<LayoutPositions | null>(null);
  const layoutTimerRef = useRef<number | null>(null);

  // Drive `flow` (the FlowView currently rendered) from the active tab.
  const activeFlowId = activeFlowIdFromTabs(tabsState);

  useEffect(() => {
    let cancelled = false;
    listWorkspaces()
      .then((list) => {
        if (!cancelled) setAllWorkspaces(list.workspaces);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        const pane = findPane(tabsState.root, tabsState.activePaneId);
        if (pane?.kind === 'leaf' && pane.activeTabId) {
          e.preventDefault();
          closeTab(pane.id, pane.activeTabId);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabsState, closeTab]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setFlow(null);
    getWorkspace(workspaceName)
      .then((ws) => {
        if (cancelled) return;
        setWorkspace(ws);
        setAllWorkspaces((prev) =>
          prev.some((w) => w.name === ws.name) ? prev : [...prev, ws]
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceName]);

  function handleWorkspaceChange(newName: string): void {
    if (newName === workspaceName) return;
    writeWorkspaceToURL(newName);
    setWorkspaceName(newName);
  }

  // Auto-open the first flow when a workspace lands with no tabs yet.
  useEffect(() => {
    if (!workspace || workspace.flow_ids.length === 0) return;
    if (countLeafTabs(tabsState) > 0) return;
    const firstId = workspace.flow_ids[0];
    openTab({ kind: 'flow', flow_id: firstId, title: firstId });
  }, [workspace, tabsState, openTab]);

  // Load the flow view whenever the active tab changes.
  useEffect(() => {
    if (!workspace || !activeFlowId) {
      setFlow(null);
      return;
    }
    let cancelled = false;
    setSelectedNode(null);
    getFlow(workspace.name, activeFlowId)
      .then((f) => {
        if (!cancelled) setFlow(f);
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFlowId, workspace]);

  const refetchFlow = useCallback(async () => {
    if (!workspace || !activeFlowId) return;
    try {
      const f = await getFlow(workspace.name, activeFlowId);
      setFlow(f);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [workspace, activeFlowId]);

  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!workspace || !flow || !connection.source || !connection.target) return;
      const fromExit = connection.sourceHandle ?? 'out';
      const isExitTarget = connection.target.startsWith('exit:');
      try {
        const updated = await addEdge(workspace.name, flow.id, {
          from_node: connection.source,
          from_exit: fromExit,
          to_node: isExitTarget ? null : connection.target,
          to_flow_exit: isExitTarget ? connection.target.slice('exit:'.length) : null,
        });
        setFlow(updated);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    },
    [workspace, flow]
  );

  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      if (!workspace || !flow) return;
      const ok = window.confirm(`Delete node '${nodeId}' and its edges?`);
      if (!ok) {
        await refetchFlow();
        return;
      }
      try {
        const updated = await deleteNode(workspace.name, flow.id, nodeId);
        setFlow(updated);
        setSelectedNode((cur) => (cur === nodeId ? null : cur));
      } catch (e) {
        setLoadError((e as Error).message);
        await refetchFlow();
      }
    },
    [workspace, flow, refetchFlow]
  );

  const handleDeleteEdge = useCallback(
    async (fromNode: string, fromExit: string) => {
      if (!workspace || !flow) return;
      try {
        const updated = await deleteEdge(workspace.name, flow.id, fromNode, fromExit);
        setFlow(updated);
      } catch (e) {
        setLoadError((e as Error).message);
        await refetchFlow();
      }
    },
    [workspace, flow, refetchFlow]
  );

  const handleNodePositionChange = useCallback(
    (nodeId: string, x: number, y: number) => {
      if (!workspace || !flow) return;
      const ws = workspace.name;
      const fid = flow.id;
      pendingLayoutRef.current = {
        ...(pendingLayoutRef.current ?? {}),
        [nodeId]: { x, y },
      };
      if (layoutTimerRef.current !== null) {
        window.clearTimeout(layoutTimerRef.current);
      }
      layoutTimerRef.current = window.setTimeout(() => {
        const positions = pendingLayoutRef.current;
        pendingLayoutRef.current = null;
        layoutTimerRef.current = null;
        if (positions) {
          updateLayout(ws, fid, positions).catch((e) => {
            setLoadError((e as Error).message);
          });
        }
      }, LAYOUT_DEBOUNCE_MS);
    },
    [workspace, flow]
  );

  const handleNodeCreated = useCallback((updated: FlowView) => {
    setFlow(updated);
  }, []);

  const handleOpenSource = useCallback(
    (nodeId: string, split: boolean) => {
      if (!flow) return;
      const node = flow.nodes[nodeId];
      const title = node?.source_path
        ? (node.source_path.split('/').pop() ?? nodeId)
        : `${nodeId}.py`;
      openTab(
        {
          kind: 'source',
          flow_id: flow.id,
          node_id: nodeId,
          source_path: node?.source_path ?? undefined,
          title,
        },
        { split: split ? 'right' : null }
      );
    },
    [flow, openTab]
  );

  const renderTab = useCallback(
    (tab: Tab) => {
      if (tab.kind === 'flow') {
        if (loadError) {
          return (
            <div className={styles.errorOverlay}>
              <h2>Load error</h2>
              <pre>{loadError}</pre>
              <p className={styles.hint}>
                Is the backend running?{' '}
                <code>uv run dagsmith ui {workspaceName}</code>
              </p>
            </div>
          );
        }
        if (flow && flow.id === tab.flow_id) {
          return (
            <FlowGraph
              flow={flow}
              onSelectNode={setSelectedNode}
              onConnect={handleConnect}
              onDeleteNode={handleDeleteNode}
              onDeleteEdge={handleDeleteEdge}
              onNodePositionChange={handleNodePositionChange}
              onOpenSource={handleOpenSource}
            />
          );
        }
        return <div className={styles.loading}>loading…</div>;
      }
      return (
        <SourceTab
          workspace={workspaceName}
          flowId={tab.flow_id}
          nodeId={tab.node_id}
        />
      );
    },
    [
      loadError,
      workspaceName,
      flow,
      handleConnect,
      handleDeleteNode,
      handleDeleteEdge,
      handleNodePositionChange,
      handleOpenSource,
    ]
  );

  const sidebar = (
    <LeftSidebar
      workspaceName={workspaceName}
      workspace={workspace}
      allWorkspaces={allWorkspaces}
      onWorkspaceChange={handleWorkspaceChange}
      onRunClick={() => setRunPanelOpen((v) => !v)}
      onAddNodeClick={() => setShowAddDialog(true)}
      canRun={!!flow}
      canAddNode={!!workspace && !!flow}
    />
  );

  const canvas = (
    <>
      <PaneTree
        renderTab={renderTab}
        renderEmpty={() => <span>no tabs open — select a flow to open one</span>}
      />
      {runPanelOpen && workspace && flow && (
        <FloatingRunPanel
          workspace={workspace.name}
          flowId={flow.id}
          inputType={flow.input_type}
          onClose={() => setRunPanelOpen(false)}
        />
      )}
    </>
  );

  return (
    <>
      <Shell sidebarBody={sidebar} canvas={canvas} />
      {showAddDialog && workspace && flow && (
        <AddNodeDialog
          workspace={workspace.name}
          flowId={flow.id}
          onClose={() => setShowAddDialog(false)}
          onCreated={handleNodeCreated}
        />
      )}
    </>
  );
}

function activeFlowIdFromTabs(
  state: import('./tabs/types').TabsState
): string | null {
  const pane = findPane(state.root, state.activePaneId);
  if (!pane || pane.kind !== 'leaf') return null;
  const active = pane.tabs.find((t) => t.id === pane.activeTabId);
  if (!active) return null;
  return active.flow_id;
}

function findPane(
  pane: import('./tabs/types').Pane,
  id: string
): import('./tabs/types').Pane | null {
  if (pane.id === id) return pane;
  if (pane.kind === 'split') {
    return findPane(pane.first, id) ?? findPane(pane.second, id);
  }
  return null;
}

function countLeafTabs(state: import('./tabs/types').TabsState): number {
  let n = 0;
  const visit = (p: import('./tabs/types').Pane): void => {
    if (p.kind === 'leaf') n += p.tabs.length;
    else {
      visit(p.first);
      visit(p.second);
    }
  };
  visit(state.root);
  return n;
}
