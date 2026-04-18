import { useEffect, useRef, useState } from 'react';
import { updateNode } from '../api';
import type { FlowView } from '../types';
import { useSelection, type SelectedNode } from '../SelectionContext';
import { shortName } from '../lib/typeRefs';

// Shared input class snippets — kept here as string constants so each
// CSS-Module rule maps to a single source of truth and so error variants
// can compose cleanly via template strings.

const ERROR_BORDER = '!border-[#e05252]';

const NAME_INPUT_BASE =
  'w-full min-w-0 rounded-xs border border-transparent bg-transparent px-[5px] py-0.5 font-mono text-sm font-medium text-ink-0 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-60';

const EDIT_INPUT_BASE =
  'w-full min-w-0 rounded-xs border border-transparent bg-transparent px-1.5 py-[3px] font-mono text-xs font-normal text-ink-0 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-60';

const EXIT_PILL_INPUT_BASE =
  'flex-1 min-w-[2ch] rounded-[2px] border border-transparent bg-transparent px-[3px] py-px font-mono text-xs font-medium text-ink-0 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-0';

const EXIT_PILL_TYPE_BASE =
  'min-w-[3ch] rounded-[2px] border border-transparent bg-transparent px-[3px] py-px font-mono text-[9px] text-ink-2 outline-none transition-[border-color,background] duration-100 ease-[ease] hover:border-line-1 focus:border-line-2 focus:bg-surface-0 focus:text-ink-1';

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
  const [diagOpen, setDiagOpen] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameCancelledRef = useRef(false);
  const diagPopoverRef = useRef<HTMLDivElement>(null);

  const nodeDiags = (flow?.diagnostics ?? []).filter(
    (d) => d.node_id === selectedNode.nodeId
  );

  // Reset add-exit row and diag popover when node changes.
  useEffect(() => { setShowAddExit(false); setDiagOpen(false); }, [selectedNode.nodeId]);

  // Close diag popover on click outside.
  useEffect(() => {
    if (!diagOpen) return;
    function handleClick(e: MouseEvent) {
      if (diagPopoverRef.current && !diagPopoverRef.current.contains(e.target as Node)) {
        setDiagOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [diagOpen]);

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
      <div className="flex h-full flex-col overflow-hidden bg-surface-0 text-xs text-ink-0">
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line-0 pl-3.5 pr-2.5">
          <span className="flex-1 min-w-0 overflow-hidden">Inspector</span>
          <button
            type="button"
            className="shrink-0 cursor-pointer rounded-xs border-0 bg-transparent px-[5px] py-1 text-[11px] leading-none text-ink-3 transition-[color,background] duration-100 ease-[ease] hover:bg-surface-hover hover:text-ink-0"
            onClick={onDismiss}
            title="Dismiss (Esc)"
            aria-label="Dismiss inspector"
          >✕</button>
        </div>
        <div className="flex flex-1 items-center justify-center px-3.5 text-xs text-ink-3">loading…</div>
      </div>
    );
  }

  const exits = Object.entries(node.exits);
  const isSubflow = node.kind === 'flow';

  const worstSeverity = nodeDiags.some(d => d.severity === 'error') ? 'error'
    : nodeDiags.some(d => d.severity === 'warning') ? 'warning'
    : nodeDiags.length > 0 ? 'info' : null;

  const diagBadgeColor =
    worstSeverity === 'error' ? 'text-[#e05252]'
    : worstSeverity === 'warning' ? 'text-[#d97706]'
    : 'text-ink-3';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-0 text-xs text-ink-0">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line-0 pl-3.5 pr-2.5">
        <span className="shrink-0 rounded-xs border border-line-1 bg-transparent px-[5px] py-px text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">{node.kind}</span>
        <span className="flex-1 min-w-0 overflow-hidden">
          <input
            ref={nameInputRef}
            className={`${NAME_INPUT_BASE} ${nameError ? ERROR_BORDER : ''}`}
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
        </span>
        {worstSeverity && (
          <button
            type="button"
            className={`shrink-0 cursor-pointer whitespace-nowrap rounded-xs border border-current bg-transparent px-[5px] py-px font-mono text-[9px] leading-[1.4] transition-opacity duration-100 ease-[ease] hover:opacity-75 ${diagBadgeColor}`}
            onClick={() => setDiagOpen((v) => !v)}
            title={`${nodeDiags.length} diagnostic${nodeDiags.length !== 1 ? 's' : ''}`}
            aria-label={`${nodeDiags.length} diagnostics`}
          >
            ● {nodeDiags.length}
          </button>
        )}
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-xs border-0 bg-transparent px-[5px] py-1 text-[11px] leading-none text-ink-3 transition-[color,background] duration-100 ease-[ease] hover:bg-surface-hover hover:text-ink-0"
          onClick={onDismiss}
          title="Dismiss (Esc)"
          aria-label="Dismiss inspector"
        >✕</button>
      </div>

      {diagOpen && nodeDiags.length > 0 && (
        <div ref={diagPopoverRef} className="max-h-[160px] overflow-y-auto border-b border-line-0 bg-surface-1 py-1">
          {nodeDiags.map((d) => (
            <div key={d.id} className="flex items-start gap-1.5 px-3.5 py-1 font-mono text-xs text-ink-1">
              <span
                className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                  d.severity === 'error' ? 'bg-[#e05252]'
                  : d.severity === 'warning' ? 'bg-[#d97706]'
                  : 'bg-ink-3'
                }`}
              />
              <span className="min-w-0 flex-1 whitespace-normal leading-[1.4] [word-break:break-word]">{d.message}</span>
              {d.source_location && (d.source_location as { line?: number }).line != null && (
                <span className="shrink-0 pt-px text-[9px] text-ink-3">line {(d.source_location as { line: number }).line}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-1 border-b border-line-0 px-3.5 py-2">
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">INPUT</span>
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

        <div className="flex flex-col gap-1 border-b border-line-0 px-3.5 py-2">
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">REF</span>
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

        <div className="flex flex-col gap-1 border-b border-line-0 px-3.5 py-2">
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">EXITS</span>
          <div className="flex flex-col gap-1">
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
                className="cursor-pointer self-start rounded-xs border border-dashed border-line-1 bg-transparent px-2 py-[3px] text-xs leading-none text-ink-3 transition-[color,border-color] duration-100 ease-[ease] hover:border-line-2 hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setShowAddExit(true)}
                disabled={exitsBusy}
                title="Add exit"
                aria-label="Add exit"
              >+</button>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-line-0 px-3.5 py-2.5">
        {isSubflow ? (
          <button
            type="button"
            className="cursor-pointer whitespace-nowrap rounded-xs border border-line-1 bg-transparent px-2.5 py-[5px] text-left font-[inherit] text-xs text-ink-1 transition-[border-color,color] duration-100 ease-[ease] hover:border-line-2 hover:text-ink-0"
            onClick={(e) => onOpenSource(node.name, e.shiftKey)}
            title="Shift-click to split"
          >
            Enter subflow →
          </button>
        ) : node.source_code ? (
          <button
            type="button"
            className="cursor-pointer whitespace-nowrap rounded-xs border border-line-1 bg-transparent px-2.5 py-[5px] text-left font-[inherit] text-xs text-ink-1 transition-[border-color,color] duration-100 ease-[ease] hover:border-line-2 hover:text-ink-0"
            onClick={(e) => onOpenSource(node.name, e.shiftKey)}
            title="Shift-click to open as split"
          >
            Open source →
          </button>
        ) : null}
      </div>
    </div>
  );
}
