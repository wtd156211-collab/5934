import { Trace, TraceSummary } from '../shared/trace';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function fetchTraces(): Promise<TraceSummary[]> {
  return getJson<TraceSummary[]>('/api/traces');
}

export function fetchTrace(traceId: string): Promise<Trace> {
  return getJson<Trace>(`/api/traces/${encodeURIComponent(traceId)}`);
}
