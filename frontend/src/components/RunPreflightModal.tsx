import type { DiagnosticView } from '../types';

interface RunPreflightModalProps {
  flowId: string;
  diagnostics: DiagnosticView[];
  onRunAnyway: () => void;
  onDismiss: () => void;
  onSelectNode: (nodeId: string) => void;
}

export function RunPreflightModal({
  flowId,
  diagnostics,
  onRunAnyway,
  onDismiss,
  onSelectNode,
}: RunPreflightModalProps) {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const hasErrors = errors.length > 0;
  const listed = hasErrors ? errors : warnings;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(0,0,0,0.45)]"
      onClick={onDismiss}
    >
      <div
        className="flex w-[400px] max-w-[calc(100vw-32px)] flex-col rounded-sm border border-line-2 bg-surface-2 shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line-0 px-4 py-3">
          <span className="text-sm font-semibold text-ink-0">
            {hasErrors ? 'Cannot run' : 'Run with warnings'}
          </span>
          <span className="font-mono text-xs text-ink-3">{flowId}</span>
        </div>

        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="m-0 text-xs text-ink-2">
            {hasErrors
              ? 'Fix the following errors before running:'
              : 'This flow has warnings. You can still run it.'}
          </p>
          <ul className="m-0 flex max-h-[220px] list-none flex-col gap-1 overflow-y-auto p-0">
            {listed.map((d) => (
              <li
                key={d.id}
                className="flex items-start gap-1.5 rounded-xs border border-line-0 bg-surface-1 px-2 py-1"
              >
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    d.severity === 'error' ? 'bg-[#e05252]' : 'bg-[#d97706]'
                  }`}
                />
                <span className="flex-1 font-mono text-xs leading-[1.5] text-ink-1 [word-break:break-word]">{d.message}</span>
                {d.node_id && (
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded-xs border border-line-1 bg-transparent px-1.5 py-px font-[inherit] text-[9px] text-ink-2 transition-[border-color,color] duration-100 ease-[ease] hover:border-line-2 hover:text-ink-0"
                    onClick={() => {
                      onSelectNode(d.node_id!);
                      onDismiss();
                    }}
                  >
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-end gap-1.5 border-t border-line-0 px-4 py-2.5">
          {hasErrors ? (
            <button
              type="button"
              className="cursor-pointer rounded-xs border border-line-1 bg-transparent px-3 py-[5px] font-[inherit] text-xs text-ink-1 transition-[border-color,color] duration-100 ease-[ease] hover:border-line-2 hover:text-ink-0"
              onClick={onDismiss}
            >
              Dismiss
            </button>
          ) : (
            <>
              <button
                type="button"
                className="cursor-pointer rounded-xs border border-line-1 bg-transparent px-3 py-[5px] font-[inherit] text-xs text-ink-1 transition-[border-color,color] duration-100 ease-[ease] hover:border-line-2 hover:text-ink-0"
                onClick={onDismiss}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-xs border border-ink-0 bg-ink-0 px-3 py-[5px] font-[inherit] text-xs font-medium text-surface-0 transition-opacity duration-100 ease-[ease] hover:opacity-85"
                onClick={onRunAnyway}
              >
                Run anyway
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
