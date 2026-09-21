import { useEffect, useMemo, useState } from 'react';
import type { TraceModel } from '../lib/traceModel';
import { axisTicks, buildLayout, clampView, zoomView, type ViewWindow } from '../lib/layout';
import { formatDuration, formatOffset } from '../lib/format';
import { SpanDetail } from './SpanDetail';

const VB_WIDTH = 10000;
const ROW_HEIGHT = 28;

interface WaterfallProps {
  trace: TraceModel;
}

export function Waterfall({ trace }: WaterfallProps) {
  const fullView = useMemo<ViewWindow>(
    () => ({ startMs: trace.startMs, endMs: trace.endMs }),
    [trace],
  );
  const [view, setView] = useState<ViewWindow>(fullView);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset interaction state whenever a new trace is loaded.
  useEffect(() => {
    setView(fullView);
    setCollapsed(new Set());
    setSelectedId(null);
  }, [fullView]);

  const layout = useMemo(() => buildLayout(trace, collapsed), [trace, collapsed]);
  const selectedSpan = selectedId ? trace.spans.find((s) => s.spanId === selectedId) ?? null : null;
  const viewSpan = Math.max(1e-9, view.endMs - view.startMs);
  const ticks = useMemo(() => axisTicks(view), [view]);

  const xFor = (ms: number) => ((ms - view.startMs) / viewSpan) * VB_WIDTH;
  const widthFor = (durationMs: number) => Math.max(durationMs / viewSpan * VB_WIDTH, durationMs > 0 ? 1.5 : 0);

  const toggleCollapsed = (spanId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const anyCollapsed = layout.rows.length < trace.spans.length;

  return (
    <div className="waterfall">
      {layout.warnings.length > 0 && (
        <div className="warning-banner" role="status" data-testid="warning-banner">
          <strong>Data quality warnings ({layout.warnings.length})</strong>
          <ul>
            {layout.warnings.slice(0, 6).map((warning) => <li key={warning}>⚠ {warning}</li>)}
            {layout.warnings.length > 6 && <li>…and {layout.warnings.length - 6} more</li>}
          </ul>
        </div>
      )}

      <div className="waterfall__toolbar">
        <div className="waterfall__meta">
          <span title={trace.traceId}>Trace <code>{trace.traceId || '(unknown)'}</code></span>
          <span>{trace.spans.length} spans</span>
          <span>duration {formatDuration(trace.durationMs)}</span>
        </div>
        <div className="waterfall__controls">
          <button type="button" onClick={() => setView((v) => zoomView(v, 1 / 2, trace.startMs, trace.endMs))}>Zoom +</button>
          <button type="button" onClick={() => setView((v) => zoomView(v, 2, trace.startMs, trace.endMs))}>Zoom −</button>
          <button type="button" onClick={() => setView(clampView(fullView, trace.startMs, trace.endMs))}>Reset zoom</button>
          <button type="button" onClick={() => setCollapsed(new Set())} disabled={!anyCollapsed}>Expand all</button>
          <button
            type="button"
            onClick={() => setCollapsed(new Set(trace.spans.filter((s) => hasShownChildren(trace, s.spanId)).map((s) => s.spanId)))}
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="waterfall__body">
        <div className="waterfall__axis" style={{ paddingLeft: LABEL_WIDTH }}>
          <svg viewBox={`0 0 ${VB_WIDTH} ${AXIS_HEIGHT}`} preserveAspectRatio="none" width="100%" height={AXIS_HEIGHT} aria-label="Time axis">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={xFor(tick)} y1={0} x2={xFor(tick)} y2={AXIS_HEIGHT} className="waterfall__tick-line" />
                <text x={xFor(tick)} y={12} className="waterfall__tick-label">
                  {formatOffset(tick - trace.startMs)}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="waterfall__rows" role="list" data-testid="waterfall-rows">
          {layout.rows.map((row) => {
            const { span } = row;
            const isCollapsed = collapsed.has(span.spanId);
            const x = xFor(span.startMs);
            const width = widthFor(span.durationMs);
            const barClass = span.isError
              ? 'span-bar span-bar--error'
              : span.isTimeout
                ? 'span-bar span-bar--timeout'
                : span.warnings.length > 0
                  ? 'span-bar span-bar--anomaly'
                  : 'span-bar';
            const isInstant = span.durationMs <= 0;
            return (
              <div
                key={span.spanId}
                className={`waterfall__row ${selectedId === span.spanId ? 'waterfall__row--selected' : ''}`}
                role="listitem"
                style={{ height: ROW_HEIGHT }}
              >
                <div
                  className="waterfall__label"
                  style={{ width: LABEL_WIDTH }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${span.name}, duration ${formatDuration(span.durationMs)}`}
                  onClick={() => setSelectedId(span.spanId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(span.spanId);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="waterfall__twisty"
                    style={{ marginLeft: row.depth * 14 }}
                    aria-label={isCollapsed ? `Expand ${span.name}` : `Collapse ${span.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCollapsed(span.spanId);
                    }}
                    disabled={!row.hasChildren}
                  >
                    {row.hasChildren ? (isCollapsed ? '▶' : '▼') : ''}
                  </button>
                  <span className="waterfall__name" title={span.name}>
                    {span.name}
                    {span.missingParent && <span className="inline-badge" title="Parent span missing">orphan</span>}
                    {span.isError && <span className="inline-badge inline-badge--error">err</span>}
                    {span.isTimeout && <span className="inline-badge inline-badge--timeout">timeout</span>}
                  </span>
                </div>
                <svg
                  className="waterfall__track"
                  viewBox={`0 0 ${VB_WIDTH} ${ROW_HEIGHT}`}
                  preserveAspectRatio="none"
                  data-testid={`track-${span.spanId}`}
                >
                  <title>{`${span.name} — ${formatDuration(span.durationMs)}${span.isError && span.errorMessage ? `: ${span.errorMessage}` : ''}`}</title>
                  {isInstant ? (
                    // Zero-duration spans (e.g. invalid timestamps) get a clickable marker.
                    <polygon
                      className={`${barClass} span-bar--instant`}
                      points={`${x},4 ${x + 7},${ROW_HEIGHT / 2} ${x},${ROW_HEIGHT - 4} ${x - 7},${ROW_HEIGHT / 2}`}
                      style={!span.isError && !span.isTimeout && span.warnings.length === 0 ? { fill: depthColor(row.depth) } : undefined}
                      onClick={() => setSelectedId(span.spanId)}
                      data-span-id={span.spanId}
                      data-error={span.isError ? 'true' : undefined}
                      data-timeout={span.isTimeout ? 'true' : undefined}
                      role="button"
                      aria-label={`${span.name} span marker`}
                    />
                  ) : (
                    <rect
                      className={barClass}
                      x={Math.max(0, Math.min(VB_WIDTH, x))}
                      y={5}
                      width={Math.max(0, Math.min(VB_WIDTH, width))}
                      height={ROW_HEIGHT - 10}
                      rx={2}
                      style={!span.isError && !span.isTimeout ? { fill: depthColor(row.depth) } : undefined}
                      onClick={() => setSelectedId(span.spanId)}
                      data-span-id={span.spanId}
                      data-error={span.isError ? 'true' : undefined}
                      data-timeout={span.isTimeout ? 'true' : undefined}
                      role="button"
                      aria-label={`${span.name} span bar`}
                    />
                  )}
                </svg>
                <span className="waterfall__duration">{formatDuration(span.durationMs)}</span>
              </div>
            );
          })}
          {layout.rows.length === 0 && <div className="waterfall__empty">This trace contains no renderable spans.</div>}
        </div>
      </div>

      <SpanDetail span={selectedSpan} traceStartMs={trace.startMs} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function hasShownChildren(trace: TraceModel, spanId: string): boolean {
  return trace.spans.some((s) => s.parentSpanId === spanId);
}

function depthColor(depth: number): string {
  const hue = 210;
  const lightness = Math.max(34, 62 - depth * 6);
  return `hsl(${hue}, 60%, ${lightness}%)`;
}

const LABEL_WIDTH = 300;
const AXIS_HEIGHT = 20;
