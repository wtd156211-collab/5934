import { describe, expect, it } from 'vitest';
import { parseTrace, extractSpans, DEFAULT_MAX_SPANS } from './traceModel';
import { msSpan } from '../test/helpers';

describe('parseTrace', () => {
  it('parses OTLP nanosecond timestamps and nested-resource documents', () => {
    const trace = parseTrace({
      resourceSpans: [{ scopeSpans: [{ spans: [msSpan('a', 1_700_000_000_000, 1_700_000_000_500)] }] }],
    });
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].durationMs).toBeCloseTo(500, 5);
  });

  it('normalizes OTLP attribute arrays and status code 2 to ERROR with message', () => {
    const trace = parseTrace([
      msSpan('err', 0, 10, undefined, {
        status: { code: 2, message: 'boom' },
        attributes: [{ key: 'error.kind', value: { stringValue: 'IOError' } }],
      }),
    ]);
    const span = trace.spans[0];
    expect(span.isError).toBe(true);
    expect(span.errorMessage).toBe('boom');
    expect(span.attributes['error.kind']).toBe('IOError');
  });

  it('detects timeout via timeout attribute and HTTP 504', () => {
    const trace = parseTrace([
      msSpan('t1', 0, 10, undefined, { attributes: [{ key: 'timeout', value: { stringValue: 'true' } }] }),
      msSpan('t2', 20, 30, undefined, { attributes: { 'http.status_code': 504 } }),
    ]);
    expect(trace.spans.map((s) => s.isTimeout)).toEqual([true, true]);
  });

  it('flags missing parents but still keeps the span', () => {
    const trace = parseTrace([msSpan('child', 0, 10, 'ghost')]);
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].missingParent).toBe(true);
    expect(trace.spans[0].warnings.join(' ')).toContain('missing');
  });

  it('degrades invalid time ranges (end before start) to zero duration', () => {
    const trace = parseTrace([msSpan('bad', 500, 400)]);
    const span = trace.spans[0];
    expect(span.durationMs).toBe(0);
    expect(span.startMs).toBe(500);
    expect(span.endMs).toBe(500);
    expect(span.warnings.join(' ')).toContain('Invalid time range');
  });

  it('handles missing timestamps without throwing', () => {
    const trace = parseTrace([{ spanId: 'no-time', name: 'x' } as never]);
    expect(trace.spans[0].durationMs).toBe(0);
    expect(trace.spans[0].warnings).toHaveLength(2);
  });

  it('skips spans without spanId and ignores duplicates', () => {
    const trace = parseTrace([msSpan('dup', 0, 5), msSpan('dup', 6, 9), { name: 'no-id' } as never]);
    expect(trace.spans).toHaveLength(1);
    expect(trace.warnings.some((w) => w.includes('Duplicate'))).toBe(true);
    expect(trace.warnings.some((w) => w.includes('spanId'))).toBe(true);
  });

  it('truncates when span count exceeds the configured limit', () => {
    const spans = Array.from({ length: DEFAULT_MAX_SPANS + 5 }, (_, i) => msSpan(`s${i}`, i, i + 1));
    const trace = parseTrace(spans, 100);
    expect(trace.spans).toHaveLength(100);
    expect(trace.truncated).toBe(true);
    expect(trace.warnings.join(' ')).toContain('more than 100');
  });

  it('extracts spans from OTLP and { spans } wrapper shapes', () => {
    expect(extractSpans({ spans: [msSpan('a', 0, 1)] })).toHaveLength(1);
    expect(extractSpans([msSpan('a', 0, 1)])).toHaveLength(1);
    expect(extractSpans({ resourceSpans: [] })).toHaveLength(0);
    expect(extractSpans(null)).toHaveLength(0);
  });

  it('parses span events with relative timestamps', () => {
    const trace = parseTrace([
      msSpan('e', 0, 100, undefined, {
        events: [{ name: 'exception', timeUnixNano: 50, attributes: {} }],
      }),
    ]);
    expect(trace.spans[0].events).toEqual([
      { name: 'exception', timeMs: 50, attributes: {} },
    ]);
  });
});
