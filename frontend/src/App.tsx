import { useEffect, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { FlowGraph } from './components/FlowGraph';
import { NodePanel } from './components/NodePanel';
import { RunPanel } from './components/RunPanel';
import { getFlow, getWorkspace } from './api';
import type { FlowView, WorkspaceView } from './types';
import styles from './App.module.css';

// Default workspace name; override via URL param ?workspace=...
const DEFAULT_WORKSPACE = 'examples.minimal';

function readWorkspaceFromURL(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('workspace') ?? DEFAULT_WORKSPACE;
}

export default function App() {
  const [workspaceName] = useState(readWorkspaceFromURL);
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load workspace metadata on mount.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getWorkspace(workspaceName)
      .then((ws) => {
        if (cancelled) return;
        setWorkspace(ws);
        if (ws.flow_ids.length > 0) {
          setSelectedFlowId(ws.flow_ids[0]);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceName]);

  // Load flow details when selection changes.
  useEffect(() => {
    if (!selectedFlowId || !workspace) return;
    let cancelled = false;
    setSelectedNode(null);
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

  const selectedNodeView =
    flow && selectedNode ? flow.nodes[selectedNode] ?? null : null;

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <div className={styles.brand}>DAGsmith</div>
        <div className={styles.spacer} />
        <label className={styles.selectorLabel}>
          workspace
          <code className={styles.workspaceName}>
            {workspace?.name ?? workspaceName}
          </code>
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
            <FlowGraph flow={flow} onSelectNode={setSelectedNode} />
          )}
          {!loadError && !flow && <div className={styles.loading}>loading…</div>}
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            {selectedNodeView ? (
              <NodePanel node={selectedNodeView} />
            ) : (
              <div className={styles.sidebarHint}>
                <p>Click a node to inspect it.</p>
              </div>
            )}
          </div>
          {workspace && flow && (
            <RunPanel
              workspace={workspace.name}
              flowId={flow.id}
              inputType={flow.input_type}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
