import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import {
  assignTask,
  requestSecondRating,
  seedHomework,
  seedRubric,
  seedSecondScore,
  userIdOf,
} from './support/tasks.ts'
import type { TenantOptions } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// OG-058 (IST-005, IST-048; DOM-BEC-024, DOM-YTK-027): zümre başkanı uyuşmazlık kuyruğundan iki
// puanı ayrışan yazıyı açar, iki puanı yan yana görür ve rubrikle son puanı verir. Kapsam, kör
// puanlama ve hata dalları API testindedir (`apps/api/test/coordinator-duties.test.ts`), ekran
// modeli birim testindedir (`apps/web-react/tests/dispute-model.test.ts`). İçerik, rubrik, ikinci
// puanlama isteği ve ikinci puan doğrudan veritabanına; atama, teslim ve ilk puan API'ye yazılır.

const TITLE = 'Uyuşmazlıklı yazı'
const DENIZ = 'Deniz Yılmaz'
/** 7-A'nın İngilizce öğretmeni (seed, Kadıköy); zümre başkanlığı branşında verilir. */
const ENGLISH_TEACHER: Pick<TenantOptions, 'teacherId'> = { teacherId: 't11' }

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const idempotent = () => ({ 'idempotency-key': randomUUID() })

async function ok(result: { status: number; body: unknown }, status = 200): Promise<Json> {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Json }).data
}

async function makeCoordinator(admin: ApiClient, teacherName: string) {
  const members = (await admin.get('/api/v1/institution-members?role=ogretmen&pageSize=100'))
    .body as { data: { id: string; name: string }[] }
  const member = members.data.find((item) => item.name === teacherName)
  expect(member, `öğretmen üyeliği: ${teacherName}`).toBeDefined()
  await ok(
    await admin.post(
      '/api/v1/coordinator-duties',
      { membershipId: member?.id, scopeId: 'english' },
      idempotent(),
    ),
    201,
  )
}

/** Deniz'in yazısı: yönetici ilk puanı (Görev 5), ikinci puanlayıcı Görev 1 verir. */
async function disputedSubmission(
  institutionId: string,
  admin: ApiClient,
  student: ApiClient,
): Promise<string> {
  const ownerId = await userIdOf(admin)
  const resourceVersionId = await seedHomework(institutionId, ownerId, TITLE, 'english')
  const rubricVersionId = await seedRubric(institutionId, ownerId)
  const assignmentId = await assignTask(admin, {
    resourceVersionId,
    settings: { submission: { submissionKind: 'text', maxVersions: 1 }, rubricVersionId },
  })
  const submitted = await ok(
    await student.post(
      `/api/v1/task-assignments/${assignmentId}/submissions`,
      { submissionKind: 'text', body: 'Last weekend I visited my grandmother in Izmir.' },
      idempotent(),
    ),
    201,
  )
  const submissionId = submitted.id as string
  await requestSecondRating(institutionId, submissionId, ownerId)
  const detail = await ok(await admin.get(`/api/v1/task-submissions/${submissionId}`))
  await ok(
    await admin.post(
      `/api/v1/task-submissions/${submissionId}/scores`,
      {
        versionNumber: 1,
        criteria: [
          { criterionId: 'task', band: 5, comment: null },
          { criterionId: 'grammar', band: 3, comment: null },
        ],
        overallComment: 'İlk puanlayıcının genel yorumu',
      },
      { ...idempotent(), 'if-match': `"${detail.rowVersion}"` },
    ),
    201,
  )
  await seedSecondScore(institutionId, {
    submissionVersionId: detail.versions[0].id,
    rubricVersionId,
    bands: { task: 1, grammar: 3 },
  })
  return submissionId
}

test('IST-005, DOM-BEC-024, DOM-YTK-027: zümre başkanı uyuşmazlık kuyruğundan son puanı verir; sonuç kesinleşir ve kuyruk boşalır', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen', 'ogrenci'], ...ENGLISH_TEACHER })
  const admin = await api(school.user('yonetici'))
  const submissionId = await disputedSubmission(
    school.institutionId,
    admin,
    await api(school.user('ogrenci')),
  )
  await makeCoordinator(admin, school.user('ogretmen').name)

  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/odevler?sekme=uyusmazlik')
  await expect(page.getByRole('heading', { name: 'Uyuşmazlık kuyruğu', level: 2 })).toBeVisible()
  const rows = page.getByRole('table', { name: 'Uyuşmazlık kuyruğu' }).locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(TITLE)
  await expectNoHorizontalOverflow(page)

  await rows
    .getByRole('button', { name: `${DENIZ} teslimine son puanı ver`, exact: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: 'Son puanı ver' })
  await expect(page).toHaveURL(new RegExp(`son-puan=${submissionId}`))
  // İki puan kriter bazında yan yana; yalnız sunucunun bildirdiği kriter uyuşmazlıktır.
  const comparison = dialog.getByRole('table', { name: 'Kriter bazında ilk ve ikinci puan' })
  await expect(
    comparison.getByRole('row', { name: /Görevin yerine getirilmesi 5 1 Uyuşmazlık/ }),
  ).toBeVisible()
  await expect(comparison.getByRole('row', { name: /3 3 Uyumlu/ })).toBeVisible()

  const form = dialog.getByRole('form', { name: 'Son puan' })
  for (const aspect of ['Görevin yerine getirilmesi', 'Dilbilgisel doğruluk']) {
    await form
      .getByRole('radiogroup', { name: `${aspect} bandı` })
      .getByLabel(/^4 ·/)
      .check()
  }
  await form.getByLabel('Genel geri bildirim', { exact: true }).fill('Koordinatörün son yorumu')
  await form.getByRole('button', { name: 'Son puanı kaydet', exact: true }).click()

  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Son puan kaydedildi' }),
  ).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Son puan bekleyen uyuşmazlık yok.', { exact: true })).toBeVisible()
  const settled = await ok(await admin.get(`/api/v1/task-submissions/${submissionId}`))
  expect(settled.versions[0].grading.status).toBe('settled')
  expect(settled.versions[0].score.settled).toBe(true)
})

test('DOM-YTK-027: koordinatör görevi olmayan öğretmen Uyuşmazlıklar sekmesini görmez; adres Ödevler’e düşer', async ({
  page,
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'], ...ENGLISH_TEACHER })
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/odevler?sekme=uyusmazlik')
  const tabs = page.getByRole('toolbar', { name: 'Ödev ve görev bölümleri' })
  await expect(tabs.getByRole('button', { name: 'Ödevler', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(tabs.getByRole('button', { name: 'Uyuşmazlıklar', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Uyuşmazlık kuyruğu' })).toHaveCount(0)
})
