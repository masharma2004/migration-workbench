import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DryRunCounts } from '@/domain/engine';

export function DryRunCountsView({ counts }: { counts: DryRunCounts }) {
  const cards = [
    { label: 'Source', value: counts.source },
    { label: 'Transformed', value: counts.transformed },
    { label: 'Accepted', value: counts.accepted, tone: 'text-[var(--accent-ok)]' },
    { label: 'Rejected (quarantined)', value: counts.rejected, tone: counts.rejected ? 'text-destructive' : '' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}><CardHeader><CardDescription>{c.label}</CardDescription><CardTitle className={`text-3xl tabular-nums ${c.tone ?? ''}`}>{c.value}</CardTitle></CardHeader></Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        {Object.entries(counts.rejectedByStage).map(([stage, n]) => (
          <span key={stage}><span className="font-mono text-xs">{stage}</span> <span className="tabular-nums text-foreground">{n}</span></span>))}
        <span>Check: {counts.accepted} + {counts.rejected} = {counts.accepted + counts.rejected} {counts.accepted + counts.rejected === counts.source ? '✓' : '✗'}</span>
      </div>
    </div>
  );
}
