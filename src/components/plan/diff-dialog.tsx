'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { PlanDiff } from '@/domain/plan';
import { api } from '@/lib/api';
import type { PlanVersionDto } from '@/lib/queries';
import { TransformChip } from './transform-chip';

export function DiffDialog({ ws, versions, defaultTo }: { ws: string; versions: PlanVersionDto[]; defaultTo: number }) {
  const [from, setFrom] = useState(Math.max(1, defaultTo - 1));
  const [to, setTo] = useState(defaultTo);
  const [open, setOpen] = useState(false);
  const diff = useQuery({ queryKey: ['ws', ws, 'diff', from, to], enabled: open && from !== to,
    queryFn: () => api<PlanDiff>(`/api/workspaces/${ws}/plans/diff?from=${from}&to=${to}`) });
  const select = (value: number, set: (n: number) => void, label: string) => (
    <select aria-label={label} className="rounded-md border bg-background p-1 text-sm" value={value} onChange={(e) => set(Number(e.target.value))}>
      {versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
    </select>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={versions.length < 2} />}>Compare versions</DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Compare plan versions</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2 text-sm">{select(from, setFrom, 'From')} → {select(to, setTo, 'To')}</div>
        {from === to ? <p className="text-sm text-muted-foreground">Pick two different versions.</p>
          : diff.isPending ? <LoadingState rows={3} /> : diff.isError ? <ErrorState error={diff.error} /> : diff.data.identical ? (
            <p className="text-sm">The executable plans are identical (only metadata such as rationale, risks or answers differ).</p>
          ) : (
            <div className="space-y-3 text-sm">
              {diff.data.changed.map((c) => (
                <div key={c.targetField} className="rounded-md border p-2">
                  <p className="font-mono">{c.targetField}</p>
                  <p className="mt-1 text-xs text-muted-foreground">before ({c.before.sourceField ?? 'constant'})</p>
                  <div className="flex flex-wrap gap-1">{c.before.transforms.map((t, i) => <TransformChip key={i} rule={t.rule} params={t.params} />)}</div>
                  <p className="mt-1 text-xs text-muted-foreground">after ({c.after.sourceField ?? 'constant'})</p>
                  <div className="flex flex-wrap gap-1">{c.after.transforms.map((t, i) => <TransformChip key={i} rule={t.rule} params={t.params} />)}</div>
                </div>
              ))}
              {[['Added mappings', diff.data.added], ['Removed mappings', diff.data.removed], ['Newly dropped fields', diff.data.unmappedAdded], ['No longer dropped', diff.data.unmappedRemoved]]
                .filter(([, xs]) => (xs as string[]).length).map(([label, xs]) => (
                  <p key={label as string}>{label as string}: <span className="font-mono">{(xs as string[]).join(', ')}</span></p>))}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}
