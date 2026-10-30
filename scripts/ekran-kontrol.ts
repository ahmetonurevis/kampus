// Ekran kontrolü: verilen route'ları açık/koyu temada ve seçili genişliklerde görüntüler,
// konsol hatalarını ve yatay taşmayı raporlar. Kullanım: .claude/skills/ekran-kontrol/SKILL.md
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type BrowserContext, type Page } from '@playwright/test'

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:5174' },
    routes: { type: 'string', default: '/giris' },
    themes: { type: 'string', default: 'light,dark' },
    widths: { type: 'string', default: '1440,390' },
    height: { type: 'string', default: '900' },
    out: { type: 'string', default: 'artifacts/ekran-kontrol' },
    // web-react gerçek girişi: rol anahtarı (ör. yonetici) Akademi demo hesabına eşlenir.
    // Vue için boş bırakılır. Hesap ve parola `apps/api/src/db/demo-seed.ts`'ten gelir.
    rol: { type: 'string', default: '' },
    eposta: { type: 'string', default: '' },
    parola: { type: 'string', default: process.env.DEMO_PASSWORD || 'Demo-Giris-2026!' },
    cikis: { type: 'boolean', default: false },
    tam: { type: 'boolean', default: false },
    'azaltilmis-hareket': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  console.log(`node scripts/ekran-kontrol.ts [seçenekler]
  --base <url>            Uygulama adresi (varsayılan http://127.0.0.1:5174)
  --routes <a,b>          Virgülle ayrılmış route listesi (varsayılan /giris)
  --themes <light,dark>   Temalar
  --widths <1440,390>     Görüntü genişlikleri (px)
  --height <900>          Görüntü yüksekliği (px)
  --rol <anahtar>         web-react'te bu rolün Akademi demo hesabıyla gerçek giriş yapar
  --eposta <adres>        --rol yerine/üstüne giriş e-postası (ör. çok kurumlu hesap)
  --parola <parola>       Giriş parolası (varsayılan DEMO_PASSWORD ya da demo parolası)
  --cikis                 Sonda avatar menüsünden çıkış yapar, korumalı adresin girişe döndüğünü denetler
  --tam                   Tam sayfa ekran görüntüsü
  --azaltilmis-hareket    prefers-reduced-motion: reduce taklidi
  --out <klasör>          Çıktı klasörü (varsayılan artifacts/ekran-kontrol)`)
  process.exit(0)
}

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
const routes = list(values.routes)
const themes = list(values.themes).filter((theme) => theme === 'light' || theme === 'dark')
const widths = list(values.widths)
  .map(Number)
  .filter((width) => Number.isInteger(width) && width > 0)
const height = Number(values.height) || 900
const outDir = resolve(values.out)
const slug = (route: string) =>
  route.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9-]+/gi, '_') || 'kok'

type Finding = {
  route: string
  theme: string
  width: number
  file: string
  overflow: number
  overflowElements: string[]
  consoleErrors: string[]
  /** Tema dışında tarayıcı deposuna yazılan anahtarlar (belirteç/kişisel veri yazılmamalı). */
  storageKeys: string[]
}

/** `apps/api/src/db/demo-seed.ts` Akademi Özel Okulları demo hesapları. */
const DEMO_EMAILS: Record<string, string> = {
  yonetici: 'murat.yilmaz@kampus.example',
  onburo: 'busra.aydin@kampus.example',
  ogretmen: 'selin.kaya@kampus.example',
  ogrenci: 'deniz.yilmaz@kampus.example',
  veli: 'ayse.yilmaz@kampus.example',
}
const loginEmail = values.eposta || DEMO_EMAILS[values.rol] || ''
if (values.rol && !loginEmail) {
  console.error(`Bilinmeyen rol: ${values.rol}. Seçenekler: ${Object.keys(DEMO_EMAILS).join(', ')}`)
  process.exit(2)
}
const signedIn = Boolean(loginEmail)

const nextFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  )

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await nextFrames(page)
  // Genişlik değişiminden doğan geçişler bitmeden görüntü alınmaz; sonsuz animasyonlar beklenmez.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
      new Promise((done) => setTimeout(done, 2000)),
    ]).then(() => undefined),
  )
  await nextFrames(page)
}

// Gerçek giriş (Better Auth): oturum çerezde olduğundan sonraki route'lar tam sayfa açılır.
// Giriş uçunun hız sınırı (dakikada 5) için her koşuda bir kez girilir, çerez diğer temalara taşınır.
async function login(page: Page) {
  await page.goto(new URL('/giris', values.base).href)
  await page.getByLabel('E-posta').fill(loginEmail)
  await page.getByLabel('Parola').fill(values.parola)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/giris'), { timeout: 15_000 })
  } catch (error) {
    const reason = await page
      .locator('[role="alert"], [data-sonner-toast], [data-slot="field-error"]')
      .allInnerTexts()
      .catch(() => [])
    throw new Error(`Giriş başarısız (${loginEmail}): ${reason.join(' | ') || 'yanıt yok'}`, {
      cause: error,
    })
  }
}

/** Çıkış: avatar menüsünden; ardından korumalı adres dönüş adresiyle girişe yönlenmeli. */
async function signOut(page: Page): Promise<string[]> {
  const problems: string[] = []
  await page.getByRole('button', { name: /^Hesap menüsü/ }).click()
  await page.getByRole('menuitem', { name: 'Oturumu kapat' }).click()
  await page.waitForURL((url) => url.pathname === '/giris', { timeout: 15_000 })
  const target = routes[0] ?? '/'
  await page.goto(new URL(target, values.base).href)
  await page
    .waitForURL((url) => url.pathname === '/giris', { timeout: 15_000 })
    .catch(() => {
      problems.push(`çıkıştan sonra ${target} girişe yönlenmedi (${page.url()})`)
    })
  return problems
}

// İzinli anahtarlar: tema tercihi ve react-router ScrollRestoration'ın yol → kaydırma konumu
// eşlemesi (yalnız sayı; belirteç veya kişisel veri değil).
const ALLOWED_STORAGE_KEYS = [
  'localStorage:kampus-theme',
  'sessionStorage:react-router-scroll-positions',
]

async function storageKeys(page: Page): Promise<string[]> {
  const keys = await page.evaluate(() => [
    ...Object.keys(localStorage).map((key) => `localStorage:${key}`),
    ...Object.keys(sessionStorage).map((key) => `sessionStorage:${key}`),
  ])
  return keys.filter((key) => !ALLOWED_STORAGE_KEYS.includes(key))
}

async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const overflow = root.scrollWidth - root.clientWidth
    const elements: string[] = []
    if (overflow > 0) {
      for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
        const box = element.getBoundingClientRect()
        if (box.right > root.clientWidth + 1 && box.width > 0) {
          const name = element.tagName.toLowerCase()
          const id = element.id ? `#${element.id}` : ''
          const cls = element.classList.length
            ? `.${[...element.classList].slice(0, 3).join('.')}`
            : ''
          elements.push(`${name}${id}${cls} (sağ ${Math.round(box.right)} px)`)
          if (elements.length >= 8) break
        }
      }
    }
    return { overflow, elements }
  })
}

const browser = await chromium.launch()
const findings: Finding[] = []
const signOutProblems: string[] = []
await mkdir(outDir, { recursive: true })

try {
  let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined
  for (const [index, theme] of themes.entries()) {
    const context = await browser.newContext({
      viewport: { width: widths[0] ?? 1440, height },
      reducedMotion: values['azaltilmis-hareket'] ? 'reduce' : 'no-preference',
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      ...(storageState ? { storageState } : {}),
    })
    await context.addInitScript((value) => {
      try {
        localStorage.setItem('kampus-theme', value)
      } catch {
        // Depolama kapalıysa tema varsayılanda kalır.
      }
    }, theme)
    const page = await context.newPage()
    let errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

    if (signedIn && !storageState) {
      await login(page)
      storageState = await context.storageState()
    }
    for (const route of routes) {
      errors = []
      await page.goto(new URL(route, values.base).href)
      for (const width of widths) {
        await page.setViewportSize({ width, height })
        await settle(page)
        const file = join(outDir, `${slug(route)}-${theme}-${width}.png`)
        await page.screenshot({ path: file, fullPage: values.tam })
        const { overflow, elements } = await measureOverflow(page)
        findings.push({
          route,
          theme,
          width,
          file,
          overflow,
          overflowElements: elements,
          consoleErrors: [...errors],
          storageKeys: await storageKeys(page),
        })
      }
    }
    if (signedIn && values.cikis && index === themes.length - 1)
      signOutProblems.push(...(await signOut(page)))
    await context.close()
  }
} finally {
  await browser.close()
}

await writeFile(join(outDir, 'rapor.json'), `${JSON.stringify(findings, null, 2)}\n`)
const problems = findings.filter(
  (f) => f.overflow > 0 || f.consoleErrors.length || f.storageKeys.length,
)
for (const f of findings) {
  const marks = [
    f.overflow > 0 ? `TAŞMA ${f.overflow} px` : '',
    f.consoleErrors.length ? `KONSOL ${f.consoleErrors.length}` : '',
    f.storageKeys.length ? `DEPO ${f.storageKeys.join(', ')}` : '',
  ].filter(Boolean)
  console.log(`${marks.length ? '✗' : '✓'} ${f.route} · ${f.theme} · ${f.width} → ${f.file}`)
  for (const element of f.overflowElements) console.log(`    taşan: ${element}`)
  for (const error of f.consoleErrors) console.log(`    konsol: ${error}`)
}
if (signedIn && values.cikis)
  console.log(signOutProblems.length ? `✗ çıkış: ${signOutProblems.join('; ')}` : '✓ çıkış')
console.log(
  `\n${findings.length} görüntü, ${problems.length} sorunlu. Rapor: ${join(outDir, 'rapor.json')}`,
)
process.exitCode = problems.length || signOutProblems.length ? 1 : 0
