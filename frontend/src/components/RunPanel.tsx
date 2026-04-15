import { useState } from 'react';
import { runFlow } from '../api';
import type { RunResponse } from '../types';
import styles from './RunPanel.module.css';

interface RunPanelProps {
  workspace: string;
  flowId: string;
  inputType: string;
}

const DEFAULT_INPUT = '{\n  "name": "Alice"\n}';

export function RunPanel({ workspace, flowId, inputType }: RunPanelProps) {
  const [inputText, setInputText] = useState(DEFAULT_INPUT);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function handleRun() {
    setError(null);
    setIsRunning(true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputText);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      setIsRunning(false);
      return;
    }
    try {
      const res = await runFlow(workspace, flowId, parsed);
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>Run</h3>
        <span className={styles.flowId}>{flowId}</span>
      </header>

      <label className={styles.label}>
        Input
        <span className={styles.typeHint}>{shortName(inputType)}</span>
      </label>
      <textarea
        className={styles.textarea}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        spellCheck={false}
        rows={6}
      />

      <button
        className={styles.runButton}
        onClick={handleRun}
        disabled={isRunning}
        type="button"
      >
        {isRunning ? 'running…' : 'Run flow'}
      </button>

      {error && (
        <div className={styles.error}>
          <div className={styles.resultLabel}>Error</div>
          <pre className={styles.resultBody}>{error}</pre>
        </div>
      )}

      {result && !error && (
        <div className={styles.result}>
          <div className={styles.resultLabel}>
            Exited via <span className={styles.exit}>{result.exit}</span>
          </div>
          <pre className={styles.resultBody}>{JSON.stringify(result.value, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function shortName(typeRef: string): string {
  const parts = typeRef.split('.');
  return parts[parts.length - 1] ?? typeRef;
}
