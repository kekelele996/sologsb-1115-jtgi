import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// 纯前端 SPA：构建产物交给 nginx:alpine 托管
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: true,
    port: 21815
  },
  preview: {
    host: true,
    port: 21815
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600
  }
})
