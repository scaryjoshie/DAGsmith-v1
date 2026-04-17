import { useEffect, useState } from 'react';
import { getFlow } from '../api';
import { RunPanel } from './RunPanel';
import styles from './FloatingRunPanel.module.css';

interface FloatingRunPanelProps {
  workspace: string;
  flowId: string;
  onClose: () => void;
}

export function FloatingRunPanel({
  workspace,
  flowId,
  onClose,
}: FloatingRunPanelProps) {
  const [inputType, setInputType] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    getFlow(workspace, flowId)
      .then((f) => { if (!cancelled) setInputType(f.input_type); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspace, flowId]);

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
