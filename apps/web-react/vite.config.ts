import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

// API aynı kökenden (`/api`) vekille sunulur: oturum çerezi birinci taraf kalır, CORS gerekmez.
// Hedef yalnız geliştirme/önizleme sunucusunun ortamından gelir; paketlenen koda girmez.
// `localhost` macOS'ta önce ::1'e çözülebildiği, API ise 127.0.0.1'i dinlediği için IP yazılır.
const apiProxy: Record<string, ProxyOptions> = {
  '/api': { target: process.env.KAMPUS_API_URL ?? 'http://127.0.0.1:3000' },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Vue uygulaması 5173'te kalır; iki uygulama aynı anda çalışabilir.
  server: { port: 5174, strictPort: true, proxy: apiProxy },
  preview: { port: 4174, strictPort: true, proxy: apiProxy },
  build: { target: 'es2022' },
})
