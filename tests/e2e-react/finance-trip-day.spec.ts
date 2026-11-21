import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Gezi günü yoklaması ve acil kart (ON-157; DOM-FIN-154). Kural dalları birim ve API testlerindedir
// (`tests/finance-trip-day.test.ts`, `apps/api/test/finance-trip-day.test.ts`); burada yönetici
// onaylı gezinin "Gezi günü" sekmesinde grup açar, katılımcıları dağıtır, yoklama turunu yürütür
// (eksik varken "Tamam" kapalı, gerekçeyle "Eksikle devam"; K-517) ve acil kart PDF'ini indirir
// (K-518). Gezi bugün (İstanbul) başlar: plan birkaç dakika sonrası için açılıp onaylanır.

const ADMIN = '/yonetici/finans'
type Json = Record<string, unknown>

async function send(
  client: ApiClient,
  path: string,
  data: unknown,
  headers: Record<string, string>,
): Promise<Json> {
  const response = await client.context.fetch(path, {
    method: 'POST',
    data,
    headers,
    failOnStatusCode: false,
  })
  expect([200, 201], `${path}: ${await response.text()}`).toContain(response.status())
  return ((await response.json()) as { data: Json }).data
}

/** Bugün çıkan onaylı plan; görevli kurumun öğretmeni (sorumlu). */
async function approvedPlanToday(admin: ApiClient, leadMembershipId: string) {
  const departure = new Date(Date.now() + 15 * 60_000)
  const plan = await send(
    admin,
    '/api/v1/finance/trip-plans',
    {
      name: 'Bilim müzesi gezisi',
      purpose: 'Fen dersinin deney kazanımlarını gözlemlemek.',
      departureAt: departure.toISOString(),
      returnAt: new Date(departure.getTime() + 3 * 3_600_000).toISOString(),
      expectedStudentCount: 2,
      stops: [{ place: 'Bilim Müzesi' }],
      staff: [{ membershipId: leadMembershipId, role: 'lead' }],
      transport: { type: 'train' },
      risks: [{ risk: 'Kalabalıkta kaybolma', measure: 'Grup sorumlusu ve yoklama' }],
      emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234567', relation: 'Müdür' }],
    },
    { 'idempotency-key': randomUUID() },
  )
  const url = `/api/v1/finance/trip-plans/${String(plan.id)}`
  const submitted = await send(
    admin,
    `${url}/submit`,
    {},
    { 'if-match': `"${String(plan.version)}"` },
  )
  await send(admin, `${url}/approve`, {}, { 'if-match': `"${String(submitted.version)}"` })
  return { id: String(plan.id), number: String(plan.number) }
}

test.describe('DOM-FIN-154: gezi günü ekranı', () => {
  test('DOM-FIN-154: yönetici grup açar, dağıtır, eksikle devam eder ve acil kartı indirir (K-517, K-518)', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], students: ['s1', 's2'] })
    const admin = await api(school.user('yonetici'))
    const options = await admin.get('/api/v1/finance/trip-plan-options')
    const teacher = (
      options.body as { data: { staff: { membershipId: string; role: string }[] } }
    ).data.staff.find((row) => row.role === 'ogretmen')
    expect(teacher).toBeDefined()
    const plan = await approvedPlanToday(admin, teacher?.membershipId ?? '')
    const dayUrl = `/api/v1/finance/trip-plans/${plan.id}/day`
    const before = (await admin.get(dayUrl)).body as {
      data: { unassigned: { studentId: string; studentName: string }[] }
    }
    const [first, second] = before.data.unassigned
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const present = first?.studentName ?? ''
    const missing = second?.studentName ?? ''

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=gezi-plani`)
    await page
      .getByRole('region', { name: 'Gezi planları' })
      .getByRole('button', { name: `${plan.number} ayrıntısını aç` })
      .click()
    const panel = page.getByRole('dialog', { name: 'Gezi planı', exact: true })
    await panel.getByRole('button', { name: 'Gezi günü' }).click()
    await expect(panel.getByText('Henüz grup yok.', { exact: false })).toBeVisible()

    await panel.getByRole('button', { name: 'Grup ekle' }).click()
    const groupForm = page.getByRole('form', { name: 'Grup ekle' })
    await groupForm.getByLabel('Grup ya da araç adı').fill('1. vagon')
    await groupForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(groupForm).toBeHidden()
    await expect(panel.getByRole('heading', { name: '1. vagon' })).toBeVisible()

    const assign = panel.getByRole('form', { name: 'Öğrencileri gruba taşı' })
    await assign.getByLabel(present).check()
    await assign.getByLabel(missing).check()
    await assign.getByRole('button', { name: 'Seçilenleri taşı (2)' }).click()
    await expect(panel.getByText('Bütün katılımcıların grubu var.')).toBeVisible()

    await panel.getByRole('button', { name: 'Yoklama başlat' }).click()
    const start = page.getByRole('form', { name: 'Yoklama başlat' })
    await expect(start.getByLabel('Kontrol noktası')).toHaveValue('Okuldan çıkış')
    await start.getByRole('button', { name: 'Yoklamayı başlat' }).click()
    await expect(start).toBeHidden()

    const roster = panel.getByRole('list', { name: 'Okuldan çıkış yoklaması' })
    await roster.getByRole('button', { name: `${present}: Var` }).click()
    await expect(roster.getByRole('button', { name: `${present}: Var` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await roster.getByRole('button', { name: `${missing}: Yok` }).click()
    await expect(roster.getByRole('button', { name: `${missing}: Yok` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Eksik varken tur tamamlanamaz (güvenlik); yalnız gerekçeli eksikle devam.
    await expect(panel.getByRole('button', { name: 'Tamam', exact: true })).toBeDisabled()
    await panel.getByRole('button', { name: 'Eksikle devam', exact: true }).click()
    const proceed = page.getByRole('form', { name: 'Eksikle devam' })
    await expect(proceed.getByText(`Eksik: ${missing}`)).toBeVisible()
    await proceed.getByLabel('Gerekçe').fill('Veli öğrenciyi okuldan aldı, müdür bilgilendirildi')
    await proceed.getByRole('button', { name: 'Eksikle devam et' }).click()
    await expect(proceed).toBeHidden()
    const history = panel.getByRole('list', { name: '1. vagon yoklama geçmişi' })
    await expect(history.getByText('1. Okuldan çıkış · 1 var · 1 yok')).toBeVisible()
    await expect(history.getByText(/Gerekçe: Veli öğrenciyi okuldan aldı/)).toBeVisible()

    await panel.getByRole('button', { name: '1. vagon acil kartını indir' }).click()
    const cardForm = page.getByRole('dialog', { name: 'Acil kartı indir' })
    await cardForm.getByLabel(/Acil durum için tam telefon/).check()
    const downloading = page.waitForEvent('download')
    await cardForm.getByRole('button', { name: 'PDF indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toMatch(/^gezi-acil-karti-GZ-\d{4}-[0-9A-F]{6}\.pdf$/)
    const text = await pdfText(file)
    for (const expected of ['GEZİ ACİL KARTI', '1. vagon', present, missing, 'Okul müdürü'])
      expect(text).toContain(expected)
    await expect(cardForm).toBeHidden()

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    await expect
      .poll(async () => {
        const day = (await admin.get(dayUrl)).body as {
          data: { groups: { checks: { status: string; counts: Json }[] }[] }
        }
        return day.data.groups[0]?.checks.map((check) => check.status)
      })
      .toEqual(['incomplete'])
  })
})
