import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { PythonIcon } from '../icons/BrandIcons';
import { WorkflowNode } from '../nodes/WorkflowNode';
import type { WorkflowNode as WorkflowNodeType } from '../nodes/WorkflowNode';
import type { FlowView } from '../types';

const nodeTypes = { workflow: WorkflowNode };

const Y_SPACING = 160;
const X_SPACING = 260;

interface FlowGraphProps {
  flow: FlowView;
  onSelectNode: (nodeId: string | null) => void;
  onConnect: (connection: Connection) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (fromNode: string, fromExit: string) => void;
  onNodePositionChange: (nodeId: string, x: number, y: number) => void;
}

export function FlowGraph({
  flow,
  onSelectNode,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
  onNodePositionChange,
}: FlowGraphProps) {
  const initial = useMemo(() => layoutFlow(flow), [flow]);
  const [nodes, setNodes] = useState<WorkflowNodeType[]>(initial.nodes);

  // Re-seed local nodes whenever the flow prop changes (new flow loaded or refetched).
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

  return (
    <ReactFlow
      nodes={nodes}
      edges={initial.edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.4 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable
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
      <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color="#3a3d4a" />
    </ReactFlow>
  );
}

function layoutFlow(flow: FlowView): { nodes: WorkflowNodeType[]; edges: Edge[] } {
  // If the backend has persisted positions (user previously dragged), use
  // those verbatim. Otherwise fall back to BFS-derived layout.
  const persisted = flow.layout?.nodes ?? {};

  // Compute topological levels via BFS from entry_node (for nodes without
  // persisted positions, and for exit terminals which are always synthetic).
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
      // Prefer persisted position from layout; fall back to BFS coordinates.
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
    labelStyle: { fill: '#c9cdd5', fontSize: 11 },
    labelBgStyle: { fill: '#1a1b23' },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
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
