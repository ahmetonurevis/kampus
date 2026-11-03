// React web + API uçtan uca testleri (tests/e2e-react). Vue demosunun yapılandırması
// `playwright.config.ts` ayrıdır. Sunucular `webServer` ile değil global kurulumla başlar çünkü
// veritabanı sıfırlanıp seed edildikten sonra API ayağa kalkmalıdır (tests/e2e-react/support).
import { defineConfig } from '@playwright/test'

import { e2e } from './tests/e2e-react/support/env.ts'

const ci = !!process.env.CI
/** Dar ekran (telefon) taraması yalnız kendi projesinde koşar (OG-098, IST-127). */
const NARROW_SPECS = '**/dar-ekran-*.spec.ts'

export default defineConfig({
  testDir: './tests/e2e-react',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/e2e-react',
  globalSetup: './tests/e2e-react/support/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 2,
  forbidOnly: ci,
  // Yeniden deneme yalnız CI'da ve en fazla 1 (.claude/rules/testler.md).
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/e2e-react' }]]
    : [['list']],
  use: {
    baseURL: e2e.webOrigin,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Mevcut testler masaüstünde (1440×1000) koşar; dar ekran spec'leri buraya girmez.
    { name: 'masaustu', testIgnore: NARROW_SPECS },
    {
      name: 'dar-ekran',
      testMatch: NARROW_SPECS,
      use: { viewport: { width: 360, height: 740 } },
    },
  ],
})
