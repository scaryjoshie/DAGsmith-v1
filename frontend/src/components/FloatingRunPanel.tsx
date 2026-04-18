import { useEffect, useState } from 'react';
import { getFlow } from '../api';
import { RunPanel } from './RunPanel';

interface FloatingRunPanelProps {
  workspace: string;
  flowId: string;
  onClose: () => void;
}

export function FloatingRunPanel({
  workspace,
  flowId,
  onClose,
}: FloatingRunPanelProps) {
  const [inputType, setInputType] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    getFlow(workspace, flowId)
      .then((f) => { if (!cancelled) setInputType(f.input_type); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspace, flowId]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-50 flex max-h-[50%] min-h-[180px] flex-col border-t border-line-1 bg-surface-0">
      <div className="flex h-8 shrink-0 items-center gap-2.5 border-b border-line-0 bg-surface-0 px-3.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-0">Run</span>
        <span className="font-mono text-xs tracking-[-0.01em] text-ink-2">{flowId}</span>
        <div className="flex-1" />
        <button
          type="button"
          className="cursor-pointer rounded-xs border-0 bg-transparent px-2 py-0.5 text-[16px] leading-none text-ink-2 hover:bg-surface-2 hover:text-ink-0"
          onClick={onClose}
          aria-label="Close run panel"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [&>*]:!border-t-0">
        <RunPanel
          workspace={workspace}
          flowId={flowId}
          inputType={inputType}
        />
      </div>
    </div>
  );
}
