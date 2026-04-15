import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  type Edge,
} from '@xyflow/react';
import { PythonIcon } from '../icons/BrandIcons';
import { WorkflowNode } from '../nodes/WorkflowNode';
import type { WorkflowNode as WorkflowNodeType } from '../nodes/WorkflowNode';
import type { FlowView } from '../types';

const nodeTypes = { workflow: WorkflowNode };

const Y_SPACING = 130;
const X_SPACING = 260;

interface FlowGraphProps {
  flow: FlowView;
  onSelectNode: (nodeId: string | null) => void;
}

export function FlowGraph({ flow, onSelectNode }: FlowGraphProps) {
  const { nodes, edges } = useMemo(() => layoutFlow(flow), [flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.4 }}
      proOptions={{ hideAttribution: true }}
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
  // Compute topological levels via BFS from entry_node.
  const levels = new Map<string, number>();
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
  // Catch unreachable nodes at level 0.
  for (const id of Object.keys(flow.nodes)) {
    if (!levels.has(id)) levels.set(id, 0);
  }

  const maxLevel = Math.max(0, ...Array.from(levels.values()));
  const terminalLevel = maxLevel + 1;

  // Group process nodes by level.
  const levelGroups: Record<number, string[]> = {};
  for (const [id, level] of levels) {
    (levelGroups[level] ??= []).push(id);
  }

  const X_CENTER = 400;
  const nodes: WorkflowNodeType[] = [];

  // Process nodes.
  for (const [levelStr, ids] of Object.entries(levelGroups)) {
    const level = Number(levelStr);
    ids.forEach((id, idx) => {
      const offset = (idx - (ids.length - 1) / 2) * X_SPACING;
      nodes.push({
        id,
        type: 'workflow',
        position: { x: X_CENTER + offset, y: level * Y_SPACING },
        data: {
          label: id,
          icon: <PythonIcon size={14} />,
        },
      });
    });
  }

  // Public-exit terminal nodes.
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

  // Edges: internal (to_node) + edges to public exit terminals.
  const edges: Edge[] = flow.edges.map((edge, idx) => ({
    id: `e${idx}`,
    source: edge.from_node,
    target: edge.to_node ?? `exit:${edge.to_flow_exit!}`,
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
