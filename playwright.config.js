import { defineConfig } from '@playwright/test'
const ci = !!process.env.CI
const port = 5173
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
    // CI'da derlenmiş uygulama (önceden `pnpm build`), yerelde dev sunucusu.
    command: ci
      ? `pnpm --filter @kampus/web exec vite preview --host 127.0.0.1 --port ${port} --strictPort`
      : 'pnpm dev',
    url: origin,
    reuseExistingServer: !process.env.CI,
  },
})
