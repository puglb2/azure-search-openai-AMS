import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '/src': fileURLToPath(new URL('./src', import.meta.url)), // resolve absolute "/src" imports
    }
  },
  build: {
    rollupOptions: {
      output: { entryFileNames: 'widget.js' }
    }
  }
})
