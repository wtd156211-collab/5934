import { describe, expect, it } from 'vitest';
import { buildLayout, clampView, zoomView, axisTicks } from './layout';
import { parse } from '../test/helpers';
import { msSpan } from '../test/helpers';

function layoutOf(spans: ReturnType<typeof msSpan>[], collapsed: string[] = []) {
  const trace = parse(spans);
  return { trace, layout: buildLayout(trace, new Set(collapsed)) };
}

describe('buildLayout - serial calls', () => {
  it('orders siblings by start time', () => {
    const { layout } = layoutOf([
      msSpan('root', 0, 1000),
      msSpan('b', 300, 500, 'root'),
      msSpan('a', 100, 200, 'root'),
    ]);
    expect(layout.rows.map((r) => r.span.spanId)).toEqual(['root', 'a', 'b']);
    expect(layout.rows.map((r) => r.depth)).toEqual([0, 1, 1]);
  });
});

describe('buildLayout - nested calls', () => {
  it('assigns increasing depths and supports collapse', () => {
    const spans = [
      msSpan('root', 0, 1000),
      msSpan('child', 100, 800, 'root'),
      msSpan('grand', 200, 300, 'child'),
    ];
    const expanded = layoutOf(spans).layout;
    expect(expanded.rows.map((r) => r.depth)).toEqual([0, 1, 2]);

    const collapsed = layoutOf(spans, ['root']).layout;
    expect(collapsed.rows.map((r) => r.span.spanId)).toEqual(['root']);
  });

  it('marks hasChildren correctly', () => {
    const { layout } = layoutOf([msSpan('root', 0, 10), msSpan('child', 1, 2, 'root')]);
    expect(layout.rows[0].hasChildren).toBe(true);
    expect(layout.rows[1].hasChildren).toBe(false);
  });
});

describe('buildLayout - parallel calls', () => {
  it('keeps overlapping siblings at the same depth', () => {
    const { layout } = layoutOf([
      msSpan('root', 0, 1000),
      msSpan('p1', 100, 900, 'root'),
      msSpan('p2', 200, 800, 'root'),
      msSpan('p3', 300, 700, 'root'),
    ]);
    const parallel = layout.rows.filter((r) => ['p1', 'p2', 'p3'].includes(r.span.spanId));
    expect(parallel.every((r) => r.depth === 1)).toBe(true);
  });

  it('positions overlapping spans at distinct time positions', () => {
    const { trace, layout } = layoutOf([
      msSpan('root', 0, 1000),
      msSpan('p1', 100, 600, 'root'),
      msSpan('p2', 500, 900, 'root'),
    ]);
    const byId = new Map(layout.rows.map((r) => [r.span.spanId, r.span]));
    const span = trace.endMs - trace.startMs;
    const x1 = ((byId.get('p1')!.startMs - trace.startMs) / span);
    const x2 = ((byId.get('p2')!.startMs - trace.startMs) / span);
    expect(x1).toBeCloseTo(0.1, 5);
    expect(x2).toBeCloseTo(0.5, 5);
    expect(x2).toBeGreaterThan(x1);
  });
});

describe('buildLayout - missing parents and anomalies', () => {
  it('attaches orphan spans as roots and keeps valid children', () => {
    const { layout } = layoutOf([
      msSpan('orphan', 50, 60, 'ghost'),
      msSpan('root', 0, 1000),
      msSpan('child', 10, 20, 'root'),
    ]);
    expect(layout.rootIds).toContain('orphan');
    expect(layout.rootIds).toContain('root');
    // Orphan sorted by start time: root (0) then orphan (50); child follows root.
    expect(layout.rows.map((r) => r.span.spanId)).toEqual(['root', 'child', 'orphan']);
  });

  it('breaks parent cycles without infinite recursion', () => {
    const { layout } = layoutOf([
      msSpan('a', 0, 10, 'b'),
      msSpan('b', 0, 10, 'a'),
    ]);
    expect(layout.rows).toHaveLength(2);
    expect(layout.warnings.some((w) => w.includes('Cycle'))).toBe(true);
  });

  it('handles out-of-order spans by start time regardless of input order', () => {
    const { layout } = layoutOf([
      msSpan('late', 800, 900, 'root'),
      msSpan('root', 0, 1000),
      msSpan('early', 100, 200, 'root'),
    ]);
    expect(layout.rows.map((r) => r.span.spanId)).toEqual(['root', 'early', 'late']);
  });
});

describe('view window math', () => {
  it('clamps views inside the trace range', () => {
    expect(clampView({ startMs: 500, endMs: 1500 }, 0, 1000)).toEqual({ startMs: 500, endMs: 1000 });
    expect(clampView({ startMs: -50, endMs: 50 }, 0, 1000)).toEqual({ startMs: 0, endMs: 50 });
  });

  it('zooms in around the center and back out', () => {
    const zoomed = zoomView({ startMs: 0, endMs: 1000 }, 0.5, 0, 1000);
    expect(zoomed.endMs - zoomed.startMs).toBeCloseTo(500, 6);
    const back = zoomView(zoomed, 2, 0, 1000);
    expect(back.endMs - back.startMs).toBeCloseTo(1000, 6);
  });

  it('never produces an empty or invalid window', () => {
    const tiny = zoomView({ startMs: 0, endMs: 1000 }, 0.0001, 0, 1000);
    expect(tiny.endMs).toBeGreaterThan(tiny.startMs);
    const reset = clampView({ startMs: 100, endMs: 100 }, 0, 1000);
    expect(reset).toEqual({ startMs: 0, endMs: 1000 });
  });

  it('produces ordered axis ticks inside the view', () => {
    const ticks = axisTicks({ startMs: 0, endMs: 1000 }, 5);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(1000);
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });
});
