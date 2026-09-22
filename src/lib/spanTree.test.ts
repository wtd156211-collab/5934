import { describe, expect, it } from 'vitest';
import { MAX_SPANS_PER_TRACE, Span } from '../../shared/trace';
import {
  buildTraceModel,
  collapsibleIds,
  flattenVisibleRows,
} from './spanTree';

const MS = 1_000_000;
let seq = 0;

function makeSpan(overrides: Partial<Span> & { spanId?: string } = {}): Span {
  seq += 1;
  return {
    traceId: 'trace-test',
    spanId: overrides.spanId ?? `span-${seq}`,
    name: overrides.name ?? `op-${seq}`,
    serviceName: 'svc',
    startTimeUnixNano: 1_000 * MS,
    endTimeUnixNano: 1_100 * MS,
    status: { code: 'OK' },
    ...overrides,
  };
}

describe('serial calls', () => {
  it('lays out a serial chain with correct nesting and time bounds', () => {
    const root = makeSpan({ spanId: 'a', name: 'root', startTimeUnixNano: 0, endTimeUnixNano: 300 * MS });
    const child = makeSpan({ spanId: 'b', parentSpanId: 'a', startTimeUnixNano: 10 * MS, endTimeUnixNano: 120 * MS });
    const grandchild = makeSpan({ spanId: 'c', parentSpanId: 'b', startTimeUnixNano: 130 * MS, endTimeUnixNano: 250 * MS });
    const model = buildTraceModel([root, child, grandchild]);

    expect(model.anomalies).toHaveLength(0);
    expect(model.roots).toHaveLength(1);
    expect(model.roots[0].children[0].children[0].span.spanId).toBe('c');
    expect(model.roots[0].children[0].children[0].depth).toBe(2);
    expect(model.minStartNano).toBe(0);
    expect(model.maxEndNano).toBe(300 * MS);

    const rows = flattenVisibleRows(model.roots, new Set());
    expect(rows.map((r) => r.node.span.spanId)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.node.depth)).toEqual([0, 1, 2]);
  });
});

describe('nested spans', () => {
  it('nests children inside parent time ranges and orders siblings by start time', () => {
    const root = makeSpan({ spanId: 'root', startTimeUnixNano: 0, endTimeUnixNano: 500 * MS });
    const late = makeSpan({ spanId: 'late', parentSpanId: 'root', startTimeUnixNano: 300 * MS, endTimeUnixNano: 400 * MS });
    const early = makeSpan({ spanId: 'early', parentSpanId: 'root', startTimeUnixNano: 50 * MS, endTimeUnixNano: 150 * MS });
    const model = buildTraceModel([root, late, early]);
    expect(model.roots[0].children.map((n) => n.span.spanId)).toEqual(['early', 'late']);
  });
});

describe('parallel spans', () => {
  it('keeps overlapping siblings as separate rows at the same depth', () => {
    const root = makeSpan({ spanId: 'root', startTimeUnixNano: 0, endTimeUnixNano: 300 * MS });
    const p1 = makeSpan({ spanId: 'p1', parentSpanId: 'root', startTimeUnixNano: 20 * MS, endTimeUnixNano: 200 * MS });
    const p2 = makeSpan({ spanId: 'p2', parentSpanId: 'root', startTimeUnixNano: 30 * MS, endTimeUnixNano: 250 * MS });
    const p3 = makeSpan({ spanId: 'p3', parentSpanId: 'root', startTimeUnixNano: 40 * MS, endTimeUnixNano: 120 * MS });
    const model = buildTraceModel([root, p1, p2, p3]);
    const rows = flattenVisibleRows(model.roots, new Set());
    expect(rows).toHaveLength(4);
    expect(rows.slice(1).map((r) => r.node.depth)).toEqual([1, 1, 1]);
    // Overlapping time ranges must not be merged or reordered away.
    expect(rows.slice(1).map((r) => r.node.span.spanId)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('error and timeout spans', () => {
  it('flags error spans via status code', () => {
    const bad = makeSpan({ spanId: 'bad', status: { code: 'ERROR', message: 'boom' } });
    const model = buildTraceModel([bad]);
    expect(model.roots[0].error).toBe(true);
    expect(model.roots[0].timeout).toBe(false);
  });

  it('flags timeout spans via attribute or status message', () => {
    const byAttr = makeSpan({ spanId: 't1', attributes: { timeout: true } });
    const byMessage = makeSpan({
      spanId: 't2',
      status: { code: 'ERROR', message: 'upstream timeout after 500ms' },
    });
    const model = buildTraceModel([byAttr, byMessage]);
    expect(model.roots.find((n) => n.span.spanId === 't1')?.timeout).toBe(true);
    expect(model.roots.find((n) => n.span.spanId === 't2')?.timeout).toBe(true);
  });
});

describe('missing parent spans', () => {
  it('attaches orphans at root level with a MISSING_PARENT anomaly', () => {
    const root = makeSpan({ spanId: 'root', startTimeUnixNano: 0, endTimeUnixNano: 100 * MS });
    const orphan = makeSpan({
      spanId: 'orphan',
      parentSpanId: 'does-not-exist',
      startTimeUnixNano: 10 * MS,
      endTimeUnixNano: 50 * MS,
    });
    const model = buildTraceModel([root, orphan]);
    expect(model.roots.map((n) => n.span.spanId)).toEqual(['root', 'orphan']);
    expect(model.roots[1].depth).toBe(0);
    const anomaly = model.anomalies.find((a) => a.type === 'MISSING_PARENT');
    expect(anomaly?.spanId).toBe('orphan');
  });

  it('keeps orphan subtrees intact under the orphan', () => {
    const orphan = makeSpan({ spanId: 'orphan', parentSpanId: 'gone', startTimeUnixNano: 0, endTimeUnixNano: 100 * MS });
    const child = makeSpan({ spanId: 'child', parentSpanId: 'orphan', startTimeUnixNano: 10 * MS, endTimeUnixNano: 40 * MS });
    const model = buildTraceModel([orphan, child]);
    expect(model.roots).toHaveLength(1);
    expect(model.roots[0].children[0].span.spanId).toBe('child');
    expect(model.roots[0].children[0].depth).toBe(1);
  });
});

describe('invalid time ranges', () => {
  it('clamps inverted ranges and flags an anomaly instead of crashing', () => {
    const inverted = makeSpan({ spanId: 'inv', startTimeUnixNano: 300 * MS, endTimeUnixNano: 100 * MS });
    const model = buildTraceModel([inverted]);
    const node = model.roots[0];
    expect(node.timeClamped).toBe(true);
    expect(node.span.startTimeUnixNano).toBe(100 * MS);
    expect(node.span.endTimeUnixNano).toBe(300 * MS);
    expect(model.anomalies.some((a) => a.type === 'INVALID_TIME_RANGE')).toBe(true);
  });

  it('handles NaN / missing timestamps with a fallback duration', () => {
    const broken = makeSpan({ spanId: 'nan', startTimeUnixNano: NaN, endTimeUnixNano: NaN });
    const model = buildTraceModel([broken]);
    const node = model.roots[0];
    expect(node.timeClamped).toBe(true);
    expect(Number.isFinite(node.span.startTimeUnixNano)).toBe(true);
    expect(node.span.endTimeUnixNano).toBeGreaterThan(node.span.startTimeUnixNano);
  });

  it('expands zero-length spans to a minimal visible duration', () => {
    const zero = makeSpan({ spanId: 'zero', startTimeUnixNano: 50 * MS, endTimeUnixNano: 50 * MS });
    const model = buildTraceModel([zero]);
    expect(model.roots[0].span.endTimeUnixNano).toBeGreaterThan(50 * MS);
  });
});

describe('out-of-order delivery', () => {
  it('sorts rows by start time regardless of input order', () => {
    const a = makeSpan({ spanId: 'a', startTimeUnixNano: 0, endTimeUnixNano: 10 * MS });
    const b = makeSpan({ spanId: 'b', startTimeUnixNano: 20 * MS, endTimeUnixNano: 30 * MS });
    const c = makeSpan({ spanId: 'c', startTimeUnixNano: 40 * MS, endTimeUnixNano: 50 * MS });
    const model = buildTraceModel([c, a, b]);
    const rows = flattenVisibleRows(model.roots, new Set());
    expect(rows.map((r) => r.node.span.spanId)).toEqual(['a', 'b', 'c']);
  });
});

describe('collapse / expand', () => {
  it('hides descendant rows for collapsed nodes', () => {
    const root = makeSpan({ spanId: 'root', startTimeUnixNano: 0, endTimeUnixNano: 300 * MS });
    const child = makeSpan({ spanId: 'child', parentSpanId: 'root', startTimeUnixNano: 10 * MS, endTimeUnixNano: 100 * MS });
    const grandchild = makeSpan({ spanId: 'gc', parentSpanId: 'child', startTimeUnixNano: 20 * MS, endTimeUnixNano: 50 * MS });
    const model = buildTraceModel([root, child, grandchild]);

    expect(flattenVisibleRows(model.roots, new Set())).toHaveLength(3);
    const collapsedRows = flattenVisibleRows(model.roots, new Set(['child']));
    expect(collapsedRows.map((r) => r.node.span.spanId)).toEqual(['root', 'child']);
    expect(collapsedRows[1].collapsed).toBe(true);
    expect(collapsibleIds(model.roots)).toEqual(['root', 'child']);
  });
});

describe('span limit', () => {
  it('truncates traces beyond MAX_SPANS_PER_TRACE with an anomaly note', () => {
    const spans = Array.from({ length: MAX_SPANS_PER_TRACE + 10 }, () => makeSpan());
    const model = buildTraceModel(spans);
    expect(model.truncated).toBe(true);
    expect(model.roots).toHaveLength(MAX_SPANS_PER_TRACE);
    expect(model.anomalies.some((a) => a.type === 'SPAN_LIMIT_EXCEEDED')).toBe(true);
  });
});

describe('duplicate span ids', () => {
  it('keeps the first occurrence and flags the duplicate', () => {
    const first = makeSpan({ spanId: 'dup', name: 'first' });
    const second = makeSpan({ spanId: 'dup', name: 'second' });
    const model = buildTraceModel([first, second]);
    expect(model.roots).toHaveLength(1);
    expect(model.roots[0].span.name).toBe('first');
    expect(model.anomalies.some((a) => a.type === 'DUPLICATE_SPAN_ID')).toBe(true);
  });
});
