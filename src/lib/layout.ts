import type { NormalizedSpan, TraceModel } from './traceModel';

export interface WaterfallRow {
  span: NormalizedSpan;
  depth: number;
  hasChildren: boolean;
}

export interface WaterfallLayout {
  rows: WaterfallRow[];
  /** ids of spans that are treated as roots (missing parents or cycles included). */
  rootIds: string[];
  warnings: string[];
}

interface SpanNode {
  span: NormalizedSpan;
  children: SpanNode[];
}

/**
 * Builds a depth-first ordered row list. Out-of-order spans are handled because
 * ordering only depends on parent/child ids; children are sorted by start time
 * (with spanId as a stable tie breaker).
 */
export function buildLayout(trace: TraceModel, collapsedIds: ReadonlySet<string>): WaterfallLayout {
  const warnings = [...trace.warnings];
  const byId = new Map<string, SpanNode>();
  for (const span of trace.spans) {
    byId.set(span.spanId, { span, children: [] });
  }

  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      // Missing parent: degrade by attaching to root. Span already carries a warning.
      roots.push(node);
      continue;
    }
    // Cycle guard: if parent chain reaches this span, detach as root.
    if (createsCycle(node.span.spanId, parentId, byId)) {
      warnings.push(`Cycle detected at span "${node.span.spanId}"; attached to the trace root.`);
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const byStartThenId = (a: SpanNode, b: SpanNode) =>
    a.span.startMs - b.span.startMs || (a.span.spanId < b.span.spanId ? -1 : a.span.spanId > b.span.spanId ? 1 : 0);
  roots.sort(byStartThenId);
  for (const node of byId.values()) node.children.sort(byStartThenId);

  // Surface per-span data-quality problems (invalid times, missing parents) in the banner.
  for (const node of byId.values()) {
    for (const warning of node.span.warnings) {
      warnings.push(`Span "${node.span.name}" (${node.span.spanId}): ${warning}`);
    }
  }

  const rows: WaterfallRow[] = [];
  const walk = (node: SpanNode, depth: number) => {
    rows.push({ span: node.span, depth, hasChildren: node.children.length > 0 });
    if (!collapsedIds.has(node.span.spanId)) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);

  return { rows, rootIds: roots.map((r) => r.span.spanId), warnings };
}

function createsCycle(spanId: string, parentId: string, byId: Map<string, SpanNode>): boolean {
  let currentId: string | undefined = parentId;
  const visited = new Set<string>();
  while (currentId !== undefined) {
    if (currentId === spanId) return true;
    if (visited.has(currentId)) return false; // upstream already broken/rooted
    visited.add(currentId);
    const node = byId.get(currentId);
    currentId = node?.span.parentSpanId && byId.has(node.span.parentSpanId as string)
      ? (node.span.parentSpanId as string)
      : undefined;
  }
  return false;
}

export interface ViewWindow {
  startMs: number;
  endMs: number;
}

export function clampView(view: ViewWindow, traceStart: number, traceEnd: number): ViewWindow {
  const span = view.endMs - view.startMs;
  if (span <= 0 || !Number.isFinite(span)) return { startMs: traceStart, endMs: traceEnd };
  return {
    startMs: Math.max(traceStart, Math.min(view.startMs, traceEnd)),
    endMs: Math.min(traceEnd, Math.max(view.endMs, traceStart)),
  };
}

export function zoomView(
  view: ViewWindow,
  factor: number,
  traceStart: number,
  traceEnd: number,
  centerMs?: number,
): ViewWindow {
  const currentSpan = view.endMs - view.startMs;
  const nextSpan = Math.min(traceEnd - traceStart, Math.max(1, currentSpan * factor));
  const center = centerMs ?? (view.startMs + view.endMs) / 2;
  const clampedCenter = Math.max(view.startMs, Math.min(view.endMs, center));
  const ratio = currentSpan > 0 ? (clampedCenter - view.startMs) / currentSpan : 0.5;
  return clampView(
    { startMs: clampedCenter - nextSpan * ratio, endMs: clampedCenter + nextSpan * (1 - ratio) },
    traceStart,
    traceEnd,
  );
}

/** "Nice" time-axis ticks for the currently visible window. */
export function axisTicks(view: ViewWindow, count: number = 10): number[] {
  const span = view.endMs - view.startMs;
  if (span <= 0 || count <= 0) return [view.startMs];
  const rough = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / pow;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let t = Math.ceil(view.startMs / niceStep) * niceStep; t <= view.endMs; t += niceStep) {
    ticks.push(Number(t.toFixed(6)));
    if (ticks.length > count * 2) break;
  }
  return ticks;
}
