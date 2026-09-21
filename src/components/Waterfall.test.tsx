import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Waterfall } from './Waterfall';
import { TracePage } from './TracePage';
import { parse } from '../test/helpers';
import { msSpan } from '../test/helpers';

function traceFixture() {
  return parse([
    msSpan('root', 0, 1000),
    msSpan('serial-1', 50, 150, 'root', { name: 'auth.verify' }),
    msSpan('serial-2', 200, 300, 'root', { name: 'cart.load' }),
    msSpan('parallel-1', 400, 800, 'root', { name: 'inventory.check' }),
    msSpan('parallel-2', 450, 700, 'root', { name: 'pricing.calc' }),
    msSpan('nested', 100, 140, 'serial-1', { name: 'cache.get' }),
    msSpan('error', 820, 980, 'root', {
      name: 'payment.charge',
      status: { code: 2, message: 'card issuer unavailable' },
    }),
    msSpan('timeout', 500, 950, 'root', {
      name: 'shipping.quote',
      attributes: [{ key: 'timeout', value: { stringValue: 'true' } }],
    }),
    msSpan('orphan', 300, 360, 'ghost', { name: 'audit.record' }),
    msSpan('bad-time', 600, 550, 'root', { name: 'feature.flag.eval' }),
  ]);
}

describe('Waterfall rendering', () => {
  it('renders one row per span with duration labels', () => {
    render(<Waterfall trace={traceFixture()} />);
    expect(screen.getByText('auth.verify')).toBeInTheDocument();
    expect(screen.getByText('payment.charge')).toBeInTheDocument();
    expect(screen.getAllByText('100 ms').length).toBeGreaterThan(0);
  });

  it('highlights error and timeout spans and shows the error message on selection', async () => {
    const user = userEvent.setup();
    render(<Waterfall trace={traceFixture()} />);
    const errorBar = screen.getByTestId('track-error').querySelector('rect')!;
    expect(errorBar).toHaveClass('span-bar--error');
    expect(errorBar).toHaveAttribute('data-error', 'true');

    const timeoutBar = screen.getByTestId('track-timeout').querySelector('rect')!;
    expect(timeoutBar).toHaveClass('span-bar--timeout');

    await user.click(errorBar);
    const errorBox = await screen.findByTestId('error-box');
    expect(errorBox).toHaveTextContent('card issuer unavailable');
  });

  it('collapses and expands children via the twisty', async () => {
    const user = userEvent.setup();
    render(<Waterfall trace={traceFixture()} />);
    expect(screen.getByText('cache.get')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse span-root' }));
    expect(screen.queryByText('cache.get')).not.toBeInTheDocument();
    expect(screen.queryByText('auth.verify')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand span-root' }));
    expect(screen.getByText('cache.get')).toBeInTheDocument();
  });

  it('expand all / collapse all toolbar buttons affect visible rows', async () => {
    const user = userEvent.setup();
    render(<Waterfall trace={traceFixture()} />);
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    // Only roots remain visible (root + orphan).
    expect(screen.queryByText('cache.get')).not.toBeInTheDocument();
    expect(screen.getByText('audit.record')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('cache.get')).toBeInTheDocument();
  });

  it('zooms the timeline in and resets', async () => {
    const user = userEvent.setup();
    render(<Waterfall trace={traceFixture()} />);
    // Full window ticks land on 100 ms boundaries, not 750 ms.
    expect(screen.queryByText('750 ms')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom +' }));
    expect(screen.getByText('750 ms')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.queryByText('750 ms')).not.toBeInTheDocument();
  });

  it('shows non-fatal warnings for missing parents and invalid time ranges', () => {
    render(<Waterfall trace={traceFixture()} />);
    const banner = screen.getByTestId('warning-banner');
    expect(banner).toHaveTextContent(/missing|Parent/i);
  });

  it('surfaces per-span warnings in the detail panel', async () => {
    const user = userEvent.setup();
    render(<Waterfall trace={traceFixture()} />);
    await user.click(screen.getByTestId('track-bad-time').querySelector('polygon')!);
    const warnings = await screen.findByTestId('span-warnings');
    expect(warnings).toHaveTextContent(/Invalid time range/i);
  });

  it('renders an empty trace without crashing', () => {
    render(<Waterfall trace={parse([])} />);
    expect(screen.getByText(/no renderable spans/i)).toBeInTheDocument();
  });

  it('keeps parallel spans on separate tracks at the same depth', () => {
    render(<Waterfall trace={traceFixture()} />);
    const rows = screen.getByTestId('waterfall-rows');
    expect(within(rows).getByText('inventory.check')).toBeInTheDocument();
    expect(within(rows).getByText('pricing.calc')).toBeInTheDocument();
  });
});

describe('TracePage real data flow', () => {
  it('fetches /api/trace, parses OTLP JSON, and renders the trace', async () => {
    const otlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                msSpan('root', 1_700_000_000_000, 1_700_000_001_000, undefined, {
                  name: 'GET /health',
                }),
                msSpan('child', 1_700_000_000_100, 1_700_000_000_400, 'root', {
                  name: 'db.ping',
                  status: { code: 2, message: 'connection refused' },
                }),
              ],
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => otlpPayload,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    render(<TracePage />);
    expect(await screen.findByText('GET /health')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/trace', expect.any(Object));

    const errorBar = screen.getByTestId('track-child').querySelector('rect')!;
    expect(errorBar).toHaveClass('span-bar--error');
    vi.unstubAllGlobals();
  });

  it('shows an error state with retry when the trace endpoint fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502 } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(<TracePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/502/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
