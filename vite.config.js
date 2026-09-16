import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ilc-new-ui/',
  plugins: [react()],
  build: {
    outDir: 'dist'
  }
})