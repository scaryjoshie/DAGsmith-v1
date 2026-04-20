import { createContext, useContext } from 'react';

export interface SelectedNode {
  nodeId: string;
  flowId: string;
  workspaceName: string;
}

export type OpenEditorMode = 'preview' | 'persistent-active' | 'persistent-nonactive';

export interface SelectionContextValue {
  selectedNode: SelectedNode | null;
  onNodeSelect: (node: SelectedNode | null) => void;
  onFlowMutated: (workspaceName: string, flowId: string) => void;
  onOpenNodeEditor: (target: SelectedNode, mode: OpenEditorMode) => void;
}

export const SelectionContext = createContext<SelectionContextValue>({
  selectedNode: null,
  onNodeSelect: () => {},
  onFlowMutated: () => {},
  onOpenNodeEditor: () => {},
});

export function useSelection(): SelectionContextValue {
  return useContext(SelectionContext);
}
