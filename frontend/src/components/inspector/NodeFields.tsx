import { useEffect, useRef, useState } from 'react';
import type { FlowView } from '../../types';
import { shortName } from '../../lib/typeRefs';

// Shared field primitives used by the Inspector sidebar and the merged
// node-editor tab header. Exported from one place so both surfaces render
// with identical styling and edit semantics.

export const ERROR_BORDER = '!border-red';

export const NAME_INPUT_BASE =
  'w-full min-w-0 rounded-xs border border-transparent bg-transparent px-[5px] py-0.5 font-mono text-sm font-medium text-ink-0 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-60';

export const EDIT_INPUT_BASE =
  'w-full min-w-0 rounded-xs border border-transparent bg-transparent px-1.5 py-[3px] font-mono text-xs font-normal text-ink-0 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-60';

export const EXIT_PILL_INPUT_BASE =
  'flex-1 min-w-[2ch] rounded-[2px] border border-transparent bg-transparent px-[3px] py-px font-mono text-xs font-medium text-ink-0 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-0';

export const EXIT_PILL_TYPE_BASE =
  'min-w-[3ch] rounded-[2px] border border-transparent bg-transparent px-[3px] py-px font-mono text-[9px] text-ink-2 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-0 focus:text-ink-1';

// ---------------------------------------------------------------------------
// ExitPill — a single exit entry: name editable, type editable, removable.
// ---------------------------------------------------------------------------

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

export function ExitPill({ exitName, exitType, nodeId, busy, flow, onRenameExit, onChangeExitType, onRemoveExit }: ExitPillProps) {
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
    <span className="flex items-center gap-0.5 rounded-xs border border-line-0 bg-surface-1 py-0.5 pl-1 pr-[3px] font-mono text-xs">
      <input
        className={`${EXIT_PILL_INPUT_BASE} ${nameError ? ERROR_BORDER : ''}`}
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
        className={`${EXIT_PILL_TYPE_BASE} ${typeError ? ERROR_BORDER : ''}`}
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
        className="shrink-0 cursor-pointer rounded-[2px] border-0 bg-transparent px-0.5 py-px text-[10px] leading-none text-ink-3 transition-[color,background] duration-100 ease-[ease] hover:bg-surface-hover hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={handleRemove}
        disabled={busy}
        title={`Remove exit '${exitName}'`}
        aria-label={`Remove exit ${exitName}`}
      >×</button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// AddExitRow — inline "+add exit" row expanded below the exits list.
// ---------------------------------------------------------------------------

interface AddExitRowProps {
  busy: boolean;
  existingNames: string[];
  onAdd: (name: string, type: string) => Promise<void>;
  onCancel: () => void;
}

export function AddExitRow({ busy, existingNames, onAdd, onCancel }: AddExitRowProps) {
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
    <span className="flex items-center gap-0.5 rounded-xs border border-line-0 bg-surface-1 py-0.5 pl-1 pr-[3px] font-mono text-xs">
      <input
        ref={nameRef}
        className={`${EXIT_PILL_INPUT_BASE} ${error ? ERROR_BORDER : ''}`}
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
        className={EXIT_PILL_TYPE_BASE}
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

// ---------------------------------------------------------------------------
// EditField — single-line editable field (used for REF, INPUT type).
// ---------------------------------------------------------------------------

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

export function EditField({ value, original, busy, error, ariaLabel, onChange, onCommit, onRollback }: EditFieldProps) {
  const cancelledRef = useRef(false);
  return (
    <input
      className={`${EDIT_INPUT_BASE} ${error ? ERROR_BORDER : ''}`}
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
