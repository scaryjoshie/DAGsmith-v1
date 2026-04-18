import { Handle, Position, useConnection, type NodeProps, type Node } from '@xyflow/react';
import { useRef, useState, type ReactNode } from 'react';

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
  fanOutCounts?: Record<string, number>;
  snappedAbove?: boolean;
  snappedBelow?: boolean;
};

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

// Inner-class names that the vendor-overrides.css selection rule looks
// for: `.flow-graph-canvas .react-flow__node.selected .wf-process` etc.
// Don't rename without also updating vendor-overrides.css.
const PROCESS_BASE =
  'wf-process group relative flex min-w-[260px] flex-col rounded-xs border border-line-2 bg-surface-1 font-mono tracking-[-0.01em] text-ink-0 transition-[border-color] duration-100 ease-[ease] hover:border-ink-2 hover:bg-surface-2';

const TERMINAL_BASE =
  'wf-terminal group flex min-w-[84px] items-center justify-center gap-2 rounded-xs border border-dashed border-line-1 bg-surface-0 px-[18px] py-[7px] font-mono text-sm font-normal tracking-[0.01em] text-ink-2 transition-[border-color] duration-100 ease-[ease] hover:border-line-2 hover:text-ink-1';

const HANDLE_BASE =
  '!h-[7px] !w-[7px] !rounded-none !border !border-[var(--fg-2)] !bg-[var(--fg-2)] !opacity-0 transition-opacity duration-150 ease-[ease] group-hover:!opacity-100 hover:!bg-[var(--fg-0)] hover:!border-[var(--fg-0)]';

const HANDLE_VISIBLE_EXTRA = '!opacity-100';

const SWITCHER_HANDLE_BASE =
  '!h-[7px] !w-[7px] !rounded-none !border !border-[var(--fg-2)] !bg-[var(--fg-2)] !opacity-0 !left-1/2 transition-opacity duration-150 ease-[ease] group-hover:!opacity-100 hover:!bg-[var(--fg-0)] hover:!border-[var(--fg-0)]';

export function WorkflowNode({ data }: NodeProps<WorkflowNode>) {
  const connection = useConnection();
  const isConnecting = !!connection.fromNode;
  const isTerminal = data.variant === 'terminal';

  if (isTerminal) {
    const handleClass = isConnecting ? `${HANDLE_BASE} ${HANDLE_VISIBLE_EXTRA}` : HANDLE_BASE;
    return (
      <div className={TERMINAL_BASE}>
        <Handle type="target" position={Position.Top} id="in" className={handleClass} />
        {data.icon && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-2"
            style={{ background: data.iconBg, color: data.iconColor }}
          >
            {data.icon}
          </span>
        )}
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{data.label}</span>
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
    ? 'wf-severity-blocking !border-red hover:!border-red'
    : data.severity === 'warning'
      ? 'wf-severity-warning !border-amber hover:!border-amber'
      : '';

  const snapTargetClass = data.snapTarget
    ? 'border-b-2 !border-b-[var(--selection)] shadow-[0_2px_0_0_var(--selection)]'
    : '';

  const snappedAboveClass = data.snappedAbove ? 'rounded-b-none' : '';
  const snappedBelowClass = data.snappedBelow ? 'rounded-t-none border-t-0' : '';

  const processClass = `${PROCESS_BASE} ${severityClass} ${snapTargetClass} ${snappedAboveClass} ${snappedBelowClass}`;
  const handleClass = isConnecting ? `${HANDLE_BASE} ${HANDLE_VISIBLE_EXTRA}` : HANDLE_BASE;
  const switcherHandleClass = isConnecting
    ? `${SWITCHER_HANDLE_BASE} ${HANDLE_VISIBLE_EXTRA}`
    : SWITCHER_HANDLE_BASE;

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
      <div className="flex items-center gap-3 px-[18px] py-3 text-lg">
        {data.icon && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-2"
            style={{ background: data.iconBg, color: data.iconColor }}
          >
            {data.icon}
          </span>
        )}
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{data.label}</span>
      </div>
      {hasSwitcher ? (
        <div className="flex rounded-b-xs border-t border-line-2 bg-surface-2">
          {exits.map((exit, idx) => {
            const isDragging = dragIndex === idx;
            const isDropTarget = dropIndex === idx && dragIndex !== null && dragIndex !== idx;
            const fanCount = data.fanOutCounts?.[exit];
            const isFanOut = fanCount !== undefined && fanCount > 1;
            const cellBaseBg = isFanOut
              ? 'bg-[color-mix(in_srgb,var(--amber)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--amber)_14%,var(--bg-3))]'
              : 'hover:bg-surface-3';
            const cellClass = [
              'relative min-w-[72px] flex-[1_0_auto] whitespace-nowrap border-r border-line-2 px-3.5 py-[7px] text-center font-mono text-xs tracking-[-0.01em] text-ink-1 transition-[background,color] duration-100 ease-[ease] hover:text-ink-0 last:border-r-0',
              cellBaseBg,
              isDragging ? 'opacity-40' : '',
              isDropTarget ? '!bg-surface-3 border-l-2 border-l-[var(--selection)]' : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={exit}
                className={cellClass}
                title={isFanOut ? `fan-out: ${fanCount} targets` : undefined}
                style={data.onExitsReorder ? { cursor: 'grab' } : undefined}
                onPointerDown={handleCellPointerDown(idx)}
                onPointerMove={handleCellPointerMove(idx)}
                onPointerUp={handleCellPointerUp}
              >
                <span className="pointer-events-none block">
                  {exit}
                  {isFanOut && <span className="pointer-events-none ml-1 text-[10px] text-amber opacity-85">×{fanCount}</span>}
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
          {(() => {
            const fanCount = data.fanOutCounts?.[exits[0]];
            return fanCount !== undefined && fanCount > 1 ? (
              <div
                className="flex items-center justify-center rounded-b-xs border-t border-line-2 bg-[color-mix(in_srgb,var(--amber)_8%,transparent)] pt-1 pb-[3px] font-mono text-xs tracking-[-0.01em] text-amber"
                title={`fan-out: ${fanCount} targets`}
              >
                <span className="pointer-events-none ml-1 text-[10px] text-amber opacity-85">×{fanCount}</span>
              </div>
            ) : null;
          })()}
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
