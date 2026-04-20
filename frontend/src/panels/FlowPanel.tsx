import { useCallback, useEffect, useRef, useState } from 'react';
import type { Connection } from '@xyflow/react';
import type { IDockviewPanelProps } from 'dockview';
import { FlowGraph } from '../components/FlowGraph';
import { Toast } from '../components/Toast';
import {
  API_BASE,
  addEdge,
  deleteEdge,
  deleteNode,
  getFlow,
  updateLayout,
} from '../api';
import type { FlowView, LayoutPositions } from '../types';
import { useSelection } from '../SelectionContext';
import { registerFlowRefetch, registerPanToNode } from '../App';

export interface FlowPanelParams {
  workspaceName: string;
  flowId: string;
}

export function FlowPanel({ params, api: panelApi }: IDockviewPanelProps<FlowPanelParams>) {
  const { workspaceName, flowId } = params;
  const panelId = panelApi.id;
  const { onNodeSelect, onOpenNodeEditor } = useSelection();
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const pendingLayoutRef = useRef<LayoutPositions | null>(null);
  const flushScheduledRef = useRef(false);

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
    try {
      setFlow(await addEdge(workspaceName, flowId, {
        from_node: connection.source,
        from_exit: fromExit,
        to_node: connection.target,
      }));
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [workspaceName, flowId, flow, showToast]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!flow) return;
    try {
      setFlow(await deleteNode(workspaceName, flowId, nodeId));
    } catch (e) {
      showToast((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showToast]);

  const handleDeleteEdge = useCallback(async (fromNode: string, fromExit: string, toNode: string) => {
    if (!flow) return;
    try {
      setFlow(await deleteEdge(workspaceName, flowId, fromNode, fromExit, toNode));
    } catch (e) {
      showToast((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showToast]);

  const handleReconnectEdge = useCallback(async (fromNode: string, fromExit: string, toNode: string, newConnection: Connection) => {
    if (!flow || !newConnection.source || !newConnection.target) return;
    try {
      await deleteEdge(workspaceName, flowId, fromNode, fromExit, toNode);
      setFlow(await addEdge(workspaceName, flowId, {
        from_node: newConnection.source,
        from_exit: newConnection.sourceHandle ?? 'out',
        to_node: newConnection.target,
      }));
    } catch (e) {
      showToast((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow, showToast]);

  const flushLayout = useCallback(() => {
    const positions = pendingLayoutRef.current;
    pendingLayoutRef.current = null;
    flushScheduledRef.current = false;
    if (positions && Object.keys(positions).length > 0) {
      updateLayout(workspaceName, flowId, positions).catch((e) => {
        showToast((e as Error).message);
      });
    }
  }, [workspaceName, flowId, showToast]);

  // Flush any pending layout save on unmount and on page unload.
  useEffect(() => {
    const onUnload = () => {
      const positions = pendingLayoutRef.current;
      if (positions && Object.keys(positions).length > 0) {
        // Synchronous fire-and-forget via sendBeacon isn't available for JSON PUT,
        // so use a synchronous XHR as a best-effort flush on unload.
        const url = `${API_BASE}/api/workspaces/${encodeURIComponent(workspaceName)}/flows/${encodeURIComponent(flowId)}/layout`;
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url, false); // synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        try { xhr.send(JSON.stringify({ nodes: positions })); } catch { /* best effort */ }
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      // Also flush on unmount (tab close / HMR component teardown).
      flushLayout();
    };
  }, [workspaceName, flowId, flushLayout]);

  const handleNodePositionChange = useCallback((nodeId: string, x: number, y: number) => {
    pendingLayoutRef.current = { ...(pendingLayoutRef.current ?? {}), [nodeId]: { x, y } };
    // Schedule a microtask flush — fires before any browser paint or HMR teardown,
    // and batches multiple same-tick calls (e.g. chain drag saving N nodes at once).
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      queueMicrotask(flushLayout);
    }
  }, [flushLayout]);

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

  const handleOpenNodeEditor = useCallback((nodeId: string, mode: 'preview' | 'persistent-active' | 'persistent-nonactive') => {
    onOpenNodeEditor({ nodeId, flowId, workspaceName }, mode);
  }, [onOpenNodeEditor, flowId, workspaceName]);

  if (!flow) {
    return (
      <div className="p-4 font-mono text-sm text-ink-2">
        {toastMsg ? (
          <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />
        ) : 'loading…'}
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      {toastMsg && <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />}
      <FlowGraph
        flow={flow}
        onSelectNode={handleSelectNode}
        onOpenNodeEditor={handleOpenNodeEditor}
        onConnect={handleConnect}
        onDeleteNode={handleDeleteNode}
        onDeleteEdge={handleDeleteEdge}
        onNodePositionChange={handleNodePositionChange}
        onReconnectEdge={handleReconnectEdge}
        onExitsReorder={handleExitsReorder}
        onToast={showToast}
        onReady={handleFlowGraphReady}
      />
    </div>
  );
}
