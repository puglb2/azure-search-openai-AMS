import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: './',                  // ensure relative asset paths
  plugins: [react()],
  resolve: {
    alias: {
      '/src': fileURLToPath(new URL('./src', import.meta.url)), // if anything still imports "/src"
    }
  },
  build: {
    rollupOptions: { output: { entryFileNames: 'widget.js' } }
  }
})
