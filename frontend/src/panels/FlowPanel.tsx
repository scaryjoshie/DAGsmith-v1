import { useCallback, useEffect, useRef, useState } from 'react';
import type { Connection } from '@xyflow/react';
import type { IDockviewPanelProps } from 'dockview';
import { FlowGraph } from '../components/FlowGraph';
import {
  addEdge,
  deleteEdge,
  deleteNode,
  getFlow,
  updateLayout,
} from '../api';
import type { FlowView, LayoutPositions } from '../types';
import { useSelection } from '../SelectionContext';
import styles from './FlowPanel.module.css';

export interface FlowPanelParams {
  workspaceName: string;
  flowId: string;
}

const LAYOUT_DEBOUNCE_MS = 500;

export function FlowPanel({ params }: IDockviewPanelProps<FlowPanelParams>) {
  const { workspaceName, flowId } = params;
  const { onNodeSelect } = useSelection();
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pendingLayoutRef = useRef<LayoutPositions | null>(null);
  const layoutTimerRef = useRef<number | null>(null);

  const showMutationError = useCallback((msg: string) => {
    setMutationError(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setMutationError(null);
      toastTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFlow(null);
    setLoadError(null);
    getFlow(workspaceName, flowId)
      .then((f) => { if (!cancelled) setFlow(f); })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, [workspaceName, flowId]);

  const refetchFlow = useCallback(async () => {
    try {
      setFlow(await getFlow(workspaceName, flowId));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [workspaceName, flowId]);

  const handleConnect = useCallback(async (connection: Connection) => {
    if (!flow || !connection.source || !connection.target) return;
    const fromExit = connection.sourceHandle ?? 'out';
    const isExitTarget = connection.target.startsWith('exit:');
    try {
      setFlow(await addEdge(workspaceName, flowId, {
        from_node: connection.source,
        from_exit: fromExit,
        to_node: isExitTarget ? null : connection.target,
        to_flow_exit: isExitTarget ? connection.target.slice('exit:'.length) : null,
      }));
    } catch (e) {
      showMutationError((e as Error).message);
    }
  }, [workspaceName, flowId, flow, showMutationError]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!flow) return;
    if (!window.confirm(`Delete node '${nodeId}' and its edges?`)) {
      await refetchFlow();
      return;
    }
    try {
      setFlow(await deleteNode(workspaceName, flowId, nodeId));
    } catch (e) {
      showMutationError((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showMutationError]);

  const handleDeleteEdge = useCallback(async (fromNode: string, fromExit: string) => {
    if (!flow) return;
    try {
      setFlow(await deleteEdge(workspaceName, flowId, fromNode, fromExit));
    } catch (e) {
      showMutationError((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showMutationError]);

  const handleReconnectEdge = useCallback(async (fromNode: string, fromExit: string, newConnection: Connection) => {
    if (!flow || !newConnection.source || !newConnection.target) return;
    try {
      await deleteEdge(workspaceName, flowId, fromNode, fromExit);
      const isExitTarget = newConnection.target.startsWith('exit:');
      setFlow(await addEdge(workspaceName, flowId, {
        from_node: newConnection.source,
        from_exit: newConnection.sourceHandle ?? 'out',
        to_node: isExitTarget ? null : newConnection.target,
        to_flow_exit: isExitTarget ? newConnection.target.slice('exit:'.length) : null,
      }));
    } catch (e) {
      showMutationError((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showMutationError]);

  const handleNodePositionChange = useCallback((nodeId: string, x: number, y: number) => {
    pendingLayoutRef.current = { ...(pendingLayoutRef.current ?? {}), [nodeId]: { x, y } };
    if (layoutTimerRef.current !== null) window.clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = window.setTimeout(() => {
      const positions = pendingLayoutRef.current;
      pendingLayoutRef.current = null;
      layoutTimerRef.current = null;
      if (positions) {
        updateLayout(workspaceName, flowId, positions).catch((e) => {
          showMutationError((e as Error).message);
        });
      }
    }, LAYOUT_DEBOUNCE_MS);
  }, [workspaceName, flowId, showMutationError]);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    onNodeSelect(nodeId ? { nodeId, flowId, workspaceName } : null);
  }, [onNodeSelect, flowId, workspaceName]);

  if (loadError && !flow) {
    return (
      <div style={{ padding: 16, color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
        <div>Error loading flow: {loadError}</div>
        <div style={{ marginTop: 8, color: 'var(--fg-2)' }}>Is the backend running?</div>
      </div>
    );
  }

  if (!flow) {
    return (
      <div style={{ padding: 16, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
        loading…
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {mutationError && (
        <div className={styles.errorToast}>
          <span className={styles.errorToastMsg}>{mutationError}</span>
          <button
            className={styles.errorToastClose}
            onClick={() => {
              setMutationError(null);
              if (toastTimerRef.current !== null) {
                window.clearTimeout(toastTimerRef.current);
                toastTimerRef.current = null;
              }
            }}
          >
            ×
          </button>
        </div>
      )}
      <FlowGraph
        flow={flow}
        onSelectNode={handleSelectNode}
        onConnect={handleConnect}
        onDeleteNode={handleDeleteNode}
        onDeleteEdge={handleDeleteEdge}
        onNodePositionChange={handleNodePositionChange}
        onReconnectEdge={handleReconnectEdge}
      />
    </div>
  );
}
