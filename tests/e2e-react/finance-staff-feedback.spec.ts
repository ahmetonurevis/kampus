import { randomUUID } from 'node:crypto'

import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Çok kaynaklı geri bildirim (ON-212; DOM-FIN-134, K-457…K-459). Kural dalları birim ve API
// testlerindedir (`tests/finance-staff-feedback.test.ts`, `apps/api/test/finance-staff-feedback.test.ts`);
// burada dönem ve personel kaydı API'den kurulur, yönetici şablonu hazırlar, öğretmene yönetici
// ve meslektaş değerlendiren atar, kâğıt formdaki yanıtları onların adına girer ve değerlendirme
// aşamasında sonucu açar: yönetici yanıtı adıyla görünür, tek meslektaş yanıtı eşiğin altında
// gizli kalır.

const ADMIN_URL = '/yonetici/finans?gorunum=performans'
const PERIOD = 'Güz geri bildirimi'
const PEER_TEXT = 'Nöbet değişimlerinde yardımcı'

test.describe('ON-212: çok kaynaklı geri bildirim', () => {
  test('DOM-FIN-134: yönetici değerlendiren atar, yanıtları girer; meslektaş sonucu eşik altında gizli', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const manager = school.user('yonetici').name
    const colleague = school.user('onburo').name
    const admin = await api(school.user('yonetici'))
    const period = await admin.post(
      '/api/v1/finance/performance-periods',
      { name: PERIOD, startDate: istanbulDay(-30), endDate: istanbulDay(60) },
      { 'idempotency-key': randomUUID() },
    )
    expect(period.status, JSON.stringify(period.body)).toBe(201)
    const periodId = (period.body as { data: { id: string } }).data.id
    const staff = await admin.get('/api/v1/finance/staff-certificate-staff?page=1&pageSize=100')
    const rows = (staff.body as { data: { membershipId: string; name: string }[] }).data
    const idOf = (name: string) => rows.find((row) => row.name === name)?.membershipId ?? ''
    expect(idOf(teacher)).toBeTruthy()
    const review = await admin.post(
      `/api/v1/finance/performance-periods/${periodId}/reviews`,
      {
        membershipId: idOf(teacher),
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
    const panel = page.getByRole('region', { name: `${PERIOD} · çok kaynaklı geri bildirim` })
    await expect(panel.getByText('Geri bildirim şablonu hazırlanmadı.')).toBeVisible()
    await expect(panel.getByText('Henüz değerlendiren atanmadı.')).toBeVisible()

    await panel.getByRole('button', { name: 'Geri bildirim şablonunu hazırla' }).click()
    const templateDialog = page.getByRole('dialog', { name: 'Geri bildirim şablonu' })
    await templateDialog.getByLabel('1. soru', { exact: true }).fill('Ekip çalışmasına katkısı')
    await templateDialog.getByRole('button', { name: 'Soru ekle' }).click()
    await templateDialog.getByLabel('2. soru', { exact: true }).fill('Güçlü yanları neler?')
    await templateDialog.getByLabel('2. soru türü').selectOption({ label: 'Açık uçlu' })
    await templateDialog.getByRole('button', { name: 'Şablonu kaydet' }).click()
    await expect(templateDialog).toBeHidden()
    await expect(panel.getByText('Geri bildirim şablonu: 2 soru, 2 zorunlu.')).toBeVisible()

    // Değerlendirilen kendini değerlendiremez (K-458): seçenekte yoktur.
    const subjectRow = panel.getByRole('row', { name: new RegExp(teacher) })
    await subjectRow.getByRole('button', { name: `${teacher} değerlendirenleri` }).click()
    const reviewers = page.getByRole('dialog', { name: `${teacher} · değerlendirenler` })
    const reviewerSelect = reviewers.getByLabel('Değerlendiren', { exact: true })
    const assigned = reviewers.getByRole('list', { name: 'Değerlendirenler' })
    await expect(reviewerSelect.locator(`option[value="${idOf(teacher)}"]`)).toHaveCount(0)
    await reviewerSelect.selectOption(idOf(manager))
    await reviewers.getByLabel('İlişki').selectOption({ label: 'Yönetici' })
    await reviewers.getByRole('button', { name: 'Değerlendiren ata' }).click()
    await expect(assigned.getByText(`${manager} · Yönetici`)).toBeVisible()
    await reviewerSelect.selectOption(idOf(colleague))
    await reviewers.getByLabel('İlişki').selectOption({ label: 'Meslektaş' })
    await reviewers.getByRole('button', { name: 'Değerlendiren ata' }).click()
    await expect(assigned.getByText(`${colleague} · Meslektaş`)).toBeVisible()
    // Planlamada yanıt girilmez (K-458).
    await expect(reviewers.getByRole('button', { name: /yanıtını gir/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(reviewers).toBeHidden()
    await expect(subjectRow).toContainText('0 / 1')

    const advanceTo = async (label: string) => {
      await row.getByRole('button', { name: `${PERIOD} dönemini ${label} aşamasına geçir` }).click()
      const advance = page.getByRole('dialog', { name: 'Dönemin aşamasını ilerlet' })
      await advance.getByRole('button', { name: `${label} aşamasına geç` }).click()
      await expect(advance).toBeHidden()
    }
    await advanceTo('Yürürlükte')

    const enter = async (reviewer: string, score: string, text: string) => {
      await subjectRow.getByRole('button', { name: `${teacher} değerlendirenleri` }).click()
      await reviewers.getByRole('button', { name: `${reviewer} yanıtını gir` }).click()
      const form = reviewers.getByRole('form', { name: `${reviewer} yanıtı` })
      await form.getByLabel('Yanıtın geldiği kanal').selectOption({ label: 'Kâğıt form' })
      await form.getByLabel('Ekip çalışmasına katkısı').selectOption(score)
      await form.getByLabel('Güçlü yanları neler?').fill(text)
      await form.getByRole('button', { name: 'Yanıtı kaydet' }).click()
      await expect(form).toBeHidden()
      await expect(
        reviewers.getByRole('button', { name: `${reviewer} yanıtını geri al` }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(reviewers).toBeHidden()
    }
    await enter(manager, '5', 'Planlı ve düzenli çalışır')
    await enter(colleague, '3', PEER_TEXT)
    await expect(
      panel.getByText('Yanıtlanan 2 / 2 (%100) · Yönetici 1 / 1 · Meslektaş 1 / 1'),
    ).toBeVisible()
    await expect(panel.getByText(/Yanıt girildiği için sorular değiştirilemez/)).toBeVisible()

    await advanceTo('Ara görüşme')
    await advanceTo('Değerlendirme')
    await subjectRow.getByRole('button', { name: `${teacher} geri bildirim sonucu` }).click()
    const result = page.getByRole('dialog', { name: `${teacher} · geri bildirim sonucu` })
    const managerAnswers = result.getByRole('definition')
    await expect(managerAnswers.filter({ hasText: '5 / 5' })).toBeVisible()
    await expect(managerAnswers.filter({ hasText: 'Planlı ve düzenli çalışır' })).toBeVisible()
    await expect(
      result.getByText('Meslektaş sonucu gizli: en az 3 yanıt gerekir, 1 yanıt var.'),
    ).toBeVisible()
    await expect(result.getByText(PEER_TEXT)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(result).toBeHidden()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
