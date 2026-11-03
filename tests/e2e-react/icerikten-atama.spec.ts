import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { seedQuiz, userIdOf } from './support/tasks.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İçerikten atama (OG-089; IST-034, DOM-BEC-049, DOM-BEC-036): öğretmen içerik havuzunda yayındaki
// quizi iki sınıfa iki ayrı son tarihle tek işlemde atar; aynı hedef iki satırda seçilemez. İçerik
// ayrıntısındaki "Atamalar ve sonuçlar" bölümü sınıf başına sonuç özetini gösterir. Kurulum API'den
// ve depodan (`tenant()`, `seedQuiz`); öğretmen Selin Kaya (t1) 7-A ve 8-A'da İngilizce de verir.

const QUIZ = 'Ann okuma quizi'
const TEACHES_ENGLISH = ['c1', 'c4'].map((classId) => ({
  collection: 'assignments' as const,
  data: { id: `assign-${classId}-ingilizce-t1`, classId, subjectId: 'ingilizce', teacherId: 't1' },
}))

const toasts = (page: Page) => page.locator('[data-sonner-toast]')

/** `gün` gün sonrasının Europe/Istanbul (UTC+3) tarihi, verilen saatte (`datetime-local`). */
function istanbulLocal(days: number, time: string) {
  const day = new Date(Date.now() + days * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10)
  return `${day}T${time}`
}
/** Istanbul duvar saatinin UTC ISO karşılığı (Türkiye 2016'dan beri sabit UTC+3). */
const utcOf = (local: string) =>
  new Date(Date.parse(`${local}:00.000Z`) - 3 * 3_600_000).toISOString()

test('IST-034, DOM-BEC-049, DOM-BEC-036: öğretmen içeriği iki sınıfa ayrı son tarihle atar ve sonuç özetini görür', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({
    roles: ['ogretmen'],
    classes: ['c1', 'c4'],
    records: TEACHES_ENGLISH,
  })
  const teacher = await api(school.user('ogretmen'))
  const versionId = await seedQuiz(school.institutionId, await userIdOf(teacher), QUIZ)
  const first = istanbulLocal(3, '18:00')
  const second = istanbulLocal(5, '09:30')

  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/icerik-havuzu')
  await page.getByRole('button', { name: QUIZ, exact: true }).first().click()
  const panel = page.getByRole('dialog', { name: QUIZ })
  const results = panel.getByRole('region', { name: 'Atamalar ve sonuçlar' })
  await expect(results.getByText('Bu içerik henüz atanmadı.', { exact: false })).toBeVisible()

  await panel.getByRole('button', { name: 'Ata', exact: true }).click()
  const assign = page.getByRole('dialog', { name: 'İçeriği ata' })
  await assign.getByLabel('1. hedef', { exact: true }).selectOption({ label: '7-A' })
  await assign.getByLabel('1. hedef son teslimi').fill(first)
  await assign.getByRole('button', { name: 'Hedef ekle' }).click()
  // Yeni satırın ilk alanı odak alır (klavyeyle sürdürülebilir).
  await expect(assign.getByLabel('2. hedef türü')).toBeFocused()
  // Aynı hedef iki satırda seçilemez (DOM-BEC-049).
  await assign.getByLabel('2. hedef', { exact: true }).selectOption({ label: '7-A' })
  await assign.getByLabel('2. hedef son teslimi').fill(second)
  await assign.getByRole('button', { name: 'Görevi ata' }).click()
  await expect(assign.getByText('Bu hedef zaten seçildi.')).toBeVisible()
  await expect(assign.getByLabel('2. hedef', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  )

  await assign.getByLabel('2. hedef', { exact: true }).selectOption({ label: '8-A' })
  await assign.getByRole('button', { name: 'Görevi ata' }).click()
  await expect(assign).toBeHidden()
  await expect(toasts(page).filter({ hasText: '2 görev atandı.' })).toBeVisible()

  // Her sınıf kendi son tarihiyle ayrı atama oldu; ikisi de aynı içerik sürümüne sabitlendi.
  const resourceId = new URL(page.url()).searchParams.get('icerik') ?? ''
  const listed = await teacher.get(`/api/v1/task-assignments?resourceId=${resourceId}`)
  expect(listed.status).toBe(200)
  const assignments = (
    listed.body as {
      data: {
        resourceVersionId: string
        deadline: { dueAt: string | null }
        targets: { kind: string; id: string }[]
      }[]
    }
  ).data
  expect(
    assignments
      .map((item) => ({
        due: item.deadline.dueAt,
        targets: item.targets,
        version: item.resourceVersionId,
      }))
      .sort((a, b) => String(a.due).localeCompare(String(b.due))),
  ).toEqual([
    { due: utcOf(first), targets: [{ kind: 'class', id: 'c1' }], version: versionId },
    { due: utcOf(second), targets: [{ kind: 'class', id: 'c4' }], version: versionId },
  ])

  // İçerik ayrıntısında sınıf başına özet: henüz deneme yok, ortalama boş.
  await expect(results.getByText(/^2 atama · 20 kursiyer · 0 tamamlayan/)).toBeVisible()
  const table = results.getByRole('table', { name: 'İçeriğin atama sonuçları' })
  for (const name of ['7-A', '8-A']) {
    const row = table.locator('tbody tr').filter({ hasText: name })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('0/10')
  }

  // Dar ekranda temel bilgiler kartta, ayrıntılar açılır bölümde; yatay taşma yok.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(results.getByText('7-A', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
