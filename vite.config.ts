import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ['@babylonjs/core'],
        },
      },
    },
  },
})
