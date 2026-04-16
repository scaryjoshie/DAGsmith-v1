import { useEffect, useRef, useState } from 'react';
import { addNode } from '../api';
import type { AddNodePayload, FlowView } from '../types';
import styles from './AddNodeDialog.module.css';

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
    const payload: AddNodePayload = {
      name: trimmed,
      ref: '',
      input: 'typing.Any',
      exits: { out: 'typing.Any' },
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
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className={styles.mini} onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className={styles.miniInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="node name, press Enter"
          spellCheck={false}
          disabled={submitting}
        />
        {error && <div className={styles.miniError}>{error}</div>}
      </form>
    </div>
  );
}
