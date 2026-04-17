import { createContext, useContext } from 'react';

export interface SelectedNode {
  nodeId: string;
  flowId: string;
  workspaceName: string;
}

export interface SelectionContextValue {
  selectedNode: SelectedNode | null;
  onNodeSelect: (node: SelectedNode | null) => void;
}

export const SelectionContext = createContext<SelectionContextValue>({
  selectedNode: null,
  onNodeSelect: () => {},
});

export function useSelection(): SelectionContextValue {
  return useContext(SelectionContext);
}
