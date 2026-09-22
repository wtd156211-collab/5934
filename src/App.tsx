import { useEffect, useState } from 'react';
import { TraceSummary } from '../shared/trace';
import { fetchTraces } from './api';
import TraceList from './components/TraceList';
import TraceWaterfall from './components/TraceWaterfall';

export default function App() {
  const [traces, setTraces] = useState<TraceSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  useEffect(() => {
    fetchTraces()
      .then(setTraces)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Trace Waterfall</h1>
        {selectedTraceId && (
          <button className="link-btn" onClick={() => setSelectedTraceId(null)}>
            ← Back to trace list
          </button>
        )}
      </header>
      {loadError && <div className="banner error">Failed to load traces: {loadError}</div>}
      {!loadError && traces === null && <div className="banner">Loading traces…</div>}
      {traces && !selectedTraceId && (
        <TraceList traces={traces} onSelect={setSelectedTraceId} />
      )}
      {selectedTraceId && <TraceWaterfall traceId={selectedTraceId} />}
    </div>
  );
}
