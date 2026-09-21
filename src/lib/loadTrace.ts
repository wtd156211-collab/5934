import { parseTrace, DEFAULT_MAX_SPANS, type TraceModel } from './traceModel';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; trace: TraceModel }
  | { status: 'error'; message: string };

/**
 * Loads a trace over HTTP and parses it through the same normalization pipeline
 * used by tests. No trace data is bundled into the UI bundle.
 */
export async function fetchTrace(
  url: string = '/api/trace',
  fetchImpl: typeof fetch = fetch,
): Promise<TraceModel> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Failed to load trace: HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error('Trace response was not valid JSON.');
  }
  const trace = parseTrace(json, DEFAULT_MAX_SPANS);
  if (trace.spans.length === 0) {
    throw new Error('The response did not contain any recognizable spans.');
  }
  return trace;
}
