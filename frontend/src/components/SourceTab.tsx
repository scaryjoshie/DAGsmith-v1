import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { getFlow } from '../api';
import styles from './SourceTab.module.css';

interface SourceTabProps {
  workspace: string;
  flowId: string;
  nodeId: string;
}

export function SourceTab({ workspace, flowId, nodeId }: SourceTabProps) {
  const [source, setSource] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setSourcePath(null);
    setError(null);
    getFlow(workspace, flowId)
      .then((f) => {
        if (cancelled) return;
        const node = f.nodes[nodeId];
        setSource(node?.source_code ?? '');
        setSourcePath(node?.source_path ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, flowId, nodeId]);

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.error}>
          <div className={styles.errorLabel}>Source load failed</div>
          <pre className={styles.errorBody}>{error}</pre>
        </div>
      </div>
    );
  }

  const filename = sourcePath ? (sourcePath.split('/').pop() ?? nodeId) : `${nodeId}.py`;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.filename}>{filename}</span>
        {sourcePath && <span className={styles.path}>{sourcePath}</span>}
      </div>
      {source !== null ? (
        <div className={styles.editor}>
          <CodeMirror
            value={source}
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
      ) : (
        <div className={styles.placeholder}>loading…</div>
      )}
    </div>
  );
}
