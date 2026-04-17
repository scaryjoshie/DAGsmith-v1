import { DockviewReact, type DockviewReadyEvent } from 'dockview';
import type { Connection } from '@xyflow/react';
import type { FlowView, WorkspaceView } from '../types';
import styles from './DockviewCanvas.module.css';

export interface PanelContext {
  workspaceName: string;
  workspace: WorkspaceView | null;
  flow: FlowView | null;
  loadError: string | null;
  onConnect: (connection: Connection) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (fromNode: string, fromExit: string) => void;
  onNodePositionChange: (nodeId: string, x: number, y: number) => void;
  onOpenSource: (nodeId: string, split: boolean) => void;
}

interface DockviewCanvasProps {
  context: PanelContext;
}

const components = {
  stub: () => (
    <div style={{ padding: 16, color: 'var(--fg-0)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
      hello from dockview
    </div>
  ),
};

function onReady(event: DockviewReadyEvent): void {
  event.api.addPanel({ id: 'stub_1', component: 'stub', title: 'stub' });
}

export function DockviewCanvas(_props: DockviewCanvasProps) {
  return (
    <div className={`${styles.wrapper} dockview-theme-dark`}>
      <DockviewReact components={components} onReady={onReady} />
    </div>
  );
}
