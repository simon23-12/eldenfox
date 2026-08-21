import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5180, host: '127.0.0.1' },
  build: {
    target: 'esnext',
    rollupOptions: { output: { manualChunks: { three: ['three/webgpu', 'three/tsl'] } } },
  },
  optimizeDeps: { exclude: ['three'] },
});
