import { Span, Trace } from '../shared/trace';

const MS = 1_000_000; // nanoseconds per millisecond

let counter = 0;
function spanId(): string {
  counter += 1;
  return counter.toString(16).padStart(16, '0');
}

interface SpanSpec {
  name: string;
  serviceName: string;
  startMs: number;
  durationMs: number;
  status?: Span['status'];
  attributes?: Span['attributes'];
  kind?: Span['kind'];
  children?: SpanSpec[];
}

function materialize(
  traceId: string,
  spec: SpanSpec,
  baseNano: number,
  parentSpanId?: string,
): Span[] {
  const id = spanId();
  const span: Span = {
    traceId,
    spanId: id,
    parentSpanId,
    name: spec.name,
    serviceName: spec.serviceName,
    kind: spec.kind ?? 'INTERNAL',
    startTimeUnixNano: baseNano + spec.startMs * MS,
    endTimeUnixNano: baseNano + (spec.startMs + spec.durationMs) * MS,
    status: spec.status ?? { code: 'OK' },
    attributes: spec.attributes,
  };
  const spans = [span];
  for (const child of spec.children ?? []) {
    spans.push(...materialize(traceId, child, baseNano, id));
  }
  return spans;
}

function makeTrace(traceId: string, root: SpanSpec, baseNano: number): Trace {
  return { traceId, spans: materialize(traceId, root, baseNano) };
}

/** Serial + nested chain: frontend -> api -> auth -> db. */
function buildCheckoutTrace(baseNano: number): Trace {
  return makeTrace('trace-checkout-001', {
    name: 'GET /checkout',
    serviceName: 'frontend',
    kind: 'SERVER',
    startMs: 0,
    durationMs: 480,
    children: [
      {
        name: 'POST /api/orders',
        serviceName: 'api-gateway',
        kind: 'CLIENT',
        startMs: 20,
        durationMs: 430,
        children: [
          {
            name: 'auth.verify',
            serviceName: 'auth-service',
            startMs: 40,
            durationMs: 90,
            children: [
              {
                name: 'SELECT users',
                serviceName: 'postgres',
                kind: 'CLIENT',
                startMs: 55,
                durationMs: 60,
              },
            ],
          },
          {
            name: 'orders.create',
            serviceName: 'order-service',
            startMs: 150,
            durationMs: 280,
            children: [
              {
                name: 'INSERT orders',
                serviceName: 'postgres',
                kind: 'CLIENT',
                startMs: 170,
                durationMs: 110,
              },
              {
                name: 'inventory.reserve',
                serviceName: 'inventory-service',
                startMs: 300,
                durationMs: 110,
              },
            ],
          },
        ],
      },
    ],
  }, baseNano);
}

/** Parallel fan-out: one parent, three concurrent downstream calls. */
function buildParallelTrace(baseNano: number): Trace {
  return makeTrace('trace-parallel-002', {
    name: 'GET /dashboard',
    serviceName: 'frontend',
    kind: 'SERVER',
    startMs: 0,
    durationMs: 320,
    children: [
      {
        name: 'aggregate',
        serviceName: 'api-gateway',
        startMs: 10,
        durationMs: 300,
        children: [
          { name: 'GET /profile', serviceName: 'user-service', kind: 'CLIENT', startMs: 30, durationMs: 180 },
          { name: 'GET /recommendations', serviceName: 'rec-service', kind: 'CLIENT', startMs: 35, durationMs: 240 },
          { name: 'GET /notifications', serviceName: 'notify-service', kind: 'CLIENT', startMs: 40, durationMs: 120 },
        ],
      },
    ],
  }, baseNano);
}

/** Error + timeout spans. */
function buildErrorTrace(baseNano: number): Trace {
  return makeTrace('trace-error-003', {
    name: 'POST /payment',
    serviceName: 'frontend',
    kind: 'SERVER',
    startMs: 0,
    durationMs: 900,
    children: [
      {
        name: 'payment.charge',
        serviceName: 'payment-service',
        startMs: 30,
        durationMs: 840,
        children: [
          {
            name: 'fraud.check',
            serviceName: 'fraud-service',
            kind: 'CLIENT',
            startMs: 60,
            durationMs: 500,
            status: { code: 'ERROR', message: 'upstream timeout: fraud-service did not respond in 500ms' },
            attributes: { timeout: true, 'http.status_code': 504 },
          },
          {
            name: 'ledger.write',
            serviceName: 'ledger-service',
            kind: 'CLIENT',
            startMs: 600,
            durationMs: 240,
            status: { code: 'ERROR', message: 'constraint violation: duplicate transaction id' },
            attributes: { 'db.statement': 'INSERT INTO ledger ...' },
          },
        ],
      },
    ],
  }, baseNano);
}

/**
 * Deliberately broken trace: a span whose parent was never exported, an
 * inverted time range, and spans delivered out of order.
 */
function buildBrokenTrace(baseNano: number): Trace {
  const trace = makeTrace('trace-broken-004', {
    name: 'GET /report',
    serviceName: 'frontend',
    kind: 'SERVER',
    startMs: 0,
    durationMs: 400,
    children: [
      { name: 'render', serviceName: 'report-service', startMs: 50, durationMs: 300 },
    ],
  }, baseNano);
  const orphan: Span = {
    traceId: trace.traceId,
    spanId: spanId(),
    parentSpanId: 'deadbeefdeadbeef', // never exported
    name: 'cache.lookup',
    serviceName: 'cache-service',
    kind: 'CLIENT',
    startTimeUnixNano: baseNano + 80 * MS,
    endTimeUnixNano: baseNano + 140 * MS,
    status: { code: 'OK' },
  };
  const inverted: Span = {
    traceId: trace.traceId,
    spanId: spanId(),
    parentSpanId: trace.spans[0].spanId,
    name: 'export.pdf',
    serviceName: 'report-service',
    startTimeUnixNano: baseNano + 300 * MS,
    endTimeUnixNano: baseNano + 200 * MS, // end before start: invalid
    status: { code: 'UNSET' },
  };
  // Shuffle to simulate out-of-order delivery from collectors.
  trace.spans.push(orphan, inverted);
  trace.spans.reverse();
  return trace;
}

export function generateTraces(nowNano: number): Trace[] {
  const hour = 3_600_000 * MS;
  return [
    buildCheckoutTrace(nowNano - 3 * hour),
    buildParallelTrace(nowNano - 2 * hour),
    buildErrorTrace(nowNano - hour),
    buildBrokenTrace(nowNano - 30 * 60 * MS),
  ];
}
