'use client';
import { AlertTriangle, Inbox, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <Inbox className="size-6 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const details = Array.isArray(e?.details) ? (e.details as { path?: string; message?: string; code?: string; label?: string; passed?: boolean }[]) : [];
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" aria-hidden />
      <AlertTitle>{e?.code ? `${e.code.replaceAll('_', ' ').toLowerCase()}` : 'Something went wrong'}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{e?.message ?? (error as Error)?.message ?? 'Unexpected error'}</p>
        {details.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {details.slice(0, 8).map((d, i) => (
              <li key={i}><span className="font-mono">{d.path ?? d.code ?? d.label}</span>{d.message ? `: ${d.message}` : d.passed === false ? ': not met' : ''}</li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3">
          {e?.requestId && <span className="font-mono text-xs opacity-70">request {e.requestId.slice(0, 8)}</span>}
          {onRetry && <Button size="sm" variant="outline" onClick={onRetry}><RotateCw className="mr-1 size-3" />Retry</Button>}
        </div>
      </AlertDescription>
    </Alert>
  );
}
