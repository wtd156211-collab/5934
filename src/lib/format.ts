/** Duration formatting used by the waterfall and detail panel. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms === 0) return '0 ms';
  const abs = Math.abs(ms);
  if (abs < 1) return `${round(ms * 1000)} µs`;
  if (abs < 1000) return `${round(ms)} ms`;
  return `${round(ms / 1000, 2)} s`;
}

/** Offset relative to trace start, e.g. for absolute timestamps. */
export function formatOffset(ms: number): string {
  return formatDuration(ms);
}

export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString();
}

function round(n: number, digits: number = 1): number {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}
