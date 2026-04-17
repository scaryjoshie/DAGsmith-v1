import { Handle, Position, useConnection, type NodeProps, type Node } from '@xyflow/react';
import { useRef, useState, type ReactNode } from 'react';
import styles from './WorkflowNode.module.css';

export type WorkflowNodeData = {
  label: string;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  variant?: 'process' | 'terminal';
  exits?: string[];
  exitOrder?: string[];
  onExitsReorder?: (newOrder: string[]) => void;
  snapTarget?: boolean;
  severity?: 'blocking' | 'warning' | null;
  fanOutExits?: string[];
};

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

export function WorkflowNode({ data }: NodeProps<WorkflowNode>) {
  const connection = useConnection();
  const isConnecting = !!connection.fromNode;
  const isTerminal = data.variant === 'terminal';

  if (isTerminal) {
    const handleClass = isConnecting ? `${styles.handle} ${styles.handleVisible}` : styles.handle;
    const terminalSeverityClass = data.severity === 'blocking'
      ? styles.severityBlocking
      : data.severity === 'warning' ? styles.severityWarning : null;
    const terminalClass = [styles.terminal, terminalSeverityClass].filter(Boolean).join(' ');
    return (
      <div className={terminalClass}>
        <Handle type="target" position={Position.Top} id="in" className={handleClass} />
        {data.icon && (
          <span
            className={styles.iconSlot}
            style={{ background: data.iconBg, color: data.iconColor }}
          >
            {data.icon}
          </span>
        )}
        <span className={styles.label}>{data.label}</span>
      </div>
    );
  }

  const rawExits = data.exits && data.exits.length > 0 ? data.exits : ['out'];
  // Apply layout order if provided, filtering to only valid exits
  const exits = data.exitOrder
    ? [...data.exitOrder.filter((e) => rawExits.includes(e)), ...rawExits.filter((e) => !data.exitOrder!.includes(e))]
    : rawExits;
  const hasSwitcher = exits.length > 1;
  const severityClass = data.severity === 'blocking'
    ? styles.severityBlocking
    : data.severity === 'warning'
      ? styles.severityWarning
      : null;
  const processClass = [
    styles.process,
    data.snapTarget ? styles.snapTarget : null,
    severityClass,
  ].filter(Boolean).join(' ');
  const handleClass = isConnecting ? `${styles.handle} ${styles.handleVisible}` : styles.handle;
  const switcherHandleClass = isConnecting
    ? `${styles.switcherHandle} ${styles.handleVisible}`
    : styles.switcherHandle;

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartX = useRef<number>(0);

  const handleCellPointerDown = (idx: number) => (e: React.PointerEvent) => {
    if (!data.onExitsReorder) return;
    e.stopPropagation();
    setDragIndex(idx);
    setDropIndex(idx);
    dragStartX.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleCellPointerMove = (idx: number) => (e: React.PointerEvent) => {
    if (dragIndex === null || dragIndex !== idx) return;
    // Estimate which cell we're over based on x delta
    const cellWidth = (e.currentTarget.parentElement?.offsetWidth ?? 1) / exits.length;
    const delta = e.clientX - dragStartX.current;
    const shift = Math.round(delta / cellWidth);
    const target = Math.max(0, Math.min(exits.length - 1, idx + shift));
    setDropIndex(target);
  };

  const handleCellPointerUp = () => {
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex && data.onExitsReorder) {
      const next = [...exits];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(dropIndex, 0, moved);
      data.onExitsReorder(next);
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <div className={processClass}>
      <Handle type="target" position={Position.Top} id="in" className={handleClass} />
      <div className={styles.body}>
        {data.icon && (
          <span
            className={styles.iconSlot}
            style={{ background: data.iconBg, color: data.iconColor }}
          >
            {data.icon}
          </span>
        )}
        <span className={styles.label}>{data.label}</span>
      </div>
      {hasSwitcher ? (
        <div className={styles.switcher}>
          {exits.map((exit, idx) => {
            const isDragging = dragIndex === idx;
            const isDropTarget = dropIndex === idx && dragIndex !== null && dragIndex !== idx;
            const isFanOut = data.fanOutExits?.includes(exit) ?? false;
            let cellClass = styles.switcherCell;
            if (isDragging) cellClass += ` ${styles.switcherCellDragging}`;
            if (isDropTarget) cellClass += ` ${styles.switcherCellDropTarget}`;
            if (isFanOut) cellClass += ` ${styles.switcherCellFanOut}`;
            return (
              <div
                key={exit}
                className={cellClass}
                title={isFanOut ? 'fan-out: multiple targets' : undefined}
                style={data.onExitsReorder ? { cursor: 'grab' } : undefined}
                onPointerDown={handleCellPointerDown(idx)}
                onPointerMove={handleCellPointerMove(idx)}
                onPointerUp={handleCellPointerUp}
              >
                <span className={styles.switcherLabel}>
                  {exit}
                  {isFanOut && <span className={styles.fanOutGlyph}>⇉</span>}
                </span>
                <Handle
                  type="source"
                  position={Position.Bottom}
                  id={exit}
                  className={switcherHandleClass}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {(data.fanOutExits?.includes(exits[0]) ?? false) && (
            <div
              className={styles.fanOutBar}
              title="fan-out: multiple targets"
            >
              <span className={styles.fanOutGlyph}>⇉</span>
            </div>
          )}
          <Handle
            type="source"
            position={Position.Bottom}
            id={exits[0]}
            className={handleClass}
          />
        </>
      )}
    </div>
  );
}
