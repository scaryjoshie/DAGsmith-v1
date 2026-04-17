// Thin fetch wrapper around the DAGsmith backend.

import type {
  AddEdgePayload,
  AddNodePayload,
  FlowView,
  LayoutPositions,
  LayoutUpdateResponse,
  RunResponse,
  UpdateSourceResponse,
  WorkspaceList,
  WorkspaceView,
} from './types';

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'http://127.0.0.1:8001';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return (await res.json()) as T;
}

export function listWorkspaces(): Promise<WorkspaceList> {
  return request<WorkspaceList>('/api/workspaces');
}

export function getWorkspace(name: string): Promise<WorkspaceView> {
  return request<WorkspaceView>(`/api/workspaces/${encodeURIComponent(name)}`);
}

export function getFlow(workspace: string, flowId: string): Promise<FlowView> {
  return request<FlowView>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}`
  );
}

export function runFlow(
  workspace: string,
  flowId: string,
  value: unknown
): Promise<RunResponse> {
  return request<RunResponse>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }
  );
}

export function updateNodeSource(
  workspace: string,
  flowId: string,
  nodeName: string,
  source: string
): Promise<UpdateSourceResponse> {
  return request<UpdateSourceResponse>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeName)}/source`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }
  );
}

export function reloadWorkspace(workspace: string): Promise<WorkspaceView> {
  return request<WorkspaceView>(
    `/api/workspaces/${encodeURIComponent(workspace)}/reload`,
    { method: 'POST' }
  );
}

export function addNode(
  workspace: string,
  flowId: string,
  payload: AddNodePayload
): Promise<FlowView> {
  return request<FlowView>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/nodes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

export function deleteNode(
  workspace: string,
  flowId: string,
  nodeName: string
): Promise<FlowView> {
  return request<FlowView>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeName)}`,
    { method: 'DELETE' }
  );
}

export function renameNode(
  workspace: string,
  flowId: string,
  nodeName: string,
  newName: string
): Promise<FlowView> {
  return request<FlowView>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeName)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    }
  );
}

export function addEdge(
  workspace: string,
  flowId: string,
  payload: AddEdgePayload
): Promise<FlowView> {
  return request<FlowView>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/edges`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

export function deleteEdge(
  workspace: string,
  flowId: string,
  fromNode: string,
  fromExit: string
): Promise<FlowView> {
  return request<FlowView>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/edges`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_node: fromNode, from_exit: fromExit }),
    }
  );
}

export function updateLayout(
  workspace: string,
  flowId: string,
  positions: LayoutPositions
): Promise<LayoutUpdateResponse> {
  return request<LayoutUpdateResponse>(
    `/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flowId)}/layout`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: positions }),
    }
  );
}
