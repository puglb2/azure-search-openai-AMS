import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',   // ensures relative asset paths for Azure SWA
  plugins: [react()]
})
