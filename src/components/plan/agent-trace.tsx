'use client';
import { JsonView } from '@/components/json-view';
import { Badge } from '@/components/ui/badge';
import type { AgentRunDto } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function AgentTrace({ run, highlight }: { run: AgentRunDto; highlight?: number | null }) {
  return (
    <ol className="space-y-2">
      {run.steps.map((s) => (
        <li key={s.step} id={`step-${s.step}`} className={cn('rounded-md border p-3', highlight === s.step && 'ring-2 ring-[var(--accent-warn)]')}>
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">#{s.step}</span>
              <Badge variant={s.kind === 'error' ? 'destructive' : s.kind === 'correction' ? 'secondary' : 'outline'}>{s.kind.replace('_', ' ')}</Badge>
              <span className="font-mono">{s.toolName ?? 'model'}</span>
              <span className="ml-auto text-xs text-muted-foreground">{s.durationMs} ms</span>
            </summary>
            <div className="mt-2 space-y-2">
              {s.args !== null && <><p className="text-xs font-medium">Arguments</p><JsonView value={s.args} maxChars={1500} /></>}
              <p className="text-xs font-medium">Result</p><JsonView value={s.result} maxChars={3000} />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
