import { useState } from 'react';
import type { DiagnosticView } from '../types';

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

function severityDotColor(severity: DiagnosticView['severity']): string {
  if (severity === 'error') return 'bg-[#e05252]';
  if (severity === 'warning') return 'bg-[#d97706]';
  return 'bg-ink-3';
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
      className={`flex flex-1 min-w-0 cursor-pointer items-start gap-1.5 rounded-xs border-0 bg-transparent py-[5px] pr-1.5 ${indent ? 'pl-[18px]' : 'pl-1'} text-left font-mono text-xs leading-[1.4] text-ink-1 hover:bg-surface-2 hover:text-ink-0`}
      onClick={() => { if (diag.node_id) onSelectNode(diag.node_id); }}
      title={diag.message}
    >
      <span className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${severityDotColor(diag.severity)}`} />
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-inherit">{diag.message}</span>
      {diag.node_id && <span className="shrink-0 whitespace-nowrap pt-px text-[9px] text-ink-3">{diag.node_id}</span>}
    </button>
  );
}

export function DiagnosticsSection({ diagnostics, onSelectNode }: DiagnosticsSectionProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (diagnostics.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-ink-3">
        <span className="text-[11px] text-[#4caf50]">✓</span>
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
    <div className="flex flex-col gap-px">
      {groups.map(({ root, derived }) => (
        <div key={root.id} className="flex flex-col">
          <div className="flex items-stretch">
            <DiagRow diag={root} onSelectNode={onSelectNode} />
            {derived.length > 0 && (
              <button
                type="button"
                className="flex shrink-0 cursor-pointer items-center rounded-xs border-0 bg-transparent px-1 py-0 text-[8px] text-ink-3 hover:bg-surface-2 hover:text-ink-1"
                onClick={() => toggleExpand(root.id)}
                aria-label={expanded.has(root.id) ? 'Collapse derived' : `Show ${derived.length} derived`}
                title={expanded.has(root.id) ? 'Collapse' : `${derived.length} derived`}
              >
                <span className={`inline-block transition-transform duration-[120ms] ease-[ease] ${expanded.has(root.id) ? 'rotate-90' : ''}`}>▸</span>
              </button>
            )}
          </div>
          {derived.length > 0 && expanded.has(root.id) && (
            <div className="ml-2.5 border-l border-line-0">
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
