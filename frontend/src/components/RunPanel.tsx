import { useState } from 'react';
import { runFlow } from '../api';
import type { RunResponse } from '../types';
import { shortName } from '../lib/typeRefs';

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
    <div className="flex flex-col gap-3 bg-surface-0 px-4 py-3.5 text-sm text-ink-0">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-md font-medium tracking-[-0.01em] text-ink-0">Run</h3>
        <span className="font-mono text-xs text-ink-2">{flowId}</span>
      </header>

      <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-ink-2">
        Input
        <span className="font-mono text-[10px] normal-case tracking-normal text-ink-1">{shortName(inputType)}</span>
      </label>
      <textarea
        className="resize-y rounded-xs border border-line-1 bg-surface-1 px-2.5 py-2 font-mono text-xs text-ink-0 outline-none focus-visible:border-[var(--fg-1)]"
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        spellCheck={false}
        rows={6}
      />

      <button
        className="cursor-pointer self-start rounded-xs border border-ink-0 bg-ink-0 px-3.5 py-[7px] text-center text-sm font-medium tracking-[-0.01em] text-surface-0 transition-opacity duration-100 ease-[ease] hover:opacity-85 disabled:cursor-default disabled:border-line-1 disabled:bg-line-1 disabled:text-ink-3 disabled:opacity-100"
        onClick={handleRun}
        disabled={isRunning}
        type="button"
      >
        {isRunning ? 'running…' : 'Run flow'}
      </button>

      {error && (
        <div className="flex flex-col gap-1.5 rounded-xs border border-red bg-transparent px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-2">Error</div>
          <pre className="m-0 whitespace-pre-wrap [word-break:break-word] font-mono text-xs text-ink-0">{error}</pre>
        </div>
      )}

      {result && !error && (
        <div className="flex flex-col gap-1.5 rounded-xs border border-line-1 bg-surface-1 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-2">
            Exited via <span className="font-mono normal-case tracking-normal text-ink-0">{result.exit}</span>
          </div>
          <pre className="m-0 whitespace-pre-wrap [word-break:break-word] font-mono text-xs text-ink-0">{JSON.stringify(result.value, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
