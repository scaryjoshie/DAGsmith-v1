import { Handle, Position, useConnection, type NodeProps, type Node } from '@xyflow/react';
import { shortName } from '../lib/typeRefs';

/**
 * StartNode — a virtual entry sentinel (SPEC §12 line 427). Renders a
 * compact pill with a ▶ glyph and the short name of the flow's declared
 * input type. No input handle — flow begins here. One source handle at
 * the bottom; the leaf-chevron cue isn't relevant since start ALWAYS
 * has a single outgoing edge in a healthy flow.
 */

export type StartNodeData = {
  label: string;
  input_type: string;
  snapTarget?: boolean;
  // These fields are never populated on a StartNode in practice, but the
  // type-union with WorkflowNodeData shares a few "maybe" fields so the
  // FlowGraph's cross-type decorator / drag / snap code can stay uniform
  // without discriminated-union gymnastics.
  exits?: string[];
};

export type StartNode = Node<StartNodeData, 'start'>;

// `wf-start` class hook: parallels `.wf-process` for the
// vendor-overrides.css selection-ring rule.
const START_BASE =
  'wf-start group relative flex min-w-[160px] items-center gap-3 rounded-xs border border-green/60 bg-surface-1 px-[18px] py-2 font-mono tracking-[-0.01em] text-ink-1 transition-[border-color] duration-100 ease-[ease] hover:border-green hover:text-ink-0';

const HANDLE_BASE =
  '!h-[7px] !w-[7px] !rounded-none !border !border-[var(--fg-2)] !bg-[var(--fg-2)] !opacity-0 transition-opacity duration-150 ease-[ease] group-hover:!opacity-100 hover:!bg-[var(--fg-0)] hover:!border-[var(--fg-0)]';

const HANDLE_VISIBLE_EXTRA = '!opacity-100';

export function StartNode({ data }: NodeProps<StartNode>) {
  const connection = useConnection();
  const isConnecting = !!connection.fromNode;
  const handleClass = isConnecting ? `${HANDLE_BASE} ${HANDLE_VISIBLE_EXTRA}` : HANDLE_BASE;

  const snapTargetClass = data.snapTarget
    ? 'border-b-2 !border-b-[var(--blue)] shadow-[0_2px_0_0_var(--blue)]'
    : '';

  return (
    <div className={`${START_BASE} ${snapTargetClass}`}>
      <span className="pointer-events-none text-green text-sm leading-none">▶</span>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs">
        {shortName(data.input_type)}
      </span>
      <Handle type="source" position={Position.Bottom} id="out" className={handleClass} />
    </div>
  );
}
