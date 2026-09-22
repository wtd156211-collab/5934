const MS = 1_000_000;

export function formatDuration(nano: number): string {
  if (nano < 1_000) return `${nano}ns`;
  if (nano < MS) return `${(nano / 1_000).toFixed(1)}µs`;
  if (nano < 1_000 * MS) return `${(nano / MS).toFixed(1)}ms`;
  return `${(nano / (1_000 * MS)).toFixed(2)}s`;
}

export function formatTimeOfDay(nano: number): string {
  return new Date(nano / MS).toLocaleTimeString(undefined, { hour12: false });
}

export function formatTimestamp(nano: number): string {
  return new Date(nano / MS).toLocaleString(undefined, { hour12: false });
}
