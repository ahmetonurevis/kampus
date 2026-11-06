import { readFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

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
