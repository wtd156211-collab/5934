import express from 'express';
import { Trace, TraceSummary, spanDurationNano, isErrorSpan } from '../shared/trace';
import { generateTraces } from './traceGenerator';

const app = express();
const PORT = Number(process.env.PORT ?? 4100);

// In-memory trace store, seeded at startup by the generator. This stands in
// for a real collector backend (e.g. Jaeger/Tempo query API).
const traces: Map<string, Trace> = new Map();
for (const trace of generateTraces(Date.now() * 1_000_000)) {
  traces.set(trace.traceId, trace);
}

function summarize(trace: Trace): TraceSummary {
  let min = Infinity;
  let max = -Infinity;
  let errorCount = 0;
  for (const span of trace.spans) {
    if (span.startTimeUnixNano < min) min = span.startTimeUnixNano;
    if (span.endTimeUnixNano > max) max = span.endTimeUnixNano;
    if (isErrorSpan(span)) errorCount += 1;
  }
  const root = trace.spans.find((s) => !s.parentSpanId) ?? trace.spans[0];
  return {
    traceId: trace.traceId,
    rootName: root?.name ?? '(unknown)',
    spanCount: trace.spans.length,
    errorCount,
    startTimeUnixNano: min,
    durationNano: max - min,
  };
}

app.get('/api/traces', (_req, res) => {
  res.json([...traces.values()].map(summarize));
});

app.get('/api/traces/:traceId', (req, res) => {
  const trace = traces.get(req.params.traceId);
  if (!trace) {
    res.status(404).json({ error: 'trace not found' });
    return;
  }
  res.json(trace);
});

// Serve the built frontend in production mode.
app.use(express.static('dist'));

app.listen(PORT, () => {
  console.log(`trace server listening on http://localhost:${PORT}`);
});
