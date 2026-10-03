'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApprovalCard } from '@/components/execute/approval-card';
import { ExecutionCard } from '@/components/execute/execution-card';
import { TargetPreview } from '@/components/execute/target-preview';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { buttonVariants } from '@/components/ui/button';
import { useVersions } from '@/lib/queries';

function ExecuteInner() {
  const { ws } = useParams<{ ws: string }>();
  const search = useSearchParams();
  const versions = useVersions(ws);
  const [picked, setVersion] = useState<number | null>(search.get('version') ? Number(search.get('version')) : null);
  const version = picked ?? versions.data?.[0]?.version ?? null;

  if (versions.isPending) return <LoadingState rows={6} />;
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />;
  if (!versions.data.length || version === null) return <EmptyState title="No plan yet" description="Create and dry-run a plan before approving."
    action={<Link href={`/w/${ws}/plan`} className={buttonVariants({  })}>Go to plan</Link>} />;
  const approved = versions.data.find((v) => v.status === 'approved')?.version ?? null;

  return (
    <div className="space-y-6">
      <ApprovalCard ws={ws} versions={versions.data} version={version} onVersion={setVersion} />
      <ExecutionCard ws={ws} approvedVersion={approved} />
      <TargetPreview ws={ws} />
    </div>
  );
}

export default function ExecutePage() {
  return <Suspense fallback={<LoadingState rows={6} />}><ExecuteInner /></Suspense>;
}
