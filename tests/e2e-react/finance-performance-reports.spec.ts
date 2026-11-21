import { randomUUID } from 'node:crypto'

import { apiRequest, type ApiClient } from './support/api.ts'
import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Performans raporu (ON-220, ON-350; DOM-FIN-137, K-466…K-468). Kural dalları birim ve API
// testlerindedir (`tests/finance-performance-reports.test.ts`,
// `apps/api/test/finance-performance-reports.test.ts`); burada dönem, puan, gözlem, geri bildirim,
// gelişim hedefi ve kapanış API'den kurulur; yönetici "Performans" sekmesinde dönem özetini ve
// raporu görür (meslektaş yanıtı eşiğin altında: "yeterli yanıt yok"), raporu görüşüyle
// kesinleştirir, hedef sonradan düzenlense de rapordaki özetin değişmediğini görür, personelin
// "okudum" kaydını girer ve PDF'i indirir.

const ADMIN_URL = '/yonetici/finans?gorunum=performans'
const PERIOD = 'Güz performans raporu'
const OPINION = 'Okuma hedefine ulaştı; veli iletişimi örnek.'
const GOAL = 'Sınıf içi soru tekniği'
const PEER_SECRET = 'Tek meslektaş cevabı görünmemeli'

type Data<T> = { data: T }
const key = () => ({ 'idempotency-key': randomUUID() })

async function advance(admin: ApiClient, periodId: string, version: number, statuses: string[]) {
  let current = version
  for (const status of statuses) {
    const moved = await admin.post(
      `/api/v1/finance/performance-periods/${periodId}/status`,
      { status },
      { 'if-match': `"${String(current)}"` },
    )
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    current = (moved.body as Data<{ version: number }>).data.version
  }
  return current
}

test.describe('ON-220: performans raporu', () => {
  test('DOM-FIN-137: yönetici dönem özetini ve raporu görür, kesinleştirir, okudum kaydı girer ve PDF alır', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const manager = school.user('yonetici').name
    const admin = await api(school.user('yonetici'))
    const period = await admin.post(
      '/api/v1/finance/performance-periods',
      { name: PERIOD, startDate: istanbulDay(-40), endDate: istanbulDay(-1) },
      key(),
    )
    expect(period.status, JSON.stringify(period.body)).toBe(201)
    const { id: periodId, version } = (period.body as Data<{ id: string; version: number }>).data
    const staff = await admin.get('/api/v1/finance/staff-certificate-staff?page=1&pageSize=100')
    const staffRows = (staff.body as Data<{ membershipId: string; name: string }[]>).data
    const memberOf = (name: string) => staffRows.find((row) => row.name === name)?.membershipId
    const membershipId = memberOf(teacher)
    expect(membershipId).toBeTruthy()
    const review = await admin.post(
      `/api/v1/finance/performance-periods/${periodId}/reviews`,
      {
        membershipId,
        goals: [
          { title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 60 },
          { title: 'Veli iletişimi', criterion: 'Her ay görüşme', weight: 40 },
        ],
      },
      key(),
    )
    expect(review.status, JSON.stringify(review.body)).toBe(201)
    const reviewRow = (review.body as Data<{ id: string; version: number }>).data
    const template = await admin.post(
      `/api/v1/finance/performance-periods/${periodId}/staff-feedback-template`,
      {
        questions: [
          { kind: 'scale', text: 'Ekip çalışmasına katkısı', required: true },
          { kind: 'open', text: 'Güçlü yanları', required: false },
        ],
      },
      key(),
    )
    expect(template.status, JSON.stringify(template.body)).toBe(201)
    let periodVersion = await advance(admin, periodId, version, ['active'])

    // Çok kaynaklı geri bildirim (DOM-FIN-134): yönetici ve tek meslektaş yanıtı; meslektaş eşiğin
    // (3) altında kaldığı için raporda yalnız "yeterli yanıt yok" görünür (K-459, K-468).
    const feedback = async (reviewerName: string, relation: string, answers: unknown[]) => {
      const assigned = await admin.post(
        `/api/v1/finance/performance-periods/${periodId}/staff-feedback-assignments`,
        {
          subjectMembershipId: membershipId,
          reviewerMembershipId: memberOf(reviewerName),
          relation,
        },
        key(),
      )
      expect(assigned.status, JSON.stringify(assigned.body)).toBe(201)
      const row = (assigned.body as Data<{ id: string; version: number }>).data
      const responded = await admin.post(
        `/api/v1/finance/staff-feedback-assignments/${row.id}/response`,
        { channel: 'paper', answers },
        { 'if-match': `"${String(row.version)}"` },
      )
      expect(responded.status, JSON.stringify(responded.body)).toBe(200)
    }
    await feedback(manager, 'manager', [{ score: 5 }, { text: 'Planlı ve özenli' }])
    await feedback(school.user('onburo').name, 'peer', [{ score: 2 }, { text: PEER_SECRET }])

    // Döneme bağlı tamamlanmış bir ders gözlemi: (4×2 + 3×1) / 15 → %73.
    const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
    const form = await admin.post(
      '/api/v1/finance/lesson-observation-templates',
      {
        name: 'Ders gözlem formu',
        criteria: [
          { title: 'Sınıf yönetimi', weight: 2, levels },
          { title: 'Öğrenci katılımı', weight: 1, levels },
        ],
      },
      key(),
    )
    expect(form.status, JSON.stringify(form.body)).toBe(201)
    const observation = await admin.post(
      '/api/v1/finance/lesson-observations',
      {
        templateId: (form.body as Data<{ id: string }>).data.id,
        teacherMembershipId: membershipId,
        observedDate: istanbulDay(-5),
        performancePeriodId: periodId,
      },
      key(),
    )
    expect(observation.status, JSON.stringify(observation.body)).toBe(201)
    const draft = (observation.body as Data<{ id: string; version: number }>).data
    const rated = await apiRequest(
      admin.context,
      'PATCH',
      `/api/v1/finance/lesson-observations/${draft.id}`,
      {
        ratings: [
          { criterionId: 'k1', level: 4 },
          { criterionId: 'k2', level: 3 },
        ],
        generalNote: 'Güçlü bir ders',
      },
      { 'if-match': `"${String(draft.version)}"` },
    )
    expect(rated.status, JSON.stringify(rated.body)).toBe(200)
    const completed = await admin.post(
      `/api/v1/finance/lesson-observations/${draft.id}/complete`,
      {},
      { 'if-match': `"${String((rated.body as Data<{ version: number }>).data.version)}"` },
    )
    expect(completed.status, JSON.stringify(completed.body)).toBe(200)

    // Döneme bağlı açık bir gelişim hedefi (DOM-FIN-133); rapora "Gelişim hedefleri" bölümüyle girer.
    const goal = await admin.post(
      '/api/v1/finance/development-goals',
      {
        teacherMembershipId: membershipId,
        performancePeriodId: periodId,
        title: GOAL,
        successCriterion: 'Derste en az beş açık uçlu soru',
        followUpDate: istanbulDay(10),
      },
      key(),
    )
    expect(goal.status, JSON.stringify(goal.body)).toBe(201)
    const goalRow = (goal.body as Data<{ id: string; version: number }>).data

    periodVersion = await advance(admin, periodId, periodVersion, ['interim', 'evaluation'])
    const scored = await apiRequest(
      admin.context,
      'PATCH',
      `/api/v1/finance/performance-reviews/${reviewRow.id}`,
      { scores: [5, 4] },
      { 'if-match': `"${String(reviewRow.version)}"` },
    )
    expect(scored.status, JSON.stringify(scored.body)).toBe(200)
    await advance(admin, periodId, periodVersion, ['closed'])

    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const periods = page.getByRole('region', { name: 'Performans dönemleri' })
    await periods
      .getByRole('row', { name: new RegExp(PERIOD) })
      .getByRole('button', { name: `${PERIOD} kayıtları` })
      .click()
    const panel = page.getByRole('region', { name: `${PERIOD} · rapor` })
    await expect(panel.getByText(/1 personel · ortalama 4,60 \/ 5/)).toBeVisible()
    await expect(panel.getByText(/1 gözlem, ortalama %73,0/)).toBeVisible()
    await expect(panel.getByLabel('Genel puan dağılımı')).toContainText('4,00–4,99')

    const row = panel.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('4,60 / 5')
    await expect(row).toContainText('1 · %73,0')
    await expect(row).toContainText('Kesinleşmedi')
    await row.getByRole('button', { name: `${teacher} raporunu aç` }).click()
    let dialog = page.getByRole('dialog', { name: `${teacher} · performans raporu` })
    await expect(dialog.getByRole('heading', { name: 'Dönem sonu değerlendirmesi' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Ders gözlemleri' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Gelişim hedefleri' })).toBeVisible()
    await expect(dialog.getByRole('list', { name: 'Gelişim hedefleri' })).toContainText(GOAL)
    await expect(dialog.getByText('Yanıt yok', { exact: false })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Çok kaynaklı geri bildirim' })).toBeVisible()
    await expect(dialog.getByLabel(`Yönetici değerlendirmesi: ${manager}`)).toContainText(
      'Planlı ve özenli',
    )
    await expect(dialog.getByText(/Yeterli meslektaş yanıtı yok/)).toBeVisible()
    await expect(dialog.getByText(PEER_SECRET)).toHaveCount(0)
    // Görüş en az 10 karakter (K-467).
    await dialog.getByRole('textbox', { name: 'Yönetici görüşü' }).fill('Kısa')
    await dialog.getByRole('button', { name: 'Raporu kesinleştir' }).click()
    await expect(dialog.getByText('Yönetici görüşünü en az 10 karakterle yazın.')).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Yönetici görüşü' }).fill(OPINION)
    await dialog.getByRole('button', { name: 'Raporu kesinleştir' }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Kesinleşti')

    // Kesinleşmeden sonra hedef düzenlenir ve dönem bağı kaldırılır; rapordaki özet değişmez (K-468).
    const edited = await apiRequest(
      admin.context,
      'PATCH',
      `/api/v1/finance/development-goals/${goalRow.id}`,
      { title: 'Sonradan değişen hedef', performancePeriodId: null },
      { 'if-match': `"${String(goalRow.version)}"` },
    )
    expect(edited.status, JSON.stringify(edited.body)).toBe(200)

    await row.getByRole('button', { name: `${teacher} raporunu aç` }).click()
    dialog = page.getByRole('dialog', { name: `${teacher} · performans raporu` })
    await expect(dialog.getByText(OPINION)).toBeVisible()
    await expect(dialog.getByRole('list', { name: 'Gelişim hedefleri' })).toContainText(GOAL)
    await expect(dialog.getByText('Sonradan değişen hedef')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Raporu kesinleştir' })).toHaveCount(0)
    await dialog.getByLabel('Kanal').selectOption({ label: 'Yüz yüze görüşme' })
    await dialog.getByRole('button', { name: 'Okudum kaydını gir' }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Okundu')
    await expect(panel.getByText(/1 rapor kesinleşti, 1 okundu/)).toBeVisible()

    await row.getByRole('button', { name: `${teacher} performans raporu PDF` }).click()
    const pdf = page.getByRole('dialog', { name: 'Performans raporu · Önizleme' })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of [
      'PERFORMANS RAPORU',
      teacher,
      'Okuma becerisi',
      'Çok kaynaklı geri bildirim',
      'Yeterli meslektaş yanıtı yok',
      'Gelişim hedefleri',
      GOAL,
      'Yüz yüze görüşme',
    ])
      expect(text).toContain(expected)
    expect(text).not.toContain(PEER_SECRET)
    expect(text).not.toContain('Sonradan değişen hedef')
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    // Okuma ve PDF denetim kaydına düştü (K-468).
    const audit = await admin.get('/api/v1/audit-events?page=1&pageSize=100')
    const actions = (audit.body as Data<{ action: string }[]>).data.map((item) => item.action)
    for (const action of [
      'finance.performance_report.list',
      'finance.performance_report.read',
      'finance.performance_report.export',
      'finance.performance_report.finalize',
      'finance.performance_report.acknowledge',
    ])
      expect(actions).toContain(action)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
