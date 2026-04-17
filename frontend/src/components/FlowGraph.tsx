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

// Snap tuning.
const SNAP_VERTICAL_RANGE = 28; // px: how close the dragged node's top must be to a candidate's bottom
const SNAP_HORIZONTAL_RANGE = 80; // px: how close in x-alignment
const FLUSH_TOLERANCE = 2; // px: geometric tolerance for "nodes are flush-touching"
const FALLBACK_NODE_HEIGHT = 40;

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
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null);
  const snapTargetRef = useRef<string | null>(null);
  snapTargetRef.current = snapTargetId;

  useEffect(() => {
    setNodes(initial.nodes);
  }, [initial.nodes]);

  const findSnapCandidate = useCallback(
    (draggedId: string, dragged: { x: number; y: number }, pool: WorkflowNodeType[]): string | null => {
      for (const candidate of pool) {
        if (candidate.id === draggedId) continue;
        if (candidate.id.startsWith('exit:')) continue;
        const exits = candidate.data.exits;
        if (!exits || exits.length !== 1) continue;
        const exitName = exits[0];
        const alreadyBound = flow.edges.some(
          (e) => e.from_node === candidate.id && e.from_exit === exitName,
        );
        if (alreadyBound) continue;

        const candHeight = candidate.measured?.height ?? FALLBACK_NODE_HEIGHT;
        const expectedTop = candidate.position.y + candHeight;
        const expectedLeft = candidate.position.x;

        const dy = Math.abs(dragged.y - expectedTop);
        const dx = Math.abs(dragged.x - expectedLeft);
        if (dy < SNAP_VERTICAL_RANGE && dx < SNAP_HORIZONTAL_RANGE) {
          return candidate.id;
        }
      }
      return null;
    },
    [flow.edges],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowNodeType>[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        for (const change of changes) {
          if (change.type !== 'position' || !change.position) continue;

          if (change.dragging) {
            if (change.id.startsWith('exit:')) continue;
            const candidate = findSnapCandidate(change.id, change.position, next);
            setSnapTargetId(candidate);
            continue;
          }

          // dragging === false: release
          const pendingTarget = snapTargetRef.current;
          setSnapTargetId(null);

          if (pendingTarget) {
            const target = next.find((n) => n.id === pendingTarget);
            if (target) {
              const h = target.measured?.height ?? FALLBACK_NODE_HEIGHT;
              const snappedX = target.position.x;
              const snappedY = target.position.y + h;
              const idx = next.findIndex((n) => n.id === change.id);
              if (idx >= 0) {
                next[idx] = {
                  ...next[idx],
                  position: { x: snappedX, y: snappedY },
                };
              }
              const exitName = target.data.exits?.[0] ?? 'out';
              onConnect({
                source: target.id,
                sourceHandle: exitName,
                target: change.id,
                targetHandle: 'in',
              });
              if (!change.id.startsWith('exit:')) {
                onNodePositionChange(change.id, snappedX, snappedY);
              }
              continue;
            }
          }

          if (!change.id.startsWith('exit:')) {
            onNodePositionChange(change.id, change.position.x, change.position.y);
          }
        }
        return next;
      });
    },
    [findSnapCandidate, onConnect, onNodePositionChange],
  );

  const handleEdgesDelete = useCallback(
    (removed: Edge[]) => {
      for (const edge of removed) {
        const fromNode = edge.source;
        const fromExit = (edge.sourceHandle as string | undefined) ?? 'out';
        onDeleteEdge(fromNode, fromExit);
      }
    },
    [onDeleteEdge],
  );

  const handleNodesDelete = useCallback(
    (removed: WorkflowNodeType[]) => {
      for (const node of removed) {
        if (node.id.startsWith('exit:')) continue;
        onDeleteNode(node.id);
      }
    },
    [onDeleteNode],
  );

  const cachedViewport = viewportCache.get(flow.id);
  const viewportRef = useRef<Viewport | null>(cachedViewport ?? null);
  const handleViewportChange = useCallback(
    (v: Viewport) => {
      viewportRef.current = v;
      viewportCache.set(flow.id, v);
    },
    [flow.id],
  );

  const decoratedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, snapTarget: n.id === snapTargetId },
      })),
    [nodes, snapTargetId],
  );

  const decoratedEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return initial.edges.map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      const hidden = source && target ? isFlushStacked(source, target) : false;
      return hidden ? { ...edge, hidden: true } : edge;
    });
  }, [nodes, initial.edges]);

  return (
    <div className={styles.root}>
      <div className={styles.canvas}>
        <ReactFlow
          nodes={decoratedNodes}
          edges={decoratedEdges}
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

function isFlushStacked(source: WorkflowNodeType, target: WorkflowNodeType): boolean {
  const h = source.measured?.height ?? FALLBACK_NODE_HEIGHT;
  const dy = Math.abs(target.position.y - (source.position.y + h));
  const dx = Math.abs(target.position.x - source.position.x);
  return dy <= FLUSH_TOLERANCE && dx <= FLUSH_TOLERANCE;
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
          icon: <PythonIcon size={16} />,
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
    style: { stroke: '#6b7080', strokeWidth: 1.6 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#6b7080',
      width: 22,
      height: 22,
    },
  }));

  return { nodes, edges };
}
