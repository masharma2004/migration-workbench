'use client';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Bot, ShieldCheck, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { getActorName, recentWorkspaces, setActorName } from '@/lib/actor';
import { formatTime } from '@/lib/format';

const STEPS = [
  { icon: Bot, title: 'AI proposes a plan', text: 'A Gemini agent inspects the schemas and data with read-only tools, then drafts mappings, risks and questions.' },
  { icon: ShieldCheck, title: 'You review and approve', text: 'Edit mappings, answer questions, dry-run any version, and approve one exact version.' },
  { icon: Undo2, title: 'Execute, reconcile, roll back', text: 'Idempotent batched execution, quarantine with field-level evidence, reconciliation and rollback.' },
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [recent, setRecent] = useState<{ id: string; at: string }[]>([]);
  // localStorage is only readable after hydration, so this read must happen in an effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(getActorName()); setRecent(recentWorkspaces()); }, []);
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/api/workspaces', { method: 'POST' }),
    onSuccess: ({ id }) => router.push(`/w/${id}`),
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">legacy_crm.customers → customers</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Migration Workbench</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Plan and validate the migration of one bounded dataset (up to 500 records) into a mock target store.
        The AI drafts; a human approves; a deterministic engine executes.
      </p>

      <div className="mt-8 flex max-w-md flex-col gap-3">
        <Label htmlFor="actor">Your name <span className="text-muted-foreground">(shown in the history)</span></Label>
        <Input id="actor" value={name} placeholder="e.g. Priya (reviewer)" maxLength={60}
          onChange={(e) => { setName(e.target.value); setActorName(e.target.value); }} />
        <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Creating workspace…' : 'Start a new workspace'} <ArrowRight className="ml-2 size-4" />
        </Button>
        <p className="text-xs text-muted-foreground">Each workspace is an isolated copy of the 200-record sample dataset and its own target store.</p>
        {create.isError && <ErrorState error={create.error} onRetry={() => create.mutate()} />}
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <Card key={title}>
            <CardHeader className="pb-2"><Icon className="size-5 text-[var(--accent-ok)]" aria-hidden /><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{text}</CardContent>
          </Card>
        ))}
      </div>

      {recent.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-medium">Recent workspaces on this device</h2>
          <ul className="mt-2 divide-y rounded-md border">
            {recent.map((w) => (
              <li key={w.id}><Link className="flex justify-between px-3 py-2 text-sm hover:bg-muted" href={`/w/${w.id}`}>
                <span className="font-mono">{w.id.slice(0, 8)}</span><span className="text-muted-foreground">{formatTime(w.at)}</span></Link></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
