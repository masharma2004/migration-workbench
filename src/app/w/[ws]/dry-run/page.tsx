'use client';
import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DryRunCountsView } from '@/components/dry-run/counts';
import { QuarantineTable } from '@/components/dry-run/quarantine-table';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatTime, shortHash } from '@/lib/format';
import { useDryRun, useReadiness, useVersions, useWorkspaceInvalidate, type DryRunDto } from '@/lib/queries';

export default function DryRunPage() {
  const { ws } = useParams<{ ws: string }>();
  const search = useSearchParams();
  const versions = useVersions(ws);
  const [picked, setVersion] = useState<number | null>(search.get('version') ? Number(search.get('version')) : null);
  const version = picked ?? versions.data?.[0]?.version ?? null;
  const readiness = useReadiness(ws, version);
  const latest = readiness.data?.latestDryRun ?? null;
  const detail = useDryRun(ws, latest?.id ?? null);
  const invalidate = useWorkspaceInvalidate(ws);
  const run = useMutation({
    mutationFn: () => api<DryRunDto>(`/api/workspaces/${ws}/plans/${version}/dry-run`, { method: 'POST' }),
    onSuccess: (d) => { toast.success(`Dry run complete: ${d.counts.accepted} accepted, ${d.counts.rejected} rejected`); invalidate(); },
  });

  if (versions.isPending) return <LoadingState rows={6} />;
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />;
  if (!versions.data.length) return <EmptyState title="No plan to dry-run" description="Create a plan version first."
    action={<Link href={`/w/${ws}/plan`} className={buttonVariants({  })}>Go to plan</Link>} />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div><CardTitle className="text-base">Deterministic dry run</CardTitle>
            <CardDescription>Runs the engine over every source record without writing to the target. Same inputs always give the same report hash.</CardDescription></div>
          <div className="flex items-center gap-2">
            <select aria-label="Plan version" className="rounded-md border bg-background p-2 text-sm" value={version ?? ''} onChange={(e) => setVersion(Number(e.target.value))}>
              {versions.data.map((v) => <option key={v.version} value={v.version}>v{v.version} ({v.status})</option>)}
            </select>
            <Button onClick={() => run.mutate()} disabled={run.isPending || version === null}>{run.isPending ? 'Running…' : 'Run dry run'}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {run.isError && <ErrorState error={run.error} />}
          {readiness.isPending ? <LoadingState /> : readiness.isError ? <ErrorState error={readiness.error} onRetry={() => readiness.refetch()} /> : !latest ? (
            <EmptyState title={`No dry run for v${version} yet`} description="Run a dry run to see accepted and rejected counts and the quarantine." />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Report <span className="font-mono">{shortHash(latest.reportHash)}</span> · {formatTime(latest.createdAt)}
                {readiness.data.checks.find((c) => c.id === 'dry_run_current')?.passed === false && <span className="ml-2 text-destructive">stale — re-run</span>}</p>
              <DryRunCountsView counts={latest.counts} />
            </>
          )}
        </CardContent>
      </Card>
      {latest && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div><CardTitle className="text-base">Quarantine</CardTitle><CardDescription>Rejected records with field-level evidence. Click a row to see every error and the raw record.</CardDescription></div>
            <a href={`/api/workspaces/${ws}/dry-runs/${latest.id}/quarantine.csv`} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Download className="mr-1 size-3" />CSV</a>
          </CardHeader>
          <CardContent>{detail.isPending ? <LoadingState rows={8} /> : detail.isError ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : <QuarantineTable rows={detail.data.quarantine} />}</CardContent>
        </Card>
      )}
    </div>
  );
}
