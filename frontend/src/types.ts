// API response types mirroring the dagsmith.server Pydantic models.

export interface WorkspaceView {
  name: string;
  flow_ids: string[];
}

export interface WorkspaceList {
  workspaces: WorkspaceView[];
}

export interface NodeView {
  name: string;
  kind: string;
  ref: string;
  selector_ref: string | null;
  input_type: string;
  exits: Record<string, string>;
  label: string;
  description: string;
  source_code: string | null;
  source_path: string | null;
}

export interface EdgeView {
  from_node: string;
  from_exit: string;
  to_node: string | null;
  to_flow_exit: string | null;
}

export interface FlowView {
  id: string;
  input_type: string;
  entry_node: string;
  description: string;
  nodes: Record<string, NodeView>;
  edges: EdgeView[];
  public_exits: Record<string, string>;
}

export interface RunResponse {
  exit: string;
  value: unknown;
}

export interface UpdateSourceResponse {
  ok: boolean;
  path: string;
}
