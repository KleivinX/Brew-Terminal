import { useEffect, useState } from 'react';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format';

interface RelativeTimeProps {
  /** Unix epoch seconds, UTC. */
  epochSeconds: number;
  /** How often to re-render the label. Default 30s — enough for "updated 12s ago" to feel live. */
  intervalMs?: number | undefined;
}

/**
 * A self-updating relative timestamp with the absolute value in the tooltip.
 *
 * One interval per instance would be wasteful on a table of 50 rows, so this is used for panel
 * headers and status lines only. Table cells render a static value from the panel's envelope.
 */
export function RelativeTime({ epochSeconds, intervalMs = 30_000 }: RelativeTimeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  if (!epochSeconds) return <span>—</span>;

  return (
    <time
      dateTime={new Date(epochSeconds * 1000).toISOString()}
      title={formatAbsoluteTime(epochSeconds)}
    >
      {formatRelativeTime(epochSeconds, now)}
    </time>
  );
}
