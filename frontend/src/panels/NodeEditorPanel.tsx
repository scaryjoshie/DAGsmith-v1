import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import type { IDockviewPanelHeaderProps, IDockviewPanelProps } from 'dockview';
import { getFlow, updateNode } from '../api';
import type { FlowView, NodeView } from '../types';
import { useSelection } from '../SelectionContext';
import { registerFlowRefetch } from '../App';
import { PythonIcon } from '../icons/BrandIcons';
import {
  ERROR_BORDER,
  NAME_INPUT_BASE,
  EditField,
  ExitPill,
  AddExitRow,
} from '../components/inspector/NodeFields';

// NodeEditorPanel — the merged "tab IS the inspector" surface. Header region
// above a read-only CodeMirror editor. Rendered by dockview under
// `components.nodeEditor`. Not yet opened by any caller in this commit; gets
// wired in C3. Start-node variant renders a minimal INPUT-TYPE-only header.

export interface NodeEditorPanelParams {
  workspaceName: string;
  flowId: string;
  nodeId: string;
  preview?: boolean;
}

export function NodeEditorPanel({ params, api: panelApi }: IDockviewPanelProps<NodeEditorPanelParams>) {
  const { workspaceName, flowId, nodeId } = params;
  const panelId = panelApi.id;

  const [flow, setFlow] = useState<FlowView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFlow(null);
    setError(null);
    getFlow(workspaceName, flowId)
      .then((f) => { if (!cancelled) setFlow(f); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [workspaceName, flowId, nodeId]);

  const refetch = () => {
    getFlow(workspaceName, flowId)
      .then((f) => setFlow(f))
      .catch((e) => setError((e as Error).message));
  };

  useEffect(() => registerFlowRefetch(panelId, flowId, refetch), [panelId, flowId]);
  // `refetch` closes over workspaceName/flowId via params — stable for panel lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col bg-surface-0">
        <div className="p-5 text-red">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em]">Failed to load</div>
          <pre className="m-0 whitespace-pre-wrap rounded-xs border border-line-1 bg-surface-1 px-3 py-2.5 font-mono text-xs text-ink-1">{error}</pre>
        </div>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 text-xs text-ink-3">
        loading…
      </div>
    );
  }

  const node = flow.nodes[nodeId];
  if (!node) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 text-xs text-ink-3">
        node {nodeId} not found
      </div>
    );
  }

  const selectedNode = { nodeId, flowId, workspaceName };

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-surface-0">
      {node.kind === 'start' ? (
        <StartHeader selectedNode={selectedNode} node={node} onRefetch={refetch} />
      ) : (
        <NodeHeader selectedNode={selectedNode} flow={flow} node={node} onRefetch={refetch} />
      )}
      <div className="source-tab-editor min-h-0 flex-1 bg-surface-0">
        <CodeMirror
          value={node.source_code ?? ''}
          extensions={[python()]}
          editable={false}
          theme="dark"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: false,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab header — italic title when params.preview === true (VS Code pattern).
// ---------------------------------------------------------------------------

export function NodeEditorTabHeader({ api, params }: IDockviewPanelHeaderProps<NodeEditorPanelParams>) {
  const isPreview = params.preview === true;
  return (
    <div className="dv-default-tab">
      <div className="dv-default-tab-content">
        <PythonIcon size={12} />
        <span style={{ marginLeft: 5, fontStyle: isPreview ? 'italic' : 'normal' }}>{api.title}</span>
      </div>
      <div
        className="dv-default-tab-action"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => { e.preventDefault(); api.close(); }}
      >
        <svg width="11" height="11" viewBox="0 0 28 28" fill="currentColor">
          <path d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z" />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeHeader — full metadata block for python / flow nodes.
// ---------------------------------------------------------------------------

interface NodeHeaderProps {
  selectedNode: { nodeId: string; flowId: string; workspaceName: string };
  flow: FlowView;
  node: NodeView;
  onRefetch: () => void;
}

function NodeHeader({ selectedNode, flow, node, onRefetch }: NodeHeaderProps) {
  const { onFlowMutated } = useSelection();

  const [nameValue, setNameValue] = useState(node.name);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameCancelledRef = useRef(false);

  const [refValue, setRefValue] = useState(node.ref);
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  const [inputValue, setInputValue] = useState(node.input_type);
  const [inputBusy, setInputBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const [exitsBusy, setExitsBusy] = useState(false);
  const [showAddExit, setShowAddExit] = useState(false);

  useEffect(() => { setNameValue(node.name); setNameError(null); }, [node.name]);
  useEffect(() => { setRefValue(node.ref); setRefError(null); }, [node.ref]);
  useEffect(() => { setInputValue(node.input_type); setInputError(null); }, [node.input_type]);
  useEffect(() => { setShowAddExit(false); }, [selectedNode.nodeId]);

  async function commitName() {
    if (nameCancelledRef.current) { nameCancelledRef.current = false; return; }
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === node.name) { setNameValue(node.name); setNameError(null); return; }
    setNameBusy(true);
    setNameError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { new_name: trimmed });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : String(err));
      setNameValue(node.name);
    } finally {
      setNameBusy(false);
    }
  }

  async function commitRef() {
    const trimmed = refValue.trim();
    if (!trimmed || trimmed === node.ref) { setRefValue(node.ref); setRefError(null); return; }
    setRefBusy(true);
    setRefError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { ref: trimmed });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onRefetch();
    } catch (err) {
      setRefError(err instanceof Error ? err.message : String(err));
      setRefValue(node.ref);
    } finally {
      setRefBusy(false);
    }
  }

  async function commitInput() {
    const trimmed = inputValue.trim();
    if (!trimmed || trimmed === node.input_type) { setInputValue(node.input_type); setInputError(null); return; }
    setInputBusy(true);
    setInputError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { input: trimmed });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onRefetch();
    } catch (err) {
      setInputError(err instanceof Error ? err.message : String(err));
      setInputValue(node.input_type);
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
      onRefetch();
    } finally {
      setExitsBusy(false);
    }
  }

  async function handleChangeExitType(exitName: string, newType: string) {
    setExitsBusy(true);
    try {
      const updatedExits = { ...node.exits, [exitName]: newType };
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { exits: updatedExits });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onRefetch();
    } finally {
      setExitsBusy(false);
    }
  }

  async function handleRemoveExit(exitName: string) {
    setExitsBusy(true);
    try {
      const updatedExits = Object.fromEntries(
        Object.entries(node.exits).filter(([k]) => k !== exitName)
      );
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { exits: updatedExits });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onRefetch();
    } finally {
      setExitsBusy(false);
    }
  }

  async function handleAddExit(name: string, type: string) {
    setExitsBusy(true);
    try {
      const updatedExits = { ...node.exits, [name]: type };
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, { exits: updatedExits });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onRefetch();
      setShowAddExit(false);
    } finally {
      setExitsBusy(false);
    }
  }

  const exits = Object.entries(node.exits);
  const nodeDiags = (flow.diagnostics ?? []).filter((d) => d.node_id === selectedNode.nodeId);
  const pathDisplay = node.source_path
    ? node.source_path.replace(/^.*?\/examples\//, 'examples/')
    : `${selectedNode.workspaceName}/${selectedNode.flowId}`;

  return (
    <div className="flex shrink-0 flex-col border-b border-line-0 bg-surface-0">
      {/* Title row: kind pill + name */}
      <div className="flex items-center gap-1.5 border-b border-line-0 px-3.5 py-2">
        <span className="shrink-0 rounded-xs border border-line-1 bg-transparent px-[5px] py-px text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">{node.kind}</span>
        <span className="flex-1 min-w-0 overflow-hidden">
          <input
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
                setNameValue(node.name);
                setNameError(null);
                e.currentTarget.blur();
              }
            }}
            aria-label="Node name"
            spellCheck={false}
          />
        </span>
      </div>

      {/* PATH (display only) */}
      <div className="flex items-baseline gap-3 border-b border-line-0 px-3.5 py-1.5">
        <span className="w-16 shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">PATH</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">{pathDisplay}</span>
      </div>

      {/* REF */}
      <div className="flex items-baseline gap-3 border-b border-line-0 px-3.5 py-1.5">
        <span className="w-16 shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">REF</span>
        <div className="min-w-0 flex-1">
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
      </div>

      {/* INPUT type */}
      <div className="flex items-baseline gap-3 border-b border-line-0 px-3.5 py-1.5">
        <span className="w-16 shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">INPUT</span>
        <div className="min-w-0 flex-1">
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
      </div>

      {/* EXITS */}
      <div className="flex items-baseline gap-3 border-b border-line-0 px-3.5 py-1.5">
        <span className="w-16 shrink-0 pt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">EXITS</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {exits.map(([name, type]) => (
            <ExitPill
              key={name}
              exitName={name}
              exitType={type}
              nodeId={selectedNode.nodeId}
              busy={exitsBusy}
              flow={flow}
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

      {/* Diagnostics (inline list) */}
      {nodeDiags.length > 0 && (
        <div className="flex flex-col gap-1 bg-surface-1 px-3.5 py-1.5">
          {nodeDiags.map((d) => (
            <div key={d.id} className="flex items-start gap-1.5 font-mono text-xs text-ink-1">
              <span
                className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                  d.severity === 'error' ? 'bg-red'
                  : d.severity === 'warning' ? 'bg-amber-muted'
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// StartHeader — minimal variant for `kind === 'start'`. Only INPUT TYPE,
// which is the `out` exit type (also the flow's declared input type).
// ---------------------------------------------------------------------------

interface StartHeaderProps {
  selectedNode: { nodeId: string; flowId: string; workspaceName: string };
  node: NodeView;
  onRefetch: () => void;
}

function StartHeader({ selectedNode, node, onRefetch }: StartHeaderProps) {
  const { onFlowMutated } = useSelection();
  const currentType = node.exits?.['out'] ?? '';
  const [typeValue, setTypeValue] = useState(currentType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setTypeValue(currentType); setError(null); }, [currentType]);

  async function commit() {
    const next = typeValue.trim();
    if (!next || next === currentType) { setTypeValue(currentType); return; }
    setBusy(true);
    setError(null);
    try {
      await updateNode(selectedNode.workspaceName, selectedNode.flowId, selectedNode.nodeId, {
        exits: { out: next },
      });
      onFlowMutated(selectedNode.workspaceName, selectedNode.flowId);
      onRefetch();
    } catch (e) {
      setError((e as Error).message);
      setTypeValue(currentType);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col border-b border-line-0 bg-surface-0">
      <div className="flex items-center gap-1.5 border-b border-line-0 px-3.5 py-2">
        <span className="shrink-0 text-green text-sm leading-none">▶</span>
        <span className="font-mono text-sm font-medium text-ink-0">Start</span>
      </div>
      <div className="flex items-baseline gap-3 border-b border-line-0 px-3.5 py-1.5">
        <span className="w-16 shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-2">INPUT</span>
        <div className="min-w-0 flex-1">
          <EditField
            value={typeValue}
            original={currentType}
            busy={busy}
            error={error}
            ariaLabel="Start input type"
            onChange={(v) => { setTypeValue(v); setError(null); }}
            onCommit={commit}
            onRollback={() => { setTypeValue(currentType); setError(null); }}
          />
        </div>
      </div>
    </div>
  );
}
