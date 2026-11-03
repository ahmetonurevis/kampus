import { randomUUID } from 'node:crypto'

import type { Locator } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { inHours, seedHomework, seedRubric, userIdOf } from './support/tasks.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yazma görevinin taslak döngüsü (OG-082; IST-047, DOM-BEC-040, 044, 046): öğrenci yazar, taslak
// kendiliğinden kaydolur, kaydedilen taslak teslim edilir; öğretmen yeniden teslim ister, öğrenci
// ikinci sürümü gönderir, öğretmen iki sürümü yan yana görür. İçerik ve rubrik doğrudan veritabanına,
// atama ve puan yönetici API'siyle yazılır; sınanan ekranlar öğrencinin ve öğretmenin akışıdır.

/** Seed'de 7-A'nın İngilizcesini başka öğretmen verir; t1 de verir ki atamayı sınıfından görsün. */
const TEACHES_ENGLISH = [
  {
    collection: 'assignments' as const,
    data: { id: 'assign-c1-english-t1', classId: 'c1', subjectId: 'english', teacherId: 't1' },
  },
]

const TITLE = 'Taslak döngüsü yazısı'
const ESSAY =
  'Last weekend I visited my grandmother in the village. We cooked soup together and walked to the river.'
const SECOND_ESSAY =
  'On Sunday I wrote the text again. I fixed my verbs, and I added a new closing sentence about the river and the old bridge.'

const idempotent = () => ({ 'idempotency-key': randomUUID() })

const box = async (locator: Locator) => {
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value as NonNullable<typeof value>
}

test('IST-047, DOM-BEC-040: kaydedilen taslak teslim edilir; yeniden teslimden sonra öğretmen iki sürümü yan yana görür', async ({
  page,
  loginAs,
  tenant,
  api,
}) => {
  const school = await tenant({
    roles: ['yonetici', 'ogretmen', 'ogrenci'],
    classes: ['c1'],
    records: TEACHES_ENGLISH,
  })
  const admin = await api(school.user('yonetici'))
  const ownerId = await userIdOf(admin)
  const homework = await seedHomework(school.institutionId, ownerId, TITLE, 'english')
  const rubric = await seedRubric(school.institutionId, ownerId)
  const assigned = await admin.post(
    '/api/v1/task-assignments',
    {
      resourceVersionId: homework,
      targets: [{ kind: 'class', id: 'c1' }],
      settings: {
        deadline: { dueAt: inHours(72) },
        submission: { submissionKind: 'text', maxVersions: 3, minWords: 5, maxWords: 80 },
        rubricVersionId: rubric,
      },
    },
    idempotent(),
  )
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(201)
  const assignmentId = (assigned.body as { data: { id: string } }).data.id

  // 1. Öğrenci yazar: sayaç canlı ve sınırla; taslak kaydolur; teslim kaydedilen taslaktan gider.
  await loginAs(school.user('ogrenci'))
  await page.goto(`/ogrenci/odevler?yaz=${assignmentId}`)
  const editor = page.getByLabel('Metniniz')
  await editor.fill('Too short.')
  await expect(page.getByText('2 sözcük · beklenen: 5–80 sözcük')).toBeVisible()
  await expect(page.getByText('Sözcük sayınız beklenen aralığın dışında.')).toBeVisible()
  await editor.fill(ESSAY)
  await expect(page.getByText('18 sözcük · beklenen: 5–80 sözcük')).toBeVisible()
  await expect(page.getByText('Sözcük sayınız beklenen aralığın dışında.')).toHaveCount(0)
  await expect(page.getByText(/Taslak kaydedildi/)).toBeVisible()

  const draftSubmit = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/draft/submit'),
  )
  await page.getByRole('button', { name: 'Teslim et' }).click()
  expect((await draftSubmit).headers()['if-match']).toMatch(/^"\d+"$/)
  const versions = page.getByRole('list', { name: 'Gönderilen sürümler' })
  await expect(versions.getByRole('heading', { name: '1. sürüm' })).toBeVisible()
  // Odak yeniden kurulan editörde kaybolmaz, sürüm listesine geçer.
  await expect(page.getByRole('heading', { name: 'Gönderdikleriniz' })).toBeFocused()

  // 2. Yönetici puanlar; öğretmen tek sürümde karşılaştırma görmez ve yeniden teslim ister.
  const list = await admin.get(`/api/v1/task-submissions?assignmentId=${assignmentId}`)
  const submissionId = (list.body as { data: { id: string }[] }).data[0]?.id as string
  const detail = await admin.get(`/api/v1/task-submissions/${submissionId}`)
  const scored = await admin.post(
    `/api/v1/task-submissions/${submissionId}/scores`,
    {
      versionNumber: 1,
      criteria: [
        { criterionId: 'task', band: 3, comment: null },
        { criterionId: 'grammar', band: 3, comment: null },
      ],
      overallComment: 'Fiilleri düzeltip yeniden gönderin.',
    },
    {
      ...idempotent(),
      'if-match': `"${(detail.body as { data: { rowVersion: number } }).data.rowVersion}"`,
    },
  )
  expect(scored.status, JSON.stringify(scored.body)).toBe(201)

  await loginAs(school.user('ogretmen'))
  await page.goto(`/ogretmen/odevler?sekme=puanlama&puanla=${submissionId}`)
  const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
  await expect(dialog.getByRole('group', { name: 'Verilen puan' })).toContainText('Kesinleşti')
  await expect(dialog.getByRole('heading', { name: 'Sürümleri karşılaştır' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Yeniden teslim iste' }).click()
  await expect(dialog.getByText('Sürüm 1 için yeniden teslim istendi.')).toBeVisible()
  await expect(dialog.getByRole('article', { name: 'Sürüm 1', exact: true })).toContainText(
    /Yeniden teslim istendi: .+ · Son tarih: /,
  )

  // 3. Öğrenci ikinci sürümü gönderir: editör son sürümle açılır, aynı metin yeni sürüm sayılmaz.
  await loginAs(school.user('ogrenci'))
  await page.goto(`/ogrenci/odevler?yaz=${assignmentId}`)
  await expect(page.getByText('Öğretmeniniz yeniden teslim istedi')).toBeVisible()
  await expect(page.getByLabel('Metniniz')).toHaveValue(ESSAY)
  await page.getByRole('button', { name: 'Teslim et' }).click()
  await expect(page.getByText('Bu metin son teslim ettiğinizle aynı.')).toBeVisible()
  await expect(page.getByLabel('Metniniz')).toBeFocused()
  await page.getByLabel('Metniniz').fill(SECOND_ESSAY)
  await expect(page.getByText('25 sözcük · beklenen: 5–80 sözcük')).toBeVisible()
  await page.getByRole('button', { name: 'Teslim et' }).click()
  await expect(versions.getByRole('heading', { name: '2. sürüm' })).toBeVisible()

  // 4. Öğretmen son iki sürümü yan yana görür; dar ekranda sütunlar alt alta dizilir.
  await loginAs(school.user('ogretmen'))
  await page.goto(`/ogretmen/odevler?sekme=puanlama&puanla=${submissionId}`)
  const compare = dialog.getByRole('region', { name: 'Sürümleri karşılaştır' })
  const left = compare.getByRole('article', { name: 'Karşılaştırılan sürüm 1' })
  const right = compare.getByRole('article', { name: 'Karşılaştırılan sürüm 2' })
  await expect(left).toContainText(ESSAY)
  await expect(right).toContainText(SECOND_ESSAY)
  await expect(left).toContainText('Yeniden teslim son tarihi')
  await expect(compare).toContainText('Sürüm 1 → Sürüm 2: +7 sözcük')
  await expect(compare.getByLabel('Sol sütun')).toHaveValue('1')
  await expect(compare.getByLabel('Sağ sütun')).toHaveValue('2')
  const [wideLeft, wideRight] = [await box(left), await box(right)]
  expect(Math.abs(wideLeft.y - wideRight.y)).toBeLessThan(2)
  expect(wideRight.x).toBeGreaterThan(wideLeft.x)

  // Aynı sürüm seçilince sütunlar yer değiştirir.
  await compare.getByLabel('Sol sütun').selectOption('2')
  await expect(compare.getByLabel('Sağ sütun')).toHaveValue('1')
  await expect(compare).toContainText('Sürüm 2 → Sürüm 1: −7 sözcük')

  await page.setViewportSize({ width: 390, height: 900 })
  const [narrowFirst, narrowSecond] = [
    await box(compare.getByRole('article').first()),
    await box(compare.getByRole('article').last()),
  ]
  expect(narrowSecond.y).toBeGreaterThan(narrowFirst.y + narrowFirst.height - 1)
  await expectNoHorizontalOverflow(page)
})
