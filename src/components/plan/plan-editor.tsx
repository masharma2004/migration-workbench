'use client';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { VersionContent } from '@/domain/plan';
import { SOURCE_FIELDS } from '@/domain/schemas/source';
import { api } from '@/lib/api';
import { useRules, useWorkspaceInvalidate, type PlanVersionDto } from '@/lib/queries';

type EditStep = { rule: string; paramsText: string };
type EditMapping = { targetField: string; sourceField: string; steps: EditStep[]; rationale: string };

export function PlanEditor({ ws, version, open, onOpenChange, onSaved }: {
  ws: string; version: PlanVersionDto; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (v: number) => void;
}) {
  const rules = useRules();
  const invalidate = useWorkspaceInvalidate(ws);
  const [mappings, setMappings] = useState<EditMapping[]>(() => version.content.plan.mappings.map((m) => ({
    targetField: m.targetField, sourceField: m.sourceField ?? '', rationale: m.rationale ?? '',
    steps: m.transforms.map((t) => ({ rule: t.rule, paramsText: JSON.stringify(t.params ?? {}) })) })));
  const [dropped, setDropped] = useState<Record<string, string>>(
    Object.fromEntries(version.content.plan.unmappedSourceFields.map((u) => [u.field, u.reason])));
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const build = (): VersionContent => {
    const plan = { ...version.content.plan,
      mappings: mappings.map((m) => ({ targetField: m.targetField, sourceField: m.sourceField || null, rationale: m.rationale || undefined,
        transforms: m.steps.map((s, i) => {
          try { return { rule: s.rule, params: JSON.parse(s.paramsText || '{}') }; }
          catch { throw new Error(`${m.targetField}: step ${i + 1} params are not valid JSON`); }
        }) })),
      unmappedSourceFields: Object.entries(dropped).map(([field, reason]) => ({ field, decision: 'drop' as const, reason: reason || 'Not needed' })) };
    return { ...version.content, plan };
  };

  const save = useMutation({
    mutationFn: (content: VersionContent) => api<PlanVersionDto>(`/api/workspaces/${ws}/plans`, { method: 'POST',
      body: { baseVersion: version.version, content, changeNote: note || 'Manual edit' } }),
    onSuccess: (v) => { toast.success(`Saved v${v.version}`); invalidate(); onSaved(v.version); onOpenChange(false); },
  });

  const update = (i: number, patch: Partial<EditMapping>) => setMappings((ms) => ms.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const updateStep = (i: number, j: number, patch: Partial<EditStep>) =>
    update(i, { steps: mappings[i].steps.map((s, k) => (k === j ? { ...s, ...patch } : s)) });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader><SheetTitle>Edit v{version.version} → save as a new version</SheetTitle></SheetHeader>
        <div className="space-y-4 p-4">
          {mappings.map((m, i) => (
            <fieldset key={m.targetField} className="space-y-2 rounded-md border p-3">
              <legend className="px-1 font-mono text-sm">{m.targetField}</legend>
              <Label className="text-xs">Source field</Label>
              <select className="w-full rounded-md border bg-background p-2 font-mono text-sm" value={m.sourceField}
                onChange={(e) => update(i, { sourceField: e.target.value })}>
                <option value="">(none — constant via default_value)</option>
                {SOURCE_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              {m.steps.map((s, j) => (
                <div key={j} className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
                  <select aria-label="Rule" className="rounded-md border bg-background p-2 font-mono text-sm" value={s.rule}
                    onChange={(e) => updateStep(i, j, { rule: e.target.value })}>
                    {(rules.data ?? [{ name: s.rule }]).map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                  </select>
                  <Input aria-label="Params (JSON)" className="font-mono text-xs" value={s.paramsText} onChange={(e) => updateStep(i, j, { paramsText: e.target.value })} />
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove step" onClick={() => update(i, { steps: m.steps.filter((_, k) => k !== j) })}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => update(i, { steps: [...m.steps, { rule: 'trim', paramsText: '{}' }] })}><Plus className="mr-1 size-3" />Add step</Button>
              <Input aria-label="Rationale" placeholder="Rationale" value={m.rationale} onChange={(e) => update(i, { rationale: e.target.value })} />
            </fieldset>
          ))}
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm">Dropped source fields</legend>
            {SOURCE_FIELDS.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <input id={`drop-${f}`} type="checkbox" checked={f in dropped}
                  onChange={(e) => setDropped((d) => { const n = { ...d }; if (e.target.checked) n[f] = ''; else delete n[f]; return n; })} />
                <label htmlFor={`drop-${f}`} className="w-32 font-mono text-xs">{f}</label>
                {f in dropped && <Input className="h-8" placeholder="Reason" value={dropped[f]} onChange={(e) => setDropped((d) => ({ ...d, [f]: e.target.value }))} />}
              </div>
            ))}
          </fieldset>
          <Label htmlFor="note">Change note</Label>
          <Textarea id="note" rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What did you change and why?" />
          {rules.data && <details className="text-xs"><summary className="cursor-pointer">Rule reference</summary>
            <ul className="mt-2 space-y-1">{rules.data.map((r) => <li key={r.name}><span className="font-mono">{r.name}</span> — {r.description}</li>)}</ul></details>}
          {localError && <p className="text-sm text-destructive" role="alert">{localError}</p>}
          {save.isError && <ErrorState error={save.error} />}
        </div>
        <SheetFooter className="p-4">
          <Button disabled={save.isPending} onClick={() => {
            setLocalError(null);
            try { save.mutate(build()); } catch (e) { setLocalError((e as Error).message); }
          }}>{save.isPending ? 'Saving…' : 'Save as new version'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
