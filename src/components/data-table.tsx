'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function DataTable({ columns, rows, empty }: {
  columns: { key: string; label: string; mono?: boolean }[]; rows: Record<string, unknown>[]; empty?: ReactNode;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader><TableRow>{columns.map((c) => <TableHead key={c.key} className="whitespace-nowrap">{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {columns.map((c) => {
                const v = r[c.key];
                return (
                  <TableCell key={c.key} className={cn('max-w-64 truncate whitespace-nowrap', c.mono && 'font-mono text-xs')}
                    title={v === null || v === undefined ? '' : String(v)}>
                    {v === null || v === undefined || v === '' ? <span className="text-muted-foreground">∅</span> : String(v)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-sm text-muted-foreground">
      <span>{total} rows · page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
