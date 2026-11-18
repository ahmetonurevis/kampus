import {
  nextMonth,
  payrollMonthLabel,
} from '../../packages/school-core/src/lib/finance-payroll-periods.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bordro onayı ve dönem kilidi (ON-200; DOM-FIN-108). Kural dalları birim ve API testlerindedir
// (`tests/finance-payroll-periods.test.ts`, `apps/api/test/finance-payroll-periods.test.ts`); burada
// yönetici geçen ayı onaylar (K-356), ücret tanımı formunda kilitli ay uyarısını ve sunucu reddini
// görür (K-357), düzeltme kaydı girer (K-358), düzeltme varken ayı açamaz, düzeltmeyi iptal edip
// ayı yeniden açar; ön büro sekmeyi görmez (K-359).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip?gorunum=bordro-donemleri'

/** Europe/Istanbul gününe göre bu ay ve geçen ay (`YYYY-AA`). */
function months() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
  const [year, month] = today.split('-').map(Number) as [number, number]
  const previous =
    month === 1 ? `${String(year - 1)}-12` : `${String(year)}-${String(month - 1).padStart(2, '0')}`
  return { previous, current: nextMonth(previous) }
}

test.describe('DOM-FIN-108: bordro dönemleri', () => {
  test('DOM-FIN-108: yönetici ayı onaylar, kilitli aya tanım yazamaz, düzeltme girer ve ayı yeniden açar; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const { previous, current } = months()
    const label = payrollMonthLabel(previous)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN}?gorunum=bordro-donemleri`)
    const section = page.getByRole('region', { name: 'Bordro dönemleri' })
    await section.getByLabel('Yıl').selectOption(previous.slice(0, 4))
    const row = section.getByRole('row', { name: new RegExp(`^${label}`) })
    await expect(row.getByText('Açık')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await row.getByRole('button', { name: `${label} onayla` }).click()
    const approve = page.getByRole('dialog', { name: `${label} bordrosunu onayla` })
    await expect(approve.getByText('Girdi damgası')).toBeVisible()
    await approve.getByRole('button', { name: 'Onayla ve kilitle' }).click()
    await expect(approve).toBeHidden()
    await expect(row.getByText('Onaylandı (kilitli)')).toBeVisible()

    // Kilitli aya başlayan ücret tanımı: formda uyarı, sunucuda ret.
    await page.goto(`${ADMIN}?gorunum=ucret-tanimi`)
    const rates = page.getByRole('region', { name: 'Ücret tanımları' })
    await rates
      .getByRole('row', { name: new RegExp(teacher) })
      .getByRole('button', { name: `${teacher} ücret tanımlarını aç` })
      .click()
    const person = page.getByRole('dialog', { name: 'Personel ücreti' })
    await person.getByRole('button', { name: 'Yeni tanım' }).click()
    const form = page.getByRole('form', { name: 'Ücret tanımı' })
    await form.getByLabel('Tutar (₺)').fill('45.000,00')
    await form.getByLabel('Yürürlük başlangıcı').fill(`${previous}-01`)
    await expect(form.getByText(/onaylanmış bordro ayına düşüyor/)).toBeVisible()
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText(/onaylanmış bordro dönemine düşüyor/)).toBeVisible()

    // Düzeltme kaydı sonraki açık aya aktarılır.
    await page.goto(`${ADMIN}?gorunum=bordro-donemleri`)
    await section.getByLabel('Yıl').selectOption(previous.slice(0, 4))
    await row.getByRole('button', { name: `${label} düzeltme kayıtları` }).click()
    const panel = page.getByRole('dialog', { name: `${label} düzeltme kayıtları` })
    const adjustment = panel.getByRole('form', { name: 'Düzeltme kaydı' })
    await adjustment.getByLabel('Personel').selectOption({ label: teacher })
    await adjustment.getByLabel('Kalem').selectOption({ label: 'Ek ders' })
    await adjustment.getByLabel('Fark tutarı (₺)').fill('1.250,00')
    await adjustment.getByRole('textbox', { name: 'Gerekçe' }).fill('Eksik ödenen iki saat ek ders')
    await adjustment.getByRole('button', { name: 'Düzeltmeyi kaydet' }).click()
    const items = panel.getByRole('list', { name: 'Düzeltme kayıtları' })
    await expect(items.getByRole('listitem')).toHaveCount(1)
    await expect(items).toContainText('Ek ödeme 1.250,00 ₺')
    await expect(items).toContainText(`${payrollMonthLabel(current)} bordrosuna aktarılacak`)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // Düzeltmesi olan ay açılmaz; düzeltme iptal edilince açılır.
    await row.getByRole('button', { name: `${label} yeniden aç` }).click()
    const reopen = page.getByRole('dialog', { name: `${label} dönemini yeniden aç` })
    await reopen
      .getByRole('textbox', { name: 'Gerekçe' })
      .fill('Ek ders çizelgesi yeniden girilecek')
    await reopen.getByRole('button', { name: 'Yeniden aç' }).click()
    await expect(page.getByText(/düzeltme kayıtları var/)).toBeVisible()
    await reopen.getByRole('button', { name: 'Vazgeç' }).click()

    await row.getByRole('button', { name: `${label} düzeltme kayıtları` }).click()
    await items.getByRole('button', { name: `${teacher} düzeltmesini iptal et` }).click()
    const cancel = page.getByRole('dialog', { name: 'Düzeltme kaydını iptal et' })
    await cancel
      .getByRole('textbox', { name: 'İptal gerekçesi' })
      .fill('Ay yeniden açılarak düzeltilecek')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(panel.getByText('Bu ay için düzeltme kaydı yok.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await row.getByRole('button', { name: `${label} yeniden aç` }).click()
    await reopen
      .getByRole('textbox', { name: 'Gerekçe' })
      .fill('Ek ders çizelgesi yeniden girilecek')
    await reopen.getByRole('button', { name: 'Yeniden aç' }).click()
    await expect(reopen).toBeHidden()
    await expect(row.getByText('Yeniden açıldı')).toBeVisible()

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK)
    await expect(desk.getByRole('region', { name: 'Bordro dönemleri' })).toHaveCount(0)
  })
})
