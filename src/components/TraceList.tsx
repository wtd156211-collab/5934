import { TraceSummary } from '../../shared/trace';
import { formatDuration, formatTimeOfDay } from '../lib/format';

interface Props {
  traces: TraceSummary[];
  onSelect: (traceId: string) => void;
}

export default function TraceList({ traces, onSelect }: Props) {
  return (
    <table className="trace-table" data-testid="trace-list">
      <thead>
        <tr>
          <th>Trace ID</th>
          <th>Root Span</th>
          <th>Start</th>
          <th>Duration</th>
          <th>Spans</th>
          <th>Errors</th>
        </tr>
      </thead>
      <tbody>
        {traces.map((t) => (
          <tr key={t.traceId} onClick={() => onSelect(t.traceId)} data-testid={`trace-row-${t.traceId}`}>
            <td className="mono">{t.traceId}</td>
            <td>{t.rootName}</td>
            <td>{formatTimeOfDay(t.startTimeUnixNano)}</td>
            <td>{formatDuration(t.durationNano)}</td>
            <td>{t.spanCount}</td>
            <td className={t.errorCount > 0 ? 'error-text' : ''}>{t.errorCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
