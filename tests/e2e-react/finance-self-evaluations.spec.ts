import { randomUUID } from 'node:crypto'

import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öz değerlendirme (ON-210; DOM-FIN-131, K-448…K-450). Kural dalları birim ve API testlerindedir
// (`tests/finance-self-evaluations.test.ts`, `apps/api/test/finance-self-evaluations.test.ts`);
// burada dönem ve personel kaydı API'den kurulur, yönetici şablonu hazırlar, dönemi yürürlüğe
// alır, öğretmenin kâğıt formdaki yanıtını onun adına girip gönderir, görüş yazar ve yanıtı
// gerekçeyle geri açar.

const ADMIN_URL = '/yonetici/finans?gorunum=performans'
const PERIOD = 'Bahar performansı'

test.describe('ON-210: öz değerlendirme', () => {
  test('DOM-FIN-131: yönetici şablonu hazırlar, yanıtı personel adına girer, gönderir, görüş yazar ve geri açar', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = school.user('ogretmen').name
    const admin = await api(school.user('yonetici'))
    const period = await admin.post(
      '/api/v1/finance/performance-periods',
      { name: PERIOD, startDate: istanbulDay(-30), endDate: istanbulDay(60) },
      { 'idempotency-key': randomUUID() },
    )
    expect(period.status, JSON.stringify(period.body)).toBe(201)
    const periodId = (period.body as { data: { id: string } }).data.id
    const staff = await admin.get('/api/v1/finance/staff-certificate-staff?page=1&pageSize=100')
    const membershipId = (
      staff.body as { data: { membershipId: string; name: string }[] }
    ).data.find((row) => row.name === teacher)?.membershipId
    expect(membershipId).toBeTruthy()
    const review = await admin.post(
      `/api/v1/finance/performance-periods/${periodId}/reviews`,
      {
        membershipId,
        goals: [{ title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 100 }],
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(review.status, JSON.stringify(review.body)).toBe(201)

    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const periods = page.getByRole('region', { name: 'Performans dönemleri' })
    const row = periods.getByRole('row', { name: new RegExp(PERIOD) })
    await row.getByRole('button', { name: `${PERIOD} kayıtları` }).click()
    const panel = page.getByRole('region', { name: `${PERIOD} · öz değerlendirme` })
    await expect(panel.getByText('Şablon hazırlanmadı.')).toBeVisible()
    await expect(panel.getByText('Gönderen 0 / 1 (%0) · Taslak 0 · Gönderilmedi 1')).toBeVisible()
    // Planlamada yanıt girilmez (K-449).
    await expect(panel.getByRole('button', { name: /öz değerlendirmesini gir/ })).toHaveCount(0)

    await panel.getByRole('button', { name: 'Şablonu hazırla' }).click()
    const templateDialog = page.getByRole('dialog', { name: 'Öz değerlendirme şablonu' })
    await templateDialog
      .getByLabel('1. soru', { exact: true })
      .fill('Ders planlarımı zamanında hazırladım')
    await templateDialog.getByRole('button', { name: 'Soru ekle' }).click()
    await templateDialog
      .getByLabel('2. soru', { exact: true })
      .fill('Bu dönemin en güçlü yanınız neydi?')
    await templateDialog.getByLabel('2. soru türü').selectOption({ label: 'Açık uçlu' })
    await templateDialog.getByRole('button', { name: 'Şablonu kaydet' }).click()
    await expect(templateDialog).toBeHidden()
    await expect(panel.getByText('Şablon: 2 soru, 2 zorunlu.')).toBeVisible()

    await row.getByRole('button', { name: `${PERIOD} dönemini Yürürlükte aşamasına geçir` }).click()
    const advance = page.getByRole('dialog', { name: 'Dönemin aşamasını ilerlet' })
    await advance.getByRole('button', { name: 'Yürürlükte aşamasına geç' }).click()
    await expect(advance).toBeHidden()

    const staffRow = panel.getByRole('row', { name: new RegExp(teacher) })
    await expect(staffRow).toContainText('Gönderilmedi')
    await staffRow.getByRole('button', { name: `${teacher} öz değerlendirmesini gir` }).click()
    let entry = page.getByRole('dialog', { name: `${teacher} · öz değerlendirme` })
    await entry.getByLabel('Yanıtın geldiği kanal').selectOption({ label: 'Kâğıt form' })
    await entry.getByLabel('Ders planlarımı zamanında hazırladım').selectOption('4')
    await entry.getByRole('button', { name: 'Kaydet ve gönder' }).click()
    // Zorunlu açık uçlu soru boşken gönderilmez (K-449).
    await expect(entry.getByText('Zorunlu 1 soru cevaplanmadı', { exact: false })).toBeVisible()
    await entry.getByLabel('Bu dönemin en güçlü yanınız neydi?').fill('Veli iletişimi')
    await entry.getByRole('button', { name: 'Kaydet ve gönder' }).click()
    await expect(entry).toBeHidden()
    await expect(staffRow).toContainText('Gönderildi')
    await expect(staffRow).toContainText('Kâğıt form')
    await expect(panel.getByText('Gönderen 1 / 1 (%100) · Taslak 0 · Gönderilmedi 0')).toBeVisible()
    await expect(panel.getByText(/Yanıt girildiği için sorular değiştirilemez/)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Şablonu düzenle' })).toHaveCount(0)

    await staffRow.getByRole('button', { name: `${teacher} öz değerlendirmesini aç` }).click()
    entry = page.getByRole('dialog', { name: `${teacher} · öz değerlendirme` })
    await expect(entry.getByRole('definition').filter({ hasText: '4 / 5' })).toBeVisible()
    await entry
      .getByRole('textbox', { name: 'Yönetici görüşü' })
      .fill('Planlama güçlü, ölçme geliştirilmeli')
    await entry.getByRole('button', { name: 'Görüşü kaydet' }).click()
    await expect(entry).toBeHidden()

    await staffRow.getByRole('button', { name: `${teacher} öz değerlendirmesini aç` }).click()
    entry = page.getByRole('dialog', { name: `${teacher} · öz değerlendirme` })
    await expect(entry.getByRole('textbox', { name: 'Yönetici görüşü' })).toHaveValue(
      'Planlama güçlü, ölçme geliştirilmeli',
    )
    await entry.getByLabel('Geri açma gerekçesi').fill('Kâğıt formda ikinci sayfa eksik girildi')
    await entry.getByRole('button', { name: 'Geri aç' }).click()
    await expect(entry).toBeHidden()
    await expect(staffRow).toContainText('Taslak')
    await expect(panel.getByText('Gönderen 0 / 1 (%0) · Taslak 1 · Gönderilmedi 0')).toBeVisible()

    // Geri açılan taslak yeniden düzenlenir; gerekçe görünür.
    await staffRow.getByRole('button', { name: `${teacher} öz değerlendirmesini aç` }).click()
    entry = page.getByRole('dialog', { name: `${teacher} · öz değerlendirme` })
    await expect(entry.getByText(/Geri açıldı \(1 kez\); son gerekçe: Kâğıt formda/)).toBeVisible()
    await expect(entry.getByLabel('Bu dönemin en güçlü yanınız neydi?')).toHaveValue(
      'Veli iletişimi',
    )
    await page.keyboard.press('Escape')
    await expect(entry).toBeHidden()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
