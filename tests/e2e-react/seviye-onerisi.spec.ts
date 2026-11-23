import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { seedTeacherGroup } from './support/cefr.ts'
import { expect, test } from './support/fixtures.ts'
import { assignTask, seedQuiz, userIdOf } from './support/tasks.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// OG-247 (IST-060; DOM-BEC-030…034): dil okulunda "Tahmini seviye" değerlendirme görevlerinden
// hesaplanır, dayandığı kanıt görevlerini listeler ve görevine bağlanır; yetersiz kanıtın nedeni
// Türkçe söylenir. Öneri hesabı ve kapsam API testindedir (`apps/api/test/cefr-task-evidence.test.ts`),
// sunum birim testindedir (`apps/web-react/tests/cefr-profile-model.test.ts`).

const TASK = 'Deniz okuma kanıtı'
const GROUP = 'A2 Sabah'

/** Öğrenci denemeyi başlatır ve iki soruyu `a` ile cevaplayıp teslim eder (%25, başarısız). */
async function completeAttempt(student: ApiClient, assignmentId: string) {
  const started = await student.post(
    `/api/v1/task-assignments/${assignmentId}/attempts`,
    {},
    { 'idempotency-key': randomUUID() },
  )
  expect(started.status, JSON.stringify(started.body)).toBe(201)
  const attempt = (
    started.body as {
      data: { id: string; rowVersion: number; questions: { questionVersionId: string }[] }
    }
  ).data
  const answers = Object.fromEntries(
    attempt.questions.map((question) => [
      question.questionVersionId,
      { questionType: 'multiple_choice', optionId: 'a' },
    ]),
  )
  const submitted = await student.post(
    `/api/v1/task-attempts/${attempt.id}/submit`,
    { answers },
    { 'idempotency-key': randomUUID(), 'if-match': `"${attempt.rowVersion}"` },
  )
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
}

test('OG-247 DOM-BEC-034: tahmini seviye kanıt görevini listeler ve görevine bağlar; öğretmen aynı kanıtı görev listesine bağlı görür', async ({
  api,
  loginAs,
  page,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: ['ogretmen', 'ogrenci'] })
  const admin = await api(school.user('yonetici'))
  await seedTeacherGroup(admin, {
    institutionId: school.institutionId,
    teacherName: school.user('ogretmen').name,
    studentId: 's1',
    groupName: GROUP,
  })
  const quiz = await seedQuiz(school.institutionId, await userIdOf(admin), TASK)
  const assignmentId = await assignTask(admin, {
    resourceVersionId: quiz,
    studentIds: ['s1'],
    settings: { attempts: { kind: 'evaluation', maxAttempts: 1 } },
  })
  await completeAttempt(await api(school.user('ogrenci')), assignmentId)

  // Öğrenci: okumada tek kanıt seviye göstermez; neden ve kanıt görevi görünür.
  await loginAs(school.user('ogrenci'))
  await page.goto('/ogrenci/seviye-takibi')
  await expect(page.getByRole('heading', { name: 'Akademik Gelişim', level: 1 })).toBeVisible()
  const skills = page.getByRole('list', { name: 'Beceri bazında tahmini seviye' })
  await expect(
    skills
      .getByRole('listitem')
      .filter({ hasText: 'Okuma' })
      .getByText('2 kanıt ve 8 madde daha gerekir'),
  ).toBeVisible()
  const evidence = page.getByRole('list', { name: 'Tahmini seviyenin kanıt görevleri' })
  await expect(evidence.getByText('Okuma · hedef A2 · %25 · başarısız')).toBeVisible()
  // Öğrenci ve veli kanıt sayılmayan sonuç listesini görmez.
  await expect(page.getByText(/^Kanıt sayılmayan sonuçlar/)).toHaveCount(0)

  await page.setViewportSize({ width: 360, height: 780 })
  await expectNoHorizontalOverflow(page)

  const link = evidence.getByRole('link', { name: new RegExp(`^${TASK}, .* sonucunu aç$`) })
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/ogrenci/soru-coz\\?coz=${assignmentId}`))

  // Öğretmen: grup özetinin "Seviye profili" sekmesinde aynı kanıt görev listesine bağlanır.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.context().clearCookies()
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/gruplar')
  await page.getByRole('button', { name: `${GROUP} özeti` }).click()
  const panel = page.getByRole('dialog', { name: 'Grup özeti' })
  await panel.getByRole('button', { name: 'Seviye profili' }).click()
  await expect(
    panel
      .getByRole('list', { name: 'Tahmini seviyenin kanıt görevleri' })
      .getByRole('link', { name: new RegExp(`^${TASK}, `) }),
  ).toHaveAttribute('href', `/ogretmen/odevler?sekme=gorevler&gorev=${assignmentId}`)
})
