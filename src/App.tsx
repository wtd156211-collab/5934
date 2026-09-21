import { TracePage } from './components/TracePage';

export default function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>Distributed Trace Waterfall</h1>
        <span className="app__subtitle">OTel-compatible span timeline</span>
      </header>
      <main>
        <TracePage />
      </main>
    </div>
  );
}
