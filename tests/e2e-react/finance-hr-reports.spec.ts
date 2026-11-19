import { readFile } from 'node:fs/promises'

import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İK raporları (ON-192; DOM-FIN-117). Hesap, bastırma ve kural dalları birim ve API testlerindedir
// (`tests/finance-hr-reports.test.ts`, `apps/api/test/finance-hr-reports.test.ts`); burada yönetici
// sekmede yedi personelli kurumun raporunu görür: hesaplar bugün açıldığı için yedisi de yıl içinde
// giriştir, rol kırılımı küçük grup olarak "<5" gizlidir (K-401), kıdem başlangıcı girilmediği için
// kıdem bandı "Bilinmiyor"dur (K-400); CSV ve PDF iner, kişi adı yazılmaz. Ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans?gorunum=ik-raporlari'
const DESK = '/onburo/tahsilat-takip?gorunum=ik-raporlari'
const FILE = /^ik-raporu-\d{4}-\d{2}(-\d{4}-\d{2})?\.(csv|pdf)$/

test.describe('DOM-FIN-117: İK raporları', () => {
  test('DOM-FIN-117: yönetici devir, kıdem ve izin raporunu görür, küçük grup gizli, CSV ve PDF kişi adı taşımaz; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogretmen', 'onburo'],
      staff: [1, 2, 3, 4].map((index) => ({
        key: `ogretmen-${String(index)}`,
        role: 'ogretmen' as const,
        name: `Ek Öğretmen ${String(index)}`,
      })),
    })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'İK raporları' })
    const turnover = section.getByRole('table', { name: 'Personel devir oranı' })
    const total = turnover.getByRole('row').filter({ hasText: 'Kurum toplamı' })
    await expect(total).toContainText('7')
    await expect(total).toContainText('%0')
    await expect(turnover.getByRole('row').filter({ hasText: 'Öğretmen' })).toContainText('<5')
    await expect(
      section
        .getByRole('table', { name: 'Kıdem dağılımı' })
        .getByRole('row')
        .filter({ hasText: 'Bilinmiyor' }),
    ).toContainText('7')
    await expect(section.getByRole('table', { name: 'İzin kullanımı' })).toContainText(
      'Yıllık ücretli izin',
    )
    await expect(section).not.toContainText(teacher)

    const csvDownload = page.waitForEvent('download')
    await section.getByRole('button', { name: 'CSV indir' }).click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toMatch(FILE)
    const csvText = await readFile(await csv.path(), 'utf8')
    expect(csvText.startsWith('﻿"Dönem";')).toBe(true)
    expect(csvText).toContain('"Rol";"Öğretmen";"<5"')
    expect(csvText).not.toContain(teacher)

    await section.getByRole('button', { name: 'İK raporu PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'İK raporu · Önizleme' })
    const pdfDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const pdf = await pdfDownload
    expect(pdf.suggestedFilename()).toMatch(FILE)
    const text = await pdfText(pdf)
    for (const expected of ['İK RAPORU', 'Personel devir oranı', 'Kıdem dağılımı', '<5'])
      expect(text).toContain(expected)
    expect(text).not.toContain(teacher)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await section.getByLabel('Bitiş ayı').fill('2020-01')
    await expect(section.getByRole('alert')).toContainText(
      'Bitiş ayı başlangıç ayından önce olamaz.',
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'İK raporları' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'İK raporları' })).toHaveCount(0)
  })
})
