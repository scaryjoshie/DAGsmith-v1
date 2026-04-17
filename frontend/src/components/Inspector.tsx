import { useEffect, useRef, useState } from 'react';
import { updateNode } from '../api';
import type { FlowView } from '../types';
import { useSelection, type SelectedNode } from '../SelectionContext';
import styles from './Inspector.module.css';

function shortName(typeRef: string): string {
  const parts = typeRef.split('.');
  return parts[parts.length - 1] ?? typeRef;
}

// A single exit pill — name editable, type editable, removable.
interface ExitPillProps {
  exitName: string;
  exitType: string;
  nodeId: string;
  busy: boolean;
  flow: FlowView;
  onRenameExit: (oldName: string, newName: string) => Promise<void>;
  onChangeExitType: (exitName: string, newType: string) => Promise<void>;
  onRemoveExit: (exitName: string) => Promise<void>;
}

function ExitPill({ exitName, exitType, nodeId, busy, flow, onRenameExit, onChangeExitType, onRemoveExit }: ExitPillProps) {
  const [nameVal, setNameVal] = useState(exitName);
  const [typeVal, setTypeVal] = useState(exitType);
  const [nameError, setNameError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const nameCancelRef = useRef(false);
  const typeCancelRef = useRef(false);

  useEffect(() => { setNameVal(exitName); setNameError(null); }, [exitName]);
  useEffect(() => { setTypeVal(exitType); setTypeError(null); }, [exitType]);

  const connectedEdges = flow.edges.filter(e => e.from_node === nodeId && e.from_exit === exitName);

  async function commitName() {
    if (nameCancelRef.current) { nameCancelRef.current = false; return; }
    const trimmed = nameVal.trim();
    if (!trimmed || trimmed === exitName) { setNameVal(exitName); setNameError(null); return; }
    try { await onRenameExit(exitName, trimmed); }
    catch (err) { setNameError(err instanceof Error ? err.message : String(err)); setNameVal(exitName); }
  }

  async function commitType() {
    if (typeCancelRef.current) { typeCancelRef.current = false; return; }
    const trimmed = typeVal.trim();
    if (!trimmed || trimmed === exitType) { setTypeVal(exitType); setTypeError(null); return; }
    try { await onChangeExitType(exitName, trimmed); }
    catch (err) { setTypeError(err instanceof Error ? err.message : String(err)); setTypeVal(exitType); }
  }

  async function handleRemove() {
    if (connectedEdges.length > 0) {
      const plural = connectedEdges.length === 1 ? 'edge' : 'edges';
      if (!window.confirm(`Exit '${exitName}' is connected to ${connectedEdges.length} ${plural}. Remove anyway?`)) return;
    }
    await onRemoveExit(exitName);
  }

  return (
    <span className={styles.exitPill}>
      <input
        className={nameError ? `${styles.exitPillInput} ${styles.editInputError}` : styles.exitPillInput}
        value={nameVal}
        disabled={busy}
        title={nameError ?? exitName}
        style={{ width: `${Math.max(nameVal.length, 2)}ch` }}
        onChange={(e) => { setNameVal(e.target.value); setNameError(null); }}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          else if (e.key === 'Escape') { nameCancelRef.current = true; setNameVal(exitName); setNameError(null); e.currentTarget.blur(); }
        }}
        spellCheck={false}
        aria-label={`Exit name ${exitName}`}
      />
      <input
        className={typeError ? `${styles.exitPillType} ${styles.editInputError}` : styles.exitPillType}
        value={typeVal}
        disabled={busy}
        title={typeError ?? exitType}
        style={{ width: `${Math.max(shortName(typeVal).length, 3)}ch` }}
        onChange={(e) => { setTypeVal(e.target.value); setTypeError(null); }}
        onBlur={commitType}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          else if (e.key === 'Escape') { typeCancelRef.current = true; setTypeVal(exitType); setTypeError(null); e.currentTarget.blur(); }
        }}
        spellCheck={false}
        aria-label={`Exit type for ${exitName}`}
      />
      <button
        type="button"
        className={styles.exitRemove}
        onClick={handleRemove}
        disabled={busy}
        title={`Remove exit '${exitName}'`}
        aria-label={`Remove exit ${exitName}`}
      >×</button>
    </span>
  );
}

// Inline add-exit row.
interface AddExitRowProps {
  busy: boolean;
  existingNames: string[];
  onAdd: (name: string, type: string) => Promise<void>;
  onCancel: () => void;
}

function AddExitRow({ busy, existingNames, onAdd, onCancel }: AddExitRowProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('typing.Any');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  useEffect(() => { nameRef.current?.focus(); }, []);

  async function commit() {
    if (committingRef.current) return;
    committingRef.current = true;
    const trimmedName = name.trim();
    const trimmedType = type.trim() || 'typing.Any';
    if (!trimmedName) { onCancel(); committingRef.current = false; return; }
    if (existingNames.includes(trimmedName)) {
      setError(`exit '${trimmedName}' already exists`);
      committingRef.current = false;
      return;
    }
    try { await onAdd(trimmedName, trimmedType); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); committingRef.current = false; }
  }

  return (
    <span className={styles.exitPill}>
      <input
        ref={nameRef}
        className={error ? `${styles.exitPillInput} ${styles.editInputError}` : styles.exitPillInput}
        value={name}
        placeholder="name"
        disabled={busy}
        title={error ?? 'New exit name'}
        style={{ width: `${Math.max(name.length, 4)}ch` }}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        spellCheck={false}
        aria-label="New exit name"
      />
      <input
        className={styles.exitPillType}
        value={type}
        placeholder="type"
        disabled={busy}
        style={{ width: `${Math.max(shortName(type).length, 4)}ch` }}
        onChange={(e) => setType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { nameRef.current?.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        spellCheck={false}
        aria-label="New exit type"
      />
    </span>
  );
}

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

  const [exitsBusy, setExitsBusy] = useState(false);
  const [showAddExit, setShowAddExit] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameCancelledRef = useRef(false);

  // Reset add-exit row when node changes.
  useEffect(() => { setShowAddExit(false); }, [selectedNode.nodeId]);

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

  async function handleRenameExit(oldName: string, newName: string) {
    setExitsBusy(true);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, {
        rename_exits: { [oldName]: newName },
      });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onFlowRefetch();
    } finally {
      setExitsBusy(false);
    }
  }

  async function handleChangeExitType(exitName: string, newType: string) {
    if (!node) return;
    setExitsBusy(true);
    try {
      const updatedExits = { ...node.exits, [exitName]: newType };
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { exits: updatedExits });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onFlowRefetch();
    } finally {
      setExitsBusy(false);
    }
  }

  async function handleRemoveExit(exitName: string) {
    if (!node) return;
    setExitsBusy(true);
    try {
      const updatedExits = Object.fromEntries(
        Object.entries(node.exits).filter(([k]) => k !== exitName)
      );
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { exits: updatedExits });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onFlowRefetch();
    } finally {
      setExitsBusy(false);
    }
  }

  async function handleAddExit(name: string, type: string) {
    if (!node) return;
    setExitsBusy(true);
    try {
      const updatedExits = { ...node.exits, [name]: type };
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { exits: updatedExits });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onFlowRefetch();
      setShowAddExit(false);
    } finally {
      setExitsBusy(false);
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

        <div className={`${styles.field} ${styles.exitsField}`}>
          <span className={styles.fieldLabel}>exits</span>
          <div className={styles.exitPills}>
            {exits.map(([name, type]) => (
              <ExitPill
                key={name}
                exitName={name}
                exitType={type}
                nodeId={selectedNode.nodeId}
                busy={exitsBusy}
                flow={flow!}
                onRenameExit={handleRenameExit}
                onChangeExitType={handleChangeExitType}
                onRemoveExit={handleRemoveExit}
              />
            ))}
            {showAddExit && (
              <AddExitRow
                busy={exitsBusy}
                existingNames={exits.map(([n]) => n)}
                onAdd={handleAddExit}
                onCancel={() => setShowAddExit(false)}
              />
            )}
            {!showAddExit && (
              <button
                type="button"
                className={styles.exitAdd}
                onClick={() => setShowAddExit(true)}
                disabled={exitsBusy}
                title="Add exit"
                aria-label="Add exit"
              >+</button>
            )}
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
