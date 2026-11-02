// Vue demosu uçtan uca testleri (tests/e2e). React web + API için `playwright.react.config.ts`.
// Sunucu `E2E_VUE_PORT` (varsayılan 5173) portunda `--strictPort` ile açılır; paralel
// worktree'lerde her koşu kendi portunu verir. Mevcut sunucu asla yeniden kullanılmaz: başka bir
// worktree'nin sunucusuna bağlanıp yanlış kodu sınamak yerine port doluysa koşu hata verir.
// Yerelde dev sunucusu; CI'da derlenmiş uygulama (`vite preview`, önce `pnpm --filter @kampus/web
// build`): soğuk Vite optimizer'ı CI'da sayfa açılışlarını 45 sn test sınırının üstüne çıkarıyordu.
import { defineConfig } from '@playwright/test'

function vuePort(): number {
  const value = Number(process.env.E2E_VUE_PORT ?? 5173)
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('E2E_VUE_PORT geçerli bir port değil.')
  return value
}

const ci = !!process.env.CI
const port = vuePort()
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 2,
  forbidOnly: ci,
  // Yeniden deneme yalnız CI'da ve en fazla 1 (.claude/rules/testler.md).
  retries: ci ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: ci
      ? `pnpm --filter @kampus/web exec vite preview --host 127.0.0.1 --port ${port} --strictPort`
      : `pnpm dev --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
  },
})
