import { useEffect, useRef, useState } from 'react';
import { updateNode } from '../api';
import { useSelection, type SelectedNode } from '../SelectionContext';
import type { FlowView } from '../types';

/**
 * StartInspector — right-sidebar editor shown when the selected node's
 * `kind` is `"start"` (SPEC §12 line 427). It edits exactly one thing:
 * the type of the start sentinel's `out` exit, which is also the flow's
 * declared input type (computed from start.exits["out"]).
 *
 * Not a branch of Inspector — separate component so the inspector code
 * for compute nodes stays free of start-specific guards.
 */

interface StartInspectorProps {
  selectedNode: SelectedNode;
  flow: FlowView | null;
  onDismiss: () => void;
  onFlowRefetch: () => void;
}

export function StartInspector({
  selectedNode,
  flow,
  onDismiss,
  onFlowRefetch,
}: StartInspectorProps) {
  const { onFlowMutated } = useSelection();
  const node = flow?.nodes[selectedNode.nodeId];
  const currentType = node?.exits?.['out'] ?? '';

  const [typeValue, setTypeValue] = useState(currentType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Resync when the selected node (or its backing data) changes.
  useEffect(() => {
    setTypeValue(currentType);
    setError(null);
  }, [currentType, selectedNode.nodeId]);

  const commitType = async () => {
    const next = typeValue.trim();
    if (!next || next === currentType) {
      setTypeValue(currentType);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, {
        exits: { out: next },
      });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onFlowRefetch();
    } catch (e) {
      setError((e as Error).message);
      setTypeValue(currentType);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-0">
      <div className="flex items-center gap-3 border-b border-line-0 bg-surface-1 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.06em] text-ink-2">
        <span className="text-ink-2">▶</span>
        <span className="flex-1 min-w-0 overflow-hidden">Start</span>
        <button
          type="button"
          onClick={onDismiss}
          className="font-mono text-xs text-ink-2 hover:text-ink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3.5 font-mono text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.06em] text-ink-3">Input type</label>
          <input
            className={`w-full border bg-surface-1 px-2 py-1 font-mono text-xs text-ink-0 transition-[border-color] duration-100 ease-[ease] focus:outline-none ${
              error ? 'border-red' : 'border-line-1 hover:border-line-2 focus:border-ink-2'
            }`}
            value={typeValue}
            disabled={busy}
            title={error ?? currentType}
            onChange={(e) => setTypeValue(e.target.value)}
            onBlur={() => {
              if (!cancelledRef.current) { void commitType(); }
              cancelledRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.currentTarget.blur(); }
              else if (e.key === 'Escape') {
                cancelledRef.current = true;
                setTypeValue(currentType);
                e.currentTarget.blur();
              }
            }}
            aria-label="Start input type"
            spellCheck={false}
          />
          {error && <span className="text-[11px] text-red">{error}</span>}
        </div>

        <p className="text-[11px] leading-relaxed text-ink-3">
          The start sentinel passes the flow's input payload through its{' '}
          <span className="font-mono text-ink-2">out</span> exit. This is also the flow's{' '}
          declared input type.
        </p>
      </div>
    </div>
  );
}
