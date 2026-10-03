'use client';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { getActorName } from '@/lib/actor';
import { useReadiness, useWorkspaceInvalidate, type ApprovalDto, type PlanVersionDto } from '@/lib/queries';

export function ApprovalCard({ ws, versions, version, onVersion }: { ws: string; versions: PlanVersionDto[]; version: number; onVersion: (v: number) => void }) {
  const readiness = useReadiness(ws, version);
  const invalidate = useWorkspaceInvalidate(ws);
  const [approvedBy, setApprovedBy] = useState(getActorName());
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const approve = useMutation({
    mutationFn: () => api<ApprovalDto>(`/api/workspaces/${ws}/plans/${version}/approve`, { method: 'POST', body: { approvedBy, note: note || undefined, acknowledgeDryRun: ack } }),
    onSuccess: (a) => { toast.success(`v${a.version} approved by ${a.approvedBy}`); setAck(false); invalidate(); },
  });
  const v = versions.find((x) => x.version === version);
  const dry = readiness.data?.latestDryRun;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div><CardTitle className="text-base">1 · Approve a plan version</CardTitle>
          <CardDescription>Approval binds to this version&apos;s plan hash, the dataset hash and the dry-run report hash.</CardDescription></div>
        <select aria-label="Version to approve" className="rounded-md border bg-background p-2 text-sm" value={version} onChange={(e) => onVersion(Number(e.target.value))}>
          {versions.map((x) => <option key={x.version} value={x.version}>v{x.version} ({x.status})</option>)}
        </select>
      </CardHeader>
      <CardContent className="space-y-4">
        {readiness.isPending ? <LoadingState rows={3} /> : readiness.isError ? <ErrorState error={readiness.error} onRetry={() => readiness.refetch()} /> : (
          <ul className="space-y-1 text-sm">
            {readiness.data.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.passed ? <CheckCircle2 className="mt-0.5 size-4 text-[var(--accent-ok)]" aria-label="passed" /> : <XCircle className="mt-0.5 size-4 text-destructive" aria-label="failed" />}
                <span>{c.label} <span className="text-muted-foreground">— {c.detail}</span></span>
              </li>
            ))}
          </ul>
        )}
        {v?.status === 'approved' ? <p className="text-sm text-[var(--accent-ok)]">v{version} is the currently approved version.</p> : (
          <form className="grid gap-3 sm:max-w-lg" onSubmit={(e) => { e.preventDefault(); approve.mutate(); }}>
            <div className="space-y-1"><Label htmlFor="approver">Approved by</Label>
              <Input id="approver" required maxLength={100} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="anote">Note (optional)</Label>
              <Textarea id="anote" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I reviewed the dry run{dry ? ` (${dry.counts.accepted} accepted, ${dry.counts.rejected} quarantined)` : ''} and approve executing exactly this version.</span>
            </label>
            <Button type="submit" disabled={!readiness.data?.ready || !ack || !approvedBy.trim() || approve.isPending}>
              {approve.isPending ? 'Approving…' : `Approve v${version}`}</Button>
            {approve.isError && <ErrorState error={approve.error} />}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
