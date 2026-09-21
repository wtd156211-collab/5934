import { parseTrace, type RawSpan } from '../lib/traceModel';

export function makeSpan(overrides: Partial<RawSpan> & Pick<RawSpan, 'spanId'>): RawSpan {
  return {
    traceId: 't-1',
    name: `span-${overrides.spanId}`,
    startTimeUnixNano: 100,
    endTimeUnixNano: 200,
    ...overrides,
  };
}

export function parse(spans: RawSpan[], maxSpans?: number) {
  return parseTrace(spans, maxSpans);
}

export function msSpan(
  spanId: string,
  startMs: number,
  endMs: number,
  parentSpanId?: string,
  extra: Partial<RawSpan> = {},
): RawSpan {
  return makeSpan({ spanId, parentSpanId, startTimeUnixNano: startMs, endTimeUnixNano: endMs, ...extra });
}
