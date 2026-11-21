import { randomUUID } from 'node:crypto'

import { connectPostgres } from '../../apps/api/src/db/client.ts'
import { updatePeriod } from '../../apps/api/src/db/finance-club-selection.ts'
import type { ApiClient } from './support/api.ts'
import { istanbulDay } from './support/enrollment-finance-smoke.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kulüp tercihi ve kontenjanlı dağıtım (ON-169; DOM-FIN-150; IST-099). Kural dalları birim ve API
// testlerindedir (`tests/finance-club-selection.test.ts`, `apps/api/test/finance-club-selection.test.ts`);
// burada yönetici dönem açar, veli ve yönetici (adına) tercih girer, dönem kapanınca kura çekilir,
// önizleme onaylanır ve kulüpten ayrılan olunca yedekteki öğrenci elle eklenir (K-505…K-507).

const ADMIN = '/yonetici/finans?gorunum=kulupler&kulup_sekme=tercih'

type Json = Record<string, unknown>

async function created(client: ApiClient, path: string, data?: unknown): Promise<Json> {
  const result = await client.post(path, data, { 'idempotency-key': randomUUID() })
  expect(result.status, path).toBeLessThan(300)
  return (result.body as { data: Json }).data
}

/** Tercih dönemi kapanmış gibi günleri geriye alır (gerçek saat ilerletilemez; kurulum). */
async function closePeriod(institutionId: string, period: Json) {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    const saved = await updatePeriod(db, institutionId, {
      id: String(period.id),
      expectedVersion: Number(period.version),
      now: new Date(),
      values: { openDate: istanbulDay(-3), closeDate: istanbulDay(-1) },
    })
    expect(saved, 'dönem kapatma').toBe(true)
  } finally {
    await close()
  }
}

test.describe('DOM-FIN-150: kulüp tercihi ve dağıtım', () => {
  test('DOM-FIN-150: dönem açılır, tercih girilir, kura onaylanır, yedek elle eklenir (K-505, K-506, K-507)', async ({
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'veli'], students: ['s1', 's2', 's3'] })
    const admin = await api(school.user('yonetici'))
    const hosts = await admin.get('/api/v1/finance/visitor-hosts?page=1&pageSize=100')
    const teacher = (hosts.body as { data: { membershipId: string; role: string }[] }).data.find(
      (row) => row.role === 'ogretmen',
    )
    expect(teacher).toBeDefined()
    const club = (name: string) => ({
      name,
      teacherMembershipId: teacher?.membershipId,
      capacity: 1,
      meetingDay: 3,
      startTime: '15:30',
      endTime: '16:30',
    })
    const robotics = await created(admin, '/api/v1/finance/clubs', club('Robotik'))
    const chess = await created(admin, '/api/v1/finance/clubs', club('Satranç'))
    // Satranç dolu: iki öğrenciden yalnız biri Robotik'e yerleşir, diğeri yedekte kalır.
    await created(admin, `/api/v1/finance/clubs/${String(chess.id)}/members`, { studentId: 's3' })

    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Tercih dönemi' })
    await section.getByRole('button', { name: 'Tercih dönemi ekle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Tercih dönemi ekle' })
    const form = dialog.getByRole('form', { name: 'Tercih dönemi ekle' })
    await form.getByLabel('Dönem adı').fill('Güz kulüp tercihi')
    await form.getByLabel('Kapanış günü').fill(istanbulDay(0))
    await form.getByRole('checkbox', { name: 'Robotik · 1 kişi' }).click()
    await form.getByRole('checkbox', { name: 'Satranç · 1 kişi' }).click()
    await form.getByLabel('En çok tercih').fill('2')
    await form.getByRole('button', { name: 'Dönemi kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expect(section.getByRole('row', { name: /Güz kulüp tercihi/ })).toContainText(
      'Tercihe açık',
    )

    const periods = await admin.get('/api/v1/finance/club-selection/periods?page=1&pageSize=20')
    const period = (periods.body as { data: Json[] }).data[0]
    const parent = await api(school.user('veli'))
    await created(
      parent,
      `/api/v1/finance/club-selection/periods/${String(period?.id)}/preferences`,
      {
        studentId: 's1',
        choices: [robotics.id, chess.id],
      },
    )

    await section.getByRole('button', { name: 'Güz kulüp tercihi dönemini aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Tercih dönemi' })
    const entry = panel.getByRole('form', { name: 'Adına tercih gir' })
    await entry.getByLabel('Tercih edecek öğrenci').fill('Ece')
    await entry.getByRole('button', { name: 'Ece Yılmaz' }).click()
    await entry.getByLabel('1. tercih').selectOption({ label: 'Robotik' })
    await entry.getByLabel('2. tercih').selectOption({ label: 'Satranç' })
    await entry.getByRole('button', { name: 'Tercihi kaydet' }).click()
    const preferences = panel.getByRole('list', { name: 'Öğrenci tercihleri' })
    await expect(preferences).toContainText('Ece Yılmaz')
    await expect(preferences).toContainText('Deniz Yılmaz')
    await expect(panel.getByText('2 / 3 öğrenci tercih yaptı')).toBeVisible()

    const current = await admin.get(`/api/v1/finance/club-selection/periods/${String(period?.id)}`)
    await closePeriod(school.institutionId, (current.body as { data: Json }).data)
    await page.reload()
    const reopened = page.getByRole('dialog', { name: 'Tercih dönemi' })
    await reopened.getByRole('button', { name: 'Kurayı çek' }).click()
    const preview = reopened.getByRole('region', { name: 'Dağıtım önizlemesi' })
    await expect(preview.getByRole('list', { name: 'Önerilen atamalar' })).toContainText(
      'Robotik (1. tercih)',
    )
    await expect(preview.getByRole('list', { name: 'Önizleme yedek listesi' })).toContainText(
      '1. yedek',
    )
    await preview.getByRole('button', { name: 'Dağıtımı onayla' }).click()
    const result = reopened.getByRole('region', { name: 'Dağıtım sonucu' })
    await expect(result.getByText('1 atama · 1 öğrenci yedekte')).toBeVisible()
    await expect(reopened.getByRole('button', { name: 'Dağıtımı onayla' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    // Robotik'ten ayrılan olunca yedekteki ilk öğrenci önerilir; ekleme elle yapılır.
    const detail = await admin.get(`/api/v1/finance/clubs/${String(robotics.id)}`)
    const member = (detail.body as { data: { members: { id: string; version: number }[] } }).data
      .members[0]
    expect(member).toBeDefined()
    const removed = await admin.context.fetch(
      `/api/v1/finance/clubs/${String(robotics.id)}/members/${String(member?.id)}`,
      {
        method: 'DELETE',
        headers: { 'if-match': `"${String(member?.version)}"` },
        failOnStatusCode: false,
      },
    )
    expect(removed.status()).toBe(200)
    await page.reload()
    const after = page.getByRole('dialog', { name: 'Tercih dönemi' })
    await expect(after.getByText(/Boş yer var; önerilen yedek:/)).toBeVisible()
    await after.getByRole('button', { name: /Robotik kulübüne ekle/ }).click()
    await expect(page.getByText(/kulübe eklendi\./)).toBeVisible()
    await expect(after.getByText(/Boş yer var; önerilen yedek:/)).toHaveCount(0)
    await expect(after.getByText(/Üye oldu/)).toBeVisible()
  })
})
