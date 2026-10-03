'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { JsonView } from '@/components/json-view';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTime } from '@/lib/format';
import { useHistory } from '@/lib/queries';

const TYPES = ['', 'agent_run.started', 'agent_run.succeeded', 'agent_run.failed', 'plan.version_created', 'dry_run.completed', 'plan.approved',
  'plan.superseded', 'execution.started', 'execution.succeeded', 'execution.failed', 'execution.interrupted', 'rollback.completed', 'reconciliation.completed'];

function summary(type: string, p: Record<string, unknown>): string {
  const c = p.counts as Record<string, number> | undefined;
  switch (type) {
    case 'plan.version_created': return `v${p.version} by ${p.author}${p.changeNote ? ` — ${p.changeNote}` : ''}`;
    case 'plan.approved': return `v${p.version} approved${p.note ? ` — ${p.note}` : ''}`;
    case 'dry_run.completed': return `v${p.version}: ${c?.accepted} accepted, ${c?.rejected} rejected`;
    case 'execution.started': return `${p.kind} attempt #${p.attempt} of v${p.version}${p.failAfterBatches !== null && p.failAfterBatches !== undefined ? ` (simulated failure after ${p.failAfterBatches})` : ''}`;
    case 'execution.succeeded': case 'execution.failed': return `${p.kind} #${p.attempt}: ${c?.inserted} inserted, ${c?.alreadyPresent} already present${p.error ? ` — ${p.error}` : ''}`;
    case 'rollback.completed': return `${p.rowsDeleted} rows removed`;
    case 'reconciliation.completed': return `${String(p.result).toUpperCase()}`;
    case 'agent_run.failed': return String(p.error ?? '');
    case 'agent_run.succeeded': return `created v${p.version} with ${p.toolCalls} tool calls`;
    default: return '';
  }
}

export default function HistoryPage() {
  const { ws } = useParams<{ ws: string }>();
  const [type, setType] = useState('');
  const history = useHistory(ws, type);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div><CardTitle className="text-base">History</CardTitle><CardDescription>Append-only audit log: approvals, executions, retries, rollbacks, reconciliations and agent runs.</CardDescription></div>
        <select aria-label="Filter by event type" className="rounded-md border bg-background p-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t || 'All events'}</option>)}
        </select>
      </CardHeader>
      <CardContent>
        {history.isPending ? <LoadingState rows={8} /> : history.isError ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : !history.data.length ? (
          <EmptyState title="No events" description={type ? 'No events of this type yet.' : 'Nothing has happened in this workspace yet.'} />
        ) : (
          <ol className="relative space-y-3 border-l pl-4">
            {[...history.data].reverse().map((e) => (
              <li key={e.id}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <Badge variant={e.type.endsWith('failed') ? 'destructive' : 'outline'} className="font-mono text-[11px]">{e.type}</Badge>
                    <span>{summary(e.type, e.payload)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{e.actor} · {formatTime(e.createdAt)}</span>
                  </summary>
                  <div className="mt-2"><JsonView value={e.payload} /></div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
