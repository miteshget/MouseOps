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
    proxy: {
      '/api': 'http://127.0.0.1:8765',
      '/logo.png': 'http://127.0.0.1:8765',
    },
  },
});
