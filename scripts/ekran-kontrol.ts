// Ekran kontrolü: verilen route'ları açık/koyu temada ve seçili genişliklerde görüntüler,
// konsol hatalarını ve yatay taşmayı raporlar. Kullanım: .claude/skills/ekran-kontrol/SKILL.md
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:5174' },
    routes: { type: 'string', default: '/giris' },
    themes: { type: 'string', default: 'light,dark' },
    widths: { type: 'string', default: '1440,390' },
    height: { type: 'string', default: '900' },
    out: { type: 'string', default: 'artifacts/ekran-kontrol' },
    // web-react geliştirme girişi: rol anahtarı (ör. yonetici). Vue için boş bırakılır.
    rol: { type: 'string', default: '' },
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
  --rol <anahtar>         web-react geliştirme girişiyle bu rolde oturum açar
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
}

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

// Oturum bellekte tutulduğu için route değişimi sayfa yenilemeden, istemci tarafında yapılır.
async function clientNavigate(page: Page, route: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
}

async function login(page: Page, role: string) {
  await page.goto(new URL('/giris', values.base).href)
  await page.locator(`[data-dev-role="${role}"]`).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/giris'))
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
await mkdir(outDir, { recursive: true })

try {
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: { width: widths[0] ?? 1440, height },
      reducedMotion: values['azaltilmis-hareket'] ? 'reduce' : 'no-preference',
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
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

    if (values.rol) await login(page, values.rol)
    for (const route of routes) {
      errors = []
      if (values.rol) await clientNavigate(page, route)
      else await page.goto(new URL(route, values.base).href)
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
        })
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
}

await writeFile(join(outDir, 'rapor.json'), `${JSON.stringify(findings, null, 2)}\n`)
const problems = findings.filter((f) => f.overflow > 0 || f.consoleErrors.length)
for (const f of findings) {
  const marks = [
    f.overflow > 0 ? `TAŞMA ${f.overflow} px` : '',
    f.consoleErrors.length ? `KONSOL ${f.consoleErrors.length}` : '',
  ].filter(Boolean)
  console.log(`${marks.length ? '✗' : '✓'} ${f.route} · ${f.theme} · ${f.width} → ${f.file}`)
  for (const element of f.overflowElements) console.log(`    taşan: ${element}`)
  for (const error of f.consoleErrors) console.log(`    konsol: ${error}`)
}
console.log(
  `\n${findings.length} görüntü, ${problems.length} sorunlu. Rapor: ${join(outDir, 'rapor.json')}`,
)
process.exitCode = problems.length ? 1 : 0
