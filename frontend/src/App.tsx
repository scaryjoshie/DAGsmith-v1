import { useCallback, useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import type { Connection } from '@xyflow/react';
import { FlowGraph } from './components/FlowGraph';
import { NodePanel } from './components/NodePanel';
import { RunPanel } from './components/RunPanel';
import { AddNodeDialog } from './components/AddNodeDialog';
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

// Default workspace name; override via URL param ?workspace=...
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
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceView[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const pendingLayoutRef = useRef<LayoutPositions | null>(null);
  const layoutTimerRef = useRef<number | null>(null);

  // Fetch the list of workspaces the backend knows about.
  useEffect(() => {
    let cancelled = false;
    listWorkspaces()
      .then((list) => {
        if (!cancelled) setAllWorkspaces(list.workspaces);
      })
      .catch(() => {
        // ignore — fallback is the URL-param workspace
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load workspace metadata whenever the active workspace changes.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setFlow(null);
    setSelectedFlowId(null);
    getWorkspace(workspaceName)
      .then((ws) => {
        if (cancelled) return;
        setWorkspace(ws);
        if (ws.flow_ids.length > 0) {
          setSelectedFlowId(ws.flow_ids[0]);
        }
        // Ensure this workspace is in the dropdown list.
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

  // Load flow details when selection changes.
  useEffect(() => {
    if (!selectedFlowId || !workspace) return;
    let cancelled = false;
    setSelectedNode(null);
    setEditMode(false);
    getFlow(workspace.name, selectedFlowId)
      .then((f) => {
        if (!cancelled) setFlow(f);
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFlowId, workspace]);

  // Exit edit mode whenever the user selects a different node.
  useEffect(() => {
    setEditMode(false);
  }, [selectedNode]);

  const refetchFlow = useCallback(async () => {
    if (!workspace || !selectedFlowId) return;
    try {
      const f = await getFlow(workspace.name, selectedFlowId);
      setFlow(f);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [workspace, selectedFlowId]);

  const handleEnterEditMode = useCallback(() => setEditMode(true), []);
  const handleExitEditMode = useCallback(() => setEditMode(false), []);

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
        // User cancelled — we need to refetch to restore the node React Flow
        // already removed locally via the delete-key handler.
        await refetchFlow();
        return;
      }
      try {
        const updated = await deleteNode(workspace.name, flow.id, nodeId);
        setFlow(updated);
        if (selectedNode === nodeId) setSelectedNode(null);
      } catch (e) {
        setLoadError((e as Error).message);
        await refetchFlow();
      }
    },
    [workspace, flow, refetchFlow, selectedNode]
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

  const selectedNodeView =
    flow && selectedNode ? flow.nodes[selectedNode] ?? null : null;

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <div className={styles.brand}>DAGsmith</div>
        <div className={styles.spacer} />
        <label className={styles.selectorLabel}>
          workspace
          <select
            className={styles.select}
            value={workspaceName}
            onChange={(e) => handleWorkspaceChange(e.target.value)}
          >
            {!allWorkspaces.some((w) => w.name === workspaceName) && (
              <option value={workspaceName}>{workspaceName}</option>
            )}
            {allWorkspaces.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {workspace && workspace.flow_ids.length > 0 && (
          <label className={styles.selectorLabel}>
            flow
            <select
              className={styles.select}
              value={selectedFlowId ?? ''}
              onChange={(e) => setSelectedFlowId(e.target.value)}
            >
              {workspace.flow_ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        )}
        {workspace && flow && (
          <button
            type="button"
            className={styles.addNodeButton}
            onClick={() => setShowAddDialog(true)}
          >
            + Add node
          </button>
        )}
      </header>

      <div className={styles.main}>
        <div className={styles.canvas}>
          {loadError && (
            <div className={styles.errorOverlay}>
              <h2>Load error</h2>
              <pre>{loadError}</pre>
              <p className={styles.hint}>
                Is the backend running?{' '}
                <code>uv run dagsmith ui {workspaceName}</code>
              </p>
            </div>
          )}
          {!loadError && flow && (
            <FlowGraph
              flow={flow}
              onSelectNode={setSelectedNode}
              onConnect={handleConnect}
              onDeleteNode={handleDeleteNode}
              onDeleteEdge={handleDeleteEdge}
              onNodePositionChange={handleNodePositionChange}
            />
          )}
          {!loadError && !flow && <div className={styles.loading}>loading…</div>}
        </div>

        <aside
          className={
            editMode ? `${styles.sidebar} ${styles.sidebarWide}` : styles.sidebar
          }
        >
          <div className={styles.sidebarTop}>
            {selectedNodeView && workspace && flow ? (
              <NodePanel
                node={selectedNodeView}
                workspace={workspace.name}
                flowId={flow.id}
                editMode={editMode}
                onEnterEditMode={handleEnterEditMode}
                onExitEditMode={handleExitEditMode}
                onSaveComplete={refetchFlow}
              />
            ) : (
              <div className={styles.sidebarHint}>
                <p>Click a node to inspect it.</p>
              </div>
            )}
          </div>
          {!editMode && workspace && flow && (
            <RunPanel
              workspace={workspace.name}
              flowId={flow.id}
              inputType={flow.input_type}
            />
          )}
        </aside>
      </div>

      {showAddDialog && workspace && flow && (
        <AddNodeDialog
          workspace={workspace.name}
          flowId={flow.id}
          onClose={() => setShowAddDialog(false)}
          onCreated={handleNodeCreated}
        />
      )}
    </div>
  );
}
