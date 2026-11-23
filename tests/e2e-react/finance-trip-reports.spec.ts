import { randomUUID } from 'node:crypto'

import pg from 'pg'

import type { ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { markFilesReady } from './support/materials.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Gezi sonrası rapor ve rızalı fotoğraf (ON-158; DOM-FIN-158; K-529, K-530). Kural dalları birim
// ve API testlerindedir (`tests/finance-trip-reports.test.ts`,
// `apps/api/test/finance-trip-reports.test.ts`); burada yönetici biten gezinin "Gezi raporu"
// sekmesinde raporu yazar, fotoğraf ekleyip öğrenciyi etiketler (rızası olmadığı için fotoğraf iç
// arşivde kalır), onaya gönderir ve onaylar. Gezi günü yoklaması API'den yapılır; plan sonra
// geçmişe taşınır (gezi bitmiş sayılır).

const ADMIN = '/yonetici/finans'
type Json = Record<string, unknown>

const PHOTO = {
  name: 'gezi.png',
  mimeType: 'image/png',
  buffer: Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'),
    Buffer.alloc(64),
  ]),
}

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
const key = () => ({ 'idempotency-key': randomUUID() })
const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })

/** Kurumun planlarını geçmişe taşır: gezi 3 saat önce çıkmış, 1 saat önce dönmüş olur. */
async function finishPlans(institutionId: string) {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      `update trip_plans set departure_at = now() - interval '3 hours',
         return_at = now() - interval '1 hour' where institution_id = $1`,
      [institutionId],
    )
    expect(result.rowCount).toBeGreaterThan(0)
  } finally {
    await client.end()
  }
}

/** Onaylı plan, tek grup ve kapanmış tur: ilk öğrenci var, ikincisi yok (eksikle devam). */
async function tripWithAttendance(admin: ApiClient, leadMembershipId: string) {
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
    key(),
  )
  const url = `/api/v1/finance/trip-plans/${String(plan.id)}`
  const submitted = await send(admin, `${url}/submit`, {}, ifMatch(plan.version))
  await send(admin, `${url}/approve`, {}, ifMatch(submitted.version))
  const day = await send(
    admin,
    `${url}/day/groups`,
    { name: '1. vagon', leaderMembershipId: leadMembershipId },
    key(),
  )
  const groupId = String((day.groups as Json[])[0]?.id)
  const students = (day.unassigned as { studentId: string; studentName: string }[]).slice(0, 2)
  expect(students).toHaveLength(2)
  await send(
    admin,
    `${url}/day/assignments`,
    { groupId, studentIds: students.map((row) => row.studentId) },
    key(),
  )
  const started = await send(
    admin,
    `${url}/day/groups/${groupId}/checks`,
    { checkpoint: 'Varış' },
    key(),
  )
  const check = ((started.groups as Json[])[0]?.checks as Json[])[0] as Json
  const marked = await send(
    admin,
    `${url}/day/checks/${String(check.id)}/marks`,
    {
      marks: [
        { studentId: students[0]?.studentId, status: 'present' },
        { studentId: students[1]?.studentId, status: 'absent' },
      ],
    },
    key(),
  )
  const version = (((marked.groups as Json[])[0]?.checks as Json[])[0] as Json).version
  await send(
    admin,
    `${url}/day/checks/${String(check.id)}/proceed`,
    { reason: 'Öğrenci rahatsızlandı, veliyle ayrıldı.' },
    ifMatch(version),
  )
  return {
    id: String(plan.id),
    number: String(plan.number),
    present: students[0]?.studentName ?? '',
  }
}

test.describe('DOM-FIN-158: gezi raporu ekranı', () => {
  test('DOM-FIN-158: yönetici raporu yazar, rızasız öğrencinin fotoğrafı iç arşivde kalır, onaylar (K-529, K-530)', async ({
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
    const plan = await tripWithAttendance(admin, teacher?.membershipId ?? '')
    await finishPlans(school.institutionId)

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=gezi-plani`)
    await page
      .getByRole('region', { name: 'Gezi planları' })
      .getByRole('button', { name: `${plan.number} ayrıntısını aç` })
      .click()
    const panel = page.getByRole('dialog', { name: 'Gezi planı', exact: true })
    await panel.getByRole('button', { name: 'Gezi raporu' }).click()
    await expect(
      panel.getByText('Katılan 1 · Katılmayan 1 (listede 2) · gezi günü yoklamasından'),
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Raporu yazmaya başla' }).click()

    const form = panel.getByRole('form', { name: 'Gezi raporu' })
    await form
      .getByLabel('Gerçekleşme özeti')
      .fill('Gezi planlandığı gibi gerçekleşti; deney atölyesine katılındı.')
    await form
      .getByLabel('Kazanımlar ve değerlendirme')
      .fill('Öğrenciler basınç deneyini yerinde gözlemledi; atölye süresi uzatılmalı.')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Rapor kaydedildi.')).toBeVisible()

    await panel.getByRole('button', { name: 'Fotoğraf ekle' }).click()
    const photoForm = page.getByRole('form', { name: 'Fotoğraf ekle' })
    await photoForm.getByLabel('Fotoğraf', { exact: true }).setInputFiles(PHOTO)
    await expect(
      photoForm.getByRole('list', { name: 'Eklenecek fotoğraf' }).getByRole('listitem'),
    ).toHaveCount(1)
    // E2E API'si tarayıcısız koşar: dosya taramadan geçmiş gibi işaretlenir.
    await markFilesReady(school.institutionId)
    await expect(photoForm.getByText('Rıza yok').first()).toBeVisible()
    await photoForm.getByLabel(plan.present).check()
    await photoForm.getByLabel('Açıklama (isteğe bağlı)').fill('Atölye')
    await photoForm.getByRole('button', { name: 'Fotoğrafı ekle' }).click()
    await expect(photoForm).toBeHidden()
    const card = panel.getByRole('article', { name: 'Atölye' })
    await expect(card.getByText('Rıza eksik: iç arşivde')).toBeVisible()
    await expect(card.getByText(`${plan.present}: rıza yok`)).toBeVisible()

    await form.getByRole('button', { name: 'Onaya gönder' }).click()
    await expect(page.getByText('Rapor onaya gönderildi.')).toBeVisible()
    await expect(panel.getByText('Onay bekliyor', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Raporu onayla' }).click()
    await expect(panel.getByText('Onaylandı', { exact: true })).toBeVisible()
    // Rızası olmayan öğrencinin göründüğü fotoğraf onaydan sonra da ailelere açılmaz.
    await expect(card.getByText('Rıza eksik: iç arşivde')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Fotoğraf ekle' })).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    await expect
      .poll(async () => {
        const list = (await admin.get('/api/v1/finance/trip-reports?status=approved')).body as {
          data: { planId: string; photoCount: number }[]
        }
        return list.data.map((row) => [row.planId, row.photoCount])
      })
      .toEqual([[plan.id, 1]])
  })
})
