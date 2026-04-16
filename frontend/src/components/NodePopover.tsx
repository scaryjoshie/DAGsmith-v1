import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useOnSelectionChange,
  useReactFlow,
  type Edge,
  type Node as RFNode,
  type XYPosition,
} from '@xyflow/react';
import type { FlowView } from '../types';
import styles from './NodePopover.module.css';

interface NodePopoverProps {
  flow: FlowView;
  onOpenSource: (nodeId: string, split: boolean) => void;
  onDeleteEdge: (fromNode: string, fromExit: string) => void;
}

type Selection =
  | { kind: 'node'; nodeId: string; screen: XYPosition }
  | {
      kind: 'edge';
      edgeId: string;
      source: string;
      sourceHandle: string;
      target: string;
      screen: XYPosition;
    }
  | null;

export function NodePopover({
  flow,
  onOpenSource,
  onDeleteEdge,
}: NodePopoverProps) {
  const rf = useReactFlow();
  const [selection, setSelection] = useState<Selection>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const recomputePosition = useCallback(
    (sel: Exclude<Selection, null>): XYPosition => {
      if (sel.kind === 'node') {
        const node = rf.getNode(sel.nodeId);
        if (!node) return sel.screen;
        const pos = node.position;
        const w = (node.measured?.width ?? node.width ?? 140) as number;
        const h = (node.measured?.height ?? node.height ?? 40) as number;
        // Anchor at bottom-right corner of the node (flow coords → screen).
        return rf.flowToScreenPosition({ x: pos.x + w + 8, y: pos.y + h / 2 });
      }
      const src = rf.getNode(sel.source);
      const tgt = rf.getNode(sel.target);
      if (!src || !tgt) return sel.screen;
      const mid = {
        x: (src.position.x + tgt.position.x) / 2,
        y: (src.position.y + tgt.position.y) / 2,
      };
      return rf.flowToScreenPosition(mid);
    },
    [rf]
  );

  const handleSelectionChange = useCallback(
    ({ nodes, edges }: { nodes: RFNode[]; edges: Edge[] }) => {
      // Prefer node selection when both present.
      if (nodes.length > 0) {
        const n = nodes[0];
        if (n.id.startsWith('exit:')) {
          setSelection(null);
          return;
        }
        const screen = recomputePosition({
          kind: 'node',
          nodeId: n.id,
          screen: { x: 0, y: 0 },
        });
        setSelection({ kind: 'node', nodeId: n.id, screen });
        return;
      }
      if (edges.length > 0) {
        const e = edges[0];
        const sourceHandle = (e.sourceHandle as string | undefined) ?? 'out';
        const screen = recomputePosition({
          kind: 'edge',
          edgeId: e.id,
          source: e.source,
          sourceHandle,
          target: e.target,
          screen: { x: 0, y: 0 },
        });
        setSelection({
          kind: 'edge',
          edgeId: e.id,
          source: e.source,
          sourceHandle,
          target: e.target,
          screen,
        });
        return;
      }
      setSelection(null);
    },
    [recomputePosition]
  );

  useOnSelectionChange({ onChange: handleSelectionChange });

  // Recompute position on viewport / node-move so the popover follows.
  useEffect(() => {
    if (!selection) return;
    let raf = 0;
    const tick = (): void => {
      setSelection((cur) => {
        if (!cur) return cur;
        const screen = recomputePosition(cur);
        if (
          Math.abs(screen.x - cur.screen.x) < 0.5 &&
          Math.abs(screen.y - cur.screen.y) < 0.5
        ) {
          return cur;
        }
        return { ...cur, screen };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selection, recomputePosition]);

  // Dismiss on Escape.
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
        rf.setEdges((es) => es.map((ed) => ({ ...ed, selected: false })));
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, rf]);

  // Dismiss on click outside the popover. Clicks on the canvas (onPaneClick)
  // already clear selection and therefore clear this popover via the
  // selection-change handler; this handler catches clicks into other UI
  // surfaces (sidebar, tab bar).
  useEffect(() => {
    if (!selection) return;
    const onDown = (e: MouseEvent): void => {
      const card = cardRef.current;
      if (!card) return;
      if (card.contains(e.target as Node)) return;
      // Let React Flow handle its own internal clicks (nodes/edges/pane).
      const rfRoot = card.closest('[data-popover-host]')?.querySelector('.react-flow');
      if (rfRoot && rfRoot.contains(e.target as Node)) return;
      rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
      rf.setEdges((es) => es.map((ed) => ({ ...ed, selected: false })));
      setSelection(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [selection, rf]);

  const content = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'node') {
      const node = flow.nodes[selection.nodeId];
      if (!node) return null;
      return (
        <NodeCardBody
          node={node}
          onOpenSource={onOpenSource}
        />
      );
    }
    return (
      <EdgeCardBody
        selection={selection}
        onDelete={() => {
          onDeleteEdge(selection.source, selection.sourceHandle);
        }}
      />
    );
  }, [selection, flow, onOpenSource, onDeleteEdge]);

  if (!selection) return null;

  return (
    <div
      ref={cardRef}
      className={styles.card}
      style={{
        left: selection.screen.x,
        top: selection.screen.y,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {content}
    </div>
  );
}

function NodeCardBody({
  node,
  onOpenSource,
}: {
  node: FlowView['nodes'][string];
  onOpenSource: (nodeId: string, split: boolean) => void;
}) {
  const exits = Object.entries(node.exits);
  const isSubflow = node.kind === 'flow';

  return (
    <>
      <div className={styles.header}>
        <span className={styles.kindChip}>{node.kind}</span>
        <span className={styles.name}>{node.name}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>input</span>
        <code className={styles.typeRef} title={node.input_type}>
          {shortName(node.input_type)}
        </code>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>exits</div>
        <ul className={styles.exitsList}>
          {exits.map(([name, type]) => (
            <li key={name} className={styles.exitRow}>
              <span className={styles.exitName}>{name}</span>
              <span className={styles.arrow}>→</span>
              <code className={styles.typeRef} title={type}>
                {shortName(type)}
              </code>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>ref</span>
        <code className={styles.refLine} title={node.ref}>
          {node.ref}
        </code>
      </div>

      <div className={styles.actions}>
        {isSubflow ? (
          <button
            type="button"
            className={styles.action}
            onClick={(e) =>
              onOpenSource(node.name, e.shiftKey)
            }
            title="Shift-click to split"
          >
            Enter subflow →
          </button>
        ) : node.source_code ? (
          <button
            type="button"
            className={styles.action}
            onClick={(e) => onOpenSource(node.name, e.shiftKey)}
            title="Shift-click to open as split"
          >
            Open source →
          </button>
        ) : (
          <span className={styles.hint}>no source available</span>
        )}
      </div>

      <div className={styles.footnote}>
        label edit + exit mutations coming in M6/M7
      </div>
    </>
  );
}

function EdgeCardBody({
  selection,
  onDelete,
}: {
  selection: {
    kind: 'edge';
    source: string;
    sourceHandle: string;
    target: string;
  };
  onDelete: () => void;
}) {
  const targetDisplay = selection.target.startsWith('exit:')
    ? `↦ ${selection.target.slice('exit:'.length)}`
    : selection.target;
  return (
    <>
      <div className={styles.header}>
        <span className={styles.kindChip}>edge</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>from</span>
        <code className={styles.refLine}>
          {selection.source}:{selection.sourceHandle}
        </code>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>to</span>
        <code className={styles.refLine}>{targetDisplay}</code>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.destructive}
          onClick={onDelete}
        >
          Delete edge
        </button>
      </div>
    </>
  );
}

function shortName(typeRef: string): string {
  const parts = typeRef.split('.');
  return parts[parts.length - 1] ?? typeRef;
}
