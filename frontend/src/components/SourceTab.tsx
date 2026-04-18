import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { getFlow } from '../api';

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
      <div className="flex h-full w-full min-h-0 flex-col">
        <div className="p-5 text-red">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em]">Source load failed</div>
          <pre className="m-0 whitespace-pre-wrap rounded-xs border border-line-1 bg-surface-1 px-3 py-2.5 font-mono text-xs text-ink-1">{error}</pre>
        </div>
      </div>
    );
  }

  const filename = sourcePath ? (sourcePath.split('/').pop() ?? nodeId) : `${nodeId}.py`;

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2.5 border-b border-line-0 bg-surface-0 px-3.5 font-mono text-xs tracking-[-0.01em]">
        <span className="font-medium text-ink-0">{filename}</span>
        {sourcePath && <span className="text-[10px] text-ink-3">{sourcePath}</span>}
      </div>
      {source !== null ? (
        <div className="source-tab-editor min-h-0 flex-1 overflow-auto bg-surface-0">
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
        <div className="p-5 text-sm text-ink-2">loading…</div>
      )}
    </div>
  );
}
