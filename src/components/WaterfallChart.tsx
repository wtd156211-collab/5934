import { useRef } from 'react';
import { WaterfallRow } from '../lib/spanTree';
import { formatDuration } from '../lib/format';
import { ViewWindow } from './TraceWaterfall';

const ROW_HEIGHT = 26;
const LABEL_WIDTH = 340;
const AXIS_HEIGHT = 24;
const SVG_WIDTH = 1000; // viewBox units; stretched to container width via CSS

interface Props {
  rows: WaterfallRow[];
  view: ViewWindow;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onToggleCollapse: (spanId: string) => void;
  onWheelZoom: (factor: number, anchorFraction: number) => void;
}

function niceTicks(view: ViewWindow, count = 6): number[] {
  const span = view.endNano - view.startNano;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = magnitude * 10;
  for (const c of [1, 2, 5, 10]) {
    if (magnitude * c >= rough) {
      step = magnitude * c;
      break;
    }
  }
  const ticks: number[] = [];
  const first = Math.ceil(view.startNano / step) * step;
  for (let t = first; t <= view.endNano; t += step) ticks.push(t);
  return ticks;
}

export default function WaterfallChart({
  rows,
  view,
  selectedSpanId,
  onSelectSpan,
  onToggleCollapse,
  onWheelZoom,
}: Props) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const viewSpan = view.endNano - view.startNano;
  const toX = (nano: number) => ((nano - view.startNano) / viewSpan) * SVG_WIDTH;
  const ticks = niceTicks(view);
  const bodyHeight = rows.length * ROW_HEIGHT;

  const handleWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = timelineRef.current?.getBoundingClientRect();
    const anchor = rect ? (e.clientX - rect.left) / rect.width : 0.5;
    onWheelZoom(e.deltaY > 0 ? 1.5 : 1 / 1.5, Math.min(1, Math.max(0, anchor)));
  };

  return (
    <div className="waterfall-chart">
      <div className="chart-header">
        <div className="label-cell header" style={{ width: LABEL_WIDTH }}>
          Span
        </div>
        <div className="timeline-axis" ref={timelineRef} onWheel={handleWheel}>
          <svg
            width="100%"
            height={AXIS_HEIGHT}
            viewBox={`0 0 ${SVG_WIDTH} ${AXIS_HEIGHT}`}
            preserveAspectRatio="none"
          >
            {ticks.map((t) => {
              const x = toX(t);
              return (
                <g key={t}>
                  <line x1={x} y1={AXIS_HEIGHT - 8} x2={x} y2={AXIS_HEIGHT} stroke="#888" />
                  <text
                    x={x}
                    y={AXIS_HEIGHT - 10}
                    textAnchor="middle"
                    className="tick-label"                  >
                    {formatDuration(t - view.startNano)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="chart-body" data-testid="waterfall-body">
        <div className="label-column" style={{ width: LABEL_WIDTH }}>
          {rows.map((row) => (
            <div
              key={row.node.span.spanId}
              className={`label-cell${row.node.error ? ' error-text' : ''}`}
              style={{ height: ROW_HEIGHT, paddingLeft: 8 + row.node.depth * 16 }}
              data-testid={`span-label-${row.node.span.spanId}`}
            >
              {row.hasChildren && (
                <button
                  className="collapse-toggle"
                  data-testid={`toggle-${row.node.span.spanId}`}
                  onClick={() => onToggleCollapse(row.node.span.spanId)}
                  aria-label={row.collapsed ? 'expand' : 'collapse'}
                >
                  {row.collapsed ? '▸' : '▾'}
                </button>
              )}
              <span className="span-name" title={row.node.span.name}>
                {row.node.span.name}
              </span>
              <span className="service-name">{row.node.span.serviceName}</span>
            </div>
          ))}
        </div>

        <div className="timeline-column" onWheel={handleWheel}>
          <svg
            data-testid="waterfall-svg"
            width="100%"
            height={bodyHeight}
            viewBox={`0 0 ${SVG_WIDTH} ${bodyHeight}`}
            preserveAspectRatio="none"
          >
            {ticks.map((t) => (
              <line
                key={`grid-${t}`}
                x1={toX(t)}
                y1={0}
                x2={toX(t)}
                y2={bodyHeight}
                className="grid-line"
              />
            ))}
            {rows.map((row) => {
              const { span } = row.node;
              const x = toX(span.startTimeUnixNano);
              const width = Math.max(
                1.5,
                toX(span.endTimeUnixNano) - x,
              );
              const y = row.index * ROW_HEIGHT + 5;
              const height = ROW_HEIGHT - 10;
              const classes = [
                'span-bar',
                row.node.error ? 'error' : '',
                row.node.timeout ? 'timeout' : '',
                row.node.timeClamped ? 'clamped' : '',
                span.spanId === selectedSpanId ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <g key={span.spanId}>
                  <rect
                    data-testid={`span-bar-${span.spanId}`}
                    className={classes}
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    rx={2}
                    onClick={() => onSelectSpan(span.spanId)}
                  >
                    <title>
                      {`${span.name} — ${formatDuration(
                        span.endTimeUnixNano - span.startTimeUnixNano,
                      )}`}
                    </title>
                  </rect>
                  {row.node.error && (
                    <text
                      x={Math.min(x + width + 4, SVG_WIDTH - 12)}
                      y={y + height / 2 + 4}
                      className="error-mark"
                      data-testid={`error-mark-${span.spanId}`}
                    >
                      ⚠
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
