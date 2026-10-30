// Vue demosu uçtan uca testleri (tests/e2e). React web + API için `playwright.react.config.ts`.
// Dev sunucusu `E2E_VUE_PORT` (varsayılan 5173) portunda `--strictPort` ile açılır; paralel
// worktree'lerde her koşu kendi portunu verir. Mevcut sunucu asla yeniden kullanılmaz: başka bir
// worktree'nin sunucusuna bağlanıp yanlış kodu sınamak yerine port doluysa koşu hata verir.
import { defineConfig } from '@playwright/test'

function vuePort(): number {
  const value = Number(process.env.E2E_VUE_PORT ?? 5173)
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('E2E_VUE_PORT geçerli bir port değil.')
  return value
}

const port = vuePort()
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
  },
})
