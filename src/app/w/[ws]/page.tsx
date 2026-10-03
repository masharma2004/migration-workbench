'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DataTable, Pager } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SOURCE_FIELDS } from '@/domain/schemas/source';
import { shortHash } from '@/lib/format';
import { useOverview, useSourceRecords } from '@/lib/queries';

export default function OverviewPage() {
  const { ws } = useParams<{ ws: string }>();
  const overview = useOverview(ws);
  const [page, setPage] = useState(1);
  const source = useSourceRecords(ws, page);
  const o = overview.data;
  if (!o) return null; // layout renders loading/error

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardDescription>Source records</CardDescription><CardTitle className="text-3xl">{o.sourceCount}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">Documented maximum: {o.maxSourceRecords} per workspace</CardContent></Card>
        <Card><CardHeader><CardDescription>Dataset fingerprint</CardDescription><CardTitle className="font-mono text-2xl">{shortHash(o.datasetHash)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">Approvals are bound to this hash</CardContent></Card>
        <Card><CardHeader><CardDescription>Plan status</CardDescription>
          <CardTitle className="text-xl">{o.approvedVersion ? `v${o.approvedVersion} approved` : o.latestVersion ? `v${o.latestVersion} draft` : 'No plan yet'}</CardTitle></CardHeader>
          <CardContent><Link href={`/w/${ws}/plan`} className={buttonVariants({ size: 'sm' })}>{o.latestVersion ? 'Open plan' : 'Propose a plan'}</Link></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Source schema <span className="font-mono text-xs text-muted-foreground">{o.sourceSchema.version}</span></CardTitle>
            <CardDescription>legacy_crm.customers — every value is text</CardDescription></CardHeader>
          <CardContent><DataTable columns={[{ key: 'name', label: 'Field', mono: true }, { key: 'description', label: 'Description' }]} rows={o.sourceSchema.fields} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Target schema <span className="font-mono text-xs text-muted-foreground">{o.targetSchema.version}</span></CardTitle>
            <CardDescription>customers — strict types and constraints</CardDescription></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr><th className="p-2">Field</th><th className="p-2">Type</th><th className="p-2">Rules</th></tr></thead>
                <tbody>
                  {o.targetSchema.fields.map((f) => (
                    <tr key={f.name} className="border-t">
                      <td className="p-2 font-mono text-xs">{f.name}</td>
                      <td className="p-2">{f.type}{f.enumValues ? ` (${f.enumValues.join(' | ')})` : ''}</td>
                      <td className="flex flex-wrap gap-1 p-2">
                        {f.required && <Badge variant="secondary">required</Badge>}
                        {f.unique && <Badge variant="secondary">unique</Badge>}
                        {f.format && <Badge variant="outline">{f.format}</Badge>}
                        {f.min !== undefined && <Badge variant="outline">≥ {f.min}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Source records</CardTitle><CardDescription>Raw legacy data, exactly as exported</CardDescription></CardHeader>
        <CardContent>
          {source.isPending ? <LoadingState rows={8} /> : source.isError ? <ErrorState error={source.error} onRetry={() => source.refetch()} /> : (
            <>
              <DataTable columns={[{ key: 'seq', label: '#', mono: true }, ...SOURCE_FIELDS.map((f) => ({ key: f, label: f, mono: true }))]}
                rows={source.data.rows.map((r) => ({ seq: r.seq, ...r.raw }))} />
              <Pager page={page} pageSize={source.data.pageSize} total={source.data.total} onPage={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
