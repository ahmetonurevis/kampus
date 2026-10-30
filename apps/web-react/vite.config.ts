import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Vue uygulaması 5173'te kalır; iki uygulama aynı anda çalışabilir.
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: { target: 'es2022' },
})
