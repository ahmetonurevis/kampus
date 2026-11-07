import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient, Principal } from './api.ts'
import { expect } from './fixtures.ts'
import type { Tenant, TenantOptions } from './tenant.ts'

/**
 * Okuma-anlama etkinliğinin e2e kurulumu (OG-051, OG-983; IST-042; DOM-BEC-006, DOM-BEC-045):
 * okuma parçası (sözlükçeli), alt beceri etiketli üç soru ve parçaya bağlı quiz yönetici API'siyle
 * yazılıp yayımlanır, 7-A sınıfına atanır (UI'dan kurulum yok). Öğrencinin çözme adımları da
 * buradadır; öğrenci (`okuma-etkinligi.spec.ts`) ve personel (`personel-deneme.spec.ts`) testleri
 * aynı yardımcıları kullanır.
 */

export type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const PASSAGE_TITLE = "Ann's ferry"
export const BODY =
  'Ann lives in Izmir. Every morning she takes the ferry across the bay to her office. She loves ' +
  'the quiet sea and the gulls. On rainy days the trip is slow, but Ann reads a book and does ' +
  'not mind the delay.'
export const GLOSSARY = [
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
export const SECRET_EXPLANATION = 'GIZLI-COZUM'

export const QUESTIONS = [
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
  outcomes: [{ outcomeId: 'ENG.7.1.1', outcomeSource: 'platform' }],
}

export const idempotent = () => ({ 'idempotency-key': randomUUID() })
const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${version}"` })

export async function expectOk(result: { status: number; body: unknown }, status = 201) {
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
export async function publishReadingQuiz(admin: ApiClient, title: string): Promise<string> {
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
export async function assignToClass(
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

export async function setUp(
  tenantFactory: (options: TenantOptions) => Promise<Tenant>,
  api: (principal: Principal) => Promise<ApiClient>,
  title: string,
  attempts: Json,
  options: Partial<TenantOptions> = {},
) {
  const school = await tenantFactory({
    classes: ['c1'],
    ...options,
    roles: ['ogrenci', ...(options.roles ?? [])],
  })
  const admin = await api(school.user('yonetici'))
  const quiz = await publishReadingQuiz(admin, title)
  const assignmentId = await assignToClass(admin, quiz, attempts)
  return { school, assignmentId, student: await api(school.user('ogrenci')) }
}

export const passageOf = (page: Page) =>
  page.getByRole('region', { name: `Okuma metni: ${PASSAGE_TITLE}` })
export const glossaryOf = (page: Page) => page.getByRole('region', { name: 'Sözlükçe' })
export const breakdownOf = (page: Page) => page.getByRole('table', { name: 'Alt beceri dökümü' })

/** Görev çalışma alanını açar, denemeyi başlatır; parça ve ilk soru görünür. */
export async function startAttempt(page: Page, assignmentId: string) {
  await page.goto(`/ogrenci/soru-coz?coz=${assignmentId}`)
  await page.getByRole('button', { name: 'Denemeyi başlat' }).click()
  await expect(passageOf(page)).toBeVisible()
  await expect(page.getByText(QUESTIONS[0].stem, { exact: true })).toBeVisible()
}

/** Sırayla seçenek işaretler (soru başına bir seçenek); her cevap otomatik kaydedilir. */
export async function answerAll(page: Page, choices: readonly string[]) {
  for (const [index, choice] of choices.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Sonraki' }).click()
    await expect(page.getByText(QUESTIONS[index]!.stem, { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: choice, exact: true }).check()
    await expect(page.getByText('Cevaplarınız kaydedildi.', { exact: true })).toBeVisible()
  }
}

export async function submitAttempt(page: Page) {
  await page.getByRole('button', { name: 'Denemeyi teslim et' }).first().click()
  await page
    .getByRole('dialog', { name: 'Deneme teslim edilsin mi?' })
    .getByRole('button', { name: 'Teslim et' })
    .click()
  await expect(page.getByRole('heading', { name: '1. deneme sonucu' })).toBeVisible()
}
