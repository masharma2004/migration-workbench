'use client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useWorkspaceInvalidate, type PlanVersionDto } from '@/lib/queries';

export function RisksPanel({ version, onEvidence }: { version: PlanVersionDto; onEvidence: (step: number) => void }) {
  const { risks, incompatibilities } = version.content;
  if (!risks.length && !incompatibilities.length) return <p className="text-sm text-muted-foreground">No risks or incompatibilities recorded for this version.</p>;
  return (
    <div className="space-y-4">
      {incompatibilities.length > 0 && (
        <ul className="space-y-1 text-sm">
          {incompatibilities.map((x, i) => (
            <li key={i}><Badge variant="outline" className="mr-2">{x.kind.replace('_', ' ')}</Badge><span className="font-mono">{x.field}</span> <span className="text-muted-foreground">({x.side}) — {x.description}</span></li>
          ))}
        </ul>
      )}
      <ul className="space-y-2">
        {risks.map((r) => (
          <li key={r.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={r.severity === 'high' ? 'destructive' : 'secondary'}>{r.severity}</Badge>
              {r.fields.map((f) => <span key={f} className="font-mono text-xs">{f}</span>)}
            </div>
            <p className="mt-1">{r.description}</p>
            {r.evidenceStepIds.length > 0 && version.agentRunId && (
              <p className="mt-1 text-xs text-muted-foreground">Evidence: {r.evidenceStepIds.map((s) => (
                <button key={s} type="button" className="mr-2 font-mono underline underline-offset-2" onClick={() => onEvidence(s)}>step #{s}</button>))}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestionsPanel({ ws, version, onSaved }: { ws: string; version: PlanVersionDto; onSaved: (v: number) => void }) {
  const invalidate = useWorkspaceInvalidate(ws);
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(version.content.questions.map((q) => [q.id, q.answer ?? ''])));
  const [instructions, setInstructions] = useState('');
  const withAnswers = () => ({ ...version.content,
    questions: version.content.questions.map((q) => (answers[q.id]?.trim() ? { ...q, answer: answers[q.id].trim() } : { ...q, answer: undefined })) });

  const save = useMutation({
    mutationFn: () => api<PlanVersionDto>(`/api/workspaces/${ws}/plans`, { method: 'POST',
      body: { baseVersion: version.version, content: withAnswers(), changeNote: 'Answered clarification questions' } }),
    onSuccess: (v) => { toast.success(`Saved answers as v${v.version}`); invalidate(); onSaved(v.version); },
  });
  const revise = useMutation({
    mutationFn: () => api<{ runId: string }>(`/api/workspaces/${ws}/agent-runs`, { method: 'POST',
      body: { mode: 'revise', baseVersion: version.version, answers, instructions: instructions || undefined } }),
    onSuccess: () => { toast.info('Agent is revising the plan'); invalidate(); },
  });

  if (!version.content.questions.length) return <p className="text-sm text-muted-foreground">The agent raised no clarification questions for this version.</p>;
  return (
    <div className="space-y-4">
      {version.content.questions.map((q) => (
        <div key={q.id} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            {q.blocking ? <Badge className="bg-[var(--accent-warn)] text-black">blocking</Badge> : <Badge variant="outline">optional</Badge>}
            <span className="font-mono text-xs text-muted-foreground">{q.id}</span>
          </div>
          <Label htmlFor={`q-${q.id}`} className="text-sm font-medium">{q.text}</Label>
          {q.assumption && <p className="text-xs text-muted-foreground">Draft assumes: {q.assumption}</p>}
          <div className="flex flex-wrap gap-1">
            {q.suggestedOptions.map((o) => <Button key={o} type="button" size="sm" variant="outline" onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>{o}</Button>)}
          </div>
          <Textarea id={`q-${q.id}`} rows={2} value={answers[q.id] ?? ''} maxLength={2000} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
        </div>
      ))}
      <Label htmlFor="instr" className="text-sm">Extra instructions for the agent (optional)</Label>
      <Textarea id="instr" rows={2} value={instructions} maxLength={2000} onChange={(e) => setInstructions(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save answers as new version'}</Button>
        <Button onClick={() => revise.mutate()} disabled={revise.isPending}>{revise.isPending ? 'Starting…' : 'Revise with agent'}</Button>
      </div>
      {save.isError && <ErrorState error={save.error} />}
      {revise.isError && <ErrorState error={revise.error} />}
    </div>
  );
}
