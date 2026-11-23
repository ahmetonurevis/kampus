import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Okuma sayfaları (W18): yönetici SLA Raporu ve öğrenci Ders Videoları. İkisi de yalnız okur
// (video izleme ilerlemesinin yazılması `video-ilerleme.spec.ts`'tedir);
// paylaşılan seed oturumları salt okunurdur. Beklenen değerler kapsamı uygulayan API'den gelir
// (seed saati e2e kurulumunda sabittir, ihlal eşiği test anında hesaplanır). Sayıları belirli
// olması gereken testler (ihlal, boş durum) kendi kurumunu kurar.

const COLLECTIONS = '/api/v1/collections'
const SLA_URL = '/yonetici/sla-raporu'
const SLA_TABLE = 'Öğretmen SLA raporu'
const VIDEOS_URL = '/ogrenci/videolar'
const MODULE_CLOSED = 'Bu modül kurum ayarlarından kapatılmış.'
const HOUR = 3_600_000

const tableOf = (page: Page, name: string) => page.getByRole('table', { name })
const bodyRows = (page: Page, name: string) => tableOf(page, name).locator('tbody tr')
const resultCount = (page: Page) => page.locator('.result-count')
const search = (page: Page) => page.getByLabel('Tabloda ara')

interface CollectionPage {
  data: { id: string; record: Record<string, unknown> }[]
  meta: { total: number }
}

async function listAll(client: ApiClient, collection: string, query = '') {
  const records: Record<string, unknown>[] = []
  for (let page = 1; ; page++) {
    const result = await client.get(
      `${COLLECTIONS}/${collection}?pageSize=100&page=${page}${query}`,
    )
    expect(result.status, `${collection} sayfa ${page}`).toBe(200)
    const body = result.body as CollectionPage
    records.push(...body.data.map((row) => row.record))
    if (records.length >= body.meta.total || body.data.length === 0) return records
  }
}

async function readCsv(download: Download): Promise<string[][]> {
  const text = await readFile(await download.path(), 'utf8')
  expect(text.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
  return text
    .slice(1)
    .split('\r\n')
    .filter((line) => line !== '')
    .map((line) => line.split(';').map((cell) => cell.replace(/^"|"$/g, '')))
}

async function downloadReport(page: Page): Promise<string[][]> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Raporu indir' }).click()
  return readCsv(await pending)
}

interface ModuleSettings {
  data: { version: number }
}

/** Yönetici adına modülü kapatır (kurum ayarının sürümü okunur, `If-Match` ile gönderilir). */
async function closeModule(client: ApiClient, moduleKey: string) {
  const settings = await client.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const response = await client.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled: false },
    headers: {
      'if-match': `"${(settings.body as ModuleSettings).data.version}"`,
      'idempotency-key': randomUUID(),
    },
  })
  expect(response.status()).toBe(200)
}

/** Bir sorunun süre hedefini aşıp aşmadığı: sayfadaki kuralın bağımsız yazımı (24 saat). */
function breached(question: Record<string, unknown>, now: number): boolean {
  const created = Date.parse(String(question.createdAt))
  return question.answeredAt
    ? Date.parse(String(question.answeredAt)) - created > 24 * HOUR
    : now - created >= 24 * HOUR
}

/** Testin kendi soru kaydı: öğretmen t1'e, `askedHoursAgo` saat önce sorulmuş. */
function slaQuestion(id: string, askedHoursAgo: number, answeredAfterHours: number | null) {
  const now = Date.now()
  return {
    collection: 'questions' as const,
    data: {
      id,
      studentId: 's1',
      teacherId: 't1',
      subjectId: 'math',
      title: `Soru ${id}`,
      text: 'Çözümü açıklar mısınız?',
      createdAt: new Date(now - askedHoursAgo * HOUR).toISOString(),
      answeredAt:
        answeredAfterHours === null
          ? null
          : new Date(now - (askedHoursAgo - answeredAfterHours) * HOUR).toISOString(),
      answer: answeredAfterHours === null ? '' : 'Yanıt',
      fileName: null,
    },
  }
}

test.describe('yönetici: SLA Raporu', () => {
  test('öğretmen satırları ve özet kartları soru kayıtlarından hesaplanır', async ({
    page,
    loginAs,
    api,
  }) => {
    const admin = await api('yonetici')
    const teachers = (await listAll(admin, 'teachers')).filter((teacher) => teacher.isActive)
    const questions = await listAll(admin, 'questions')
    const now = Date.now()
    expect(questions.length).toBeGreaterThan(0)

    await loginAs('yonetici')
    await page.goto(SLA_URL)
    await expect(page.getByRole('heading', { name: 'SLA Raporu', level: 1 })).toBeVisible()
    await expect(resultCount(page)).toContainText(`/ ${teachers.length} kayıt`)

    const summary = page.getByLabel('SLA özeti', { exact: true })
    const pending = questions.filter((question) => !question.answeredAt).length
    await expect(summary).toContainText('Toplam soru')
    await expect(summary.locator('dd').nth(0)).toHaveText(String(questions.length))
    await expect(summary.locator('dd').nth(1)).toHaveText(String(pending))
    await expect(summary).toContainText('24 saat içinde yanıt')

    // Sorusu olan ilk üç öğretmenin satırı API'deki kayıtlarla aynıdır (tablo 8'erli sayfalıdır).
    const withQuestions = teachers
      .filter((teacher) => questions.some((question) => question.teacherId === teacher.id))
      .slice(0, 3)
    expect(withQuestions.length).toBeGreaterThan(0)
    for (const teacher of withQuestions) {
      const own = questions.filter((question) => question.teacherId === teacher.id)
      const ownBreaches = own.filter((question) => breached(question, now)).length
      await search(page).fill(String(teacher.name))
      const row = bodyRows(page, SLA_TABLE).filter({ hasText: String(teacher.name) })
      await expect(row).toHaveCount(1)
      await expect(row.locator('td').nth(2)).toHaveText(String(own.length))
      await expect(row.locator('td').nth(4)).toHaveText(
        String(own.filter((question) => !question.answeredAt).length),
      )
      await expect(row.locator('td').nth(5)).toHaveText(
        ownBreaches > 0 ? `${ownBreaches} ihlal` : '0',
      )
    }
  })

  test('ihlal, bekleyen ve ortalama yanıt süresi tanımlı kayıtlardan çıkar', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      records: [
        slaQuestion('sla-q1', 30, 2), // yanıt 2 sa: uyumlu
        slaQuestion('sla-q2', 40, 30), // yanıt 30 sa: ihlal
        slaQuestion('sla-q3', 26, null), // bekliyor, süre doldu: ihlal
        slaQuestion('sla-q4', 1, null), // bekliyor, süre var
      ],
    })
    await loginAs(school.user('yonetici'))
    await page.goto(SLA_URL)
    const row = bodyRows(page, SLA_TABLE).filter({ hasText: 'Selin Kaya' })
    await expect(row).toHaveCount(1)
    await expect(row.locator('td').nth(2)).toHaveText('4')
    await expect(row.locator('td').nth(3)).toHaveText('16 sa')
    await expect(row.locator('td').nth(4)).toHaveText('2')
    await expect(row.locator('td').nth(5)).toHaveText('2 ihlal')
    await expect(row.locator('td').nth(6)).toHaveText('%50')

    const summary = page.getByLabel('SLA özeti', { exact: true })
    await expect(summary.locator('dd').nth(0)).toHaveText('4')
    await expect(summary.locator('dd').nth(2)).toHaveText('2')
    await expect(summary.locator('dd').nth(3)).toHaveText('%50')
    // Sorusu olmayan öğretmen için yanıt süresi uydurulmaz.
    await expect(
      bodyRows(page, SLA_TABLE).filter({ hasText: 'Henüz yanıt yok' }).first(),
    ).toBeVisible()
  })

  test('arama ve ihlal filtresi sonucu daraltır; temizleyince liste döner', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      records: [slaQuestion('sla-q5', 30, null)],
    })
    await loginAs(school.user('yonetici'))
    await page.goto(SLA_URL)
    await expect(resultCount(page)).toContainText('/ ')
    const total = Number(/\/ (\d+) kayıt/.exec((await resultCount(page).textContent()) ?? '')?.[1])
    expect(total).toBeGreaterThan(1)

    await search(page).fill('Selin Kaya')
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
    await expectEveryRow(bodyRows(page, SLA_TABLE), 'Selin Kaya')

    await search(page).fill('zzzz-yok')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(resultCount(page)).toContainText(`/ ${total} kayıt`)

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('İhlal en az').fill('1')
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
    await expectEveryRow(bodyRows(page, SLA_TABLE), 'Selin Kaya')
  })

  test('rapor CSV filtrelenmiş tüm öğretmen satırlarını içerir', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      records: [slaQuestion('sla-q6', 30, 2), slaQuestion('sla-q7', 3, null)],
    })
    await loginAs(school.user('yonetici'))
    await page.goto(SLA_URL)
    await expect(resultCount(page)).toContainText('1–8 / ')
    const total = Number(/\/ (\d+) kayıt/.exec((await resultCount(page).textContent()) ?? '')?.[1])
    expect(total).toBeGreaterThan(8)
    const all = await downloadReport(page)
    expect(all[0]).toEqual([
      'Öğretmen',
      'Sınıflar',
      'Soru',
      'Ort. yanıt süresi',
      'Bekleyen',
      'İhlal',
      'SLA uyumu (%)',
    ])
    expect(all).toHaveLength(total + 1)
    const selin = all.find((row) => row[0] === 'Selin Kaya')
    expect(selin?.slice(2)).toEqual(['2', '2 sa', '1', '0', '100'])

    await search(page).fill('Selin Kaya')
    await expect(resultCount(page)).toContainText('/ 1 kayıt')
    const filtered = await downloadReport(page)
    expect(filtered).toHaveLength(2)
    expect(filtered[1]?.[0]).toBe('Selin Kaya')
  })

  test('soru kaydı yoksa özet ve tablo boş durum gösterir', async ({ page, loginAs, tenant }) => {
    const school = await tenant({ roles: ['yonetici'], students: [] })
    await loginAs(school.user('yonetici'))
    await page.goto(SLA_URL)
    const summary = page.getByLabel('SLA özeti', { exact: true })
    await expect(summary.locator('dd').nth(0)).toHaveText('0')
    await expect(summary.locator('dd').nth(3)).toHaveText('—')
    await expect(summary).toContainText('Henüz soru yok')
    await expect(bodyRows(page, SLA_TABLE).first().locator('td').nth(3)).toHaveText(
      'Henüz yanıt yok',
    )
  })

  test('rol kapsamı: yönetici dışı roller sayfayı açamaz, öğretmen yalnız kendi sorularını okur', async ({
    page,
    loginAs,
    api,
  }) => {
    for (const [role, home] of [
      ['onburo', /\/onburo\/dashboard$/],
      ['ogretmen', /\/ogretmen\/dashboard$/],
      ['ogrenci', /\/ogrenci\/dashboard$/],
      ['veli', /\/veli\/dashboard(\?|$)/],
    ] as const) {
      await loginAs(role)
      await page.goto(SLA_URL)
      await expect(page).toHaveURL(home)
    }
    const all = await listAll(await api('yonetici'), 'questions')
    const own = await listAll(await api('ogretmen'), 'questions')
    expect(own.length).toBeGreaterThan(0)
    expect(own.length).toBeLessThan(all.length)
    expect(new Set(own.map((question) => question.teacherId))).toEqual(new Set(['t1']))
    expect((await (await api('onburo')).get(`${COLLECTIONS}/questions`)).status).toBe(403)
  })

  test('öğrenme modülü kapanınca sayfa ve soru ucu kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], students: ['s1'] })
    const admin = await api(school.user('yonetici'))
    expect((await admin.get(`${COLLECTIONS}/questions`)).status).toBe(200)
    await closeModule(admin, 'learning')
    await loginAs(school.user('yonetici'))
    await page.goto(SLA_URL)
    await expect(page.getByText(MODULE_CLOSED)).toBeVisible()
    await expect(page).toHaveURL(/\/yonetici\/dashboard/)
    expect((await admin.get(`${COLLECTIONS}/questions`)).status).toBe(403)
  })
})

test.describe('öğrenci: Ders Videoları', () => {
  test('kapsamdaki videolar kartlarla açılır; izleme ilerlemesi kayıttan gelir', async ({
    page,
    loginAs,
    api,
  }) => {
    const student = await api('ogrenci')
    const videos = await listAll(student, 'videos')
    const progress = await listAll(student, 'videoProgress')
    const teachers = await listAll(student, 'teachers')
    expect(videos.length).toBeGreaterThan(0)
    const first = videos.find((video) => video.id === 'v1')
    expect(first).toBeDefined()
    const watched = Number(progress.find((entry) => entry.videoId === 'v1')?.progress)
    expect(watched).toBeGreaterThan(0)

    await loginAs('ogrenci')
    await page.goto(VIDEOS_URL)
    await expect(page.getByRole('heading', { name: 'Ders Videoları', level: 1 })).toBeVisible()
    const cards = page.getByRole('button', { name: /videosunu aç$/ })
    await expect(cards).toHaveCount(videos.length)

    const card = page.getByRole('button', { name: `${String(first?.title)} videosunu aç` })
    await expect(card).toContainText(`%${watched} izlendi · Devam et`)
    await expect(card).toContainText('Devam et')
    const teacher = teachers.find((item) => item.id === first?.teacherId)
    await expect(card).toContainText(String(teacher?.name ?? '—'))
    await expect(
      card.getByRole('progressbar', { name: `${String(first?.title)} izleme ilerlemesi` }),
    ).toHaveAttribute('aria-valuenow', String(watched))
    // İzlenmemiş videoda ilerleme çubuğu boş, eylem "Dersi izle"dir.
    const untouched = page.getByRole('button', { name: /Hücreyi keşfedelim.*videosunu aç/ })
    await expect(untouched).toContainText('Henüz izlenmedi')
    await expect(untouched).toContainText('Dersi izle')
  })

  test('arama ve ders filtresi videoları daraltır; eşleşme yoksa boş sonuç, temizleyince liste döner', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogrenci')
    await page.goto(VIDEOS_URL)
    const cards = page.getByRole('button', { name: /videosunu aç$/ })
    await expect(cards).toHaveCount(2)

    await page.getByLabel('Video ara').fill('Denklem')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Denklemleri adım adım çözelim')

    await page.getByLabel('Video ara').fill('zzzz-yok')
    await expect(cards).toHaveCount(0)
    await expect(page.getByText('Uygun kayıt bulunamadı.')).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(cards).toHaveCount(2)

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Ders', { exact: true }).selectOption({ label: 'Fen Bilimleri' })
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Hücreyi keşfedelim')
  })

  test('video penceresi adreste açılır: oynatıcı, altyazı ve ilerleme; geri düğmesi kapatır', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogrenci')
    await page.goto(VIDEOS_URL)
    await page.getByRole('button', { name: 'Denklemleri adım adım çözelim videosunu aç' }).click()
    const dialog = page.getByRole('dialog', { name: 'Denklemleri adım adım çözelim' })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/[?&]video=v1/)
    const player = dialog.locator('video')
    await expect(player).toHaveAttribute('controls', '')
    await expect(player.locator('source')).toHaveAttribute('src', '/videos/denklemler.mp4')
    await expect(player.locator('track')).toHaveAttribute('src', '/videos/denklemler.vtt')
    await expect(dialog.getByText('%35 izlendi')).toBeVisible()
    await dialog.getByText('Ders notları ve metin dökümü').click()
    await expect(dialog.getByText('2x + 6 = 18. Önce her iki taraftan 6 çıkarırız')).toBeVisible()
    // Oynatıcı dosyaları gerçekten sunulur.
    for (const path of ['/videos/denklemler.mp4', '/videos/denklemler.vtt']) {
      expect((await page.request.get(path)).status(), path).toBe(200)
    }

    await page.goBack()
    await expect(dialog).toHaveCount(0)
    await expect(page).not.toHaveURL(/video=/)
    await page.goForward()
    await expect(dialog).toBeVisible()
  })

  test('kapsam dışı video adresi kayıt bulunamadı der', async ({ page, loginAs }) => {
    await loginAs('ogrenci')
    await page.goto(`${VIDEOS_URL}?video=v-yok`)
    await expect(page.getByRole('dialog').getByText('Kayıt bulunamadı')).toBeVisible()
  })

  test('düzeyine video yoksa boş durum gösterilir', async ({ page, loginAs, tenant }) => {
    const school = await tenant({ roles: ['ogrenci'], students: ['s1'] })
    await loginAs(school.user('ogrenci'))
    await page.goto(VIDEOS_URL)
    await expect(page.getByRole('heading', { name: 'Ders Videoları', level: 1 })).toBeVisible()
    await expect(page.getByText('Henüz kayıt yok.')).toBeVisible()
    await expect(page.getByRole('button', { name: /videosunu aç$/ })).toHaveCount(0)
  })

  test('rol kapsamı: öğrenci yalnız kendi ilerlemesini okur, diğer roller sayfayı açamaz', async ({
    page,
    loginAs,
    api,
  }) => {
    const mine = await listAll(await api('ogrenci'), 'videoProgress')
    const all = await listAll(await api('yonetici'), 'videoProgress')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.length).toBeLessThan(all.length)
    expect(new Set(mine.map((entry) => entry.studentId))).toEqual(new Set(['s1']))
    expect((await (await api('onburo')).get(`${COLLECTIONS}/videos`)).status).toBe(403)

    for (const [role, home] of [
      ['yonetici', /\/yonetici\/dashboard$/],
      ['onburo', /\/onburo\/dashboard$/],
      ['ogretmen', /\/ogretmen\/dashboard$/],
    ] as const) {
      await loginAs(role)
      await page.goto(VIDEOS_URL)
      await expect(page).toHaveURL(home)
    }
  })

  test('öğrenme modülü kapanınca sayfa ve video uçları kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogrenci'], students: ['s1'] })
    const admin = await api(school.user('yonetici'))
    await closeModule(admin, 'learning')
    await loginAs(school.user('ogrenci'))
    await page.goto(VIDEOS_URL)
    await expect(page.getByText(MODULE_CLOSED)).toBeVisible()
    await expect(page).toHaveURL(/\/ogrenci\/dashboard/)
    const student = await api(school.user('ogrenci'))
    expect((await student.get(`${COLLECTIONS}/videos`)).status).toBe(403)
    expect((await student.get(`${COLLECTIONS}/videoProgress`)).status).toBe(403)
  })
})

test.describe('390 px genişlik', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('SLA raporu yatay taşmaz', async ({ page, loginAs }) => {
    await loginAs('yonetici')
    await page.goto(SLA_URL)
    await expect(page.getByLabel('SLA özeti', { exact: true })).toBeVisible()
    await expect(page.getByText('Selin Kaya').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('ders videoları ve oynatıcı penceresi yatay taşmaz', async ({ page, loginAs }) => {
    await loginAs('ogrenci')
    await page.goto(VIDEOS_URL)
    await expect(page.getByRole('button', { name: /videosunu aç$/ }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Denklemleri adım adım çözelim videosunu aç' }).click()
    await expect(page.getByRole('dialog', { name: 'Denklemleri adım adım çözelim' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
