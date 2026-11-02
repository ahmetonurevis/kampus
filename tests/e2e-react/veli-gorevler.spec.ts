import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { assignTask, QUIZ_QUESTIONS, seedQuiz, userIdOf } from './support/tasks.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Velinin beceri görevleri (OG-992; IST-051, DOM-YTK-028, DOM-BEC-045): veli `/veli/akademik-takip`
// "Beceri görevleri" sekmesinde seçili çocuğun görevlerini ve tamamlanan denemenin sunucunun açtığı
// sonucunu görür; çözme, başlatma ve teslim düğmesi yoktur. Deniz'e (s1) atanan okuma quizini Deniz
// API'den çözer (ilk soru doğru, ikinci yanlış: 1 / 4 puan); Ece'ye (s2) ayrı bir görev atanır.
// İçerik doğrudan veritabanına (`support/tasks.ts`), atama ve deneme API'den yazılır.

const DENIZ_TASK = 'Deniz okuma görevi'
const ECE_TASK = 'Ece dinleme görevi'

/** Öğrenci denemeyi başlatır ve iki soruyu (ilk `a` doğru, ikinci `a` yanlış) cevaplayıp teslim eder. */
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

test('OG-992, DOM-BEC-045: veli çocuğunun tamamlanan okuma denemesinin puanını görür; çözme düğmesi yok, çocuk değişince liste değişir', async ({
  page,
  loginAs,
  tenant,
  api,
}) => {
  const school = await tenant({ roles: ['ogrenci', 'veli'] })
  const admin = await api(school.user('yonetici'))
  const student = await api(school.user('ogrenci'))
  const ownerId = await userIdOf(admin)
  const denizQuiz = await seedQuiz(school.institutionId, ownerId, DENIZ_TASK)
  const eceQuiz = await seedQuiz(school.institutionId, ownerId, ECE_TASK)
  const denizId = await assignTask(admin, {
    resourceVersionId: denizQuiz,
    studentIds: ['s1'],
    settings: { attempts: { kind: 'evaluation', maxAttempts: 1 } },
  })
  await assignTask(admin, { resourceVersionId: eceQuiz, studentIds: ['s2'] })
  await completeAttempt(student, denizId)

  await loginAs(school.user('veli'))
  await page.goto('/veli/akademik-takip?cocuk=s1&sekme=gorevler')
  await expect(page.getByRole('button', { name: 'Beceri görevleri' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const table = page.getByRole('table', { name: 'Beceri görevleri' })
  const row = table.locator('tbody tr').filter({ hasText: DENIZ_TASK })
  await expect(row).toContainText('Tamamlandı')
  await expect(row).toContainText('25 / 100')
  await expect(row).toContainText('1 / 1 deneme')
  await expect(table.getByText(ECE_TASK)).toHaveCount(0)

  // Sağ panel adreste (`?gorev=`); sonuç velinin diliyle, anahtar açılmadığı için doğru cevap yok.
  await page.getByRole('button', { name: `${DENIZ_TASK} ayrıntısını aç` }).click()
  await expect(page).toHaveURL(new RegExp(`[?&]gorev=${denizId}`))
  const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
  await expect(panel.getByRole('heading', { name: DENIZ_TASK })).toBeVisible()
  await expect(panel.getByLabel('Puan 100 üzerinden 25')).toBeVisible()
  await expect(panel.getByText('1 / 4 puan', { exact: true })).toBeVisible()
  await expect(panel.getByText('Doğru cevap:', { exact: true })).toHaveCount(0)
  await expect(panel).not.toContainText(QUIZ_QUESTIONS[0])
  // Salt okur: başlatma, devam, çözme ya da teslim düğmesi çizilmez.
  await expect(
    page.getByRole('button', { name: /başla|devam et|çöz|teslim et|itiraz|yeni deneme/i }),
  ).toHaveCount(0)

  // Yenileme paneli korur.
  await page.reload()
  await expect(panel.getByLabel('Puan 100 üzerinden 25')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // Çocuk değişince liste o çocuğa daralır.
  await page.getByRole('combobox', { name: 'Çocuk seç' }).selectOption({ label: 'Ece Yılmaz' })
  await expect(page).toHaveURL(/[?&]cocuk=s2/)
  const eceRow = table.locator('tbody tr').filter({ hasText: ECE_TASK })
  await expect(eceRow).toContainText('Başlanmadı')
  await expect(table.getByText(DENIZ_TASK)).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)
})

test('OG-992: görevi olmayan çocukta boş durum görünür', async ({ page, loginAs, tenant }) => {
  const school = await tenant({ roles: ['veli'] })
  await loginAs(school.user('veli'))
  await page.goto('/veli/akademik-takip?cocuk=s2&sekme=gorevler')
  await expect(page.getByRole('heading', { name: 'Bu çocuğa atanmış görev yok.' })).toBeVisible()
})
