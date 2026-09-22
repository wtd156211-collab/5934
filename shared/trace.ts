/**
 * Trace data model, aligned with OpenTelemetry Span fields so that real
 * OTel-exported spans (e.g. OTLP/JSON) can be adapted with minimal mapping.
 */

export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

export type SpanAttributeValue = string | number | boolean;

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  serviceName: string;
  kind?: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  /** Nanoseconds since Unix epoch. */
  startTimeUnixNano: number;
  /** Nanoseconds since Unix epoch. */
  endTimeUnixNano: number;
  status: SpanStatus;
  attributes?: Record<string, SpanAttributeValue>;
}

export interface Trace {
  traceId: string;
  spans: Span[];
}

export interface TraceSummary {
  traceId: string;
  rootName: string;
  spanCount: number;
  errorCount: number;
  startTimeUnixNano: number;
  durationNano: number;
}

/** Hard cap on spans rendered for a single trace to keep the UI stable. */
export const MAX_SPANS_PER_TRACE = 2000;

export function isErrorSpan(span: Span): boolean {
  return span.status.code === 'ERROR' || span.attributes?.['error'] === true;
}

export function isTimeoutSpan(span: Span): boolean {
  if (span.attributes?.['timeout'] === true) return true;
  const msg = span.status.message?.toLowerCase() ?? '';
  return msg.includes('timeout') || msg.includes('deadline exceeded');
}

export function spanDurationNano(span: Span): number {
  return span.endTimeUnixNano - span.startTimeUnixNano;
}
