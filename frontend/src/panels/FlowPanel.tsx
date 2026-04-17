import { useCallback, useEffect, useRef, useState } from 'react';
import type { Connection } from '@xyflow/react';
import type { IDockviewPanelProps } from 'dockview';
import { FlowGraph } from '../components/FlowGraph';
import { Toast } from '../components/Toast';
import {
  addEdge,
  deleteEdge,
  deleteNode,
  getFlow,
  updateLayout,
} from '../api';
import type { FlowView, LayoutPositions } from '../types';
import { useSelection } from '../SelectionContext';
import { registerFlowRefetch, registerPanToNode } from '../App';
import styles from './FlowPanel.module.css';

export interface FlowPanelParams {
  workspaceName: string;
  flowId: string;
}

const LAYOUT_DEBOUNCE_MS = 500;

export function FlowPanel({ params, api: panelApi }: IDockviewPanelProps<FlowPanelParams>) {
  const { workspaceName, flowId } = params;
  const panelId = panelApi.id;
  const { onNodeSelect } = useSelection();
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const pendingLayoutRef = useRef<LayoutPositions | null>(null);
  const layoutTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => { setToastMsg(msg); }, []);

  useEffect(() => {
    let cancelled = false;
    setFlow(null);
    getFlow(workspaceName, flowId)
      .then((f) => { if (!cancelled) setFlow(f); })
      .catch((e) => { if (!cancelled) showToast((e as Error).message); });
    return () => { cancelled = true; };
  }, [workspaceName, flowId, showToast]);

  const refetchFlow = useCallback(async () => {
    try {
      setFlow(await getFlow(workspaceName, flowId));
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [workspaceName, flowId, showToast]);

  // Register refetch so Inspector mutations can trigger canvas refresh.
  useEffect(() => {
    return registerFlowRefetch(panelId, flowId, () => { void refetchFlow(); });
  }, [panelId, flowId, refetchFlow]);

  const handleFlowGraphReady = useCallback((panToNode: (nodeId: string) => void) => {
    registerPanToNode(panelId, flowId, panToNode);
  }, [panelId, flowId]);

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
      showToast((e as Error).message);
    }
  }, [workspaceName, flowId, flow, showToast]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!flow) return;
    if (!window.confirm(`Delete node '${nodeId}' and its edges?`)) {
      await refetchFlow();
      return;
    }
    try {
      setFlow(await deleteNode(workspaceName, flowId, nodeId));
    } catch (e) {
      showToast((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showToast]);

  const handleDeleteEdge = useCallback(async (fromNode: string, fromExit: string) => {
    if (!flow) return;
    try {
      setFlow(await deleteEdge(workspaceName, flowId, fromNode, fromExit));
    } catch (e) {
      showToast((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showToast]);

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
      showToast((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showToast]);

  const handleNodePositionChange = useCallback((nodeId: string, x: number, y: number) => {
    pendingLayoutRef.current = { ...(pendingLayoutRef.current ?? {}), [nodeId]: { x, y } };
    if (layoutTimerRef.current !== null) window.clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = window.setTimeout(() => {
      const positions = pendingLayoutRef.current;
      pendingLayoutRef.current = null;
      layoutTimerRef.current = null;
      if (positions) {
        updateLayout(workspaceName, flowId, positions).catch((e) => {
          showToast((e as Error).message);
        });
      }
    }, LAYOUT_DEBOUNCE_MS);
  }, [workspaceName, flowId, showToast]);

  const handleExitsReorder = useCallback(async (nodeId: string, newOrder: string[]) => {
    if (!flow) return;
    const currentExits = (flow.layout?.exits ?? {}) as Record<string, string[]>;
    const updatedExits = { ...currentExits, [nodeId]: newOrder };
    try {
      await updateLayout(workspaceName, flowId, {}, updatedExits);
      setFlow(await getFlow(workspaceName, flowId));
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [workspaceName, flowId, flow, showToast]);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    onNodeSelect(nodeId ? { nodeId, flowId, workspaceName } : null);
  }, [onNodeSelect, flowId, workspaceName]);

  if (!flow) {
    return (
      <div style={{ padding: 16, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
        {toastMsg ? (
          <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
        ) : 'loading…'}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {toastMsg && <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />}
      <FlowGraph
        flow={flow}
        onSelectNode={handleSelectNode}
        onConnect={handleConnect}
        onDeleteNode={handleDeleteNode}
        onDeleteEdge={handleDeleteEdge}
        onNodePositionChange={handleNodePositionChange}
        onReconnectEdge={handleReconnectEdge}
        onExitsReorder={handleExitsReorder}
        onReady={handleFlowGraphReady}
      />
    </div>
  );
}
