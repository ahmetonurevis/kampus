import { randomUUID } from 'node:crypto'

import {
  resourceVersionInputSchema,
  type ResourceRecord,
  type ResourceVersion,
  type ResourceVersionInput,
} from '../../../packages/school-core/src/content/resource.ts'
import {
  rubricVersionInputSchema,
  type RubricVersionData,
} from '../../../packages/school-core/src/skills/rubric.ts'

import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { insertResourceWithVersions } from '../../../apps/api/src/db/resources.ts'
import { insertRubricScore, insertSecondRatingRequest } from '../../../apps/api/src/db/skills.ts'
import { rubrics, rubricVersions } from '../../../apps/api/src/db/schema/skills.ts'
import { expect } from '@playwright/test'
import pg from 'pg'

import type { ApiClient } from './api.ts'
import { e2e } from './env.ts'

/**
 * Öğrenci görev ekranları için test verisi (W22a). Yazma ucu içerik havuzunda henüz yoktur
 * (soru, quiz ve ödev şablonu doğrudan depoya yazılır; içerik core şemasıyla doğrulanır); atama,
 * puan ve yeniden teslim isteği API'den yapılır. Her işlem kendi bağlantısını açıp kapatır.
 */

const SECRET_EXPLANATION = 'GIZLI-ACIKLAMA'

export const QUIZ_QUESTIONS = ['Where does Ann live?', 'What is the main idea?'] as const

const tags = (skill: 'reading' | 'writing' | 'speaking', subjectId = 'ingilizce') => ({
  subjectId,
  gradeLevels: [9],
  primarySkill: skill,
  cefrLevel: 'A2' as const,
})

function version(
  resourceId: string,
  authorUserId: string,
  input: Partial<ResourceVersionInput>,
): ResourceVersion {
  const data = resourceVersionInputSchema.parse({
    license: { kind: 'institution_original' },
    tags: { gradeLevels: [9] },
    ...input,
  })
  const at = new Date().toISOString()
  return {
    id: randomUUID(),
    resourceId,
    versionNumber: 1,
    status: 'published',
    authorUserId,
    createdAt: at,
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    publishedAt: at,
    archivedAt: null,
    removedAt: null,
    removalReason: null,
    ...data,
  }
}

async function seed(
  institutionId: string,
  ownerUserId: string,
  input: Partial<ResourceVersionInput>,
): Promise<string> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    const id = randomUUID()
    const published = version(id, ownerUserId, input)
    const resource: Omit<ResourceRecord, 'ownerActive'> = {
      id,
      contentType: published.content.type,
      ownerUserId,
      shareScope: 'private',
      sharedStudentIds: [],
      sharedClassIds: [],
      currentVersionId: published.id,
      derivedFromVersionId: null,
      derivedFromPlatformVersionId: null,
    }
    await insertResourceWithVersions(db, institutionId, resource, [published], new Date())
    return published.id
  } finally {
    await close()
  }
}

/** Oturum açmış kullanıcının kimliği (içerik sahibi). */
export async function userIdOf(client: ApiClient): Promise<string> {
  const me = await client.get('/api/v1/me')
  expect(me.status).toBe(200)
  return (me.body as { data: { user: { id: string } } }).data.user.id
}

const question = (stem: string, correctOptionId: string): Partial<ResourceVersionInput> => ({
  title: `Soru: ${stem}`,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem,
      options: [
        { id: 'a', text: 'In London.' },
        { id: 'b', text: 'In Paris.' },
        { id: 'c', text: 'In Rome.' },
        { id: 'd', text: 'In Berlin.' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId, explanation: SECRET_EXPLANATION },
  tags: tags('reading'),
})

/** İki sorulu (1 + 3 puan) yayındaki quiz; ilk sorunun doğrusu `a`, ikincinin `b`. */
export async function seedQuiz(institutionId: string, ownerUserId: string, title: string) {
  const first = await seed(institutionId, ownerUserId, question(QUIZ_QUESTIONS[0], 'a'))
  const second = await seed(institutionId, ownerUserId, question(QUIZ_QUESTIONS[1], 'b'))
  return seed(institutionId, ownerUserId, {
    title,
    content: {
      type: 'quiz',
      items: [
        { questionVersionId: first, points: 1 },
        { questionVersionId: second, points: 3 },
      ],
    },
    tags: tags('reading'),
  })
}

/**
 * Metin teslimli yazma ödevi şablonu. `subjectId` içeriğin dersidir; zümre başkanı kapsamı onunla
 * eşleşir (DOM-YTK-027; seed müfredatında İngilizce `english`).
 */
export function seedHomework(
  institutionId: string,
  ownerUserId: string,
  title: string,
  subjectId?: string,
) {
  return seed(institutionId, ownerUserId, {
    title,
    content: {
      type: 'homework_template',
      instructions: 'Write about your weekend in a short text.',
      submissionKinds: ['text'],
      criteria: 'Zaman ifadeleri, paragraf düzeni ve yazım.',
      rubricId: null,
    },
    tags: tags('writing', subjectId),
  })
}

/** Sesli (konuşma) teslimli ödev şablonu (IST-051). */
export function seedSpeakingHomework(institutionId: string, ownerUserId: string, title: string) {
  return seed(institutionId, ownerUserId, {
    title,
    content: {
      type: 'homework_template',
      instructions: 'Record a short answer about your favourite place.',
      submissionKinds: ['audio'],
      criteria: 'Akıcılık ve doğruluk.',
      rubricId: null,
    },
    tags: tags('speaking'),
  })
}

const bands = (aspect: string) =>
  [0, 1, 2, 3, 4, 5].map((band) => ({
    band,
    description: `${aspect} bant ${band}`,
    alignment: {
      kind: 'cefr' as const,
      scale: 'Overall written production',
      level: 'B1',
      index: 1,
    },
  }))

/** Analitik yazma rubriği (iki kriter: `task`, `grammar`); yayındaki sürüm kimliğini döndürür. */
export function seedRubric(institutionId: string, ownerUserId: string): Promise<string> {
  return insertRubric(
    institutionId,
    ownerUserId,
    rubricVersionInputSchema.parse({
      title: 'Yazma rubriği',
      kind: 'analytic',
      skill: 'writing',
      criteria: [
        { id: 'task', aspect: 'task_fulfilment', bands: bands('Görev') },
        { id: 'grammar', aspect: 'grammatical_accuracy', bands: bands('Dilbilgisi') },
      ],
    }),
  )
}

/** Analitik konuşma rubriği (iki kriter: `fluency`, `accuracy`); yayındaki sürüm kimliği. */
export function seedSpeakingRubric(institutionId: string, ownerUserId: string): Promise<string> {
  return insertRubric(
    institutionId,
    ownerUserId,
    rubricVersionInputSchema.parse({
      title: 'Konuşma rubriği',
      kind: 'analytic',
      skill: 'speaking',
      criteria: [
        { id: 'fluency', aspect: 'fluency', bands: bands('Akıcılık') },
        { id: 'accuracy', aspect: 'accuracy', bands: bands('Doğruluk') },
      ],
    }),
  )
}

async function insertRubric(
  institutionId: string,
  ownerUserId: string,
  data: RubricVersionData,
): Promise<string> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    const now = new Date()
    const rubricId = randomUUID()
    const rubricVersionId = randomUUID()
    const at = { createdAt: now, updatedAt: now }
    await db.insert(rubrics).values({ institutionId, id: rubricId, ownerUserId, ...at })
    await db.insert(rubricVersions).values({
      institutionId,
      id: rubricVersionId,
      rubricId,
      versionNumber: 1,
      status: 'published',
      ...data,
      publishedAt: now,
      ...at,
    })
    return rubricVersionId
  } finally {
    await close()
  }
}

/**
 * Atamanın son tarihini geçmişe çeker. API geçmiş son tarihle atamayı reddeder (`due_in_past`);
 * süresi dolmuş görev ancak zamanla oluşur, testte bu yolla kurulur.
 */
export async function expireAssignment(assignmentId: string): Promise<void> {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query('update task_assignments set due_at = $1 where id = $2', [
      new Date(Date.now() - 2 * 3_600_000),
      assignmentId,
    ])
    expect(result.rowCount).toBe(1)
  } finally {
    await client.end()
  }
}

/**
 * Örneklemli görevin örneklemini çekilmiş sayar (DOM-BEC-024). API örneklemi yalnız teslim penceresi
 * kapanınca çeker ve o ana kadar ilk puanı 409 `second_rating_sample_pending` ile reddeder;
 * pencere ancak zamanla kapandığından testte bu yolla kurulur.
 */
export async function markSecondRatingSampled(assignmentId: string): Promise<void> {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      'update task_assignments set second_rating_sampled_at = now(), version = version + 1 where id = $1',
      [assignmentId],
    )
    expect(result.rowCount).toBe(1)
  } finally {
    await client.end()
  }
}

/** İkinci puanlama isteği (DOM-BEC-024): ilk puan kesinleşmez, öğrenciye açılmaz. */
export async function requestSecondRating(
  institutionId: string,
  submissionId: string,
  requestedByUserId: string,
) {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    const now = new Date()
    await insertSecondRatingRequest(
      db,
      institutionId,
      { submissionId, source: 'manual', requestedByUserId, requestedAt: now.toISOString() },
      now,
    )
  } finally {
    await close()
  }
}

/**
 * Başka bir öğretmenin kör ikinci puanı (DOM-BEC-024). Tenant'ta tek öğretmen hesabı vardır ve o
 * hesap uyuşmazlığı çözecek koordinatördür (puanlayıcı olamaz); ikinci puanlayıcı testte yalnız
 * kimliktir, puan satırı doğrudan yazılır. Teslim istendiği ve ilk puan verildiği varsayılır.
 */
export async function seedSecondScore(
  institutionId: string,
  input: {
    submissionVersionId: string
    rubricVersionId: string
    bands: Readonly<Record<string, number>>
  },
): Promise<void> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    const now = new Date()
    await insertRubricScore(
      db,
      institutionId,
      {
        id: randomUUID(),
        submissionVersionId: input.submissionVersionId,
        rubricVersionId: input.rubricVersionId,
        raterUserId: `e2e-ikinci-${randomUUID().slice(0, 8)}`,
        raterRole: 'second',
        criteria: Object.entries(input.bands).map(([criterionId, band]) => ({
          criterionId,
          band,
          comment: band < 3 ? 'İkinci puanlayıcının kısa yorumu' : null,
        })),
        overallComment: 'İkinci puanlayıcının genel yorumu',
        scoredAt: now.toISOString(),
      },
      now,
    )
  } finally {
    await close()
  }
}

/** Şimdiden `hours` saat sonrası ISO (UTC). */
export const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()

export interface AssignOptions {
  resourceVersionId: string
  settings?: Record<string, unknown>
  studentIds?: readonly string[]
  dueAt?: string
}

/** Yönetici öğrenci hedefli atama yapar; atama kimliğini döndürür. */
export async function assignTask(admin: ApiClient, options: AssignOptions): Promise<string> {
  const response = await admin.post(
    '/api/v1/task-assignments',
    {
      resourceVersionId: options.resourceVersionId,
      settings: { deadline: { dueAt: options.dueAt ?? inHours(72) }, ...options.settings },
      targets: (options.studentIds ?? ['s1']).map((id) => ({ kind: 'student', id })),
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(response.status, JSON.stringify(response.body)).toBe(201)
  return (response.body as { data: { id: string } }).data.id
}
