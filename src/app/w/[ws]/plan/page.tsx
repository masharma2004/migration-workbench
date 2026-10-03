'use client';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AgentPanel } from '@/components/plan/agent-panel';
import { AgentTrace } from '@/components/plan/agent-trace';
import { DiffDialog } from '@/components/plan/diff-dialog';
import { MappingTable } from '@/components/plan/mapping-table';
import { PlanEditor } from '@/components/plan/plan-editor';
import { QuestionsPanel, RisksPanel } from '@/components/plan/risks-questions';
import { VersionList } from '@/components/plan/version-list';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SOURCE_SCHEMA_VERSION } from '@/domain/schemas/source';
import { TARGET_FIELD_NAMES, TARGET_SCHEMA_VERSION } from '@/domain/schemas/target';
import { api } from '@/lib/api';
import { shortHash } from '@/lib/format';
import { useAgentRun, useVersions, useWorkspaceInvalidate, type PlanVersionDto } from '@/lib/queries';

export default function PlanPage() {
  const { ws } = useParams<{ ws: string }>();
  const router = useRouter();
  const versions = useVersions(ws);
  const invalidate = useWorkspaceInvalidate(ws);
  const [picked, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [evidenceStep, setEvidenceStep] = useState<number | null>(null);

  const selected = picked ?? versions.data?.[0]?.version ?? null;
  const version = versions.data?.find((v) => v.version === selected) ?? null;
  const versionRun = useAgentRun(ws, evidenceStep !== null ? version?.agentRunId ?? null : null);

  const manual = useMutation({
    mutationFn: () => api<PlanVersionDto>(`/api/workspaces/${ws}/plans`, { method: 'POST', body: { changeNote: 'Manual skeleton', content: {
      plan: { sourceSchemaVersion: SOURCE_SCHEMA_VERSION, targetSchemaVersion: TARGET_SCHEMA_VERSION,
        mappings: TARGET_FIELD_NAMES.map((f) => ({ targetField: f, sourceField: null, transforms: [] })), unmappedSourceFields: [] } } } }),
    onSuccess: (v) => { invalidate(); setSelected(v.version); setEditing(true); },
  });
  const dryRun = useMutation({
    mutationFn: (v: number) => api<{ id: string }>(`/api/workspaces/${ws}/plans/${v}/dry-run`, { method: 'POST' }),
    onSuccess: (_, v) => { toast.success(`Dry run of v${v} complete`); invalidate(); router.push(`/w/${ws}/dry-run?version=${v}`); },
  });

  return (
    <div className="space-y-6">
      <AgentPanel ws={ws} onVersionCreated={(v) => setSelected(v)} traceStep={null} onCloseTrace={() => {}} />
      {versions.isPending ? <LoadingState rows={6} /> : versions.isError ? <ErrorState error={versions.error} onRetry={() => versions.refetch()} /> :
        !versions.data.length ? (
          <EmptyState title="No plan versions yet" description="Ask the agent to propose a plan, or start a manual draft if the agent is unavailable."
            action={<Button variant="outline" onClick={() => manual.mutate()} disabled={manual.isPending}>Start a manual draft</Button>} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
            <aside className="space-y-2"><h2 className="text-sm font-medium">Versions</h2>
              <VersionList versions={versions.data} selected={selected} onSelect={setSelected} /></aside>
            {version && (
              <div className="min-w-0 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">Plan v{version.version}
                        <Badge variant="outline" className="font-mono">{shortHash(version.planHash)}</Badge></CardTitle>
                      <CardDescription>{version.author === 'agent' ? 'Drafted by the AI agent' : 'Edited by a human'}{version.changeNote ? ` — ${version.changeNote}` : ''}</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <DiffDialog ws={ws} versions={versions.data} defaultTo={version.version} />
                      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
                      <Button size="sm" disabled={version.issues.length > 0 || dryRun.isPending} onClick={() => dryRun.mutate(version.version)}
                        title={version.issues.length ? 'Fix validation issues first' : undefined}>{dryRun.isPending ? 'Running…' : 'Dry run this version'}</Button>
                      <Link href={`/w/${ws}/execute?version=${version.version}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Approve…</Link>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {version.content.summary && <p className="text-sm">{version.content.summary}</p>}
                    {dryRun.isError && <ErrorState error={dryRun.error} />}
                    <MappingTable content={version.content} issues={version.issues} />
                  </CardContent>
                </Card>
                <div className="grid gap-6 xl:grid-cols-2">
                  <Card><CardHeader><CardTitle className="text-base">Risks & incompatibilities</CardTitle></CardHeader>
                    <CardContent><RisksPanel version={version} onEvidence={setEvidenceStep} /></CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-base">Clarification questions</CardTitle>
                    <CardDescription>Blocking questions must be answered before approval.</CardDescription></CardHeader>
                    <CardContent><QuestionsPanel key={version.id} ws={ws} version={version} onSaved={setSelected} /></CardContent></Card>
                </div>
                {editing && <PlanEditor key={version.id} ws={ws} version={version} open={editing} onOpenChange={setEditing} onSaved={setSelected} />}
                <Sheet open={evidenceStep !== null} onOpenChange={(o) => !o && setEvidenceStep(null)}>
                  <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
                    <SheetHeader><SheetTitle>Evidence — step #{evidenceStep}</SheetTitle></SheetHeader>
                    <div className="p-4">{versionRun.data ? <AgentTrace run={versionRun.data} highlight={evidenceStep} /> : versionRun.isError ? <ErrorState error={versionRun.error} /> : <LoadingState />}</div>
                  </SheetContent>
                </Sheet>
              </div>
            )}
          </div>
        )}
      {manual.isError && <ErrorState error={manual.error} />}
    </div>
  );
}
