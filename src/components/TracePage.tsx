import { useCallback, useEffect, useState } from 'react';
import { fetchTrace, type LoadState } from '../lib/loadTrace';
import { Waterfall } from './Waterfall';

export function TracePage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    fetchTrace()
      .then((trace) => setState({ status: 'ready', trace }))
      .catch((error: unknown) => setState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === 'loading') {
    return <div className="trace-page trace-page--status" role="status">Loading trace…</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="trace-page trace-page--status">
        <div className="error-box" role="alert">
          <strong>Unable to load trace</strong>
          <div>{state.message}</div>
        </div>
        <button type="button" onClick={load}>Retry</button>
      </div>
    );
  }
  return <Waterfall trace={state.trace} />;
}
