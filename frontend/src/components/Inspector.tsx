import { useEffect, useRef, useState } from 'react';
import { updateNode } from '../api';
import type { FlowView } from '../types';
import { useSelection, type SelectedNode } from '../SelectionContext';
import styles from './Inspector.module.css';

interface InspectorProps {
  selectedNode: SelectedNode;
  flow: FlowView | null;
  onOpenSource: (nodeId: string, split: boolean) => void;
  onDismiss: () => void;
  onNodeRenamed: (oldName: string, newName: string) => void;
  onFlowRefetch: () => void;
}

interface EditFieldProps {
  value: string;
  original: string;
  busy: boolean;
  error: string | null;
  ariaLabel: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onRollback: () => void;
}

function EditField({ value, original, busy, error, ariaLabel, onChange, onCommit, onRollback }: EditFieldProps) {
  const cancelledRef = useRef(false);
  return (
    <input
      className={error ? `${styles.editInput} ${styles.editInputError}` : styles.editInput}
      value={value}
      disabled={busy}
      title={error ?? original}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => { if (!cancelledRef.current) { onCommit(); } cancelledRef.current = false; }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        else if (e.key === 'Escape') { cancelledRef.current = true; onRollback(); e.currentTarget.blur(); }
      }}
      aria-label={ariaLabel}
      spellCheck={false}
    />
  );
}

export function Inspector({
  selectedNode,
  flow,
  onOpenSource,
  onDismiss,
  onNodeRenamed,
  onFlowRefetch,
}: InspectorProps) {
  const { onFlowMutated } = useSelection();
  const node = flow?.nodes[selectedNode.nodeId];

  const [nameValue, setNameValue] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [refValue, setRefValue] = useState('');
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  const [inputValue, setInputValue] = useState('');
  const [inputBusy, setInputBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameCancelledRef = useRef(false);

  useEffect(() => {
    setNameValue(node?.name ?? selectedNode.nodeId);
    setNameError(null);
  }, [node?.name, selectedNode.nodeId]);

  useEffect(() => {
    setRefValue(node?.ref ?? '');
    setRefError(null);
  }, [node?.ref]);

  useEffect(() => {
    setInputValue(node?.input_type ?? '');
    setInputError(null);
  }, [node?.input_type]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && document.activeElement !== nameInputRef.current) {
        e.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  async function commitName() {
    if (nameCancelledRef.current) { nameCancelledRef.current = false; return; }
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === selectedNode.nodeId) {
      setNameValue(selectedNode.nodeId);
      setNameError(null);
      return;
    }
    setNameBusy(true);
    setNameError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { new_name: trimmed });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onNodeRenamed(selectedNode.nodeId, trimmed);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : String(err));
      setNameValue(selectedNode.nodeId);
    } finally {
      setNameBusy(false);
    }
  }

  async function commitRef() {
    const trimmed = refValue.trim();
    const original = node?.ref ?? '';
    if (!trimmed || trimmed === original) {
      setRefValue(original);
      setRefError(null);
      return;
    }
    setRefBusy(true);
    setRefError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { ref: trimmed });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onFlowRefetch();
    } catch (err) {
      setRefError(err instanceof Error ? err.message : String(err));
      setRefValue(original);
    } finally {
      setRefBusy(false);
    }
  }

  async function commitInput() {
    const trimmed = inputValue.trim();
    const original = node?.input_type ?? '';
    if (!trimmed || trimmed === original) {
      setInputValue(original);
      setInputError(null);
      return;
    }
    setInputBusy(true);
    setInputError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { input: trimmed });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onFlowRefetch();
    } catch (err) {
      setInputError(err instanceof Error ? err.message : String(err));
      setInputValue(original);
    } finally {
      setInputBusy(false);
    }
  }

  if (!node) {
    return (
      <div className={styles.root}>
        <div className={styles.loading}>loading…</div>
        <button type="button" className={styles.dismiss} onClick={onDismiss} title="Dismiss (Esc)" aria-label="Dismiss inspector">✕</button>
      </div>
    );
  }

  const exits = Object.entries(node.exits);
  const isSubflow = node.kind === 'flow';

  return (
    <div className={styles.root}>
      <div className={styles.identity}>
        <span className={styles.kindChip}>{node.kind}</span>
        <input
          ref={nameInputRef}
          className={nameError ? `${styles.editInput} ${styles.editInputError}` : styles.editInput}
          value={nameValue}
          disabled={nameBusy}
          title={nameError ?? node.name}
          onChange={(e) => { setNameValue(e.target.value); setNameError(null); }}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.currentTarget.blur(); }
            else if (e.key === 'Escape') {
              nameCancelledRef.current = true;
              setNameValue(selectedNode.nodeId);
              setNameError(null);
              e.currentTarget.blur();
            }
          }}
          aria-label="Node name"
          spellCheck={false}
        />
      </div>

      <div className={styles.fields}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>input</span>
          <EditField
            value={inputValue}
            original={node.input_type}
            busy={inputBusy}
            error={inputError}
            ariaLabel="Input type"
            onChange={(v) => { setInputValue(v); setInputError(null); }}
            onCommit={commitInput}
            onRollback={() => { setInputValue(node.input_type); setInputError(null); }}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>ref</span>
          <EditField
            value={refValue}
            original={node.ref}
            busy={refBusy}
            error={refError}
            ariaLabel="Node ref"
            onChange={(v) => { setRefValue(v); setRefError(null); }}
            onCommit={commitRef}
            onRollback={() => { setRefValue(node.ref); setRefError(null); }}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>exits</span>
          <div className={styles.exitPills}>
            {exits.map(([name, type]) => (
              <span key={name} className={styles.exitPill} title={type}>
                <span className={styles.exitName}>{name}</span>
                <span className={styles.exitType}>{shortName(type)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        {isSubflow ? (
          <button
            type="button"
            className={styles.action}
            onClick={(e) => onOpenSource(node.name, e.shiftKey)}
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
        ) : null}
      </div>

      <button type="button" className={styles.dismiss} onClick={onDismiss} title="Dismiss (Esc)" aria-label="Dismiss inspector">✕</button>
    </div>
  );
}

function shortName(typeRef: string): string {
  const parts = typeRef.split('.');
  return parts[parts.length - 1] ?? typeRef;
}
