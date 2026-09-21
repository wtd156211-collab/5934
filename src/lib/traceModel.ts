/**
 * OTel-compatible trace data model.
 *
 * The parser accepts either:
 *  - a flat array of OTLP-like span objects
 *  - an OTLP JSON document ({ resourceSpans: [{ scopeSpans: [{ spans: [] }] }] })
 *  - a wrapper object ({ traceId, spans: [] })
 *
 * Raw time fields follow OTLP naming (startTimeUnixNano / endTimeUnixNano) and may be
 * big numbers as strings. Both attribute encodings used in the wild are accepted:
 * OTLP arrays of { key, value: { stringValue | boolValue | intValue | doubleValue } }
 * and plain JSON objects.
 */

export const DEFAULT_MAX_SPANS = 2000;

export interface RawSpan {
  traceId?: unknown;
  spanId?: unknown;
  parentSpanId?: unknown;
  name?: unknown;
  kind?: unknown;
  startTimeUnixNano?: unknown;
  endTimeUnixNano?: unknown;
  status?: unknown;
  attributes?: unknown;
  events?: unknown;
}

export type SpanStatus = 'UNSET' | 'OK' | 'ERROR';

export interface SpanEvent {
  name: string;
  timeMs?: number;
  attributes: Record<string, unknown>;
}

export interface NormalizedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: SpanStatus;
  isError: boolean;
  isTimeout: boolean;
  errorMessage?: string;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  /** Per-span data-quality problems (e.g. invalid time range). */
  warnings: string[];
  /** Set when this span references a parent that does not exist in the trace. */
  missingParent?: boolean;
}

export interface TraceModel {
  traceId: string;
  spans: NormalizedSpan[];
  /** Trace-level data-quality problems, rendered as a non-fatal banner. */
  warnings: string[];
  truncated: boolean;
  startMs: number;
  endMs: number;
  durationMs: number;
}

interface RawEvent {
  name?: unknown;
  timeUnixNano?: unknown;
  attributes?: unknown;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return undefined;
}

/** OTLP timestamps are nanosecond integers; ms values are passed through unchanged. */
function timestampToMs(value: unknown): number | undefined {
  const n = toFiniteNumber(value);
  if (n === undefined) return undefined;
  // Heuristic: >= 1e15 means nanosecond epoch (year 2001+); otherwise treat as ms.
  return Math.abs(n) >= 1e15 ? n / 1e6 : n;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function otlpValueToPrimitive(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.intValue !== undefined) return toFiniteNumber(v.intValue);
  if (v.doubleValue !== undefined) return toFiniteNumber(v.doubleValue);
  if (v.arrayValue !== undefined) return v.arrayValue;
  return value;
}

export function parseAttributes(raw: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') continue;
      const key = (entry as Record<string, unknown>).key;
      if (typeof key !== 'string') continue;
      result[key] = otlpValueToPrimitive((entry as Record<string, unknown>).value);
    }
  } else if (raw !== null && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      result[key] = value;
    }
  }
  return result;
}

function normalizeStatusCode(rawStatus: unknown, attributes: Record<string, unknown>): SpanStatus {
  if (rawStatus !== null && typeof rawStatus === 'object') {
    const code = (rawStatus as Record<string, unknown>).code;
    if (code === 2 || code === '2' || code === 'ERROR') return 'ERROR';
    if (code === 1 || code === '1' || code === 'OK') return 'OK';
  }
  // Fall back to common framework attributes when status is absent.
  if (attributes['http.status_code'] !== undefined) {
    const httpCode = toFiniteNumber(attributes['http.status_code']);
    if (httpCode !== undefined && httpCode >= 500) return 'ERROR';
  }
  if (attributes['error'] === true || attributes['error.kind'] !== undefined) return 'ERROR';
  return 'UNSET';
}

function statusMessage(rawStatus: unknown, attributes: Record<string, unknown>): string | undefined {
  if (rawStatus !== null && typeof rawStatus === 'object') {
    const message = (rawStatus as Record<string, unknown>).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  const errMsg = attributes['error.message'];
  if (typeof errMsg === 'string' && errMsg !== '') return errMsg;
  const exception = Array.isArray(attributes['exception.message']) ? undefined : attributes['exception.message'];
  if (typeof exception === 'string' && exception !== '') return exception;
  return undefined;
}

function isTruthyAttr(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value === 'true' || value.toLowerCase() === 'timeout';
  return false;
}

function parseEvents(raw: unknown): SpanEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: SpanEvent[] = [];
  for (const item of raw as RawEvent[]) {
    if (item === null || typeof item !== 'object') continue;
    const name = asString(item.name) ?? 'event';
    const timeMs = timestampToMs(item.timeUnixNano);
    events.push({ name, timeMs, attributes: parseAttributes(item.attributes) });
  }
  return events;
}

export function extractSpans(input: unknown): RawSpan[] {
  if (Array.isArray(input)) return input as RawSpan[];
  if (input !== null && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.spans)) return obj.spans as RawSpan[];
    if (Array.isArray(obj.resourceSpans)) {
      const spans: RawSpan[] = [];
      for (const resource of obj.resourceSpans as Record<string, unknown>[]) {
        const scopeSpans = resource?.scopeSpans;
        if (!Array.isArray(scopeSpans)) continue;
        for (const scope of scopeSpans as Record<string, unknown>[]) {
          if (Array.isArray(scope?.spans)) spans.push(...(scope.spans as RawSpan[]));
        }
      }
      return spans;
    }
  }
  return [];
}

export function parseTrace(input: unknown, maxSpans: number = DEFAULT_MAX_SPANS): TraceModel {
  const rawSpans = extractSpans(input);
  const warnings: string[] = [];
  const spans: NormalizedSpan[] = [];
  const seenIds = new Set<string>();
  let traceId = '';
  let truncated = false;

  rawSpans.forEach((raw, index) => {
    if (spans.length >= maxSpans) {
      truncated = true;
      return;
    }
    const spanId = asString(raw?.spanId);
    if (!spanId) {
      warnings.push(`Span #${index} is missing spanId and was skipped.`);
      return;
    }
    if (seenIds.has(spanId)) {
      warnings.push(`Duplicate spanId "${spanId}" was ignored; the first occurrence is kept.`);
      return;
    }
    seenIds.add(spanId);

    const rawTraceId = asString(raw?.traceId);
    if (rawTraceId) traceId = rawTraceId;

    const spanWarnings: string[] = [];
    let startMs = timestampToMs(raw?.startTimeUnixNano);
    let endMs = timestampToMs(raw?.endTimeUnixNano);

    if (startMs === undefined) {
      startMs = 0;
      spanWarnings.push('Missing or invalid start time; rendered at the trace origin.');
    }
    if (endMs === undefined) {
      endMs = startMs;
      spanWarnings.push('Missing or invalid end time; rendered with zero duration.');
    }
    if (endMs < startMs) {
      spanWarnings.push(`Invalid time range: end time (${endMs}) is before start time (${startMs}); duration clamped to 0.`);
      endMs = startMs;
    }

    const attributes = parseAttributes(raw?.attributes);
    const status = normalizeStatusCode(raw?.status, attributes);
    const isError = status === 'ERROR';
    const isTimeout =
      isTruthyAttr(attributes['timeout']) ||
      isTruthyAttr(attributes['span.timeout']) ||
      attributes['http.response.status_code'] === 504 ||
      attributes['http.status_code'] === 504;
    const errorMessage = isError ? statusMessage(raw?.status, attributes) : undefined;
    const parentSpanId = asString(raw?.parentSpanId);

    spans.push({
      traceId: rawTraceId ?? '',
      spanId,
      parentSpanId: parentSpanId || undefined,
      name: asString(raw?.name) ?? '(unnamed span)',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      status,
      isError,
      isTimeout,
      errorMessage,
      attributes,
      events: parseEvents(raw?.events),
      warnings: spanWarnings,
    });
  });

  if (truncated) {
    warnings.push(
      `Trace contains more than ${maxSpans} spans; only the first ${maxSpans} are rendered. Increase the limit explicitly if the environment can handle more.`,
    );
  }

  // Flag missing parents (a span whose parent id is not present in the trace).
  for (const span of spans) {
    if (span.parentSpanId && !seenIds.has(span.parentSpanId)) {
      span.missingParent = true;
      span.warnings.push(`Parent span "${span.parentSpanId}" is missing from this trace; attached to the trace root.`);
    }
  }

  const startMs = spans.length ? Math.min(...spans.map((s) => s.startMs)) : 0;
  const endMs = spans.length ? Math.max(...spans.map((s) => s.endMs)) : 0;

  return {
    traceId,
    spans,
    warnings,
    truncated,
    startMs,
    endMs,
    durationMs: endMs > startMs ? endMs - startMs : 1,
  };
}
