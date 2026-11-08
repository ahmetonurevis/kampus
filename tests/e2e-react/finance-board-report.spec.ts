import { createSeed } from '../../packages/school-core/src/data/seed.ts'
import { money } from '../../packages/school-core/src/lib/format.ts'
import { istanbulDay } from './support/enrollment-finance-smoke.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yönetim kurulu raporu (DOM-FIN-064, ON-251): yönetici dönemi seçer, özeti görür ve tek PDF
// indirir; belge kişi adı taşımaz. Hesap dalları (mutabakat, yaşlandırma, küçük grup bastırma,
// kayıt olayları) birim ve API testlerindedir (`tests/finance-board-report.test.ts`,
// `apps/api/test/finance-board-report.test.ts`).

const YEAR = createSeed(new Date()).academicYear
const AMOUNT = 1_234_500

/** Dönemde vadesi geçmiş tek taksit: tahakkuk ve gecikmiş alacak. */
const records = (prefix: string) => [
  {
    collection: 'invoices' as const,
    data: {
      id: `${prefix}-inv-1`,
      studentId: 's1',
      installment: 1,
      amount: AMOUNT,
      dueDate: `${istanbulDay(-3)}T09:00:00.000Z`,
      paidAt: null,
      method: null,
      reminderAt: null,
      academicYear: YEAR,
    },
  },
]

test('DOM-FIN-064: yönetici dönem özetini görür ve kişi adı olmayan yönetim kurulu PDF’ini indirir', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: [], students: ['s1'], records: records('e2e-br') })
  const page = await loginAs(school.user('yonetici'))
  await page.goto('/yonetici/finans?gorunum=kurul-raporu')
  const section = page.getByRole('region', { name: 'Yönetim kurulu raporu' })
  await expect(section.getByRole('heading', { name: 'Yönetim kurulu raporu' })).toBeVisible()
  const summary = section.getByLabel('Yönetim kurulu raporu özeti')
  await expect(summary).toContainText('Tahakkuk')
  await expect(summary).toContainText('Gecikmiş alacak')
  await expect(summary).toContainText(money(AMOUNT))
  await expect(section).toContainText(`${String(YEAR)}–${String(YEAR + 1)} eğitim yılı`)
  await expectNoHorizontalOverflow(page)

  // Elle aralıkta iki gün girilmeden rapor istenmez.
  await section.getByLabel('Rapor dönemi').selectOption({ label: 'Tarih aralığı' })
  await expect(section.getByText('Başlangıç ve bitiş gününü seçin.')).toBeVisible()
  await section.getByLabel('Başlangıç günü').fill(istanbulDay(-10))
  await section.getByLabel('Bitiş günü').fill(istanbulDay(0))
  await expect(section).toContainText('Tarih aralığı')
  await expect(summary).toContainText(money(AMOUNT))

  await section.getByRole('button', { name: 'Rapor PDF’i' }).click()
  const preview = page.getByRole('dialog', { name: 'Yönetim kurulu raporu · Önizleme' })
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^yonetim-kurulu-raporu-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.pdf$/,
  )
  const text = await pdfText(download)
  expect(text).toContain('Gecikmiş alacak yaşlandırması')
  expect(text).toContain('Ayrılış nedenleri')
  expect(text).not.toContain('Deniz Yılmaz')
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await expect(section.getByRole('button', { name: 'Rapor PDF’i' })).toBeFocused()
})

test('DOM-FIN-064: ön büro yönetim kurulu raporu sekmesini görmez, adres taksitlere düşer', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['onburo'], students: ['s1'] })
  const page = await loginAs(school.user('onburo'))
  await page.goto('/onburo/tahsilat-takip?gorunum=kurul-raporu')
  const tabs = page.getByRole('toolbar', { name: 'Finans görünümü' })
  await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(tabs.getByRole('button', { name: 'Yönetim kurulu raporu' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Yönetim kurulu raporu' })).toHaveCount(0)
})
