// Thin fetch wrapper around the DAGsmith backend.

import type { FlowView, RunResponse, WorkspaceList, WorkspaceView } from './types';

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
