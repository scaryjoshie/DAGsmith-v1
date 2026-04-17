import { useCallback, useEffect, useRef } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from 'dockview';
import { FlowPanel } from '../panels/FlowPanel';
import type { WorkspaceView } from '../types';
import styles from './DockviewCanvas.module.css';

interface DockviewCanvasProps {
  workspaceName: string;
  workspace: WorkspaceView | null;
  onApiReady?: (api: DockviewApi) => void;
}

const components = {
  flow: FlowPanel,
};

export function DockviewCanvas({ workspaceName, workspace, onApiReady }: DockviewCanvasProps) {
  const apiRef = useRef<DockviewApi | null>(null);
  const workspaceNameRef = useRef(workspaceName);
  workspaceNameRef.current = workspaceName;

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    onApiReady?.(event.api);
  }, [onApiReady]);

  // When workspace loads, auto-open the first flow if no panels are open.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !workspace || workspace.flow_ids.length === 0) return;
    if (api.panels.length > 0) return;
    const firstId = workspace.flow_ids[0];
    api.addPanel({
      id: firstId,
      component: 'flow',
      title: firstId.split('.').pop() ?? firstId,
      params: { workspaceName: workspaceNameRef.current, flowId: firstId },
    });
  }, [workspace]);

  return (
    <div className={`${styles.wrapper} dagsmith-theme`}>
      <DockviewReact components={components} onReady={onReady} />
    </div>
  );
}

export function openFlowPanel(api: DockviewApi, workspaceName: string, flowId: string): void {
  const existing = api.panels.find((p) => p.id === flowId);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel({
    id: flowId,
    component: 'flow',
    title: flowId.split('.').pop() ?? flowId,
    params: { workspaceName, flowId },
  });
}
