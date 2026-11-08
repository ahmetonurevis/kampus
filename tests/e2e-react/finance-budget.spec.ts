import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bütçe ekranı (ON-241, ON-242; DOM-FIN-062). Kural dalları birim ve API testlerindedir
// (`tests/finance-budget.test.ts`, `tests/finance-cost-centers.test.ts`,
// `apps/api/test/finance-budget.test.ts`); burada yöneticinin merkez, kalem, dönem ve satır akışı var.

const ADMIN_URL = '/yonetici/finans?gorunum=butce'

const centers = (page: Page) => page.getByRole('region', { name: 'Maliyet merkezleri' })
const items = (page: Page) => page.getByRole('region', { name: 'Bütçe kalemleri' })
const periods = (page: Page) => page.getByRole('region', { name: 'Bütçe dönemleri' })

test.describe('DOM-FIN-062: bütçe ve maliyet merkezi ekranı', () => {
  test('DOM-FIN-062: yönetici merkez, kalem ve dönem açar, satır ekler, dönemi açıp kapatır', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(centers(page).getByText('Henüz maliyet merkezi yok.')).toBeVisible()

    await centers(page).getByRole('button', { name: 'Yeni merkez' }).click()
    const centerForm = page.getByRole('dialog', { name: 'Yeni maliyet merkezi' })
    await centerForm.getByLabel('Kod').fill('kad')
    await centerForm.getByLabel('Ad').fill('Kadıköy merkezi')
    await centerForm.getByRole('button', { name: 'Kaydet' }).click()
    // Kampüs merkezi kampüssüz kaydedilmez.
    await expect(centerForm.getByText('Kampüs seçin.', { exact: true })).toBeVisible()
    await centerForm.getByLabel('Kampüs').selectOption({ label: 'Kadıköy Kampüsü' })
    await centerForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(centerForm).toBeHidden()
    await expect(centers(page).getByRole('cell', { name: 'KAD', exact: true })).toBeVisible()

    await items(page).getByRole('button', { name: 'Yeni kalem' }).click()
    const itemForm = page.getByRole('dialog', { name: 'Yeni bütçe kalemi' })
    await itemForm.getByLabel('Kod').fill('G-100')
    await itemForm.getByLabel('Ad').fill('Öğrenim geliri')
    await itemForm.getByLabel('Ücret türü (isteğe bağlı)').selectOption({ label: 'Öğrenim ücreti' })
    await itemForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(itemForm).toBeHidden()
    await expect(items(page).getByRole('cell', { name: 'G-100', exact: true })).toBeVisible()

    await periods(page).getByRole('button', { name: 'Yeni dönem' }).click()
    const periodForm = page.getByRole('dialog', { name: 'Yeni bütçe dönemi' })
    await periodForm.getByLabel('Dönem adı').fill('Ana bütçe')
    await periodForm.getByRole('button', { name: 'Kaydet' }).click()

    const panel = page.getByRole('dialog', { name: 'Ana bütçe' })
    await expect(panel.getByText('Taslak', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Satır ekle' }).click()
    const lineForm = page.getByRole('dialog', { name: 'Bütçe satırı ekle' })
    await lineForm.getByLabel('Maliyet merkezi').selectOption({ index: 1 })
    await lineForm.getByLabel('Bütçe kalemi').selectOption({ index: 1 })
    await lineForm.getByLabel('Planlanan tutar (₺)').fill('120.000,00')
    await lineForm.getByLabel('Aylık dağılım').selectOption('even')
    await lineForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(lineForm).toBeHidden()
    await expect(panel.getByText('120.000,00 ₺').first()).toBeVisible()

    await panel.getByRole('button', { name: 'Dönemi aç' }).click()
    await expect(panel.getByText('Açık', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Dönemi kapat' }).click()
    await expect(panel.getByText('Kapalı', { exact: true })).toBeVisible()
    // Kapalı dönemde satır eklenmez ve düzenlenmez.
    await expect(panel.getByRole('button', { name: 'Satır ekle' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /satırını düzenle$/ })).toHaveCount(0)
  })

  test('DOM-FIN-062: ön büro bütçe sekmesini görmez; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.goto('/onburo/tahsilat-takip?gorunum=butce')
    await expect(desk.getByRole('button', { name: 'Taksitler', exact: true })).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Bütçe', exact: true })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Maliyet merkezleri' })).toHaveCount(0)

    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN_URL)
    await expect(periods(page).getByText('Henüz bütçe dönemi yok.')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
