'use client';
import { useMutation } from '@tanstack/react-query';
import { Bot, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useAgentRun, useAgentRuns, useWorkspaceInvalidate } from '@/lib/queries';
import { AgentTrace } from './agent-trace';

export function AgentPanel({ ws, onVersionCreated, traceStep, onCloseTrace }: {
  ws: string; onVersionCreated: (v: number) => void; traceStep: number | null; onCloseTrace: () => void;
}) {
  const runs = useAgentRuns(ws);
  const latest = runs.data?.[0] ?? null;
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const run = useAgentRun(ws, latest?.id ?? null);
  const invalidate = useWorkspaceInvalidate(ws);
  const announced = useRef<string | null>(null);

  const propose = useMutation({
    mutationFn: () => api<{ runId: string }>(`/api/workspaces/${ws}/agent-runs`, { method: 'POST', body: { mode: 'propose' } }),
    onSuccess: () => { toast.info('Agent started — watch the trace'); invalidate(); },
  });

  useEffect(() => {
    const r = run.data;
    if (!r || announced.current === r.id || r.status === 'queued' || r.status === 'running') return;
    announced.current = r.id;
    if (r.status === 'succeeded' && r.resultVersion) { toast.success(`Agent created draft v${r.resultVersion}`); invalidate(); onVersionCreated(r.resultVersion); }
    if (r.status === 'failed') toast.error('Agent run failed — see the trace for details');
  }, [run.data, invalidate, onVersionCreated]);

  const busy = latest?.status === 'queued' || latest?.status === 'running';
  const traceRun = run.data;
  const sheetOpen = !!openRunId || traceStep !== null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Bot className="size-4" aria-hidden />Planning agent</CardTitle>
          <CardDescription>Uses only read-only inspection and validation tools; it can create drafts but never approve or execute.</CardDescription>
        </div>
        <Button onClick={() => propose.mutate()} disabled={propose.isPending || busy}>
          {busy || propose.isPending ? <><Loader2 className="mr-2 size-4 animate-spin" />Running…</> : 'Propose new plan'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {propose.isError && <ErrorState error={propose.error} onRetry={() => propose.mutate()} />}
        {latest ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={latest.status === 'failed' ? 'destructive' : latest.status === 'succeeded' ? 'default' : 'secondary'}>{latest.status}</Badge>
            <span className="text-muted-foreground">{latest.mode} · {latest.toolCalls} tool calls · {latest.inputTokens + latest.outputTokens} tokens · <span className="font-mono">{latest.model}</span></span>
            {latest.error && <span className="text-destructive">{latest.error}</span>}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpenRunId(latest.id)}>View trace{traceRun ? ` (${traceRun.steps.length} steps)` : ''}</Button>
          </div>
        ) : <p className="text-sm text-muted-foreground">No agent runs yet.</p>}
      </CardContent>
      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) { setOpenRunId(null); onCloseTrace(); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader><SheetTitle>Agent trace</SheetTitle></SheetHeader>
          <div className="p-4">{traceRun ? <AgentTrace run={traceRun} highlight={traceStep} /> : <p className="text-sm text-muted-foreground">Loading…</p>}</div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
