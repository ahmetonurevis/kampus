import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { assignTask, seedQuiz, userIdOf } from './support/tasks.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Beceri ilerleme panosu (OG-080; IST-057, DOM-BEC-035): veli Akademik Gelişim'de seçili çocuğun
// okuma, dinleme, yazma ve konuşma becerilerini ayrı görür; puanlı nokta görev sonucuna bağlanır.
// Deniz'e (s1) atanan okuma quizini Deniz API'den çözer (ilk soru doğru, ikinci yanlış: 1 / 4 puan).

const TASK = 'Deniz okuma değerlendirmesi'

/** Öğrenci denemeyi başlatır ve iki soruyu `a` ile cevaplayıp teslim eder (%25). */
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

test('OG-080, DOM-BEC-035: veli dört beceriyi ayrı görür ve okuma noktasından görev sonucuna gider', async ({
  page,
  loginAs,
  tenant,
  api,
}) => {
  const school = await tenant({ roles: ['ogrenci', 'veli'] })
  const admin = await api(school.user('yonetici'))
  const student = await api(school.user('ogrenci'))
  const quiz = await seedQuiz(school.institutionId, await userIdOf(admin), TASK)
  const assignmentId = await assignTask(admin, {
    resourceVersionId: quiz,
    studentIds: ['s1'],
    settings: { attempts: { kind: 'evaluation', maxAttempts: 1 } },
  })
  await completeAttempt(student, assignmentId)

  await loginAs(school.user('veli'))
  await page.goto('/veli/seviye-takibi?cocuk=s1')
  const card = page.getByRole('region', { name: 'Beceri gelişimi' })
  for (const skill of ['Okuma', 'Dinleme', 'Yazma', 'Konuşma'])
    await expect(card.getByRole('heading', { name: skill, exact: true })).toBeVisible()
  const reading = card.getByRole('region', { name: 'Okuma', exact: true })
  await expect(reading).toContainText('Son puan %25 · 1 görev')
  await expect(card.getByRole('region', { name: 'Dinleme', exact: true })).toContainText(
    'Henüz puanlanmış dinleme görevi yok.',
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)

  // Satır bağlantısı klavyeyle açılır ve velinin görev panelini getirir.
  const link = reading
    .getByRole('list', { name: 'Okuma görev sonuçları' })
    .getByRole('link', { name: new RegExp(`^${TASK}, .*, %25 sonucunu aç$`) })
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(
    new RegExp(`/veli/akademik-takip\\?cocuk=s1&sekme=gorevler&gorev=${assignmentId}`),
  )
  const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
  await expect(panel.getByRole('heading', { name: TASK })).toBeVisible()
  await expect(panel.getByLabel('Puan 100 üzerinden 25')).toBeVisible()
})
