import { RunPanel } from './RunPanel';
import styles from './FloatingRunPanel.module.css';

interface FloatingRunPanelProps {
  workspace: string;
  flowId: string;
  inputType: string;
  onClose: () => void;
}

export function FloatingRunPanel({
  workspace,
  flowId,
  inputType,
  onClose,
}: FloatingRunPanelProps) {
  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <span className={styles.title}>Run</span>
        <span className={styles.flowId}>{flowId}</span>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close run panel"
        >
          ×
        </button>
      </div>
      <div className={styles.body}>
        <RunPanel
          workspace={workspace}
          flowId={flowId}
          inputType={inputType}
        />
      </div>
    </div>
  );
}
