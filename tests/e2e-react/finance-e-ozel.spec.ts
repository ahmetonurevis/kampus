import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// e-Özel işlem listesi (IST-085, DOM-KAY-015): dil okulunda "Finans > e-Özel işlem listesi". Veri
// yazan test kendi dil okulunu kurar. Okulda sekme yoktur, adresle de açılmaz.

const ADMIN_URL = '/yonetici/finans?gorunum=e-ozel'
const FRONT_OFFICE_URL = '/onburo/tahsilat-takip?gorunum=e-ozel'
const TABLE = 'e-Özel işlem listesi'
const tableOf = (page: Page) => page.getByRole('table', { name: TABLE })

test.describe('e-Özel işlem listesi', () => {
  test('IST-085: yönetici kursiyeri işler, işaret kim/ne zaman ile görünür ve geri alınır, dosya iner', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      students: ['s16'],
    })
    await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const table = tableOf(page)
    await page.getByRole('combobox', { name: /^Tür/ }).selectOption('learner')
    const markButton = table.getByRole('button', { name: /işlendi olarak işaretle/ })
    await expect(markButton).toHaveCount(1)
    await expect(page.getByRole('combobox', { name: /^e-Özel durumu/ })).toHaveValue('pending')
    await expectNoHorizontalOverflow(page)

    await markButton.click()
    await expect(markButton).toHaveCount(0)

    await page.getByRole('combobox', { name: /^e-Özel durumu/ }).selectOption('recorded')
    const undo = table.getByRole('button', { name: /işaretini kaldır/ })
    await expect(undo).toHaveCount(1)
    await expect(table.getByText('İşlendi', { exact: true })).toBeVisible()
    await expect(table.getByText(/Murat Yılmaz/)).toBeVisible()

    await undo.click()
    await expect(undo).toHaveCount(0)
    await page.getByRole('combobox', { name: /^e-Özel durumu/ }).selectOption('pending')
    await expect(markButton).toHaveCount(1)

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Listeyi indir' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('e-ozel-islem-listesi.csv')
    const path = await file.path()
    const csv = await readFile(path, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('e-Özel durumu')
    expect(csv).toContain('İşlenmedi')
  })

  test('DOM-YTK-052: tek satırın tam kimliği "Göster" ile açılır, "Gizle" ile kapanır; dosya maskeli kalır', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      students: ['s16'],
      birthDates: { s16: '2001-05-06' },
    })
    await loginAs(school.user('onburo'))
    await page.goto(FRONT_OFFICE_URL)
    const table = tableOf(page)
    await page.getByRole('combobox', { name: /^Tür/ }).selectOption('learner')
    const show = table.getByRole('button', { name: /kimlik numarasını göster/ })
    await expect(show).toHaveCount(1)
    await expect(table.getByText(/^\*{7}/)).toBeVisible()
    await expect(table.getByText(/E2E-.*-s16/)).toHaveCount(0)

    const read = page.waitForResponse((response) =>
      response.url().includes('/learners/s16/identity'),
    )
    await show.click()
    expect((await read).headers()['cache-control']).toBe('no-store')
    await expect(table.getByText(/E2E-.*-s16/)).toBeVisible()
    await expect(table.getByText(/^\*{7}/)).toHaveCount(0)

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Listeyi indir' }).click()
    const csv = await readFile(await (await download).path(), 'utf8')
    expect(csv).not.toMatch(/E2E-.*-s16/)
    expect(csv).toContain('*******')

    await table.getByRole('button', { name: /kimlik numarasını gizle/ }).click()
    await expect(table.getByText(/E2E-.*-s16/)).toHaveCount(0)
    await expect(table.getByText(/^\*{7}/)).toBeVisible()
    await expect(show).toHaveCount(1)
  })

  test('guvenlik-kvkk: eski oturumda tam kimlik parolayı sorar, doğrulanınca açılır; vazgeçilince maskeli kalır', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      type: 'language_school',
      roles: [],
      students: ['s16'],
      birthDates: { s16: '2001-05-06' },
    })
    await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const table = tableOf(page)
    await page.getByRole('combobox', { name: /^Tür/ }).selectOption('learner')
    let staleReads = 2
    await page.route('**/learners/s16/identity', (route) => {
      if (staleReads === 0) return route.continue()
      staleReads -= 1
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'reauthentication_required',
          message: 'Bu işlem için parolanızı yeniden girmeniz gerekiyor.',
          requestId: 'e2e',
        }),
      })
    })
    const show = table.getByRole('button', { name: /kimlik numarasını göster/ })
    const reauth = page.getByRole('dialog', { name: 'Parolanızı doğrulayın' })

    await show.click()
    await reauth.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(reauth).toBeHidden()
    await expect(show).toBeVisible()
    await expect(table.getByText(/E2E-.*-s16/)).toHaveCount(0)

    await show.click()
    await reauth.getByLabel('Parola').fill(e2e.password)
    await reauth.getByRole('button', { name: 'Doğrula ve devam et' }).click()
    await expect(reauth).toBeHidden()
    await expect(table.getByText(/E2E-.*-s16/)).toBeVisible()
  })

  test("IST-085: işaretli tahsilat iptal edilince satır e-Özel'de düzeltilmeli kalır, düzeltilince işlenir", async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      students: ['s16'],
    })
    const client = await api(school.user('yonetici'))
    const created = await client.post(
      '/api/v1/payments',
      {
        studentId: 's16',
        amountCents: 10_000,
        method: 'Banka havalesi',
        reference: `E2E-${randomUUID()}`,
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(created.status, 'tahsilat').toBe(201)
    const paymentId = (created.body as { data: { id: string } }).data.id

    await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const table = tableOf(page)
    await page.getByRole('combobox', { name: /^Tür/ }).selectOption('fee')
    await table.getByRole('button', { name: /işlendi olarak işaretle/ }).click()
    await expect(table.getByRole('button', { name: /işlendi olarak işaretle/ })).toHaveCount(0)

    const reversed = await client.post(
      `/api/v1/payments/${paymentId}/reverse`,
      { reason: 'E2E iptal gerekçesi' },
      { 'idempotency-key': randomUUID(), 'if-match': '"2"' },
    )
    expect(reversed.status, 'iptal').toBe(200)

    await page.reload()
    const state = page.getByRole('combobox', { name: /^e-Özel durumu/ })
    await state.selectOption('needs_correction')
    await expect(table.getByText("e-Özel'de düzeltilmeli", { exact: true })).toBeVisible()
    await expect(table.getByText('Tahsilat iptal edildi')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await table.getByRole('button', { name: /düzeltildi olarak işaretle/ }).click()
    await expect(table.getByRole('button', { name: /düzeltildi olarak işaretle/ })).toHaveCount(0)
    await state.selectOption('recorded')
    await expect(table.getByText('İşlendi', { exact: true })).toBeVisible()
    await expect(table.getByRole('button', { name: /işaretini kaldır/ })).toHaveCount(0)
  })

  test('IST-085: ön büro listeyi süzer', async ({ page, loginAs, tenant }) => {
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      students: ['s16'],
    })
    await loginAs(school.user('onburo'))
    await page.goto(FRONT_OFFICE_URL)
    const table = tableOf(page)
    await page.getByRole('combobox', { name: /^Tür/ }).selectOption('learner')
    await expect(table.getByRole('button', { name: /işlendi olarak işaretle/ })).toHaveCount(1)
    await page.getByLabel('Gün (başlangıç)').fill('2030-01-01')
    await page.getByLabel('Gün (bitiş)').fill('2029-01-01')
    await expect(page.getByText('Bitiş günü başlangıç gününden önce olamaz.')).toBeVisible()
  })

  test('ADR 0008: okulda sekme yok, adres taksit listesine döner', async ({ page, loginAs }) => {
    await loginAs('yonetici')
    await page.goto(ADMIN_URL)
    await expect(page.getByRole('table', { name: 'Taksit ve tahsilat listesi' })).toBeVisible()
    await expect(page.getByRole('tab', { name: TABLE })).toHaveCount(0)
    await expect(tableOf(page)).toHaveCount(0)
  })
})
