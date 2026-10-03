'use client';
import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { WorkspaceOverview } from '@/lib/queries';

const STEPS = [
  { href: '', label: 'Overview', done: () => true },
  { href: '/plan', label: 'Plan', done: (o?: WorkspaceOverview) => !!o?.latestVersion },
  { href: '/dry-run', label: 'Dry run', done: (o?: WorkspaceOverview) => !!o?.approvedVersion },
  { href: '/execute', label: 'Approve & execute', done: (o?: WorkspaceOverview) => o?.lastRunStatus === 'succeeded' },
  { href: '/reconcile', label: 'Reconcile', done: () => false },
  { href: '/history', label: 'History', done: () => false },
];

export function StepNav({ ws, overview }: { ws: string; overview?: WorkspaceOverview }) {
  const path = usePathname();
  return (
    <nav aria-label="Workflow steps" className="-mx-4 overflow-x-auto px-4">
      <ol className="flex min-w-max gap-1 border-b">
        {STEPS.map((s, i) => {
          const href = `/w/${ws}${s.href}`;
          const active = s.href === '' ? path === href : path.startsWith(href);
          const Icon = s.done(overview) && s.href !== '' ? CheckCircle2 : Circle;
          return (
            <li key={s.href}>
              <Link href={href} aria-current={active ? 'page' : undefined}
                className={cn('flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors',
                  active ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                <Icon className={cn('size-3.5', s.done(overview) && s.href !== '' && 'text-[var(--accent-ok)]')} aria-hidden />
                <span className="font-mono text-xs opacity-60">{i + 1}</span>{s.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
