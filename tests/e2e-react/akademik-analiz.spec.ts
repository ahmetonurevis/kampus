import type { Page } from '@playwright/test'

import { createSeed } from '../../packages/school-core/src/data/seed.ts'
import {
  exampleOpticalFile,
  runAssessment,
} from '../../packages/school-core/src/lib/assessment-automation.ts'
import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Sınav Analizi, Akademik Gelişim ve Öğretmen Görüşleri (veli ve öğrenci). Okuma ekranlarıdır:
// paylaşılan seed oturumları salt okunur kullanılır. Optik analiz API'de yazılamadığından çekirdek
// kuralıyla üretilip testin kendi kurumuna konur (`tenant` `records`); kapsamı sunucu uygular.

const EXAM_7 = '7. Sınıf Hazırlık Denemesi 1'
const EXAM_5 = '5. Sınıf Gelişim Denemesi'
const NO_ANALYSIS = /Bu deneme için optik soru analizi yok/
const EVALUATIONS = '/api/v1/collections/opticalEvaluations?pageSize=100'

interface EvaluationRow {
  record: {
    studentId: string
    questionResults: { number: number; answer: string }[]
  }
}

const examsTable = (page: Page) =>
  page.getByRole('table', { name: 'Deneme sonuçları', exact: true })
const openAnalysis = (page: Page, title: string) =>
  page
    .getByRole('button', { name: `${title} soru analizini aç` })
    .first()
    .click()

/** Seed profilinin örnek dosyasını değerlendirir; analiz ve bağlı deneme sonuçları döner. */
function evaluatedRecords(now: Date, studentIds: readonly string[]) {
  const state = createSeed(now)
  const profile = state.opticalProfiles[0]
  if (!profile) throw new Error('Seed optik profili yok.')
  let counter = 0
  runAssessment(
    state,
    { role: 'yonetici' },
    'evaluate',
    { profileId: profile.id, text: exampleOpticalFile(state, profile) },
    (prefix) => `${prefix}-e2e-${++counter}`,
    '',
    now.toISOString(),
  )
  const mine = (item: { studentId: string }) => studentIds.includes(item.studentId)
  return [
    ...state.opticalEvaluations
      .filter(mine)
      .map((data) => ({ collection: 'opticalEvaluations' as const, data })),
    ...state.mockResults.filter(mine).map((data) => ({ collection: 'mockResults' as const, data })),
  ]
}

/** Deniz'in sınıf düzeyinde (7) ondan başka bir öğrenci: kapsam dışı analiz kaynağı. */
function classmateOf(now: Date): string {
  const state = createSeed(now)
  const grade = (id: string) =>
    state.classes.find((item) => item.id === state.students.find((s) => s.id === id)?.classId)
      ?.grade
  const other = state.students.find((item) => item.id !== 's1' && grade(item.id) === grade('s1'))
  if (!other) throw new Error('Seed sınıf arkadaşı yok.')
  return other.id
}

async function evaluationsOf(client: ApiClient): Promise<EvaluationRow[]> {
  const result = await client.get(EVALUATIONS)
  expect(result.status).toBe(200)
  return (result.body as { data: EvaluationRow[] }).data
}

test.describe('veli: Sınav Analizi', () => {
  test('Deniz ile Ece arasında geçince analiz değişir ve ?cocuk= adreste kalır', async ({
    page,
    loginAs,
  }) => {
    await loginAs('veli')
    await page.goto('/veli/sinav-analizi')
    await expect(page.getByRole('heading', { name: 'Sınav Analizi', level: 1 })).toBeVisible()
    await expect(page).toHaveURL(/[?&]cocuk=s1/)
    const summary = page.getByLabel('Başarı özeti', { exact: true })
    await expect(summary).toContainText('Genel başarı')
    await expect(examsTable(page)).toContainText(EXAM_7)
    await expect(examsTable(page)).not.toContainText(EXAM_5)
    await expect(page.getByRole('heading', { name: 'Ders bazlı başarı' })).toBeVisible()
    const dennizOverall = await summary.textContent()

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(examsTable(page)).toContainText(EXAM_5)
    await expect(examsTable(page)).not.toContainText(EXAM_7)
    await expect(summary).not.toHaveText(dennizOverall ?? '')

    // Dersi seçince konu analizi gelir ve ders adreste durur; çocuk değişimi çocuğu korur.
    const subject = page.getByLabel('Analiz dersi')
    await subject.selectOption({ index: 1 })
    await expect(page).toHaveURL(/[?&]ders=/)
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(page.getByRole('heading', { name: /· Konu analizi/ })).toBeVisible()
  })

  test('optik analizi olmayan deneme soru analizi yerine boş durum gösterir', async ({
    page,
    loginAs,
  }) => {
    await loginAs('veli')
    await page.goto('/veli/sinav-analizi?cocuk=s1')
    await expect(examsTable(page)).toContainText(EXAM_7)
    await expect(page.getByText('Analiz yok').first()).toBeVisible()
    await openAnalysis(page, EXAM_7)
    await expect(page).toHaveURL(/[?&]sinav=exam-7-1/)
    const region = page.getByRole('region', { name: `Soru analizi · ${EXAM_7}` })
    await expect(region.getByText(NO_ANALYSIS)).toBeVisible()
    await region.getByRole('button', { name: 'Analizi kapat' }).click()
    await expect(page).not.toHaveURL(/sinav=/)
    await expect(region).toHaveCount(0)
  })

  test('veli çocuğunun soru analizini doğru cevaplarıyla görür; diğer çocuk ve sınıf arkadaşı yok', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const now = new Date()
    const mate = classmateOf(now)
    const school = await tenant({
      roles: ['veli'],
      students: ['s1', 's2', mate],
      collections: ['mockExams', 'opticalProfiles'],
      records: evaluatedRecords(now, ['s1', mate]),
    })
    await loginAs(school.user('veli'))
    const client = await api(school.user('veli'))
    const own = (await evaluationsOf(client)).filter((row) => row.record.studentId === 's1')
    // Sunucu yalnız bağlı çocukların analizini verir.
    expect((await evaluationsOf(client)).every((row) => row.record.studentId !== mate)).toBe(true)
    expect(own.length).toBeGreaterThan(0)

    await page.goto('/veli/sinav-analizi?cocuk=s1')
    await expect(page.getByText('Analiz var').first()).toBeVisible()
    await openAnalysis(page, EXAM_7)
    const region = page.getByRole('region', { name: `Soru analizi · ${EXAM_7}` })
    await expect(region.getByRole('article')).toHaveCount(own.length)
    const questions = region.getByRole('table', { name: 'Soru bazında sonuçlar' })
    await expect(questions.getByRole('columnheader', { name: 'Doğru cevap' })).toBeVisible()
    const first = own[0]?.record.questionResults[0]
    expect(first).toBeDefined()
    await expect(questions.locator('tbody tr').first()).toContainText(first?.answer ?? '')

    // Ece'nin (5. sınıf) kapsamında bu deneme ve analizi yok.
    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(examsTable(page)).not.toContainText(EXAM_7)
    await expect(page.getByRole('region', { name: /Soru analizi/ })).toHaveCount(0)
  })
})

test.describe('öğrenci: Sınav Analizi ve Akademik Gelişim', () => {
  test('öğrenci yalnız kendi verisini görür; başka öğrenci kimliği adreste etkisizdir', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogrenci')
    // Adresteki `cocuk` yalnız velinin seçimidir; öğrencinin kapsamı değişmez.
    await page.goto('/ogrenci/sinav-analizi?cocuk=s2&sinav=exam-5-1')
    await expect(page.getByRole('heading', { name: 'Sınav Analizi', level: 1 })).toBeVisible()
    await expect(examsTable(page)).toContainText(EXAM_7)
    await expect(examsTable(page)).not.toContainText(EXAM_5)
    await expect(page.getByRole('region', { name: /Soru analizi/ })).toHaveCount(0)

    await page.goto('/ogrenci/seviye-takibi?cocuk=s2')
    await expect(page.getByRole('heading', { name: /Deniz Yılmaz, her gün/ })).toBeVisible()
    await expect(page.getByText('Ece')).toHaveCount(0)
  })

  test('öğrenci kendi analizinde doğru cevapları görür; sınıf arkadaşının analizi gelmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const now = new Date()
    const mate = classmateOf(now)
    const school = await tenant({
      roles: ['ogrenci'],
      students: ['s1', mate],
      collections: ['mockExams', 'opticalProfiles'],
      records: evaluatedRecords(now, ['s1', mate]),
    })
    await loginAs(school.user('ogrenci'))
    const client = await api(school.user('ogrenci'))
    const rows = await evaluationsOf(client)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.record.studentId === 's1')).toBe(true)

    await page.goto('/ogrenci/sinav-analizi')
    await openAnalysis(page, EXAM_7)
    const region = page.getByRole('region', { name: `Soru analizi · ${EXAM_7}` })
    await expect(region.getByRole('article')).toHaveCount(rows.length)
    const questions = region.getByRole('table', { name: 'Soru bazında sonuçlar' })
    await expect(questions.getByRole('columnheader', { name: 'Doğru cevap' })).toBeVisible()
    const answer = rows[0]?.record.questionResults[0]?.answer ?? ''
    await expect(questions.locator('tbody tr').first()).toContainText(answer)
    // Dar ekranda da taşma olmaz (analiz açıkken).
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(region).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('Akademik Gelişim: ders öncelikleri ve geçmiş kayıtlardan gelir', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogrenci')
    await page.goto('/ogrenci/seviye-takibi')
    await expect(page.getByRole('heading', { name: 'Akademik Gelişim', level: 1 })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Deniz Yılmaz, her gün biraz daha ileri.' }),
    ).toBeVisible()
    await expect(page.getByRole('meter', { name: 'Dönem hedeflerine ilerleme' })).toBeVisible()
    const priorities = page.getByRole('list', { name: 'Çalışma öncelikleri' })
    await expect(priorities.getByRole('listitem').first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'Ders başarıları' })).toBeVisible()
  })
})

test.describe('veli: Akademik Gelişim ve Öğretmen Görüşleri', () => {
  test('Akademik Gelişim çocuk değişince değişir', async ({ page, loginAs }) => {
    await loginAs('veli')
    await page.goto('/veli/seviye-takibi')
    await expect(page).toHaveURL(/[?&]cocuk=s1/)
    await expect(page.getByRole('heading', { name: /Deniz Yılmaz, her gün/ })).toBeVisible()
    const meter = page.getByRole('meter', { name: 'Dönem hedeflerine ilerleme' })
    const deniz = await meter.getAttribute('aria-valuenow')
    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(page.getByRole('heading', { name: /Ece Yılmaz, her gün/ })).toBeVisible()
    await expect(page.getByText('5-A', { exact: false }).first()).toBeVisible()
    expect(await meter.getAttribute('aria-valuenow')).not.toBe(deniz)
  })

  test('Öğretmen Görüşleri ödev geri bildirimi ve paylaşılan rehberlik notunu gösterir, iç notu göstermez', async ({
    page,
    loginAs,
  }) => {
    await loginAs('veli')
    await page.goto('/veli/ogretmen-degerlendirmeleri?cocuk=s1')
    await expect(page.getByRole('heading', { name: 'Öğretmen Görüşleri', level: 1 })).toBeVisible()
    const homework = page.getByRole('list', { name: 'Ödev geri bildirimleri' })
    await expect(homework).toContainText('Denklemin iki tarafına aynı işlemi doğru uygulamışsın')
    const guidance = page.getByRole('list', { name: 'Rehberlik görüşleri' })
    await expect(guidance).toContainText('Matematik çalışma alışkanlığı')
    await expect(guidance).toContainText('Kısa ve düzenli tekrarlar üzerinde birlikte çalışacağız.')
    // Rehberlik iç notu veliye hiç gelmez (DOM-YTK-020).
    await expect(
      page.getByText('İlk görüşmede çalışma ortamı ve zaman yönetimi konuşuldu.'),
    ).toHaveCount(0)

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(guidance).toContainText('Kulüp etkinliklerine katılımı destekliyoruz.')
    await expect(guidance).not.toContainText('Matematik çalışma alışkanlığı')
    await expect(page.getByText('Danışman görüşmesi planlandı.')).toHaveCount(0)
    await expect(page.getByText('Denklemin iki tarafına')).toHaveCount(0)
  })

  test('sunucu yanıtında rehberlik iç notu alanı yoktur', async ({ api }) => {
    const client = await api('veli')
    const result = await client.get('/api/v1/collections/guidanceCases?pageSize=100')
    expect(result.status).toBe(200)
    const rows = (result.body as { data: { record: Record<string, unknown> }[] }).data
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.record).not.toHaveProperty('internalNote')
  })
})

test.describe('analiz ekranları: 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('veli sayfalarında yatay taşma yok', async ({ page, loginAs }) => {
    await loginAs('veli')
    await page.goto('/veli/sinav-analizi')
    await expect(page.getByRole('heading', { name: 'Ders bazlı başarı' })).toBeVisible()
    await expect(page.getByRole('article').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/veli/seviye-takibi')
    await expect(page.getByRole('list', { name: 'Çalışma öncelikleri' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/veli/ogretmen-degerlendirmeleri')
    await expect(page.getByRole('list', { name: 'Rehberlik görüşleri' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('öğrenci sayfalarında yatay taşma yok', async ({ page, loginAs }) => {
    await loginAs('ogrenci')
    await page.goto('/ogrenci/sinav-analizi')
    await expect(page.getByRole('heading', { name: 'Ders bazlı başarı' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto('/ogrenci/seviye-takibi')
    await expect(page.getByRole('list', { name: 'Çalışma öncelikleri' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
