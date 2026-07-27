import * as React from 'react';
import { cn } from '@/lib/utils';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/**
 * Old/new values diff for audit entries. When both sides are objects the diff
 * is per-field with changed rows highlighted; otherwise raw JSON is shown.
 */
export function ValueDiff({ oldValues, newValues }: { oldValues: unknown; newValues: unknown }) {
  const hasOld = oldValues !== undefined && oldValues !== null;
  const hasNew = newValues !== undefined && newValues !== null;

  if (!hasOld && !hasNew) {
    return <p className="text-sm text-muted-foreground">No value changes recorded for this event.</p>;
  }

  if (isPlainObject(oldValues ?? {}) && isPlainObject(newValues ?? {}) && (hasOld || hasNew)) {
    const oldObj = isPlainObject(oldValues) ? oldValues : {};
    const newObj = isPlainObject(newValues) ? newValues : {};
    const keys = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])].sort();

    if (keys.length > 0) {
      return (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Old</th>
                <th className="px-3 py-2">New</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const oldValue = oldObj[key];
                const newValue = newObj[key];
                const changed = JSON.stringify(oldValue) !== JSON.stringify(newValue);
                return (
                  <tr key={key} className={cn('border-b last:border-0', changed && 'bg-warning/5')}>
                    <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs">{key}</td>
                    <td
                      className={cn(
                        'px-3 py-2 align-top font-mono text-xs',
                        changed ? 'text-destructive line-through decoration-destructive/50' : 'text-muted-foreground',
                      )}
                    >
                      <pre className="whitespace-pre-wrap break-all font-mono">{renderValue(hasOld ? oldValue : undefined)}</pre>
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 align-top font-mono text-xs',
                        changed ? 'font-medium text-success' : 'text-muted-foreground',
                      )}
                    >
                      <pre className="whitespace-pre-wrap break-all font-mono">{renderValue(hasNew ? newValue : undefined)}</pre>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Old</p>
        <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs">
          {renderValue(hasOld ? oldValues : undefined)}
        </pre>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">New</p>
        <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs">
          {renderValue(hasNew ? newValues : undefined)}
        </pre>
      </div>
    </div>
  );
}
