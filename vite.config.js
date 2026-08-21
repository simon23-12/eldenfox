import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base, damit der Build unter jedem GitHub-Pages-Unterpfad läuft
  // (z. B. https://<user>.github.io/<repo>/).
  base: './',
  server: { port: 5180, host: '127.0.0.1' },
  build: {
    target: 'esnext',
    rollupOptions: { output: { manualChunks: { three: ['three/webgpu', 'three/tsl'] } } },
  },
  optimizeDeps: { exclude: ['three'] },
});
