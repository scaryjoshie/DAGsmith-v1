import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getSmoothStepPath,
  reconnectEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { PythonIcon } from '../icons/BrandIcons';
import { WorkflowNode } from '../nodes/WorkflowNode';
import type { WorkflowNode as WorkflowNodeType } from '../nodes/WorkflowNode';
import { StartNode } from '../nodes/StartNode';
import type { StartNode as StartNodeType } from '../nodes/StartNode';
import type { FlowView } from '../types';

type GraphNode = WorkflowNodeType | StartNodeType;

const EDGE_DELETE_BTN_CLASS =
  'pointer-events-auto flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[2px] border border-line-2 bg-surface-1 font-mono text-[11px] leading-none text-ink-1 transition-[background,border-color,color] duration-100 ease-[ease] hover:border-red hover:bg-red hover:text-white';

const EDGE_ENDPOINT_HANDLE_CLASS =
  'pointer-events-none absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-[1.5px] border-surface-0 bg-blue';

const nodeTypes = { workflow: WorkflowNode, start: StartNode };

// Context so SelectableEdge can call the delete handler without prop-drilling through edgeTypes.
const EdgeDeleteContext = createContext<((fromNode: string, fromExit: string) => void) | null>(null);

function SelectableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  markerEnd,
  style,
}: EdgeProps) {
  const onDeleteEdge = useContext(EdgeDeleteContext);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const isSelected = !!selected;
  const edgeStyle = isSelected
    ? { ...style, stroke: 'var(--blue)', strokeWidth: 2.5 }
    : style;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd} />
      {isSelected && (
        <EdgeLabelRenderer>
          {/* Endpoint handles — visual affordance for drag-to-reconnect */}
          <div
            className={EDGE_ENDPOINT_HANDLE_CLASS}
            style={{ left: sourceX, top: sourceY, position: 'absolute' }}
          />
          <div
            className={EDGE_ENDPOINT_HANDLE_CLASS}
            style={{ left: targetX, top: targetY, position: 'absolute' }}
          />
          {/* × delete badge at midpoint */}
          <button
            className={EDGE_DELETE_BTN_CLASS}
            style={{ position: 'absolute', left: labelX, top: labelY }}
            onClick={(e) => {
              e.stopPropagation();
              if (onDeleteEdge && data) {
                const fromNode = (data as { fromNode: string; fromExit: string }).fromNode;
                const fromExit = (data as { fromNode: string; fromExit: string }).fromExit;
                onDeleteEdge(fromNode, fromExit);
              }
            }}
            title="Delete edge"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { selectable: SelectableEdge };

const Y_SPACING = 160;
const X_SPACING = 260;

// Snap tuning.
const SNAP_VERTICAL_RANGE = 28; // px: how close the dragged node's top must be to a candidate's bottom
const SNAP_HORIZONTAL_RANGE = 80; // px: how close in x-alignment
const FLUSH_TOLERANCE = 2; // px: geometric tolerance for flush-stacked detection
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
  onReconnectEdge: (fromNode: string, fromExit: string, newConnection: Connection) => void;
  onExitsReorder: (nodeId: string, newOrder: string[]) => void;
  onReady?: (panToNode: (nodeId: string) => void) => void;
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
  onReconnectEdge,
  onExitsReorder,
  onReady,
}: FlowGraphProps) {
  const { setCenter, getNode, getViewport } = useReactFlow();
  const initial = useMemo(() => layoutFlow(flow), [flow]);
  const [nodes, setNodes] = useState<GraphNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null);
  const snapTargetRef = useRef<string | null>(null);
  snapTargetRef.current = snapTargetId;
  const prevNodeIdsRef = useRef(new Set(initial.nodes.map((n) => n.id)));

  // Chain drag: when top of a stacked chain is dragged, move all chain members.
  // Maps member id → { parentId, exitName } so we can recompute exact flush positions
  // from the parent's grid-snapped position rather than from saved offsets (which drift
  // when node heights aren't multiples of the snap grid).
  const chainParentRef = useRef<Map<string, { parentId: string }>>(new Map());
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const prevIds = prevNodeIdsRef.current;
    const newNode = initial.nodes.find((n) => !prevIds.has(n.id));
    prevNodeIdsRef.current = new Set(initial.nodes.map((n) => n.id));
    // Preserve current positions for existing nodes so edge mutations don't
    // trigger BFS re-layout and jump nodes that haven't been persisted yet.
    setNodes((current) => {
      const currentPos = new Map(current.map((n) => [n.id, n.position]));
      return initial.nodes.map((n) => {
        const pos = currentPos.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
    });
    if (newNode) {
      // Pan to the new node without resetting zoom or moving existing nodes.
      requestAnimationFrame(() => {
        const measured = getNode(newNode.id);
        const nx = measured ?? newNode;
        const cx = nx.position.x + ((measured?.measured?.width ?? 160) / 2);
        const cy = nx.position.y + ((measured?.measured?.height ?? FALLBACK_NODE_HEIGHT) / 2);
        setCenter(cx, cy, { zoom: getViewport().zoom, duration: 300 });
      });
    }
  }, [initial.nodes, getNode, setCenter, getViewport]);

  useEffect(() => {
    setEdges(initial.edges);
  }, [initial.edges]);

  // Expose panToNode to parent (FlowPanel → panToNodeRegistry).
  useEffect(() => {
    if (!onReady) return;
    onReady((nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      const x = node.position.x + (node.measured?.width ?? 160) / 2;
      const y = node.position.y + (node.measured?.height ?? 40) / 2;
      setCenter(x, y, { zoom: 1, duration: 400 });
    });
  }, [onReady, setCenter, getNode]);

  const findSnapCandidate = useCallback(
    (draggedId: string, dragged: { x: number; y: number }, pool: GraphNode[]): string | null => {
      for (const candidate of pool) {
        if (candidate.id === draggedId) continue;
        // Snap eligibility: source must have 0 or 1 exit. 0-exit nodes use the
        // implicit "out" handle (SPEC §5); 1-exit nodes use their declared
        // exit. Multi-exit nodes can't be snap sources since the chain's
        // routing is ambiguous.
        const exits = candidate.data.exits ?? [];
        if (exits.length > 1) continue;
        const exitName = exits[0] ?? 'out';
        const boundEdge = flow.edges.find(
          (e) => e.from_node === candidate.id && e.from_exit === exitName,
        );
        if (boundEdge && boundEdge.to_node !== draggedId) continue;

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
    (changes: NodeChange<GraphNode>[]) => {
      setNodes((current) => {
        let next = applyNodeChanges(changes, current);
        for (const change of changes) {
          if (change.type !== 'position' || !change.position) continue;

          if (change.dragging) {
            // On drag start (first dragging=true event), collect the chain below.
            if (dragStartPosRef.current === null) {
              dragStartPosRef.current = change.position;
              // Collect flush-stacked descendants: follow edges to find children
              // that are geometrically flush-stacked below this node.
              const parentMap = new Map<string, { parentId: string }>();
              const byId = new Map(current.map((n) => [n.id, n]));
              const visited = new Set<string>([change.id]);
              const queue = [change.id];
              while (queue.length > 0) {
                const parentId = queue.shift()!;
                const parent = byId.get(parentId);
                if (!parent) continue;
                // Chain follows snap-eligible edges: 0 or 1 exit (same rule
                // as findSnapCandidate). 0-exit → implicit "out".
                const exits = parent.data.exits ?? [];
                if (exits.length > 1) continue;
                const exitName = exits[0] ?? 'out';
                const boundEdge = flow.edges.find(
                  (e) => e.from_node === parentId && e.from_exit === exitName,
                );
                if (!boundEdge) continue;
                const childId = boundEdge.to_node;
                if (visited.has(childId)) continue;
                const child = byId.get(childId);
                if (!child) continue;
                const ph = parent.measured?.height ?? FALLBACK_NODE_HEIGHT;
                const dy = Math.abs(child.position.y - (parent.position.y + ph));
                const dx = Math.abs(child.position.x - parent.position.x);
                if (dy > FLUSH_TOLERANCE || dx > FLUSH_TOLERANCE) continue;
                visited.add(childId);
                queue.push(childId);
                parentMap.set(childId, { parentId });
              }
              chainParentRef.current = parentMap;
            }

            // Apply chain positions by walking parent→child using exact measured heights.
            // This avoids grid drift: each child is positioned flush below its parent
            // using the parent's already-grid-snapped position.
            if (chainParentRef.current.size > 0) {
              const byId = new Map(next.map((n) => [n.id, n]));
              for (const [childId, { parentId }] of chainParentRef.current) {
                const parent = byId.get(parentId);
                if (!parent) continue;
                const ph = parent.measured?.height ?? FALLBACK_NODE_HEIGHT;
                const newPos = { x: parent.position.x, y: parent.position.y + ph };
                const idx = next.findIndex((n) => n.id === childId);
                if (idx >= 0) {
                  next = next.map((n, i) => i === idx ? { ...n, position: newPos } : n);
                  byId.set(childId, { ...byId.get(childId)!, position: newPos });
                }
              }
            }

            const candidate = findSnapCandidate(change.id, change.position, next);
            setSnapTargetId(candidate);
            continue;
          }

          // dragging === false: release — clear refs synchronously so re-entrant
          // calls in the same batch don't fire snap or chain drag twice.
          const pendingTarget = snapTargetRef.current;
          snapTargetRef.current = null;
          setSnapTargetId(null);
          const chainParents = chainParentRef.current;
          chainParentRef.current = new Map();
          dragStartPosRef.current = null;

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
              const edgeExists = flow.edges.some(
                (e) => e.from_node === target.id && e.from_exit === exitName && e.to_node === change.id,
              );
              if (!edgeExists) {
                onConnect({
                  source: target.id,
                  sourceHandle: exitName,
                  target: change.id,
                  targetHandle: 'in',
                });
              }
              onNodePositionChange(change.id, snappedX, snappedY);
              // Reposition chain members flush below their parents using exact heights,
              // update next so React state is immediately correct (not waiting for refetch),
              // and save positions to backend. Walk in insertion order (parent before child).
              if (chainParents.size > 0) {
                const byId = new Map(next.map((n) => [n.id, n]));
                // Leader position already set in next[idx] above; reflect it in byId too.
                byId.set(change.id, next[idx]);
                for (const [memberId, { parentId }] of chainParents) {
                  const parent = byId.get(parentId);
                  if (!parent) continue;
                  const ph = parent.measured?.height ?? FALLBACK_NODE_HEIGHT;
                  const memberPos = { x: parent.position.x, y: parent.position.y + ph };
                  next = next.map((n) => n.id === memberId ? { ...n, position: memberPos } : n);
                  byId.set(memberId, { ...byId.get(memberId)!, position: memberPos });
                  onNodePositionChange(memberId, memberPos.x, memberPos.y);
                }
              }
              continue;
            }
          }

          onNodePositionChange(change.id, change.position.x, change.position.y);
          // Reposition chain members flush below their parents, update next, and save.
          if (chainParents.size > 0) {
            const byId = new Map(next.map((n) => [n.id, n]));
            for (const [memberId, { parentId }] of chainParents) {
              const parent = byId.get(parentId);
              if (!parent) continue;
              const ph = parent.measured?.height ?? FALLBACK_NODE_HEIGHT;
              const memberPos = { x: parent.position.x, y: parent.position.y + ph };
              next = next.map((n) => n.id === memberId ? { ...n, position: memberPos } : n);
              byId.set(memberId, { ...byId.get(memberId)!, position: memberPos });
              onNodePositionChange(memberId, memberPos.x, memberPos.y);
            }
          }
        }
        return next;
      });
    },
    [findSnapCandidate, onConnect, onNodePositionChange, flow.edges],
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

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
      const fromNode = oldEdge.source;
      const fromExit = (oldEdge.sourceHandle as string | undefined) ?? 'out';
      onReconnectEdge(fromNode, fromExit, newConnection);
    },
    [onReconnectEdge],
  );

  const handleNodesDelete = useCallback(
    (removed: GraphNode[]) => {
      for (const node of removed) {
        onDeleteNode(node.id);
      }
    },
    [onDeleteNode],
  );

  const handleBeforeDelete = useCallback(
    async ({ nodes: nodesToDelete }: { nodes: GraphNode[]; edges: Edge[] }) => {
      if (nodesToDelete.length === 0) return true;
      const names = nodesToDelete.map((n) => n.id).join(', ');
      const label = nodesToDelete.length === 1
        ? `Delete node '${names}' and its edges?`
        : `Delete nodes ${names} and their edges?`;
      return window.confirm(label);
    },
    [],
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

  const layoutExits = flow.layout?.exits as Record<string, string[]> | undefined;

  const nodeSeverity = useMemo(() => {
    const map = new Map<string, 'blocking' | 'warning'>();
    for (const d of flow.diagnostics ?? []) {
      if (!d.node_id) continue;
      const current = map.get(d.node_id);
      const next = d.severity === 'error' ? 'blocking' : d.severity === 'warning' ? 'warning' : null;
      if (!next) continue;
      if (current !== 'blocking') map.set(d.node_id, next);
    }
    return map;
  }, [flow.diagnostics]);

  // Fan-out: map node id → { exitName: count } for exits with >1 outgoing edge
  const fanOutMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of flow.edges) {
      const key = `${edge.from_node}|${edge.from_exit}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const result = new Map<string, Record<string, number>>();
    for (const [key, count] of counts) {
      if (count < 2) continue;
      const sep = key.indexOf('|');
      const nodeId = key.slice(0, sep);
      const exitName = key.slice(sep + 1);
      if (!result.has(nodeId)) result.set(nodeId, {});
      result.get(nodeId)![exitName] = count;
    }
    return result;
  }, [flow.edges]);

  // Leaves: source handles with no outgoing edge — these are inferred public
  // exits (SPEC §12 line 425, Infer model). The UI shows a downward chevron
  // inside the handle to say "exits flow here". The implicit "out" handle on
  // a 0-exit plain-return node counts too.
  const leafMap = useMemo(() => {
    const connected = new Set<string>();
    for (const edge of flow.edges) {
      connected.add(`${edge.from_node}|${edge.from_exit}`);
    }
    const result = new Map<string, Set<string>>();
    for (const [nodeId, nodeSpec] of Object.entries(flow.nodes)) {
      const declared = Object.keys(nodeSpec.exits);
      const handles = declared.length > 0 ? declared : ['out'];
      const leaves = new Set<string>();
      for (const exitName of handles) {
        if (!connected.has(`${nodeId}|${exitName}`)) {
          leaves.add(exitName);
        }
      }
      if (leaves.size > 0) result.set(nodeId, leaves);
    }
    return result;
  }, [flow.edges, flow.nodes]);

  // Detect flush-stacked pairs: node A bottom is flush with node B top.
  // snappedAbove = this node has another node flush-stacked below it.
  // snappedBelow = this node is flush-stacked on top of another node.
  // flushPairs = set of "topId|botId" for hiding the connecting edge.
  const stackFlags = useMemo(() => {
    const above = new Set<string>();
    const below = new Set<string>();
    const flushPairs = new Set<string>();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const top = nodes[i];
        const bot = nodes[j];
        const h = top.measured?.height ?? FALLBACK_NODE_HEIGHT;
        const dy = Math.abs(bot.position.y - (top.position.y + h));
        const dx = Math.abs(bot.position.x - top.position.x);
        if (dy <= FLUSH_TOLERANCE && dx <= FLUSH_TOLERANCE) {
          above.add(top.id);
          below.add(bot.id);
          flushPairs.add(`${top.id}|${bot.id}`);
        }
      }
    }
    return { above, below, flushPairs };
  }, [nodes]);

  const decoratedNodes: GraphNode[] = useMemo(
    () =>
      nodes.map((n): GraphNode => {
        // StartNode is purely structural — only snapTarget is meaningful.
        if (n.type === 'start') {
          return {
            ...n,
            data: { ...n.data, snapTarget: n.id === snapTargetId },
          };
        }
        const snappedAbove = stackFlags.above.has(n.id);
        const exitCount = n.data.exits?.length ?? 0;
        // Suppress the chevron on a 0/1-exit node that's flush-stacked above a
        // follower: the follower IS the effective downstream, so this top isn't
        // a real leaf. Multi-exit nodes can still have per-exit leaves even when
        // one exit is stacked, so preserve the set there.
        const leafExits = snappedAbove && exitCount <= 1
          ? undefined
          : leafMap.get(n.id);
        return {
          ...n,
          data: {
            ...n.data,
            snapTarget: n.id === snapTargetId,
            exitOrder: layoutExits?.[n.id],
            onExitsReorder: (newOrder: string[]) => onExitsReorder(n.id, newOrder),
            severity: nodeSeverity.get(n.id) ?? null,
            fanOutCounts: fanOutMap.get(n.id),
            snappedAbove,
            snappedBelow: stackFlags.below.has(n.id),
            leafExits,
          },
        };
      }),
    [nodes, snapTargetId, layoutExits, onExitsReorder, nodeSeverity, fanOutMap, stackFlags, leafMap],
  );

  const mismatchEdgeIndices = useMemo(() => {
    const set = new Set<number>();
    for (const d of flow.diagnostics ?? []) {
      if (d.code === 'type_mismatch' && d.edge_index !== null) {
        set.add(d.edge_index);
      }
    }
    return set;
  }, [flow.diagnostics]);

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const decoratedEdges = useMemo(
    () => edges.map((e, idx) => {
      // Selected always wins — show even if flush-stacked, override marker color to selection blue.
      if (e.id === selectedEdgeId) return {
        ...e,
        selected: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--blue)', width: 20, height: 20 },
      };
      // Hide edge when its endpoints are flush-stacked (the shared border IS the visual connector).
      if (stackFlags.flushPairs.has(`${e.source}|${e.target}`)) {
        return { ...e, hidden: true };
      }
      if (mismatchEdgeIndices.has(idx)) {
        return {
          ...e,
          data: { ...(e.data as object), mismatch: true },
          style: { stroke: 'var(--red)', strokeWidth: 1.6 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--red)', width: 22, height: 22 },
        };
      }
      return e;
    }),
    [edges, selectedEdgeId, mismatchEdgeIndices, stackFlags.flushPairs],
  );

  return (
    <EdgeDeleteContext.Provider value={onDeleteEdge}>
      <div className="flex h-full w-full min-h-0 flex-col">
        <div className="flow-graph-canvas relative min-h-0 flex-1">
          <ReactFlow
            nodes={decoratedNodes}
            edges={decoratedEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'selectable' }}
            defaultViewport={cachedViewport}
            fitView={!cachedViewport}
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            onViewportChange={handleViewportChange}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable
            edgesFocusable
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={['Delete', 'Backspace']}
            onBeforeDelete={handleBeforeDelete}
            onNodesChange={handleNodesChange}
            onConnect={onConnect}
            onNodesDelete={handleNodesDelete}
            onEdgesDelete={handleEdgesDelete}
            onReconnect={handleReconnect}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId((prev) => prev === edge.id ? null : edge.id);
              onSelectNode(null);
            }}
            onNodeClick={(_, node) => {
              setSelectedEdgeId(null);
              onSelectNode(node.id);
            }}
            onPaneClick={() => {
              setSelectedEdgeId(null);
              onSelectNode(null);
            }}
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
    </EdgeDeleteContext.Provider>
  );
}

function layoutFlow(flow: FlowView): { nodes: GraphNode[]; edges: Edge[] } {
  const persisted = flow.layout?.nodes ?? {};

  const levels = new Map<string, number>();
  if (flow.nodes[flow.entry_node]) {
    levels.set(flow.entry_node, 0);
    const queue: string[] = [flow.entry_node];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const level = levels.get(current)!;
      for (const edge of flow.edges) {
        if (edge.from_node === current && !levels.has(edge.to_node)) {
          levels.set(edge.to_node, level + 1);
          queue.push(edge.to_node);
        }
      }
    }
  }
  for (const id of Object.keys(flow.nodes)) {
    if (!levels.has(id)) levels.set(id, 0);
  }

  const levelGroups: Record<number, string[]> = {};
  for (const [id, level] of levels) {
    (levelGroups[level] ??= []).push(id);
  }

  const X_CENTER = 400;
  const nodes: GraphNode[] = [];

  for (const [levelStr, ids] of Object.entries(levelGroups)) {
    const level = Number(levelStr);
    ids.forEach((id, idx) => {
      const offset = (idx - (ids.length - 1) / 2) * X_SPACING;
      const nodeSpec = flow.nodes[id];
      const exits = Object.keys(nodeSpec.exits);
      const saved = persisted[id];
      const position = saved
        ? { x: saved.x, y: saved.y }
        : { x: X_CENTER + offset, y: level * Y_SPACING };
      if (nodeSpec.kind === 'start') {
        nodes.push({
          id,
          type: 'start',
          position,
          data: {
            label: id,
            input_type: nodeSpec.input_type,
          },
        });
      } else {
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
      }
    });
  }

  const edges: Edge[] = flow.edges.map((edge, idx) => ({
    id: `e${idx}`,
    source: edge.from_node,
    sourceHandle: edge.from_exit,
    target: edge.to_node,
    targetHandle: 'in',
    type: 'selectable',
    data: { fromNode: edge.from_node, fromExit: edge.from_exit },
    label: edge.from_exit === 'out' ? undefined : edge.from_exit,
    labelStyle: { fill: '#c9cdd5', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
    labelBgStyle: { fill: '#0a0a0a' },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 2,
    style: { stroke: '#6b7080', strokeWidth: 1.6 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#6b7080',
      width: 22,
      height: 22,
    },
    interactionWidth: 20,
  }));

  return { nodes, edges };
}
