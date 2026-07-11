import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/phaser/')) return 'phaser';
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/colyseus') || id.includes('/node_modules/@colyseus/')) return 'network';
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
});
