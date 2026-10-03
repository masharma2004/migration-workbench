'use client';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useReconciliations, useWorkspaceInvalidate, type ReconciliationDto } from '@/lib/queries';

export default function ReconcilePage() {
  const { ws } = useParams<{ ws: string }>();
  const list = useReconciliations(ws);
  const invalidate = useWorkspaceInvalidate(ws);
  const run = useMutation({
    mutationFn: () => api<ReconciliationDto>(`/api/workspaces/${ws}/reconciliations`, { method: 'POST' }),
    onSuccess: (r) => { (r.result === 'pass' ? toast.success : toast.error)(`Reconciliation ${r.result}`); invalidate(); },
  });
  const latest = list.data?.[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div><CardTitle className="text-base">Reconcile source vs target</CardTitle>
            <CardDescription>Recomputes the expected rows from the active plan version and compares counts, control totals and every row&apos;s content hash.</CardDescription></div>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Reconciling…' : 'Run reconciliation'}</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {run.isError && <ErrorState error={run.error} />}
          {list.isPending ? <LoadingState /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !latest ? (
            <EmptyState title="No reconciliation yet" description="Run one after executing (or after a rollback, to confirm the target is clean)." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={latest.result === 'pass' ? 'bg-[var(--accent-ok)] text-white' : ''} variant={latest.result === 'pass' ? 'default' : 'destructive'}>{latest.result.toUpperCase()}</Badge>
                <span className="text-sm text-muted-foreground">{latest.details.activeMigration ? `Active migration: v${latest.version}` : 'No active migration (target should hold no migrated rows)'} · {formatTime(latest.createdAt)}</span>
              </div>
              <ul className="divide-y rounded-md border text-sm">
                {latest.details.checks.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 p-2">
                    {c.passed ? <CheckCircle2 className="size-4 text-[var(--accent-ok)]" aria-label="passed" /> : <XCircle className="size-4 text-destructive" aria-label="failed" />}
                    <span className="font-medium">{c.label}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">expected {String(c.expected)} · actual {String(c.actual)}</span>
                    {c.detail && <span className="w-full pl-6 text-xs text-muted-foreground">{c.detail}</span>}
                  </li>
                ))}
              </ul>
              {[['Missing in target', latest.details.missing], ['Unexpected in target', latest.details.unexpected],
                ['Content mismatch', latest.details.mismatched.map((m) => m.legacyId)]].filter(([, xs]) => (xs as string[]).length).map(([label, xs]) => (
                <details key={label as string} className="text-sm"><summary className="cursor-pointer">{label as string} ({(xs as string[]).length})</summary>
                  <p className="mt-1 break-words font-mono text-xs">{(xs as string[]).slice(0, 200).join(', ')}</p></details>))}
            </>
          )}
        </CardContent>
      </Card>
      {list.data && list.data.length > 1 && (
        <Card><CardHeader><CardTitle className="text-base">Previous reconciliations</CardTitle></CardHeader>
          <CardContent><ul className="space-y-1 text-sm">{list.data.slice(1).map((r) => (
            <li key={r.id} className="flex gap-2"><Badge variant={r.result === 'pass' ? 'outline' : 'destructive'}>{r.result}</Badge>
              <span className="text-muted-foreground">{r.version ? `v${r.version}` : 'no active migration'} · {formatTime(r.createdAt)}</span></li>))}</ul></CardContent></Card>
      )}
    </div>
  );
}
