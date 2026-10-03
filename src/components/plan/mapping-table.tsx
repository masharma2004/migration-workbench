import { Badge } from '@/components/ui/badge';
import type { PlanIssue, VersionContent } from '@/domain/plan';
import { TransformChip } from './transform-chip';

export function MappingTable({ content, issues }: { content: VersionContent; issues: PlanIssue[] }) {
  const general = issues.filter((i) => !/^mappings\[\d+\]/.test(i.path));
  return (
    <div className="space-y-3">
      {general.length > 0 && (
        <ul className="rounded-md border border-[var(--accent-warn)] p-3 text-sm">
          {general.map((i, k) => <li key={k}><span className="font-mono text-xs">{i.code}</span> — {i.message}</li>)}
        </ul>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="p-2">Target</th><th className="p-2">Source</th><th className="p-2">Pipeline</th><th className="p-2">Confidence</th><th className="p-2">Rationale</th></tr>
          </thead>
          <tbody>
            {content.plan.mappings.map((m, i) => {
              const rowIssues = issues.filter((x) => x.path.startsWith(`mappings[${i}]`));
              return (
                <tr key={`${m.targetField}-${i}`} className="border-t align-top">
                  <td className="p-2 font-mono text-xs">{m.targetField}</td>
                  <td className="p-2 font-mono text-xs">{m.sourceField ?? <span className="text-muted-foreground">constant</span>}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">{m.transforms.length ? m.transforms.map((t, j) => <TransformChip key={j} rule={t.rule} params={t.params} />) : <span className="text-muted-foreground">—</span>}</div>
                    {rowIssues.map((x, k) => <p key={k} className="mt-1 text-xs text-destructive">{x.message}</p>)}
                  </td>
                  <td className="p-2">{m.confidence && <Badge variant={m.confidence === 'low' ? 'destructive' : m.confidence === 'medium' ? 'secondary' : 'outline'}>{m.confidence}</Badge>}</td>
                  <td className="p-2 text-muted-foreground">{m.rationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {content.plan.unmappedSourceFields.length > 0 && (
        <p className="text-sm text-muted-foreground">Dropped source fields: {content.plan.unmappedSourceFields.map((u) => (
          <span key={u.field} className="mr-2"><span className="font-mono text-foreground">{u.field}</span> ({u.reason})</span>))}</p>
      )}
    </div>
  );
}
