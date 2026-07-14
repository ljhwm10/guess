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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React 核心单独分包
          if (id.includes('/node_modules/react') || id.includes('/node_modules/react-dom') || id.includes('/node_modules/zustand')) {
            return 'react-vendor';
          }
          // socket.io 单独分包
          if (id.includes('/node_modules/socket.io-client') || id.includes('/node_modules/engine.io')) {
            return 'socket-vendor';
          }
          // WebRTC 相关单独分包
          if (id.includes('/node_modules/simple-peer') || id.includes('/node_modules/peerjs')) {
            return 'webrtc-vendor';
          }
        },
      },
    },
    // 启用 CSS code splitting
    cssCodeSplit: true,
  },
});
