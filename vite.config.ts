import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const configDir = dirname(fileURLToPath(import.meta.url));
const traceJson = readFileSync(resolve(configDir, 'server/data/trace.json'), 'utf-8');

function traceApiPlugin(): Plugin {
  return {
    name: 'trace-api',
    configureServer(server) {
      server.middlewares.use('/api/trace', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(traceJson);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/trace', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(traceJson);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), traceApiPlugin()],
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
