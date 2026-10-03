import { Badge } from '@/components/ui/badge';

export function TransformChip({ rule, params }: { rule: string; params: unknown }) {
  const p = params && typeof params === 'object' && Object.keys(params).length ? JSON.stringify(params) : '';
  return (
    <Badge variant="outline" className="max-w-72 justify-start truncate font-mono text-[11px] font-normal" title={p ? `${rule} ${p}` : rule}>
      {rule}{p && <span className="ml-1 text-muted-foreground">{p.length > 40 ? `${p.slice(0, 40)}…` : p}</span>}
    </Badge>
  );
}
