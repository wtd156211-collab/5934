import { Span, isErrorSpan, isTimeoutSpan } from '../../shared/trace';
import { formatDuration, formatTimestamp } from '../lib/format';

interface Props {
  span: Span;
  onClose: () => void;
}

export default function SpanDetail({ span, onClose }: Props) {
  const error = isErrorSpan(span);
  const timeout = isTimeoutSpan(span);
  const attributes = Object.entries(span.attributes ?? {});

  return (
    <aside className="span-detail" data-testid="span-detail">
      <div className="detail-header">
        <strong>{span.name}</strong>
        <button onClick={onClose} aria-label="close">✕</button>
      </div>
      {error && (
        <div className="banner error" data-testid="span-error-message">
          {timeout ? 'Timeout: ' : 'Error: '}
          {span.status.message ?? 'span reported an error'}
        </div>
      )}
      <dl>
        <dt>Span ID</dt>
        <dd className="mono">{span.spanId}</dd>
        <dt>Parent Span ID</dt>
        <dd className="mono">{span.parentSpanId ?? '(root)'}</dd>
        <dt>Service</dt>
        <dd>{span.serviceName}</dd>
        <dt>Kind</dt>
        <dd>{span.kind ?? 'INTERNAL'}</dd>
        <dt>Status</dt>
        <dd className={error ? 'error-text' : ''}>{span.status.code}</dd>
        <dt>Start</dt>
        <dd>{formatTimestamp(span.startTimeUnixNano)}</dd>
        <dt>End</dt>
        <dd>{formatTimestamp(span.endTimeUnixNano)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(span.endTimeUnixNano - span.startTimeUnixNano)}</dd>
      </dl>
      {attributes.length > 0 && (
        <>
          <h4>Attributes</h4>
          <dl>
            {attributes.map(([key, value]) => (
              <div key={key} className="attr-row">
                <dt className="mono">{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </aside>
  );
}
