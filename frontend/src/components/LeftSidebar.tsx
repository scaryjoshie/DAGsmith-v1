import { useMemo, useState, type ReactNode } from 'react';
import { useTabs } from '../tabs/TabsProvider';
import type { WorkspaceView } from '../types';
import styles from './LeftSidebar.module.css';

interface LeftSidebarProps {
  workspaceName: string;
  workspace: WorkspaceView | null;
  allWorkspaces: WorkspaceView[];
  onWorkspaceChange: (name: string) => void;
  onRunClick: () => void;
  onAddNodeClick: () => void;
  canRun: boolean;
  canAddNode: boolean;
}

export function LeftSidebar({
  workspaceName,
  workspace,
  allWorkspaces,
  onWorkspaceChange,
  onRunClick,
  onAddNodeClick,
  canRun,
  canAddNode,
}: LeftSidebarProps) {
  return (
    <>
      <div className={styles.header}>
        <span className={styles.brand}>DAGsmith</span>
      </div>

      <div className={styles.body}>
        <Section title="Workspace" defaultOpen>
          <select
            className={styles.select}
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
              <FlowTree flowIds={workspace.flow_ids} />
            ) : (
              <div className={styles.muted}>no flows</div>
            )
          ) : (
            <div className={styles.muted}>loading…</div>
          )}
        </Section>

        <Section title="Types">
          <div className={styles.placeholder}>Types palette coming in M7</div>
        </Section>

        <Section title="Diagnostics">
          <div className={styles.placeholder}>Diagnostics coming in M6</div>
        </Section>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.runButton}
          onClick={onRunClick}
          disabled={!canRun}
        >
          Run
        </button>
        <button
          type="button"
          className={styles.addNodeButton}
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
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={open ? styles.chevronOpen : styles.chevron}>▸</span>
        <span>{title}</span>
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
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
}

function FlowTree({ flowIds }: FlowTreeProps) {
  const tree = useMemo(() => buildFlowTree(flowIds), [flowIds]);
  return (
    <ul className={styles.tree}>
      {tree.map((node) => (
        <FlowTreeRow key={node.flowId ?? node.label} node={node} depth={0} />
      ))}
    </ul>
  );
}

interface FlowTreeRowProps {
  node: FlowTreeNode;
  depth: number;
}

function FlowTreeRow({ node, depth }: FlowTreeRowProps) {
  const { openTab, state } = useTabs();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isActive =
    node.flowId !== null && isActiveFlowTab(state, node.flowId);
  const isOpenTab =
    node.flowId !== null && hasTabForFlow(state.root, node.flowId);

  function handleClick(): void {
    if (node.flowId) {
      openTab({ kind: 'flow', flow_id: node.flowId, title: node.label });
    } else if (hasChildren) {
      setExpanded((v) => !v);
    }
  }

  const rowClass = isActive
    ? `${styles.row} ${styles.rowActive}`
    : isOpenTab
      ? `${styles.row} ${styles.rowOpen}`
      : styles.row;

  return (
    <li>
      <button
        type="button"
        className={rowClass}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={handleClick}
        title={node.flowId ?? node.label}
      >
        {hasChildren ? (
          <span
            className={expanded ? styles.chevronOpen : styles.chevron}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            ▸
          </span>
        ) : (
          <span className={styles.chevronLeaf} />
        )}
        <span className={node.flowId ? styles.rowFlow : styles.rowGroup}>
          {node.label}
        </span>
      </button>
      {hasChildren && expanded && (
        <ul className={styles.tree}>
          {node.children.map((child) => (
            <FlowTreeRow
              key={child.flowId ?? `${node.label}.${child.label}`}
              node={child}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function hasTabForFlow(pane: import('../tabs/types').Pane, flowId: string): boolean {
  if (pane.kind === 'leaf') {
    return pane.tabs.some((t) => t.kind === 'flow' && t.flow_id === flowId);
  }
  return hasTabForFlow(pane.first, flowId) || hasTabForFlow(pane.second, flowId);
}

function isActiveFlowTab(
  state: import('../tabs/types').TabsState,
  flowId: string
): boolean {
  const findLeaf = (p: import('../tabs/types').Pane): import('../tabs/types').LeafPane | null => {
    if (p.id === state.activePaneId && p.kind === 'leaf') return p;
    if (p.kind === 'split') return findLeaf(p.first) ?? findLeaf(p.second);
    return null;
  };
  const pane = findLeaf(state.root);
  if (!pane) return false;
  const active = pane.tabs.find((t) => t.id === pane.activeTabId);
  return !!active && active.kind === 'flow' && active.flow_id === flowId;
}
