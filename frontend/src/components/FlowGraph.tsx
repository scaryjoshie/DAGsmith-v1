import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { PythonIcon } from '../icons/BrandIcons';
import { WorkflowNode } from '../nodes/WorkflowNode';
import type { WorkflowNode as WorkflowNodeType } from '../nodes/WorkflowNode';
import type { FlowView } from '../types';
import styles from './FlowGraph.module.css';

const nodeTypes = { workflow: WorkflowNode };

const Y_SPACING = 160;
const X_SPACING = 260;

// Module-level cache of viewport state per flow_id. Tabs unmount when
// inactive, so we restore the viewport on remount to give the illusion of
// "each tab preserves its own viewport" per SPEC §7.2.
const viewportCache = new Map<string, Viewport>();

interface FlowGraphProps {
  flow: FlowView;
  onSelectNode: (nodeId: string | null) => void;
  onConnect: (connection: Connection) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (fromNode: string, fromExit: string) => void;
  onNodePositionChange: (nodeId: string, x: number, y: number) => void;
}

export function FlowGraph(props: FlowGraphProps) {
  return (
    <ReactFlowProvider>
      <FlowGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowGraphInner({
  flow,
  onSelectNode,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
  onNodePositionChange,
}: FlowGraphProps) {
  const initial = useMemo(() => layoutFlow(flow), [flow]);
  const [nodes, setNodes] = useState<WorkflowNodeType[]>(initial.nodes);

  useEffect(() => {
    setNodes(initial.nodes);
  }, [initial.nodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowNodeType>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      for (const change of changes) {
        if (
          change.type === 'position' &&
          change.position &&
          change.dragging === false
        ) {
          if (!change.id.startsWith('exit:')) {
            onNodePositionChange(change.id, change.position.x, change.position.y);
          }
        }
      }
    },
    [onNodePositionChange]
  );

  const handleEdgesDelete = useCallback(
    (removed: Edge[]) => {
      for (const edge of removed) {
        const fromNode = edge.source;
        const fromExit = (edge.sourceHandle as string | undefined) ?? 'out';
        onDeleteEdge(fromNode, fromExit);
      }
    },
    [onDeleteEdge]
  );

  const handleNodesDelete = useCallback(
    (removed: WorkflowNodeType[]) => {
      for (const node of removed) {
        if (node.id.startsWith('exit:')) continue;
        onDeleteNode(node.id);
      }
    },
    [onDeleteNode]
  );

  const cachedViewport = viewportCache.get(flow.id);
  const viewportRef = useRef<Viewport | null>(cachedViewport ?? null);
  const handleViewportChange = useCallback(
    (v: Viewport) => {
      viewportRef.current = v;
      viewportCache.set(flow.id, v);
    },
    [flow.id]
  );

  return (
    <div className={styles.root}>
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes}
          edges={initial.edges}
          nodeTypes={nodeTypes}
          defaultViewport={cachedViewport}
          fitView={!cachedViewport}
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          onViewportChange={handleViewportChange}
          proOptions={{ hideAttribution: true }}
          nodesDraggable
          nodesConnectable
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={['Delete', 'Backspace']}
          onNodesChange={handleNodesChange}
          onConnect={onConnect}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          onNodeClick={(_, node) => {
            if (node.id.startsWith('exit:')) {
              onSelectNode(null);
            } else {
              onSelectNode(node.id);
            }
          }}
          onPaneClick={() => onSelectNode(null)}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1.5}
            color="#3a3d4a"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

function layoutFlow(flow: FlowView): { nodes: WorkflowNodeType[]; edges: Edge[] } {
  const persisted = flow.layout?.nodes ?? {};

  const levels = new Map<string, number>();
  if (flow.nodes[flow.entry_node]) {
    levels.set(flow.entry_node, 0);
    const queue: string[] = [flow.entry_node];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const level = levels.get(current)!;
      for (const edge of flow.edges) {
        if (edge.from_node === current && edge.to_node && !levels.has(edge.to_node)) {
          levels.set(edge.to_node, level + 1);
          queue.push(edge.to_node);
        }
      }
    }
  }
  for (const id of Object.keys(flow.nodes)) {
    if (!levels.has(id)) levels.set(id, 0);
  }

  const maxLevel = Math.max(0, ...Array.from(levels.values()));
  const terminalLevel = maxLevel + 1;

  const levelGroups: Record<number, string[]> = {};
  for (const [id, level] of levels) {
    (levelGroups[level] ??= []).push(id);
  }

  const X_CENTER = 400;
  const nodes: WorkflowNodeType[] = [];

  for (const [levelStr, ids] of Object.entries(levelGroups)) {
    const level = Number(levelStr);
    ids.forEach((id, idx) => {
      const offset = (idx - (ids.length - 1) / 2) * X_SPACING;
      const exits = Object.keys(flow.nodes[id].exits);
      const saved = persisted[id];
      const position = saved
        ? { x: saved.x, y: saved.y }
        : { x: X_CENTER + offset, y: level * Y_SPACING };
      nodes.push({
        id,
        type: 'workflow',
        position,
        data: {
          label: id,
          icon: <PythonIcon size={14} />,
          exits,
        },
      });
    });
  }

  const exitIds = Object.keys(flow.public_exits);
  exitIds.forEach((exitId, idx) => {
    const offset = (idx - (exitIds.length - 1) / 2) * X_SPACING;
    nodes.push({
      id: `exit:${exitId}`,
      type: 'workflow',
      position: { x: X_CENTER + offset, y: terminalLevel * Y_SPACING },
      data: { label: exitId, variant: 'terminal' },
    });
  });

  const edges: Edge[] = flow.edges.map((edge, idx) => ({
    id: `e${idx}`,
    source: edge.from_node,
    sourceHandle: edge.from_exit,
    target: edge.to_node ?? `exit:${edge.to_flow_exit!}`,
    targetHandle: 'in',
    label: edge.from_exit === 'out' ? undefined : edge.from_exit,
    labelStyle: { fill: '#c9cdd5', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
    labelBgStyle: { fill: '#0a0a0a' },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 2,
    type: 'smoothstep',
    style: { stroke: '#4a4d5a', strokeWidth: 1.3 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#4a4d5a',
      width: 14,
      height: 14,
    },
  }));

  return { nodes, edges };
}
