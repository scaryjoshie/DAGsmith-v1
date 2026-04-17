import type { DiagnosticView } from '../types';
import styles from './RunPreflightModal.module.css';

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
    <div className={styles.backdrop} onClick={onDismiss}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>
            {hasErrors ? 'Cannot run' : 'Run with warnings'}
          </span>
          <span className={styles.flowId}>{flowId}</span>
        </div>

        <div className={styles.body}>
          <p className={styles.lead}>
            {hasErrors
              ? 'Fix the following errors before running:'
              : 'This flow has warnings. You can still run it.'}
          </p>
          <ul className={styles.list}>
            {listed.map((d) => (
              <li key={d.id} className={styles.row}>
                <span
                  className={`${styles.dot} ${
                    d.severity === 'error' ? styles.dotError : styles.dotWarn
                  }`}
                />
                <span className={styles.msg}>{d.message}</span>
                {d.node_id && (
                  <button
                    type="button"
                    className={styles.editBtn}
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

        <div className={styles.footer}>
          {hasErrors ? (
            <button type="button" className={styles.btnSecondary} onClick={onDismiss}>
              Dismiss
            </button>
          ) : (
            <>
              <button type="button" className={styles.btnSecondary} onClick={onDismiss}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={onRunAnyway}>
                Run anyway
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
