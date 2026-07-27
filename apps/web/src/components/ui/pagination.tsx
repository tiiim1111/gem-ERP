'use client';

import type { PaginationMeta } from '@gemerp/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { Select } from './select';

export interface PaginationControlsProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

/** Server-side pagination footer: range summary, page-size select, prev/next. */
export function PaginationControls({
  meta,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: PaginationControlsProps) {
  const { page, pageSize, total, totalPages } = meta;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 border-t px-3 py-2.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        {total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}
      </p>
      <div className="flex items-center gap-3">
        {onPageSizeChange ? (
          <label className="flex items-center gap-2">
            <span className="hidden sm:inline">Rows</span>
            <Select
              aria-label="Rows per page"
              className="w-[4.75rem]"
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-[6rem] text-center tabular-nums">
            Page {totalPages === 0 ? 0 : page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
