import type { Page } from '@playwright/test'

import { istanbulDay } from './support/commands.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bağış kampanyası ekranı (ON-258; DOM-FIN-097, K-296…K-299). Kural dalları birim ve API
// testlerindedir (`tests/finance-donations.test.ts`, `apps/api/test/finance-donations.test.ts`);
// burada yöneticinin kampanya açma, bağışçı ekleme, bağış ve makbuz, iptal akışı ile ön büronun
// sekmeyi görmemesi var.

const ADMIN_URL = '/yonetici/finans?gorunum=bagis'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=bagis'
const CAMPAIGN = 'Kütüphane Kampanyası'
const TCKN = '10000000146'

const campaigns = (page: Page) => page.getByRole('region', { name: 'Bağış kampanyaları' })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Bağış kampanyası', exact: true })

test.describe('ON-258: bağış kampanyası ekranı', () => {
  test('DOM-FIN-097: yönetici kampanya açar, bağış kaydeder, makbuz alır ve bağışı iptal eder', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s1'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(campaigns(page).getByText('Henüz bağış kampanyası yok.')).toBeVisible()

    // Bağışçı kimlik numarası listede maskelidir (K-298).
    const donors = page.getByRole('region', { name: 'Bağışçılar' })
    await donors.getByRole('button', { name: 'Yeni bağışçı' }).click()
    const donorForm = page.getByRole('dialog', { name: 'Yeni bağışçı' })
    await donorForm.getByLabel('Ad soyad').fill('Ayşe Yılmaz')
    await donorForm.getByLabel('T.C. kimlik no (isteğe bağlı)').fill(TCKN)
    await donorForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(donorForm).toBeHidden()
    await expect(donors.getByRole('cell', { name: '*******0146' })).toBeVisible()

    await campaigns(page).getByRole('button', { name: 'Yeni kampanya' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni bağış kampanyası' })
    await form.getByLabel('Kampanya adı').fill(CAMPAIGN)
    await form.getByLabel('Amaç').fill('Okul kütüphanesinin yenilenmesi.')
    await form.getByLabel('Hedef tutar (₺)').fill('10.000')
    await form.getByLabel('Bitiş').fill(istanbulDay(30))
    await form.getByRole('button', { name: 'Kaydet' }).click()

    const detail = panel(page)
    await expect(detail.getByRole('heading', { name: CAMPAIGN })).toBeVisible()
    await expect(detail.getByText('Taslak', { exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Bağış kaydet' })).toHaveCount(0)
    await detail.getByRole('button', { name: 'Kampanyayı aç' }).click()
    const opening = page.getByRole('dialog', { name: 'Kampanyayı aç' })
    await opening.getByRole('button', { name: 'Kampanyayı aç' }).click()
    await expect(opening).toBeHidden()

    await detail.getByRole('button', { name: 'Bağış kaydet' }).click()
    const donation = page.getByRole('dialog', { name: 'Bağış kaydet' })
    await donation
      .getByLabel('Bağışçı', { exact: true })
      .selectOption({ label: 'Ayşe Yılmaz · *******0146' })
    await donation.getByLabel('Tutar (₺)').fill('2.500')
    await donation.getByRole('button', { name: 'Kaydet' }).click()
    await expect(donation).toBeHidden()
    const list = detail.getByRole('list', { name: 'Kampanya bağışları' })
    const receipt = `BM-${istanbulDay().slice(0, 4)}-1`
    await expect(list.getByText(new RegExp(`^${receipt} ·`))).toBeVisible()
    await expect(detail.getByText(/2\.500,00 ₺ \/ 10\.000,00 ₺ · %25/)).toBeVisible()

    // Makbuz tam kimlik numarasını taşır; liste yalnız maskeli gösterir.
    await list.getByRole('button', { name: `${receipt} makbuzu` }).click()
    const pdf = page.getByRole('dialog', { name: 'Bağış makbuzu · Önizleme' })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of ['BAĞIŞ MAKBUZU', receipt, 'Ayşe Yılmaz', TCKN, CAMPAIGN])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    // İptal makbuzu silmez; ilerleme düşer (K-297).
    await list.getByRole('button', { name: `${receipt} bağışını iptal et` }).click()
    const cancel = page.getByRole('dialog', { name: 'Bağış iptali' })
    await cancel.getByLabel('İptal gerekçesi').fill('Yanlış tutar girildi')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(list.getByText('İptal edildi')).toBeVisible()
    await expect(detail.getByText(/0,00 ₺ \/ 10\.000,00 ₺ · %0/)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(campaigns(page).getByRole('cell', { name: CAMPAIGN, exact: true })).toBeVisible()
  })

  test('K-299: ön büro bağış sekmesini görmez; yönetici dar ekranda taşma görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    await expect(desk.getByRole('button', { name: 'Bağışlar' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Bağış kampanyaları' })).toHaveCount(0)

    const admin = await loginAs(school.user('yonetici'))
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin.goto(ADMIN_URL)
    await expect(campaigns(admin).getByRole('button', { name: 'Yeni kampanya' })).toBeVisible()
    await expectNoHorizontalOverflow(admin)
  })
})
