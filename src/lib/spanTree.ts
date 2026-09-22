import {
  MAX_SPANS_PER_TRACE,
  Span,
  isErrorSpan,
  isTimeoutSpan,
} from '../../shared/trace';

export type AnomalyType =
  | 'MISSING_PARENT'
  | 'INVALID_TIME_RANGE'
  | 'DUPLICATE_SPAN_ID'
  | 'SPAN_LIMIT_EXCEEDED';

export interface TraceAnomaly {
  type: AnomalyType;
  spanId?: string;
  message: string;
}

export interface SpanNode {
  span: Span;
  depth: number;
  children: SpanNode[];
  /** True when the recorded time range was invalid and had to be clamped. */
  timeClamped: boolean;
  error: boolean;
  timeout: boolean;
}

export interface WaterfallRow {
  node: SpanNode;
  /** Visible row index in the flattened, collapse-aware list. */
  index: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export interface TraceModel {
  roots: SpanNode[];
  anomalies: TraceAnomaly[];
  minStartNano: number;
  maxEndNano: number;
  totalSpans: number;
  truncated: boolean;
}

const FALLBACK_DURATION_NANO = 1_000_000; // 1ms fallback for invalid ranges

/**
 * Clamp an invalid time range (missing / inverted / zero-length timestamps)
 * so downstream layout math never sees NaN or negative durations.
 */
function normalizeTimes(span: Span, anomalies: TraceAnomaly[]): { start: number; end: number; clamped: boolean } {
  let { startTimeUnixNano: start, endTimeUnixNano: end } = span;
  let clamped = false;
  const valid = (v: number) => Number.isFinite(v) && v >= 0;
  if (!valid(start)) {
    start = valid(end) ? end - FALLBACK_DURATION_NANO : 0;
    clamped = true;
  }
  if (!valid(end)) {
    end = start + FALLBACK_DURATION_NANO;
    clamped = true;
  }
  if (end < start) {
    [start, end] = [end, start];
    clamped = true;
  }
  if (end === start) {
    end = start + FALLBACK_DURATION_NANO;
    clamped = true;
  }
  if (clamped) {
    anomalies.push({
      type: 'INVALID_TIME_RANGE',
      spanId: span.spanId,
      message: `Span "${span.name}" (${span.spanId}) has an invalid time range and was clamped for display.`,
    });
  }
  return { start, end, clamped };
}

/**
 * Build a forest of span nodes from a flat, possibly unordered span list.
 * - Orphans (missing parent) are attached to a synthetic root level and flagged.
 * - Duplicate span ids are flagged; the first occurrence wins.
 * - Spans beyond MAX_SPANS_PER_TRACE are dropped with an anomaly note.
 */
export function buildTraceModel(rawSpans: Span[]): TraceModel {
  const anomalies: TraceAnomaly[] = [];
  const totalSpans = rawSpans.length;
  const truncated = totalSpans > MAX_SPANS_PER_TRACE;
  const spans = truncated ? rawSpans.slice(0, MAX_SPANS_PER_TRACE) : rawSpans;
  if (truncated) {
    anomalies.push({
      type: 'SPAN_LIMIT_EXCEEDED',
      message: `Trace has ${totalSpans} spans; only the first ${MAX_SPANS_PER_TRACE} are shown.`,
    });
  }

  const byId = new Map<string, SpanNode>();
  const normalized = new Map<string, { start: number; end: number }>();

  for (const span of spans) {
    if (byId.has(span.spanId)) {
      anomalies.push({
        type: 'DUPLICATE_SPAN_ID',
        spanId: span.spanId,
        message: `Duplicate span id ${span.spanId}; later occurrence ignored.`,
      });
      continue;
    }
    const t = normalizeTimes(span, anomalies);
    normalized.set(span.spanId, t);
    const node: SpanNode = {
      span: { ...span, startTimeUnixNano: t.start, endTimeUnixNano: t.end },
      depth: 0,
      children: [],
      timeClamped: t.clamped,
      error: isErrorSpan(span),
      timeout: isTimeoutSpan(span),
    };
    byId.set(span.spanId, node);
  }

  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId;
    if (parentId && parentId !== '0000000000000000') {
      const parent = byId.get(parentId);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
        continue;
      }
      anomalies.push({
        type: 'MISSING_PARENT',
        spanId: node.span.spanId,
        message: `Span "${node.span.name}" (${node.span.spanId}) references missing parent ${parentId}; shown at root level.`,
      });
    }
    roots.push(node);
  }

  // Depths of orphans' subtrees must be recomputed from the root level.
  const fixDepth = (node: SpanNode, depth: number) => {
    node.depth = depth;
    for (const child of node.children) fixDepth(child, depth + 1);
  };
  for (const root of roots) fixDepth(root, 0);

  // Out-of-order arrival: sort siblings by (clamped) start time for display.
  const sortRecursive = (node: SpanNode) => {
    node.children.sort((a, b) => a.span.startTimeUnixNano - b.span.startTimeUnixNano);
    node.children.forEach(sortRecursive);
  };
  roots.sort((a, b) => a.span.startTimeUnixNano - b.span.startTimeUnixNano);
  roots.forEach(sortRecursive);

  let minStartNano = Infinity;
  let maxEndNano = -Infinity;
  for (const t of normalized.values()) {
    if (t.start < minStartNano) minStartNano = t.start;
    if (t.end > maxEndNano) maxEndNano = t.end;
  }
  if (!Number.isFinite(minStartNano)) {
    minStartNano = 0;
    maxEndNano = FALLBACK_DURATION_NANO;
  }

  return { roots, anomalies, minStartNano, maxEndNano, totalSpans, truncated };
}

/** Flatten the forest into visible rows, honoring the collapsed set. */
export function flattenVisibleRows(
  roots: SpanNode[],
  collapsed: ReadonlySet<string>,
): WaterfallRow[] {
  const rows: WaterfallRow[] = [];
  const visit = (node: SpanNode) => {
    const isCollapsed = collapsed.has(node.span.spanId);
    rows.push({
      node,
      index: rows.length,
      hasChildren: node.children.length > 0,
      collapsed: isCollapsed,
    });
    if (!isCollapsed) node.children.forEach(visit);
  };
  roots.forEach(visit);
  return rows;
}

/** Collect the ids of all nodes that have children (useful for "collapse all"). */
export function collapsibleIds(roots: SpanNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: SpanNode) => {
    if (node.children.length > 0) ids.push(node.span.spanId);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return ids;
}
