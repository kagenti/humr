interface Props {
  rowHeight?: number;
  rows?: number;
}

/**
 * Placeholder rows shown while a list query is in flight. Matches the
 * rounded-xl card chrome used across the connections / secrets lists.
 */
export function ListSkeleton({ rowHeight = 68, rows = 1 }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border-2 border-border-light bg-surface anim-pulse"
          style={{ height: `${rowHeight}px` }}
        />
      ))}
    </div>
  );
}
