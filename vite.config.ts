import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',               // <- keep relative paths in build
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { entryFileNames: 'widget.js' }
    }
  }
})
