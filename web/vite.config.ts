import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@draw-guess/shared': path.resolve(dir, '../shared/src/index.ts'),
    },
  },
  server: {
    host: true,
    port: 5311,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:5310',
        ws: true,
      },
    },
  },
});
