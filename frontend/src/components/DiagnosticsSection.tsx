import { useState } from 'react';
import type { DiagnosticView } from '../types';
import styles from './DiagnosticsSection.module.css';

interface DiagnosticsSectionProps {
  diagnostics: DiagnosticView[];
  onSelectNode: (nodeId: string) => void;
}

interface DiagGroup {
  root: DiagnosticView;
  derived: DiagnosticView[];
}

function buildGroups(diagnostics: DiagnosticView[]): DiagGroup[] {
  const byId = new Map<string, DiagnosticView>();
  for (const d of diagnostics) byId.set(d.id, d);

  const groups: DiagGroup[] = [];
  const grouped = new Set<string>();

  for (const d of diagnostics) {
    if (grouped.has(d.id)) continue;
    if (d.derived_from && byId.has(d.derived_from)) continue; // will be nested under root

    const derived = diagnostics.filter(
      (x) => x.derived_from === d.id && !grouped.has(x.id)
    );
    derived.forEach((x) => grouped.add(x.id));
    grouped.add(d.id);
    groups.push({ root: d, derived });
  }

  return groups;
}

function severityDot(severity: DiagnosticView['severity']): string {
  if (severity === 'error') return styles.dotError;
  if (severity === 'warning') return styles.dotWarn;
  return styles.dotInfo;
}

interface DiagRowProps {
  diag: DiagnosticView;
  indent?: boolean;
  onSelectNode: (nodeId: string) => void;
}

function DiagRow({ diag, indent, onSelectNode }: DiagRowProps) {
  return (
    <button
      type="button"
      className={`${styles.diagRow} ${indent ? styles.diagRowIndent : ''}`}
      onClick={() => { if (diag.node_id) onSelectNode(diag.node_id); }}
      title={diag.message}
    >
      <span className={`${styles.dot} ${severityDot(diag.severity)}`} />
      <span className={styles.diagMsg}>{diag.message}</span>
      {diag.node_id && <span className={styles.diagNode}>{diag.node_id}</span>}
    </button>
  );
}

export function DiagnosticsSection({ diagnostics, onSelectNode }: DiagnosticsSectionProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (diagnostics.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyCheck}>✓</span>
        <span>No issues</span>
      </div>
    );
  }

  const groups = buildGroups(diagnostics);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.list}>
      {groups.map(({ root, derived }) => (
        <div key={root.id} className={styles.group}>
          <div className={styles.groupRoot}>
            <DiagRow diag={root} onSelectNode={onSelectNode} />
            {derived.length > 0 && (
              <button
                type="button"
                className={styles.expandBtn}
                onClick={() => toggleExpand(root.id)}
                aria-label={expanded.has(root.id) ? 'Collapse derived' : `Show ${derived.length} derived`}
                title={expanded.has(root.id) ? 'Collapse' : `${derived.length} derived`}
              >
                <span className={expanded.has(root.id) ? styles.chevronOpen : styles.chevron}>▸</span>
              </button>
            )}
          </div>
          {derived.length > 0 && expanded.has(root.id) && (
            <div className={styles.derived}>
              {derived.map((d) => (
                <DiagRow key={d.id} diag={d} indent onSelectNode={onSelectNode} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
