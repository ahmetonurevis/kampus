import type { Page } from '@playwright/test'

import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Etkinlik biletleri ekranı (ON-159, ON-345; DOM-FIN-103, K-324…K-327, K-378…K-380). Kural dalları
// (eşzamanlı koltuk, aile sınırı, iade kuralı, girişi geri alma yetkisi ve süresi, kurumlar arası
// 404, CSV) birim ve API testlerindedir (`tests/finance-event-tickets.test.ts`,
// `apps/api/test/finance-event-tickets.test.ts`); burada yöneticinin etkinlik açma (aile sınırı),
// koltuk seçip bilet ayırma, ödeme, PDF bilet, girişte kod okutma ve girişi geri alma, iptal ve iade
// ödendi akışı ile ön büronun etkinlik açamaması var.

const ADMIN_URL = '/yonetici/finans?gorunum=etkinlik-bileti'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=etkinlik-bileti'
const STUDENT = 'Deniz Yılmaz'
const CODE = /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/

const region = (page: Page, name: string | RegExp) => page.getByRole('region', { name })

/** 30 gün sonrası, İstanbul günüyle 18:00 (`datetime-local`). */
function futureEvening(): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  return `${day}T18:00`
}

test.describe('ON-159: etkinlik biletleri ekranı', () => {
  test('DOM-FIN-103, K-378…K-380: yönetici etkinlik açar, bilet ayırır, ödeme alır, PDF açar, girişi okutup geri alır, iptal edip iadeyi işaretler', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)

    await page.getByRole('button', { name: 'Etkinlik ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Etkinlik ekle' })
    await form.getByLabel('Etkinlik adı').fill('Yıl sonu gösterisi')
    await form.getByLabel('Gün ve saat').fill(futureEvening())
    await form.getByLabel('Salon').fill('Konferans salonu')
    await form.getByLabel('Sıra sayısı').fill('2')
    await form.getByLabel('Sıra başına koltuk').fill('3')
    await form.getByLabel('Kapalı koltuklar').fill('A1')
    await form
      .getByLabel('Sınır kapsamı')
      .selectOption({ label: 'Aile başına (kardeşler birlikte)' })
    await form.getByRole('button', { name: 'Bilet türü ekle' }).click()
    await form.getByLabel('2. tür adı').fill('Veli bileti')
    await form.getByLabel('2. tür fiyatı (TL)').fill('150')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()

    const map = region(page, 'Koltuk haritası')
    await expect(map.getByRole('button', { name: 'A1 koltuğu, kapalı' })).toBeDisabled()
    await map.getByRole('button', { name: 'A2 koltuğu, boş' }).click()
    await map.getByRole('button', { name: 'B1 koltuğu, boş' }).click()
    await expect(map.getByRole('button', { name: 'A2 koltuğu, seçili' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await map.getByRole('button', { name: 'Seçili koltuklara bilet ayır (2)' }).click()

    const allocate = page.getByRole('dialog', { name: 'Bilet ayır' })
    await expect(allocate).toContainText('Aile başına en çok 2 bilet')
    await allocate.getByLabel('Öğrenci', { exact: true }).selectOption({ label: STUDENT })
    await allocate.getByLabel('A2 koltuğu bilet sahibi').fill('Ayşe Yılmaz')
    await allocate
      .getByLabel('B1 koltuğu bilet türü')
      .selectOption({ label: 'Veli bileti (150,00 ₺)' })
    await allocate.getByLabel('B1 koltuğu bilet sahibi').fill('Misafir Can')
    await allocate.getByRole('button', { name: 'Bileti ayır' }).click()
    await expect(allocate).toBeHidden()
    await expect(map.getByRole('button', { name: 'A2 koltuğu, dolu' })).toBeDisabled()

    const sales = region(page, 'Satış listesi')
    await expect(sales.getByRole('row', { name: /Misafir Can/ })).toContainText('Ödeme bekliyor')
    await sales.getByRole('button', { name: 'Misafir Can biletinin ödemesini al' }).click()
    const pay = page.getByRole('dialog', { name: 'Bilet ödemesi' })
    await pay.getByLabel('Ödeme yöntemi').selectOption({ label: 'Nakit' })
    await pay.getByRole('button', { name: 'Ödemeyi işaretle' }).click()
    await expect(pay).toBeHidden()
    await expect(sales.getByRole('row', { name: /Misafir Can/ })).toContainText('Geçerli')

    await sales.getByRole('button', { name: "Ayşe Yılmaz biletinin PDF'i" }).click()
    const pdf = page.getByRole('dialog', { name: 'Etkinlik bileti · Önizleme' })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of ['Yıl sonu gösterisi', 'Ayşe Yılmaz', 'A2', 'Ücretsiz davetiye'])
      expect(text).toContain(expected)
    const code = CODE.exec(text)?.[0] ?? ''
    expect(code).toMatch(CODE)
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    await page.getByLabel('Bilet kodu').fill(code.toLowerCase())
    await page.getByRole('button', { name: 'Girişi işaretle' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Giriş işaretlendi' })).toContainText(
      'Ayşe Yılmaz, koltuk A2',
    )
    await expect(sales.getByRole('row', { name: /Ayşe Yılmaz/ })).toContainText('Kullanıldı')

    await sales.getByRole('button', { name: 'Ayşe Yılmaz biletinin girişini geri al' }).click()
    const undo = page.getByRole('dialog', { name: 'Girişi geri al' })
    await undo.getByLabel('Gerekçe').fill('Yanlış bilet okutuldu')
    await undo.getByRole('button', { name: 'Girişi geri al' }).click()
    await expect(undo).toBeHidden()
    const ayse = sales.getByRole('row', { name: /Ayşe Yılmaz/ })
    await expect(ayse).toContainText('Geçerli')
    await expect(ayse).toContainText('Giriş 1 kez geri alındı')

    await sales.getByRole('button', { name: 'Misafir Can biletini iptal et' }).click()
    const cancel = page.getByRole('dialog', { name: 'Bileti iptal et' })
    await expect(cancel).toContainText('Kurala göre iade 150,00 ₺')
    await expect(cancel.getByLabel('İade tutarı (TL)')).toHaveValue('150')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    const can = sales.getByRole('row', { name: /Misafir Can/ })
    await expect(can).toContainText('İptal')
    await expect(can).toContainText('İade bekliyor · 150,00 ₺')
    await expect(map.getByRole('button', { name: 'B1 koltuğu, boş' })).toBeEnabled()

    await sales
      .getByRole('button', { name: 'Misafir Can biletinin iadesini ödendi işaretle' })
      .click()
    const refund = page.getByRole('dialog', { name: 'İade ödendi' })
    await refund.getByLabel('İade yöntemi').selectOption({ label: 'Havale/EFT' })
    await refund.getByRole('button', { name: 'İadeyi işaretle' }).click()
    await expect(refund).toBeHidden()
    await expect(can).toContainText('İade ödendi · 150,00 ₺')
  })

  test('K-324: ön büro etkinlik açamaz, bilet listesini görür; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.setViewportSize({ width: 390, height: 844 })
    await desk.goto(DESK_URL)
    await expect(region(desk, 'Etkinlik biletleri')).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Etkinlik ekle' })).toHaveCount(0)
    await expect(desk.getByText('Henüz biletli etkinlik yok.')).toBeVisible()
    await expectNoHorizontalOverflow(desk)
  })
})
