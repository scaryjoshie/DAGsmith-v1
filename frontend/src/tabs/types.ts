export type TabKind = 'flow' | 'source';

interface TabBase {
  id: string;
  title: string;
}

export interface FlowTab extends TabBase {
  kind: 'flow';
  flow_id: string;
}

export interface SourceTab extends TabBase {
  kind: 'source';
  flow_id: string;
  node_id: string;
  source_path?: string;
}

export type Tab = FlowTab | SourceTab;

export type OpenTabInput =
  | { kind: 'flow'; flow_id: string; title?: string }
  | {
      kind: 'source';
      flow_id: string;
      node_id: string;
      source_path?: string;
      title?: string;
    };

export type SplitDirection = 'row' | 'column';

export type SplitTarget = 'right' | 'down';

export interface LeafPane {
  kind: 'leaf';
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
}

export interface SplitPane {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  first: Pane;
  second: Pane;
  sizes: [number, number];
}

export type Pane = LeafPane | SplitPane;

export interface TabsState {
  root: Pane;
  activePaneId: string;
}

export interface OpenTabOptions {
  split?: SplitTarget | null;
  activate?: boolean;
}
