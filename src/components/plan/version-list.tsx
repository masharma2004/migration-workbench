'use client';
import { Badge } from '@/components/ui/badge';
import { shortHash } from '@/lib/format';
import type { PlanVersionDto } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function VersionList({ versions, selected, onSelect }: { versions: PlanVersionDto[]; selected: number | null; onSelect: (v: number) => void }) {
  return (
    <ol className="space-y-1" aria-label="Plan versions">
      {versions.map((v) => (
        <li key={v.id}>
          <button type="button" onClick={() => onSelect(v.version)} aria-current={selected === v.version}
            className={cn('w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted', selected === v.version && 'border-foreground bg-muted')}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">v{v.version}</span>
              <Badge variant={v.status === 'approved' ? 'default' : v.status === 'superseded' ? 'outline' : 'secondary'}>{v.status}</Badge>
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>{v.author === 'agent' ? 'AI agent' : 'Human edit'}{v.issues.length ? ` · ${v.issues.length} issue(s)` : ''}</span>
              <span className="font-mono">{shortHash(v.planHash)}</span>
            </div>
          </button>
        </li>
      ))}
    </ol>
  );
}
