'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { StepNav } from '@/components/step-nav';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { buttonVariants } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { rememberWorkspace } from '@/lib/actor';
import { useOverview } from '@/lib/queries';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { ws } = useParams<{ ws: string }>();
  const overview = useOverview(ws);
  useEffect(() => { if (overview.data) rememberWorkspace(ws); }, [overview.data, ws]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-2 py-4">
        <Link href="/" className="font-semibold tracking-tight">Migration Workbench</Link>
        <span className="font-mono text-xs text-muted-foreground">workspace {ws.slice(0, 8)}</span>
      </header>
      {overview.isPending ? <LoadingState rows={6} /> : overview.isError ? (
        overview.error instanceof ApiError && overview.error.code === 'NOT_FOUND' ? (
          <EmptyState title="Workspace not found" description="This workspace does not exist or has been removed. Start a new one to continue."
            action={<Link href="/" className={buttonVariants({  })}>Start a new workspace</Link>} />
        ) : <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : (
        <>
          <StepNav ws={ws} overview={overview.data} />
          <main className="pt-6">{children}</main>
        </>
      )}
    </div>
  );
}
