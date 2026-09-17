import { cn } from '@/lib/utils';

/**
 * Placeholder block. A sweeping highlight reads as "content is coming" more
 * clearly than a pulse; it degrades to a plain pulse when the viewer prefers
 * reduced motion.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer',
        'after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.07] after:to-transparent',
        'motion-reduce:animate-pulse motion-reduce:after:hidden',
        className,
      )}
      {...props}
    />
  );
}

/** Table-shaped placeholder for list pages while the first query resolves. */
function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex gap-4 border-b pb-3">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-4 flex-1', columnIndex === 0 && 'max-w-[22%]')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Whole-page placeholder: heading, filter bar, and a table. */
function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-60 max-w-full" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <TableSkeleton />
      </div>
      <span className="sr-only">Loading page…</span>
    </div>
  );
}

export { Skeleton, TableSkeleton, PageSkeleton };
