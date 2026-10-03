'use client';
import { Fragment, useMemo, useState } from 'react';
import { JsonView } from '@/components/json-view';
import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { QuarantineRow } from '@/lib/queries';

export function QuarantineTable({ rows }: { rows: QuarantineRow[] }) {
  const [stage, setStage] = useState('');
  const [code, setCode] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const stages = useMemo(() => [...new Set(rows.map((r) => r.stage))].sort(), [rows]);
  const codes = useMemo(() => [...new Set(rows.flatMap((r) => r.errors.map((e) => e.code)))].sort(), [rows]);
  const filtered = rows.filter((r) => (!stage || r.stage === stage) && (!code || r.errors.some((e) => e.code === code))
    && (!search || `${r.legacyKey} ${r.seq} ${r.errors.map((e) => `${e.targetField} ${e.sourceValue}`).join(' ')}`.toLowerCase().includes(search.toLowerCase())));

  if (!rows.length) return <EmptyState title="Nothing quarantined" description="Every source record passed transformation and validation." />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Filter by stage" className="rounded-md border bg-background p-2 text-sm" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">All stages</option>{stages.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Filter by error code" className="rounded-md border bg-background p-2 text-sm" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">All codes</option>{codes.map((c) => <option key={c}>{c}</option>)}</select>
        <Input aria-label="Search" placeholder="Search key, field or value" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="self-center text-sm text-muted-foreground">{filtered.length} of {rows.length}</span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-muted-foreground"><tr><th className="p-2">#</th><th className="p-2">Legacy key</th><th className="p-2">Stage</th><th className="p-2">Errors</th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <Fragment key={r.seq}>
                <tr className="cursor-pointer border-t hover:bg-muted/50" onClick={() => setOpen(open === r.seq ? null : r.seq)} aria-expanded={open === r.seq}>
                  <td className="p-2 font-mono text-xs">{r.seq}</td>
                  <td className="p-2 font-mono text-xs">{r.legacyKey ?? '∅'}</td>
                  <td className="p-2"><Badge variant="outline">{r.stage}</Badge></td>
                  <td className="p-2">{r.errors.map((e, i) => <span key={i} className="mr-2 font-mono text-xs">{e.targetField}:{e.code}</span>)}</td>
                </tr>
                {open === r.seq && (
                  <tr className="border-t bg-muted/30"><td colSpan={4} className="space-y-3 p-3">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground"><tr><th className="p-1">Target</th><th className="p-1">Source field</th><th className="p-1">Source value</th><th className="p-1">Rule</th><th className="p-1">Code</th><th className="p-1">Message</th></tr></thead>
                      <tbody>{r.errors.map((e, i) => (
                        <tr key={i} className="border-t"><td className="p-1 font-mono">{e.targetField}</td><td className="p-1 font-mono">{e.sourceField ?? '—'}</td>
                          <td className="p-1 font-mono">{e.sourceValue === null ? '∅' : JSON.stringify(e.sourceValue)}</td><td className="p-1 font-mono">{e.rule ?? 'target constraint'}</td>
                          <td className="p-1 font-mono">{e.code}</td><td className="p-1">{e.message}</td></tr>))}</tbody>
                    </table>
                    <p className="text-xs font-medium">Raw source record</p>
                    <JsonView value={r.raw} />
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
