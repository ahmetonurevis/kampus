import { randomUUID } from 'node:crypto'

import { wordCount } from '../../packages/school-core/src/content/resource.ts'

import type { Page } from '@playwright/test'

import type { ApiClient, Principal } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Okuma-anlama etkinliği (OG-051; IST-042; DOM-BEC-006, DOM-BEC-045, DOM-KYN-002, DOM-KYN-024):
// okuma parçasına bağlı quiz. Parça (sözlükçeli), alt beceri etiketli üç soru ve parçaya bağlı
// quiz yönetici API'siyle yazılıp yayımlanır, 7-A sınıfına atanır (UI'dan kurulum yok). Öğrenci
// metni, kelime sayısını, seviyeyi, kaynak gösterimini ve sözlükçeyi görür, soru başında alt
// beceriyi okur, cevaplar ve teslim eder. Alt beceri dökümü madde sonuçlarıyla aynı anda açılır:
// alıştırmada teslimde görünür, değerlendirmede kapanışa kadar hiç çizilmez.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const PASSAGE_TITLE = "Ann's ferry"
const BODY =
  'Ann lives in Izmir. Every morning she takes the ferry across the bay to her office. She loves ' +
  'the quiet sea and the gulls. On rainy days the trip is slow, but Ann reads a book and does ' +
  'not mind the delay.'
const GLOSSARY = [
  {
    term: 'ferry',
    meaning: 'Yolcu ve araç taşıyan gemi; vapur.',
    example: 'We took the ferry to the island.',
  },
  { term: 'gull', meaning: 'Martı.' },
] as const
const ATTRIBUTION = {
  work: "Ann's ferry",
  author: 'Kampüs yazarları',
  source: 'Kurum okuma arşivi',
  year: 2026,
}
const SECRET_EXPLANATION = 'GIZLI-COZUM'

const QUESTIONS = [
  {
    stem: 'What is the text mainly about?',
    options: ["Ann's trip to work.", 'A storm at sea.', "Ann's new book.", 'Gulls in Izmir.'],
    correct: 'a',
    subskill: 'main_idea',
    points: 1,
  },
  {
    stem: 'How does Ann go to work?',
    options: ['By bus.', 'By ferry.', 'By car.', 'On foot.'],
    correct: 'b',
    subskill: 'detail',
    points: 1,
  },
  {
    stem: 'How does Ann probably feel about the trip?',
    options: ['She hates it.', 'She is afraid.', 'She enjoys it.', 'She is bored.'],
    correct: 'c',
    subskill: 'inference',
    points: 2,
  },
] as const

const TAGS = {
  subjectId: 'english',
  gradeLevels: [7],
  primarySkill: 'reading',
  cefrLevel: 'A2',
  outcomes: [{ outcomeId: 'OKU.7.1', outcomeSource: 'institution' }],
}

const idempotent = () => ({ 'idempotency-key': randomUUID() })
const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${version}"` })

async function expectOk(result: { status: number; body: unknown }, status = 201) {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Json }).data
}

/**
 * Yönetici kaynağı yazar ve onaysız yayımlar: kurum özgün, kendi kapsamlı içerik onaya girmez
 * (DOM-KYN-031). Yayındaki sürüm kimliğini döner.
 */
async function publish(admin: ApiClient, body: Json): Promise<string> {
  const created = await expectOk(await admin.post('/api/v1/resources', body, idempotent()))
  const draft = created.version as Json
  const published = await expectOk(
    await admin.post(
      `/api/v1/resources/${created.resource.id}/versions/${draft.id}/publish`,
      {},
      versioned(draft.rowVersion),
    ),
    200,
  )
  return (published.version as Json).id as string
}

/** Sözlükçeli parça, alt beceri etiketli üç soru ve parçaya bağlı quiz; quiz sürümü döner. */
async function publishReadingQuiz(admin: ApiClient, title: string): Promise<string> {
  const license = { kind: 'institution_original' }
  const passageVersionId = await publish(admin, {
    title: PASSAGE_TITLE,
    content: { type: 'reading_passage', body: BODY, glossary: GLOSSARY },
    license,
    attributions: [ATTRIBUTION],
    tags: TAGS,
  })
  const items: { questionVersionId: string; points: number }[] = []
  for (const question of QUESTIONS) {
    const questionVersionId = await publish(admin, {
      title: `Soru: ${question.stem}`,
      content: {
        type: 'question',
        question: {
          questionType: 'multiple_choice',
          stem: question.stem,
          options: question.options.map((text, index) => ({ id: 'abcd'[index], text })),
        },
      },
      answerKey: {
        questionType: 'multiple_choice',
        correctOptionId: question.correct,
        explanation: SECRET_EXPLANATION,
      },
      license,
      tags: { ...TAGS, subskill: question.subskill },
    })
    items.push({ questionVersionId, points: question.points })
  }
  return publish(admin, {
    title,
    content: { type: 'quiz', items, passageVersionId },
    license,
    tags: TAGS,
  })
}

/** 7-A sınıfına (Deniz Yılmaz, `s1`) atama; atama kimliği döner. */
async function assignToClass(
  admin: ApiClient,
  resourceVersionId: string,
  attempts: Json,
): Promise<string> {
  const assignment = await expectOk(
    await admin.post(
      '/api/v1/task-assignments',
      {
        resourceVersionId,
        targets: [{ kind: 'class', id: 'c1' }],
        settings: {
          attempts,
          deadline: { dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
        },
      },
      idempotent(),
    ),
  )
  return assignment.id as string
}

async function setUp(
  tenantFactory: (options: TenantOptions) => Promise<Tenant>,
  api: (principal: Principal) => Promise<ApiClient>,
  title: string,
  attempts: Json,
) {
  const school = await tenantFactory({ roles: ['ogrenci'], classes: ['c1'] })
  const admin = await api(school.user('yonetici'))
  const quiz = await publishReadingQuiz(admin, title)
  const assignmentId = await assignToClass(admin, quiz, attempts)
  return { school, assignmentId, student: await api(school.user('ogrenci')) }
}

const passageOf = (page: Page) =>
  page.getByRole('region', { name: `Okuma metni: ${PASSAGE_TITLE}` })
const glossaryOf = (page: Page) => page.getByRole('region', { name: 'Sözlükçe' })
const breakdownOf = (page: Page) => page.getByRole('table', { name: 'Alt beceri dökümü' })

/** Görev çalışma alanını açar, denemeyi başlatır; parça ve ilk soru görünür. */
async function startAttempt(page: Page, assignmentId: string) {
  await page.goto(`/ogrenci/soru-coz?coz=${assignmentId}`)
  await page.getByRole('button', { name: 'Denemeyi başlat' }).click()
  await expect(passageOf(page)).toBeVisible()
  await expect(page.getByText(QUESTIONS[0].stem, { exact: true })).toBeVisible()
}

/** Sırayla seçenek işaretler (soru başına bir seçenek); her cevap otomatik kaydedilir. */
async function answerAll(page: Page, choices: readonly string[]) {
  for (const [index, choice] of choices.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Sonraki' }).click()
    await expect(page.getByText(QUESTIONS[index]!.stem, { exact: true })).toBeVisible()
    await page.getByLabel(choice, { exact: true }).check()
    await expect(page.getByText('Cevaplarınız kaydedildi.', { exact: true })).toBeVisible()
  }
}

async function submitAttempt(page: Page) {
  await page.getByRole('button', { name: 'Denemeyi teslim et' }).first().click()
  await page
    .getByRole('dialog', { name: 'Deneme teslim edilsin mi?' })
    .getByRole('button', { name: 'Teslim et' })
    .click()
  await expect(page.getByRole('heading', { name: '1. deneme sonucu' })).toBeVisible()
}

test.describe('okuma-anlama etkinliği', () => {
  test('IST-042, DOM-BEC-006: alıştırmada öğrenci metni, kelime sayısını ve sözlükçeyi görür; teslimde alt beceri dökümü açılır', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId } = await setUp(tenant, api, 'Feribot okuma alıştırması', {
      kind: 'practice',
    })
    await loginAs(school.user('ogrenci'))
    await startAttempt(page, assignmentId)

    // Parça: başlık, seviye, sistemin saydığı kelime sayısı (DOM-KYN-002), kaynak gösterimi.
    const passage = passageOf(page)
    await expect(passage.getByRole('heading', { name: PASSAGE_TITLE })).toBeVisible()
    await expect(passage.getByText('A2', { exact: true })).toBeVisible()
    await expect(passage.getByText(`${wordCount(BODY)} kelime`, { exact: true })).toBeVisible()
    await expect(passage.getByText(/Every morning she takes the ferry/)).toBeVisible()
    await expect(passage.getByRole('region', { name: 'Kaynak gösterimi' })).toContainText(
      'Kampüs yazarları',
    )
    // Sözlükçe terim + anlam + örnek; metin bölgesi klavyeyle odaklanır (kaydırılabilir).
    const glossary = glossaryOf(page)
    await expect(glossary.getByRole('term')).toHaveCount(GLOSSARY.length)
    await expect(glossary.getByText('ferry', { exact: true })).toBeVisible()
    await expect(glossary.getByText(GLOSSARY[0].meaning, { exact: true })).toBeVisible()
    await expect(glossary.getByText(GLOSSARY[0].example, { exact: true })).toBeVisible()
    await expect(glossary.getByText(GLOSSARY[1].meaning, { exact: true })).toBeVisible()
    await passage.focus()
    await expect(passage).toBeFocused()

    // Geniş ekranda metin ve sorular yan yana.
    const question = page.getByText(QUESTIONS[0].stem, { exact: true })
    const [textBox, questionBox] = await Promise.all([
      passage.boundingBox(),
      question.boundingBox(),
    ])
    expect(textBox && questionBox && questionBox.x >= textBox.x + textBox.width).toBe(true)

    // Soru başında alt beceri etiketi; çözümde doğru cevap ve açıklama yok.
    await expect(page.getByText('Ana fikir', { exact: true })).toBeVisible()
    await answerAll(page, ["Ann's trip to work.", 'By bus.', 'She enjoys it.'])
    await expect(page.getByRole('main')).not.toContainText(SECRET_EXPLANATION)
    await submitAttempt(page)

    // 3 / 4 puan; döküm yalnız etiketli alt becerilerle ve gerçek madde puanlarıyla.
    await expect(page.getByLabel('Puan 100 üzerinden 75')).toBeVisible()
    const breakdown = breakdownOf(page)
    await expect(breakdown.locator('tbody tr')).toHaveCount(3)
    const row = (label: string) => breakdown.locator('tbody tr').filter({ hasText: label })
    await expect(row('Ana fikir')).toContainText('1 / 1')
    await expect(row('Ana fikir')).toContainText('%100')
    await expect(row('Ayrıntı')).toContainText('0 / 1')
    await expect(row('Ayrıntı')).toContainText('%0')
    await expect(row('Çıkarım')).toContainText('2 / 2')
    await expect(row('Kelime bilgisi')).toHaveCount(0)
  })

  test('DOM-BEC-045, DOM-BEC-006: değerlendirmede döküm kapanışa kadar çizilmez; dar ekranda metin soruların üstünde, taşma yok', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId, student } = await setUp(
      tenant,
      api,
      'Feribot okuma değerlendirmesi',
      { kind: 'evaluation', maxAttempts: 1 },
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(school.user('ogrenci'))
    await startAttempt(page, assignmentId)

    const passage = passageOf(page)
    const question = page.getByText(QUESTIONS[0].stem, { exact: true })
    const [textBox, questionBox] = await Promise.all([
      passage.boundingBox(),
      question.boundingBox(),
    ])
    expect(textBox && questionBox && questionBox.y >= textBox.y + textBox.height).toBe(true)
    await expect(glossaryOf(page).getByText('gull', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await answerAll(page, ["Ann's trip to work.", 'By ferry.', 'She is bored.'])
    await submitAttempt(page)
    await expect(page.getByLabel('Puan 100 üzerinden 50')).toBeVisible()
    await expect(breakdownOf(page)).toHaveCount(0)
    await expect(page.getByText('Alt beceri', { exact: false })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    // Sunucu da dökümü açmaz (istemciye güvenilmez).
    const attempts = await expectOk(
      await student.get(`/api/v1/task-attempts?assignmentId=${assignmentId}&page=1&pageSize=20`),
      200,
    )
    const attemptId = (attempts as unknown as { id: string }[])[0]?.id
    const detail = await expectOk(await student.get(`/api/v1/task-attempts/${attemptId}`), 200)
    expect(detail.result.subskills).toBeNull()
    expect(detail.result.items).toBeNull()
  })
})
