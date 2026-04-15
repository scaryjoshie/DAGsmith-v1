import { useEffect, useMemo, useState } from 'react';
import { addNode } from '../api';
import type { AddNodePayload, FlowView } from '../types';
import styles from './AddNodeDialog.module.css';

interface AddNodeDialogProps {
  workspace: string;
  flowId: string;
  onClose: () => void;
  onCreated: (flow: FlowView) => void;
}

interface ExitRow {
  name: string;
  type: string;
}

export function AddNodeDialog({
  workspace,
  flowId,
  onClose,
  onCreated,
}: AddNodeDialogProps) {
  const [name, setName] = useState('');
  const [refTouched, setRefTouched] = useState(false);
  const [refValue, setRefValue] = useState('');
  const [inputType, setInputType] = useState('');
  const [selectorRef, setSelectorRef] = useState('');
  const [exits, setExits] = useState<ExitRow[]>([{ name: 'out', type: '' }]);
  const [createStub, setCreateStub] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live-update ref default from name until the user edits ref explicitly.
  useEffect(() => {
    if (!refTouched) {
      setRefValue(name ? `.${name}:process` : '');
    }
  }, [name, refTouched]);

  const canSubmit = useMemo(() => {
    if (!name.trim() || !refValue.trim() || !inputType.trim()) return false;
    if (exits.length === 0) return false;
    return exits.every((row) => row.name.trim() && row.type.trim());
  }, [name, refValue, inputType, exits]);

  function updateExit(idx: number, patch: Partial<ExitRow>) {
    setExits((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function addExitRow() {
    setExits((rows) => [...rows, { name: '', type: '' }]);
  }

  function removeExitRow(idx: number) {
    setExits((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const payload: AddNodePayload = {
      name: name.trim(),
      ref: refValue.trim(),
      input: inputType.trim(),
      exits: Object.fromEntries(
        exits.map((row) => [row.name.trim(), row.type.trim()])
      ),
      selector: selectorRef.trim() ? selectorRef.trim() : null,
      create_stub: createStub,
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
      <form className={styles.modal} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h3 className={styles.title}>Add node</h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="validate_phone"
              autoFocus
              spellCheck={false}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Ref</span>
            <input
              className={styles.input}
              value={refValue}
              onChange={(e) => {
                setRefTouched(true);
                setRefValue(e.target.value);
              }}
              placeholder=".validate_phone:process"
              spellCheck={false}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Input type</span>
            <input
              className={styles.input}
              value={inputType}
              onChange={(e) => setInputType(e.target.value)}
              placeholder="examples.customer.onboarding.types.records.NormalizedCustomer"
              spellCheck={false}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Exits</span>
            <div className={styles.exitsList}>
              {exits.map((row, idx) => (
                <div key={idx} className={styles.exitRow}>
                  <input
                    className={styles.exitName}
                    value={row.name}
                    onChange={(e) => updateExit(idx, { name: e.target.value })}
                    placeholder="out"
                    spellCheck={false}
                  />
                  <input
                    className={styles.exitType}
                    value={row.type}
                    onChange={(e) => updateExit(idx, { type: e.target.value })}
                    placeholder="package.types.MyType"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => removeExitRow(idx)}
                    disabled={exits.length === 1}
                    aria-label="Remove exit"
                  >
                    −
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.addRowButton}
                onClick={addExitRow}
              >
                + add exit
              </button>
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Selector ref (optional)</span>
            <input
              className={styles.input}
              value={selectorRef}
              onChange={(e) => setSelectorRef(e.target.value)}
              placeholder=".route:pick"
              spellCheck={false}
            />
          </label>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={createStub}
              onChange={(e) => setCreateStub(e.target.checked)}
            />
            <span>Create stub .py file</span>
          </label>

          {error && (
            <div className={styles.error}>
              <div className={styles.errorLabel}>Create failed</div>
              <pre className={styles.errorBody}>{error}</pre>
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={!canSubmit || submitting}
          >
            {submitting ? 'creating…' : 'Create'}
          </button>
        </footer>
      </form>
    </div>
  );
}
