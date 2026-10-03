'use client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useRuns, useWorkspaceInvalidate, type MigrationRunDto } from '@/lib/queries';

export function ExecutionCard({ ws, approvedVersion }: { ws: string; approvedVersion: number | null }) {
  const runs = useRuns(ws);
  const invalidate = useWorkspaceInvalidate(ws);
  const [simulate, setSimulate] = useState(false);
  const [failAfter, setFailAfter] = useState(2);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const active = (runs.data ?? []).filter((r) => r.status !== 'rolled_back');
  const activeVersion = active[0]?.version ?? null;
  const willRetry = active.length > 0 && activeVersion === approvedVersion;
  const migratedRows = active.reduce((s, r) => s + r.counts.inserted, 0);

  const execute = useMutation({
    mutationFn: () => api<MigrationRunDto>(`/api/workspaces/${ws}/executions`, { method: 'POST', body: { failAfterBatches: simulate ? failAfter : null } }),
    onSuccess: (r) => {
      if (r.status === 'succeeded') toast.success(`${r.kind === 'retry' ? 'Retry' : 'Run'} succeeded: ${r.counts.inserted} inserted, ${r.counts.alreadyPresent} already present`);
      else toast.warning(`Run ${r.status}: ${r.error ?? ''} (${r.counts.inserted} rows committed)`);
      invalidate();
    },
  });
  const rollback = useMutation({
    mutationFn: () => api<{ rowsDeleted: number }>(`/api/workspaces/${ws}/rollback`, { method: 'POST' }),
    onSuccess: (r) => { toast.success(`Rolled back: ${r.rowsDeleted} rows removed`); setConfirmRollback(false); invalidate(); },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">2 · Execute into the mock target</CardTitle>
        <CardDescription>Insert-only, 50 rows per transaction. Retrying the same approved version never inserts duplicates.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {approvedVersion === null ? <EmptyState title="Nothing approved yet" description="Approve a plan version above to enable execution." /> : (
          <div className="flex flex-wrap items-end gap-4">
            <div className="text-sm">Approved: <span className="font-medium">v{approvedVersion}</span>
              {activeVersion !== null && activeVersion !== approvedVersion && <p className="text-destructive">Target holds rows from v{activeVersion}; roll back before executing v{approvedVersion}.</p>}</div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
              Simulate a failure after
              <Input type="number" min={0} max={20} className="h-8 w-16" value={failAfter} disabled={!simulate}
                onChange={(e) => setFailAfter(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} aria-label="Batches before failure" />
              batches
            </label>
            <Button onClick={() => execute.mutate()} disabled={execute.isPending}>{execute.isPending ? 'Executing…' : willRetry ? 'Retry / resume' : 'Execute'}</Button>
            <Button variant="destructive" disabled={!active.length || rollback.isPending} onClick={() => setConfirmRollback(true)}>Roll back</Button>
          </div>
        )}
        {execute.isError && <ErrorState error={execute.error} />}
        {runs.isPending ? <LoadingState /> : runs.isError ? <ErrorState error={runs.error} onRetry={() => runs.refetch()} /> : !runs.data.length ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-muted-foreground"><tr><th className="p-2">Attempt</th><th className="p-2">Kind</th><th className="p-2">Version</th><th className="p-2">Status</th>
                <th className="p-2 text-right">Planned</th><th className="p-2 text-right">Inserted</th><th className="p-2 text-right">Already present</th><th className="p-2 text-right">Conflicts</th><th className="p-2">Started</th></tr></thead>
              <tbody>{runs.data.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">#{r.attempt}</td><td className="p-2">{r.kind}</td><td className="p-2">v{r.version}</td>
                  <td className="p-2"><Badge variant={r.status === 'succeeded' ? 'default' : r.status === 'rolled_back' ? 'outline' : r.status === 'running' ? 'secondary' : 'destructive'}>{r.status.replace('_', ' ')}</Badge>
                    {r.error && <p className="mt-1 max-w-56 text-xs text-muted-foreground">{r.error}</p>}</td>
                  <td className="p-2 text-right tabular-nums">{r.counts.planned}</td><td className="p-2 text-right tabular-nums">{r.counts.inserted}</td>
                  <td className="p-2 text-right tabular-nums">{r.counts.alreadyPresent}</td><td className="p-2 text-right tabular-nums">{r.counts.conflict}</td>
                  <td className="p-2 text-xs text-muted-foreground">{formatTime(r.startedAt)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </CardContent>
      <Dialog open={confirmRollback} onOpenChange={setConfirmRollback}>
        <DialogContent>
          <DialogHeader><DialogTitle>Roll back the migration?</DialogTitle>
            <DialogDescription>This deletes the ~{migratedRows} rows inserted by {active.length} active run(s) of v{activeVersion}. Pre-existing target customers are not touched. The runs stay in history, marked rolled back.</DialogDescription></DialogHeader>
          {rollback.isError && <ErrorState error={rollback.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRollback(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => rollback.mutate()} disabled={rollback.isPending}>{rollback.isPending ? 'Rolling back…' : 'Roll back'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
