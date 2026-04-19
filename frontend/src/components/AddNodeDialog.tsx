import { useEffect, useRef, useState } from 'react';
import { addNode } from '../api';
import type { AddNodePayload, FlowView } from '../types';

interface AddNodeDialogProps {
  workspace: string;
  flowId: string;
  onClose: () => void;
  onCreated: (flow: FlowView) => void;
}

export function AddNodeDialog({
  workspace,
  flowId,
  onClose,
  onCreated,
}: AddNodeDialogProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    // New nodes default to plain-return (0 declared exits). The runtime
    // routes the return value through the implicit "out" handle per SPEC §5.
    // Users can add named exits later via the Inspector if they want emit-
    // based multi-exit routing. Avoids forcing an alias ("out") on single-
    // return nodes that don't need one.
    const payload: AddNodePayload = {
      name: trimmed,
      ref: '',
      input: 'typing.Any',
      exits: {},
      selector: null,
      create_stub: true,
    };
    try {
      const updated = await addNode(workspace, flowId, payload);
      onCreated(updated);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-[rgba(0,0,0,0.35)] pt-[25vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="flex w-[340px] flex-col gap-1.5 rounded-sm border border-line-2 bg-surface-2 p-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
        onSubmit={handleSubmit}
      >
        <input
          ref={inputRef}
          className="rounded-xs border border-line-1 bg-surface-1 px-2.5 py-2 font-mono text-md text-ink-0 outline-none focus-visible:border-blue"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="node name, press Enter"
          spellCheck={false}
          disabled={submitting}
        />
        {error && (
          <div className="px-1 py-0 font-mono text-xs text-red">{error}</div>
        )}
      </form>
    </div>
  );
}
