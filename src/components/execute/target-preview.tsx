'use client';
import { useState } from 'react';
import { DataTable, Pager } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TARGET_FIELD_NAMES } from '@/domain/schemas/target';
import { useTargetRows } from '@/lib/queries';

export function TargetPreview({ ws }: { ws: string }) {
  const [page, setPage] = useState(1);
  const rows = useTargetRows(ws, page);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Target store</CardTitle>
        <CardDescription>target.customers for this workspace — pre-existing customers plus migrated rows with lineage.</CardDescription></CardHeader>
      <CardContent>
        {rows.isPending ? <LoadingState rows={6} /> : rows.isError ? <ErrorState error={rows.error} onRetry={() => rows.refetch()} /> : (
          <>
            <DataTable columns={[{ key: 'origin', label: 'origin' }, ...TARGET_FIELD_NAMES.map((f) => ({ key: f, label: f, mono: true })), { key: 'runId', label: 'run', mono: true }]}
              rows={rows.data.rows.map((r) => ({ ...r, runId: typeof r.runId === 'string' ? r.runId.slice(0, 8) : null }))} />
            <Pager page={page} pageSize={rows.data.pageSize} total={rows.data.total} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
