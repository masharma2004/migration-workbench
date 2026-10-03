'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FieldError } from '@/domain/types';
import type { AgentRunDto } from '@/server/services/agent-runs';
import type { ApprovalDto, ReadinessCheck } from '@/server/services/approvals';
import type { AuditEventDto } from '@/server/services/audit';
import type { DryRunDto } from '@/server/services/dry-runs';
import type { MigrationRunDto } from '@/server/services/executions';
import type { PlanVersionDto } from '@/server/services/plans';
import type { ReconciliationDto } from '@/server/services/reconciliations';
import type { WorkspaceOverview } from '@/server/services/workspaces';
import { api } from './api';

export type { AgentRunDto, ApprovalDto, AuditEventDto, DryRunDto, MigrationRunDto, PlanVersionDto, ReadinessCheck, ReconciliationDto, WorkspaceOverview };
export type QuarantineRow = { seq: number; legacyKey: string | null; stage: string; raw: Record<string, unknown>; errors: FieldError[] };
export type Readiness = { version: number; ready: boolean; checks: ReadinessCheck[]; latestDryRun: DryRunDto | null };
export type Paged<T> = { total: number; page: number; pageSize: number; rows: T[] };
export type RuleInfo = { name: string; description: string; params: Record<string, unknown> };

const base = (ws: string) => `/api/workspaces/${ws}`;

export const useOverview = (ws: string) => useQuery({ queryKey: ['ws', ws, 'overview'], queryFn: () => api<WorkspaceOverview>(base(ws)) });
export const useVersions = (ws: string) => useQuery({ queryKey: ['ws', ws, 'versions'], queryFn: () => api<PlanVersionDto[]>(`${base(ws)}/plans`) });
export const useAgentRuns = (ws: string) => useQuery({ queryKey: ['ws', ws, 'agent-runs'],
  queryFn: () => api<Omit<AgentRunDto, 'steps'>[]>(`${base(ws)}/agent-runs`),
  refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued' || r.status === 'running') ? 2000 : false) });
export const useAgentRun = (ws: string, runId: string | null) => useQuery({ queryKey: ['ws', ws, 'agent-run', runId],
  queryFn: () => api<AgentRunDto>(`${base(ws)}/agent-runs/${runId}`), enabled: !!runId,
  refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 1500 : false) });
export const useReadiness = (ws: string, version: number | null) => useQuery({ queryKey: ['ws', ws, 'readiness', version],
  queryFn: () => api<Readiness>(`${base(ws)}/plans/${version}/readiness`), enabled: version !== null });
export const useDryRun = (ws: string, id: string | null) => useQuery({ queryKey: ['ws', ws, 'dry-run', id],
  queryFn: () => api<DryRunDto & { quarantine: QuarantineRow[] }>(`${base(ws)}/dry-runs/${id}`), enabled: !!id });
export const useRuns = (ws: string) => useQuery({ queryKey: ['ws', ws, 'runs'], queryFn: () => api<MigrationRunDto[]>(`${base(ws)}/executions`) });
export const useTargetRows = (ws: string, page: number) => useQuery({ queryKey: ['ws', ws, 'target', page],
  queryFn: () => api<Paged<Record<string, unknown>>>(`${base(ws)}/target-rows?page=${page}&pageSize=25`) });
export const useSourceRecords = (ws: string, page: number) => useQuery({ queryKey: ['ws', ws, 'source', page],
  queryFn: () => api<Paged<{ seq: number; raw: Record<string, string> }>>(`${base(ws)}/source-records?page=${page}&pageSize=25`) });
export const useReconciliations = (ws: string) => useQuery({ queryKey: ['ws', ws, 'reconciliations'],
  queryFn: () => api<ReconciliationDto[]>(`${base(ws)}/reconciliations`) });
export const useHistory = (ws: string, type: string) => useQuery({ queryKey: ['ws', ws, 'history', type],
  queryFn: () => api<AuditEventDto[]>(`${base(ws)}/history${type ? `?type=${encodeURIComponent(type)}` : ''}`) });
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: () => api<RuleInfo[]>('/api/rules'), staleTime: Infinity });

export function useWorkspaceInvalidate(ws: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['ws', ws] });
}
