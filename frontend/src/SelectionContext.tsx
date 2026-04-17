import { createContext, useContext } from 'react';

export interface SelectedNode {
  nodeId: string;
  flowId: string;
  workspaceName: string;
}

export interface SelectionContextValue {
  selectedNode: SelectedNode | null;
  onNodeSelect: (node: SelectedNode | null) => void;
  onFlowMutated: (workspaceName: string, flowId: string) => void;
}

export const SelectionContext = createContext<SelectionContextValue>({
  selectedNode: null,
  onNodeSelect: () => {},
  onFlowMutated: () => {},
});

export function useSelection(): SelectionContextValue {
  return useContext(SelectionContext);
}
