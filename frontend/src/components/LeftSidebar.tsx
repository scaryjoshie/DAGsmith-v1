import { useMemo, useState, type ReactNode } from 'react';
import type { FlowView, WorkspaceView } from '../types';
import { DiagnosticsSection } from './DiagnosticsSection';

const CHEVRON_BASE =
  'inline-block w-2 text-[8px] transition-transform duration-[120ms] ease-[ease]';

interface LeftSidebarProps {
  workspaceName: string;
  workspace: WorkspaceView | null;
  allWorkspaces: WorkspaceView[];
  activeFlowView: FlowView | null;
  onWorkspaceChange: (name: string) => void;
  onOpenFlow: (flowId: string) => void;
  onRunClick: () => void;
  onAddNodeClick: () => void;
  onPanToNode: (nodeId: string) => void;
  onNodeSelect: (node: { nodeId: string; flowId: string; workspaceName: string }) => void;
  canRun: boolean;
  canAddNode: boolean;
}

export function LeftSidebar({
  workspaceName,
  workspace,
  allWorkspaces,
  activeFlowView,
  onWorkspaceChange,
  onOpenFlow,
  onRunClick,
  onAddNodeClick,
  onPanToNode,
  onNodeSelect,
  canRun,
  canAddNode,
}: LeftSidebarProps) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line-0 px-4 py-3.5">
        <span className="text-md font-semibold tracking-[-0.01em] text-ink-0">DAGsmith</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <Section title="Workspace" defaultOpen>
          <select
            className="w-full cursor-pointer appearance-none rounded-xs border border-line-1 bg-surface-1 px-2.5 py-1.5 font-mono text-sm text-ink-0 outline-none hover:border-line-2 focus-visible:border-[var(--fg-1)]"
            value={workspaceName}
            onChange={(e) => onWorkspaceChange(e.target.value)}
          >
            {!allWorkspaces.some((w) => w.name === workspaceName) && (
              <option value={workspaceName}>{workspaceName}</option>
            )}
            {allWorkspaces.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Flows" defaultOpen>
          {workspace ? (
            workspace.flow_ids.length > 0 ? (
              <FlowTree flowIds={workspace.flow_ids} onOpenFlow={onOpenFlow} />
            ) : (
              <div className="px-1 py-1.5 text-xs text-ink-3">no flows</div>
            )
          ) : (
            <div className="px-1 py-1.5 text-xs text-ink-3">loading…</div>
          )}
        </Section>

        <Section title="Types">
          <div className="px-1 py-1.5 text-xs text-ink-3">Types palette coming in M7</div>
        </Section>

        <Section title="Diagnostics">
          {activeFlowView ? (
            <DiagnosticsSection
              diagnostics={activeFlowView.diagnostics}
              onSelectNode={(nodeId) => {
                if (!activeFlowView) return;
                onNodeSelect({ nodeId, flowId: activeFlowView.id, workspaceName });
                onPanToNode(nodeId);
              }}
            />
          ) : (
            <div className="px-1 py-1.5 text-xs text-ink-3">open a flow to see diagnostics</div>
          )}
        </Section>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line-0 px-3 py-2.5">
        <button
          type="button"
          className="w-full cursor-pointer rounded-xs border border-ink-0 bg-ink-0 px-3 py-[7px] text-sm font-medium tracking-[-0.01em] text-surface-0 transition-opacity duration-100 ease-[ease] enabled:hover:opacity-85 disabled:cursor-not-allowed disabled:border-line-1 disabled:bg-line-1 disabled:text-ink-3"
          onClick={onRunClick}
          disabled={!canRun}
        >
          Run
        </button>
        <button
          type="button"
          className="w-full cursor-pointer rounded-xs border border-line-1 bg-transparent px-3 py-1.5 text-sm tracking-[-0.005em] text-ink-1 transition-[border-color,color] duration-100 ease-[ease] enabled:hover:border-line-2 enabled:hover:bg-surface-2 enabled:hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onAddNodeClick}
          disabled={!canAddNode}
        >
          + Add node
        </button>
      </div>
    </>
  );
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function Section({ title, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line-0 last:border-b-0">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-2 hover:text-ink-0"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`${CHEVRON_BASE} ${open ? 'rotate-90 text-ink-1' : 'text-ink-3'}`}>▸</span>
        <span>{title}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

interface FlowTreeNode {
  label: string;
  /** Full dotted flow id if this node corresponds to a flow; null for pure groups. */
  flowId: string | null;
  children: FlowTreeNode[];
}

function buildFlowTree(flowIds: string[]): FlowTreeNode[] {
  // Group by dotted-path prefix. Every segment becomes a group node; leaves
  // may coincide with internal paths (a flow with subflows of its own — we
  // render both the flow-as-leaf and any deeper flows under it).
  const root: FlowTreeNode[] = [];
  const byPath = new Map<string, FlowTreeNode>();

  function ensureGroup(path: string, label: string): FlowTreeNode {
    const existing = byPath.get(path);
    if (existing) return existing;
    const node: FlowTreeNode = { label, flowId: null, children: [] };
    byPath.set(path, node);
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) {
      root.push(node);
    } else {
      const parentPath = path.slice(0, lastDot);
      const parent = byPath.get(parentPath) ?? ensureGroup(parentPath, parentPath.slice(parentPath.lastIndexOf('.') + 1));
      parent.children.push(node);
    }
    return node;
  }

  for (const fid of flowIds) {
    const parts = fid.split('.');
    // Walk parents, ensuring a group exists at each prefix.
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.');
      ensureGroup(prefix, parts[i - 1]);
    }
    // The flow itself.
    const label = parts[parts.length - 1];
    const node = ensureGroup(fid, label);
    node.flowId = fid;
  }

  return root;
}

interface FlowTreeProps {
  flowIds: string[];
  onOpenFlow: (flowId: string) => void;
}

function FlowTree({ flowIds, onOpenFlow }: FlowTreeProps) {
  const tree = useMemo(() => buildFlowTree(flowIds), [flowIds]);
  return (
    <ul className="m-0 list-none p-0">
      {tree.map((node) => (
        <FlowTreeRow key={node.flowId ?? node.label} node={node} depth={0} onOpenFlow={onOpenFlow} />
      ))}
    </ul>
  );
}

interface FlowTreeRowProps {
  node: FlowTreeNode;
  depth: number;
  onOpenFlow: (flowId: string) => void;
}

function FlowTreeRow({ node, depth, onOpenFlow }: FlowTreeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  function handleClick(): void {
    if (node.flowId) {
      onOpenFlow(node.flowId);
    } else if (hasChildren) {
      setExpanded((v) => !v);
    }
  }

  return (
    <li>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-xs border-0 bg-transparent px-2 py-[5px] text-left font-mono text-sm text-ink-1 hover:bg-surface-2 hover:text-ink-0"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={handleClick}
        title={node.flowId ?? node.label}
      >
        {hasChildren ? (
          <span
            className={`${CHEVRON_BASE} ${expanded ? 'rotate-90 text-ink-1' : 'text-ink-3'}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            ▸
          </span>
        ) : (
          <span className={`${CHEVRON_BASE} invisible text-ink-3`} />
        )}
        <span className={node.flowId ? 'text-ink-1' : 'text-ink-2'}>
          {node.label}
        </span>
      </button>
      {hasChildren && expanded && (
        <ul className="m-0 list-none p-0">
          {node.children.map((child) => (
            <FlowTreeRow
              key={child.flowId ?? `${node.label}.${child.label}`}
              node={child}
              depth={depth + 1}
              onOpenFlow={onOpenFlow}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
