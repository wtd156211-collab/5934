import type { NormalizedSpan } from '../lib/traceModel';
import { formatDuration, formatOffset, formatTimestamp } from '../lib/format';

interface SpanDetailProps {
  span: NormalizedSpan | null;
  traceStartMs: number;
  onClose: () => void;
}

export function SpanDetail({ span, traceStartMs, onClose }: SpanDetailProps) {
  if (!span) {
    return (
      <aside className="span-detail span-detail--empty" aria-label="Span detail">
        <p>Select a span to inspect its details.</p>
      </aside>
    );
  }

  const attributeEntries = Object.entries(span.attributes);

  return (
    <aside className="span-detail" aria-label={`Details for ${span.name}`}>
      <header className="span-detail__header">
        <div>
          <span className={`status-badge ${span.isError ? 'status-badge--error' : span.isTimeout ? 'status-badge--timeout' : 'status-badge--ok'}`}>
            {span.isError ? 'ERROR' : span.isTimeout ? 'TIMEOUT' : span.status === 'OK' ? 'OK' : span.status}
          </span>
          <h2 className="span-detail__title" title={span.name}>{span.name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close detail">×</button>
      </header>

      <dl className="span-detail__grid">
        <dt>Span ID</dt><dd><code>{span.spanId}</code></dd>
        {span.parentSpanId && (<><dt>Parent ID</dt><dd><code>{span.parentSpanId}</code>{span.missingParent && <span className="warn-text"> (missing)</span>}</dd></>)}
        <dt>Start</dt><dd>+{formatOffset(span.startMs - traceStartMs)}</dd>
        <dt>Start (absolute)</dt><dd>{formatTimestamp(span.startMs)}</dd>
        <dt>Duration</dt><dd>{formatDuration(span.durationMs)}</dd>
        <dt>End</dt><dd>+{formatOffset(span.endMs - traceStartMs)}</dd>
      </dl>

      {span.isError && (
        <div className="error-box" role="alert" data-testid="error-box">
          <strong>Error</strong>
          <div>{span.errorMessage ?? 'No error message recorded on this span.'}</div>
        </div>
      )}
      {span.isTimeout && !span.isError && (
        <div className="timeout-box" role="status">
          <strong>Timeout</strong>
          <div>This span was marked as timed out (timeout attribute or HTTP 504).</div>
        </div>
      )}

      {span.warnings.length > 0 && (
        <ul className="warn-list" data-testid="span-warnings">
          {span.warnings.map((warning) => <li key={warning}>⚠ {warning}</li>)}
        </ul>
      )}

      {span.events.length > 0 && (
        <section>
          <h3>Events</h3>
          <ul className="event-list">
            {span.events.map((event, index) => (
              <li key={`${event.name}-${index}`}>
                <span className="event-list__name">{event.name}</span>
                {event.timeMs !== undefined && (
                  <span className="event-list__time">+{formatOffset(event.timeMs - traceStartMs)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {attributeEntries.length > 0 && (
        <section>
          <h3>Attributes</h3>
          <dl className="attr-list">
            {attributeEntries.map(([key, value]) => (
              <div key={key} className="attr-list__row">
                <dt>{key}</dt>
                <dd>{formatAttrValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </aside>
  );
}

function formatAttrValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
