import type { IDockviewPanelProps } from 'dockview';
import { SourceTab } from '../components/SourceTab';

export interface SourcePanelParams {
  workspaceName: string;
  flowId: string;
  nodeId: string;
}

export function SourcePanel({ params }: IDockviewPanelProps<SourcePanelParams>) {
  return (
    <SourceTab
      workspace={params.workspaceName}
      flowId={params.flowId}
      nodeId={params.nodeId}
    />
  );
}
