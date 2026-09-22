import { useEffect, useMemo, useState } from 'react';
import { Trace } from '../../shared/trace';
import { fetchTrace } from '../api';
import {
  TraceModel,
  buildTraceModel,
  collapsibleIds,
  flattenVisibleRows,
} from '../lib/spanTree';
import WaterfallChart from './WaterfallChart';
import SpanDetail from './SpanDetail';

export interface ViewWindow {
  startNano: number;
  endNano: number;
}

const MIN_ZOOM_FRACTION = 1 / 1000;

export default function TraceWaterfall({ traceId }: { traceId: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [window, setWindow] = useState<ViewWindow | null>(null);

  useEffect(() => {
    setTrace(null);
    setLoadError(null);
    setCollapsed(new Set());
    setSelectedSpanId(null);
    setWindow(null);
    fetchTrace(traceId)
      .then(setTrace)
      .catch((err: Error) => setLoadError(err.message));
  }, [traceId]);

  const model: TraceModel | null = useMemo(
    () => (trace ? buildTraceModel(trace.spans) : null),
    [trace],
  );

  const fullWindow: ViewWindow | null = useMemo(
    () =>
      model ? { startNano: model.minStartNano, endNano: model.maxEndNano } : null,
    [model],
  );
  const view = window ?? fullWindow;

  const rows = useMemo(
    () => (model ? flattenVisibleRows(model.roots, collapsed) : []),
    [model, collapsed],
  );

  const zoom = (factor: number, anchorFraction = 0.5) => {
    if (!view || !fullWindow) return;
    const fullSpan = fullWindow.endNano - fullWindow.startNano;
    const span = view.endNano - view.startNano;
    const anchor = view.startNano + span * anchorFraction;
    let newSpan = span * factor;
    newSpan = Math.min(fullSpan, Math.max(fullSpan * MIN_ZOOM_FRACTION, newSpan));
    let start = anchor - newSpan * anchorFraction;
    start = Math.max(fullWindow.startNano, Math.min(start, fullWindow.endNano - newSpan));
    setWindow({ startNano: start, endNano: start + newSpan });
  };

  if (loadError) return <div className="banner error">Failed to load trace: {loadError}</div>;
  if (!trace || !model || !view || !fullWindow) return <div className="banner">Loading trace…</div>;

  const toggleCollapse = (spanId: string) => {
    const next = new Set(collapsed);
    if (next.has(spanId)) next.delete(spanId);
    else next.add(spanId);
    setCollapsed(next);
  };

  const selectedSpan =
    (selectedSpanId && trace.spans.find((s) => s.spanId === selectedSpanId)) || null;

  return (
    <div className="waterfall-view">
      <div className="toolbar">
        <span className="mono trace-title">{trace.traceId}</span>
        <span className="muted" data-testid="span-count">
          {model.totalSpans} spans{model.truncated ? ' (truncated)' : ''}
        </span>
        <div className="toolbar-buttons">
          <button data-testid="zoom-in" onClick={() => zoom(0.5)}>Zoom in</button>
          <button data-testid="zoom-out" onClick={() => zoom(2)}>Zoom out</button>
          <button data-testid="zoom-reset" onClick={() => setWindow(null)}>Reset</button>
          <button
            data-testid="collapse-all"
            onClick={() => setCollapsed(new Set(collapsibleIds(model.roots)))}
          >
            Collapse all
          </button>
          <button data-testid="expand-all" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
        </div>
      </div>

      {model.anomalies.length > 0 && (
        <div className="banner warning" data-testid="anomaly-banner">
          <strong>{model.anomalies.length} data issue(s) detected:</strong>
          <ul>
            {model.anomalies.map((a, i) => (
              <li key={i}>{a.message}</li>
            ))}
          </ul>
        </div>
      )}

      <WaterfallChart
        rows={rows}
        view={view}
        selectedSpanId={selectedSpanId}
        onSelectSpan={setSelectedSpanId}
        onToggleCollapse={toggleCollapse}
        onWheelZoom={zoom}
      />

      {selectedSpan && (
        <SpanDetail span={selectedSpan} onClose={() => setSelectedSpanId(null)} />
      )}
    </div>
  );
}
