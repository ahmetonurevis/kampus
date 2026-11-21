import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Ders Videoları: izleme ilerlemesinin yazılması ve kaldığı yerden devam (IST-041, DOM-KYN-005).
// Gerçek medya oynatımı CI'da kararsızdır (OG-975 karantinası): oynatıcı olayları (`timeupdate`,
// `pause`, `loadedmetadata`) elemandan tetiklenir, süre ve konum eleman üzerinde taklit edilir.
// Yazan her test kendi kurumunu kurar; paylaşılan seed oturumları salt okunurdur.

const VIDEOS_URL = '/ogrenci/videolar'
const PROGRESS = '/api/v1/collections/videoProgress?pageSize=100'
/** `Hücreyi keşfedelim: bitki ve hayvan`: örnek veride izlenmemiş (%0) 7. Sınıf videosu. */
const VIDEO_ID = 'v2'
const VIDEO_TITLE = 'Hücreyi keşfedelim: bitki ve hayvan'

const tenantOptions = {
  roles: ['ogrenci'],
  students: ['s1'],
  collections: ['videos', 'videoProgress'],
} as const

interface StoredProgress {
  progress: number
  positionSeconds?: number
  durationSeconds?: number
}

async function storedProgress(client: ApiClient, videoId = VIDEO_ID) {
  const result = await client.get(PROGRESS)
  expect(result.status).toBe(200)
  const rows = (result.body as { data: { record: Record<string, unknown> }[] }).data
  return rows.map((row) => row.record).find((record) => record.videoId === videoId) as
    StoredProgress | undefined
}

/** Oynatıcının süresini ve konumunu taklit eder; konum atamaları `window.__seeks`e yazılır. */
async function fakePlayer(page: Page, state: { position: number; duration: number }) {
  await page
    .getByRole('dialog')
    .locator('video')
    .evaluate((element, fake) => {
      const target = window as unknown as { __seeks?: number[]; __position?: number }
      target.__seeks = []
      target.__position = fake.position
      Object.defineProperty(element, 'duration', { configurable: true, value: fake.duration })
      Object.defineProperty(element, 'currentTime', {
        configurable: true,
        get: () => target.__position ?? 0,
        set: (value: number) => {
          target.__seeks?.push(value)
          target.__position = value
        },
      })
    }, state)
}

const fire = (page: Page, type: string, position?: number) =>
  page
    .getByRole('dialog')
    .locator('video')
    .evaluate(
      (element, args) => {
        const target = window as unknown as { __position?: number }
        if (args.position !== undefined) target.__position = args.position
        element.dispatchEvent(new Event(args.type))
      },
      { type, position },
    )

test.describe('öğrenci: video izleme ilerlemesi', () => {
  test('DOM-KYN-005: oynatırken seyrek, duraklatınca hemen yazılır; liste yeni yüzdeyi gösterir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant(tenantOptions)
    const student = await api(school.user('ogrenci'))
    expect(await storedProgress(student)).toMatchObject({ progress: 0 })
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes(`/videos/${VIDEO_ID}/progress`))
        writes.push(request.postData() ?? '')
    })

    await loginAs(school.user('ogrenci'))
    await page.goto(VIDEOS_URL)
    await page.getByRole('button', { name: new RegExp(`${VIDEO_TITLE}.*videosunu aç`) }).click()
    const dialog = page.getByRole('dialog', { name: VIDEO_TITLE })
    await expect(dialog.locator('video')).toBeVisible()
    await fakePlayer(page, { position: 0, duration: 100 })

    // Konum olayları aralık dolmadan gönderilmez.
    for (const position of [5, 10, 15, 20, 25]) await fire(page, 'timeupdate', position)
    await fire(page, 'pause', 40)
    await expect.poll(async () => (await storedProgress(student))?.progress).toBe(40)
    expect(await storedProgress(student)).toMatchObject({
      progress: 40,
      positionSeconds: 40,
      durationSeconds: 100,
    })
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0] ?? '{}')).toEqual({ positionSeconds: 40, durationSeconds: 100 })

    // Yazma okumayı tazeler: pencerede ve listede yeni yüzde görünür.
    await expect(dialog.getByText('%40 izlendi')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    const card = page.getByRole('button', { name: new RegExp(`${VIDEO_TITLE}.*videosunu aç`) })
    await expect(card).toContainText('%40 izlendi · Devam et')
    await expect(
      card.getByRole('progressbar', { name: `${VIDEO_TITLE} izleme ilerlemesi` }),
    ).toHaveAttribute('aria-valuenow', '40')
  })

  test('DOM-KYN-005: pencereyi kapatmak oynatılan son konumu yazar; ilerleme geri gitmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant(tenantOptions)
    const student = await api(school.user('ogrenci'))
    await loginAs(school.user('ogrenci'))
    await page.goto(`${VIDEOS_URL}?video=${VIDEO_ID}`)
    const dialog = page.getByRole('dialog', { name: VIDEO_TITLE })
    await expect(dialog.locator('video')).toBeVisible()
    await fakePlayer(page, { position: 0, duration: 200 })
    await fire(page, 'timeupdate', 150)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await storedProgress(student))?.positionSeconds).toBe(150)
    expect((await storedProgress(student))?.progress).toBe(75)

    // Geri sarıp bırakmak yüzdeyi düşürmez, son konumu günceller.
    await page.getByRole('button', { name: new RegExp(`${VIDEO_TITLE}.*videosunu aç`) }).click()
    await expect(dialog.locator('video')).toBeVisible()
    await fakePlayer(page, { position: 0, duration: 200 })
    await fire(page, 'pause', 20)
    await expect.poll(async () => (await storedProgress(student))?.positionSeconds).toBe(20)
    expect((await storedProgress(student))?.progress).toBe(75)
  })

  test('DOM-KYN-005: yeniden açınca kayıtlı konumdan başlar; bitirilmiş video baştan başlar', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant(tenantOptions)
    const student = await api(school.user('ogrenci'))
    const saved = await student.post(`/api/v1/videos/${VIDEO_ID}/progress`, {
      positionSeconds: 40,
      durationSeconds: 100,
    })
    expect(saved.status).toBe(200)

    await loginAs(school.user('ogrenci'))
    await page.goto(`${VIDEOS_URL}?video=${VIDEO_ID}`)
    const dialog = page.getByRole('dialog', { name: VIDEO_TITLE })
    await expect(dialog.locator('video')).toBeVisible()
    await expect(dialog.getByText('%40 izlendi')).toBeVisible()
    await fakePlayer(page, { position: 0, duration: 100 })
    await fire(page, 'loadedmetadata')
    expect(await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks)).toEqual(
      [40],
    )

    // Bitişe kadar izlenmişse devam yerine baştan başlanır.
    expect(
      (
        await student.post(`/api/v1/videos/${VIDEO_ID}/progress`, {
          positionSeconds: 100,
          durationSeconds: 100,
        })
      ).status,
    ).toBe(200)
    await page.reload()
    await expect(dialog.getByText('%100 izlendi')).toBeVisible()
    await fakePlayer(page, { position: 0, duration: 100 })
    await fire(page, 'loadedmetadata')
    expect(await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks)).toEqual(
      [],
    )
  })

  test('yazma hatası kullanıcıya gösterilmez; oynatıcı ve pencere çalışmaya devam eder', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant(tenantOptions)
    let failed = 0
    await page.route(`**/api/v1/videos/${VIDEO_ID}/progress`, async (route) => {
      failed += 1
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'internal_error',
          message: 'Beklenmeyen hata.',
          requestId: 'x',
        }),
      })
    })
    await loginAs(school.user('ogrenci'))
    await page.goto(`${VIDEOS_URL}?video=${VIDEO_ID}`)
    const dialog = page.getByRole('dialog', { name: VIDEO_TITLE })
    await expect(dialog.locator('video')).toBeVisible()
    await fakePlayer(page, { position: 0, duration: 100 })
    await fire(page, 'pause', 30)
    await expect.poll(() => failed).toBe(1)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
    await expect(dialog.locator('video')).toBeVisible()
  })
})
