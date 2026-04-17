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

export interface FlowPanelParams {
  workspaceName: string;
  flowId: string;
}

const LAYOUT_DEBOUNCE_MS = 500;

export function FlowPanel({ params }: IDockviewPanelProps<FlowPanelParams>) {
  const { workspaceName, flowId } = params;
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pendingLayoutRef = useRef<LayoutPositions | null>(null);
  const layoutTimerRef = useRef<number | null>(null);

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
      setLoadError((e as Error).message);
    }
  }, [workspaceName, flowId, flow]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!flow) return;
    if (!window.confirm(`Delete node '${nodeId}' and its edges?`)) {
      await refetchFlow();
      return;
    }
    try {
      setFlow(await deleteNode(workspaceName, flowId, nodeId));
    } catch (e) {
      setLoadError((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow]);

  const handleDeleteEdge = useCallback(async (fromNode: string, fromExit: string) => {
    if (!flow) return;
    try {
      setFlow(await deleteEdge(workspaceName, flowId, fromNode, fromExit));
    } catch (e) {
      setLoadError((e as Error).message);
      await refetchFlow();
    }
  }, [workspaceName, flowId, flow, refetchFlow]);

  const handleNodePositionChange = useCallback((nodeId: string, x: number, y: number) => {
    pendingLayoutRef.current = { ...(pendingLayoutRef.current ?? {}), [nodeId]: { x, y } };
    if (layoutTimerRef.current !== null) window.clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = window.setTimeout(() => {
      const positions = pendingLayoutRef.current;
      pendingLayoutRef.current = null;
      layoutTimerRef.current = null;
      if (positions) {
        updateLayout(workspaceName, flowId, positions).catch((e) => {
          setLoadError((e as Error).message);
        });
      }
    }, LAYOUT_DEBOUNCE_MS);
  }, [workspaceName, flowId]);

  const handleOpenSource = useCallback((_nodeId: string, _split: boolean) => {
    // Source tab wiring deferred to task #5+
  }, []);

  if (loadError) {
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
    <FlowGraph
      flow={flow}
      onSelectNode={() => {}}
      onConnect={handleConnect}
      onDeleteNode={handleDeleteNode}
      onDeleteEdge={handleDeleteEdge}
      onNodePositionChange={handleNodePositionChange}
      onOpenSource={handleOpenSource}
    />
  );
}
