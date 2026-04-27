import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Build outputs directly into the FastAPI static directory
  build: {
    outDir: path.resolve(__dirname, '../static'),
    emptyOutDir: true,
  },
  // In dev mode, proxy API calls to the FastAPI backend
  server: {
    // Use MOUSEOPS_DEV_TARGET to match the backend mode:
    //   HTTPS mode (default): MOUSEOPS_DEV_TARGET=https://127.0.0.1:8766
    //   HTTP  mode:           MOUSEOPS_DEV_TARGET=http://127.0.0.1:8765
    proxy: (() => {
      const target = process.env.MOUSEOPS_DEV_TARGET || 'https://127.0.0.1:8766';
      const secure = !target.startsWith('http://');
      return {
        '/api':      { target, secure },
        '/logo.png': { target, secure },
      };
    })(),
  },
});
