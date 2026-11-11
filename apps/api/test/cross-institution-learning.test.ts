import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { resources, resourceVersions } from '../src/db/schema/resources.ts'
import {
  rubricScores,
  rubrics,
  rubricVersions,
  scoreAppeals,
  secondRatingRequests,
  submissionDrafts,
  submissionVersions,
  taskAssignments,
  taskAttempts,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import {
  crossInject,
  nextIp,
  runCrossCase,
  tableRows,
  type CrossCase,
  type Ids,
} from './support/cross-institution.ts'
import { seedResource } from './support/resources-sample.ts'
import { sampleRubricData } from './support/skills-sample.ts'

/**
 * Öğrenme uçlarında çapraz kurum (IST-002; DOM-YTK-001, DOM-YTK-011, DOM-YTK-028): içerik
 * havuzu sürüm geçişleri, görev denemeleri, teslimler, ikinci ve son puan, ikinci puanlama
 * isteği, itiraz ve karar. İki kurumda aynı öğrenci (`s-1`), sınıf (`9-A`) ve öğretmen (`t-eng`)
 * kimlikleri bulunur: A'nın öğrencisi B'nin `9-A` atamasına ulaşamaz. İstek, A'da o işi yapmaya
 * yetkili rolle yapılır (öğrenci yazmaları öğrenciyle, karar öğretmenle); yönetici rolüyle 403
 * yalnız rol reddi olurdu, kurum sınırını sınamazdı.
 */

const DUE = '2026-10-20T20:59:00.000Z'
const SKILL_TAGS = { subjectId: 'ingilizce', gradeLevels: [9], cefrLevel: 'A2' as const }

const homework = (): Partial<ResourceVersionInput> => ({
  title: 'Hafta sonu yazısı',
  content: {
    type: 'homework_template',
    instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
    submissionKinds: ['text'],
    criteria: 'Zaman ifadeleri ve paragraf düzeni.',
    rubricId: null,
  },
  license: { kind: 'institution_original' },
  tags: { ...SKILL_TAGS, primarySkill: 'writing' },
})

const question = (): Partial<ResourceVersionInput> => ({
  title: 'Soru: What does Tom do on Sundays?',
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: 'What does Tom do on Sundays?',
      options: [
        { id: 'a', text: 'He swims.' },
        { id: 'b', text: 'He reads.' },
        { id: 'c', text: 'He cooks.' },
        { id: 'd', text: 'He sleeps.' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'b', explanation: 'Okuma.' },
  license: { kind: 'institution_original' },
  tags: { ...SKILL_TAGS, primarySkill: 'listening' },
})

const scoreBody = () => ({
  versionNumber: 1,
  criteria: [
    { criterionId: 'task', band: 4, comment: null },
    { criterionId: 'grammar', band: 2, comment: 'Zaman uyumuna dikkat.' },
  ],
  overallComment: 'Paragraf düzeni iyi.',
})

const disagreeing = () => ({
  ...scoreBody(),
  criteria: [
    { criterionId: 'task', band: 1, comment: 'Görev eksik kaldı.' },
    { criterionId: 'grammar', band: 2, comment: 'Zaman hataları var.' },
  ],
})

let db: Database
let app: App

/** Kurum: `t-eng` 9-A'nın İngilizce öğretmeni, Deniz (`s-1`) 9-A'da; yayında ödev ve soru. */
async function tenant() {
  const institution = await createInstitution(app)
  await insertMissingRecords(
    db,
    institution.id,
    [
      {
        collection: 'teachers',
        id: 't-eng',
        data: { id: 't-eng', name: 'Selin Kaya', subjectId: 'ingilizce', branchId: 'b-1' },
      },
      {
        collection: 'teachers',
        id: 't-head',
        data: { id: 't-head', name: 'Zeynep Ak', subjectId: 'ingilizce', branchId: 'b-1' },
      },
      {
        collection: 'classes',
        id: '9-A',
        data: { id: '9-A', grade: 9, level: '9', branchId: 'b-1', teacherId: 't-eng' },
      },
      {
        collection: 'students',
        id: 's-1',
        data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
      },
      {
        collection: 'assignments',
        id: 'as-1',
        data: { id: 'as-1', classId: '9-A', teacherId: 't-eng', subjectId: 'ingilizce' },
      },
    ],
    FIXED_NOW,
  )
  const member = (role: 'ogretmen' | 'ogrenci', kind: string, recordId: string) =>
    createMember(app, institution.id, role, [{ kind, recordId } as never])
  const teacher = await member('ogretmen', 'teacher', 't-eng')
  const head = await member('ogretmen', 'teacher', 't-head')
  const cookies = {
    admin: await signInAs(app, institution.admin),
    teacher: await signInAs(app, teacher),
    // Aynı sınıfın ikinci öğretmeni: ilk puanlayıcıdan bağımsız puanlayıcı.
    colleague: await signInAs(app, await member('ogretmen', 'teacher', 't-eng')),
    student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
    // İngilizce zümre başkanı: uyuşmazlıkta son puanı verir (DOM-YTK-027).
    head: await signInAs(app, head),
  }
  const published = async (input: Partial<ResourceVersionInput>) =>
    (
      await seedResource(db, institution.id, {
        ownerUserId: teacher.id,
        versions: [{ status: 'published', input }],
      })
    ).versions[0]!.id
  const homeworkId = await published(homework())
  const questionId = await published(question())
  const rubricId = randomUUID()
  const rubricVersionId = randomUUID()
  const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
  await db
    .insert(rubrics)
    .values({ institutionId: institution.id, id: rubricId, ownerUserId: teacher.id, ...at })
  await db.insert(rubricVersions).values({
    institutionId: institution.id,
    id: rubricVersionId,
    rubricId,
    versionNumber: 1,
    status: 'published',
    ...sampleRubricData(),
    publishedAt: FIXED_NOW,
    ...at,
  })
  const t = { id: institution.id, teacher, cookies, homeworkId, questionId, rubricVersionId }
  await made(cookies.admin, '/api/v1/coordinator-duties', {
    membershipId: head.membershipId,
    scopeId: 'ingilizce',
  })
  return t
}
type Tenant = Awaited<ReturnType<typeof tenant>>

/** Kurulum isteği: başarılı olmalı; yanıt verisini döner. */
async function made(cookie: string, url: string, body: Record<string, unknown>, ifMatch?: number) {
  const response = await crossInject(app, nextIp(), cookie, {
    method: 'POST',
    url,
    body,
    ...(ifMatch === undefined ? {} : { ifMatch }),
  })
  assert.ok(response.statusCode < 300, response.body)
  return response.json<{ data: { id: string } }>().data
}

/** Yönetici 9-A'ya atar: ödev rubrikli yazma, soru otomatik puanlı. */
async function assignment(t: Tenant, kind: 'homework' | 'question') {
  const settings =
    kind === 'homework'
      ? {
          deadline: { dueAt: DUE },
          submission: { submissionKind: 'text', maxVersions: 1 },
          rubricVersionId: t.rubricVersionId,
        }
      : { deadline: { dueAt: DUE } }
  const data = await made(t.cookies.admin, '/api/v1/task-assignments', {
    resourceVersionId: kind === 'homework' ? t.homeworkId : t.questionId,
    settings,
    targets: [{ kind: 'class', id: '9-A' }],
  })
  return data.id
}

const homeworkAssignment = async (t: Tenant): Promise<Ids> => ({
  assignmentId: await assignment(t, 'homework'),
})
/** Yazma görevi ve öğrencinin kaydedilmiş taslağı (revizyon 1; IST-047 taslaktan teslim). */
async function draftedAssignment(t: Tenant): Promise<Ids> {
  const assignmentId = await assignment(t, 'homework')
  const response = await crossInject(app, nextIp(), t.cookies.student, {
    method: 'PATCH',
    url: `/api/v1/task-assignments/${assignmentId}/draft`,
    body: { body: 'Taslak metin.' },
  })
  assert.equal(response.statusCode, 200, response.body)
  return { assignmentId }
}
const questionAssignment = async (t: Tenant): Promise<Ids> => ({
  assignmentId: await assignment(t, 'question'),
})

async function submission(t: Tenant): Promise<Ids> {
  const assignmentId = await assignment(t, 'homework')
  const data = await made(
    t.cookies.student,
    `/api/v1/task-assignments/${assignmentId}/submissions`,
    {
      submissionKind: 'text',
      body: 'My weekend was busy.',
    },
  )
  return { assignmentId, submissionId: data.id }
}

async function attempt(t: Tenant): Promise<Ids> {
  const assignmentId = await assignment(t, 'question')
  const data = await made(
    t.cookies.student,
    `/api/v1/task-assignments/${assignmentId}/attempts`,
    {},
  )
  return { attemptId: data.id }
}

/**
 * Uyuşmazlıklı teslim: ikinci puanlama istenir, iki puan birden fazla bant ayrılır; son puanı
 * zümre başkanı verir (satır sürümü 4).
 */
async function disputed(t: Tenant): Promise<Ids> {
  const ids = await submission(t)
  const url = `/api/v1/task-submissions/${ids.submissionId}`
  await made(t.cookies.admin, `${url}/second-rating-requests`, { versionNumber: 1 }, 1)
  await made(t.cookies.teacher, `${url}/scores`, scoreBody(), 2)
  await made(t.cookies.colleague, `${url}/second-scores`, disagreeing(), 3)
  return ids
}

/** Teslimin ilk sürümüne itiraz satırı (karar ucunun hedefi; itirazın kuralı burada sınanmaz). */
async function appeal(t: Tenant): Promise<Ids> {
  const { submissionId } = await submission(t)
  const [version] = await db
    .select({ id: submissionVersions.id })
    .from(submissionVersions)
    .where(
      and(
        eq(submissionVersions.institutionId, t.id),
        eq(submissionVersions.submissionId, submissionId!),
      ),
    )
  assert.ok(version)
  const appealId = randomUUID()
  await db.insert(scoreAppeals).values({
    institutionId: t.id,
    id: appealId,
    submissionVersionId: version.id,
    learnerId: 's-1',
    filedByUserId: t.teacher.id,
    reason: 'Paragraf düzeni yanlış değerlendirildi.',
    filedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  })
  return { submissionId: submissionId!, appealId }
}

/** Öğretmenin kurum kapsamında paylaşılmış, verilen durumdaki kaynak sürümü. */
const resourceIn =
  (status: 'draft' | 'in_review' | 'rejected' | 'published') =>
  async (t: Tenant): Promise<Ids> => {
    const { resource, versions } = await seedResource(db, t.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'institution',
      versions: [{ status, input: { tags: { subjectId: 'ingilizce', gradeLevels: [9] } } }],
    })
    return { resourceId: resource.id, versionId: versions[0]!.id }
  }

const LEARNING = [
  resources,
  resourceVersions,
  taskAssignments,
  taskAttempts,
  taskSubmissions,
  submissionVersions,
  submissionDrafts,
  rubricScores,
  secondRatingRequests,
  scoreAppeals,
]

/** Sürüm geçişi; anahtar uç yolunu tam yazar (envanter metinsel denetimi). */
const transition = (
  key: string,
  status: Parameters<typeof resourceIn>[0],
  actor: keyof Tenant['cookies'],
  body: Record<string, unknown> = {},
): CrossCase<Tenant> => ({
  key,
  kind: 'kayıt',
  actor: (a) => a.cookies[actor],
  make: resourceIn(status),
  request: ({ resourceId, versionId }) => ({
    method: 'POST',
    url: `/api/v1/resources/${resourceId}/versions/${versionId}/${key.slice(key.lastIndexOf('/') + 1)}`,
    body,
  }),
})

const CASES: readonly CrossCase<Tenant>[] = [
  // --- İçerik havuzu --------------------------------------------------------------------------
  {
    // Quiz maddesi B'nin soru sürümüyse olmayan soruyla aynı 422 `quiz_item_missing` (DOM-KYN-001).
    key: 'POST /api/v1/resources',
    kind: 'gövde',
    actor: (a) => a.cookies.teacher,
    make: async (t) => ({ questionVersionId: t.questionId }),
    request: ({ questionVersionId }) => ({
      method: 'POST',
      url: '/api/v1/resources',
      body: {
        title: 'Dinleme quizi',
        content: { type: 'quiz', items: [{ questionVersionId, points: 1 }] },
        license: { kind: 'institution_original' },
        tags: { ...SKILL_TAGS },
      },
    }),
  },
  transition('POST /api/v1/resources/:resourceId/versions/:versionId/publish', 'draft', 'teacher'),
  transition(
    'POST /api/v1/resources/:resourceId/versions/:versionId/withdraw',
    'in_review',
    'teacher',
  ),
  transition(
    'POST /api/v1/resources/:resourceId/versions/:versionId/approve',
    'in_review',
    'admin',
  ),
  transition(
    'POST /api/v1/resources/:resourceId/versions/:versionId/reject',
    'in_review',
    'admin',
    { reason: 'Kazanım eşleşmiyor.' },
  ),
  transition(
    'POST /api/v1/resources/:resourceId/versions/:versionId/reopen',
    'rejected',
    'teacher',
  ),
  transition(
    'POST /api/v1/resources/:resourceId/versions/:versionId/archive',
    'published',
    'teacher',
  ),

  // --- Görev denemesi -------------------------------------------------------------------------
  {
    key: 'POST /api/v1/task-assignments/:assignmentId/attempts',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: questionAssignment,
    request: ({ assignmentId }) => ({
      method: 'POST',
      url: `/api/v1/task-assignments/${assignmentId}/attempts`,
      body: {},
    }),
  },
  {
    key: 'PATCH /api/v1/task-attempts/:attemptId',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: attempt,
    request: ({ attemptId }) => ({
      method: 'PATCH',
      url: `/api/v1/task-attempts/${attemptId}`,
      body: { answers: {} },
      ifMatch: 1,
    }),
  },
  {
    key: 'POST /api/v1/task-attempts/:attemptId/submit',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: attempt,
    request: ({ attemptId }) => ({
      method: 'POST',
      url: `/api/v1/task-attempts/${attemptId}/submit`,
      body: {},
      ifMatch: 1,
    }),
  },

  // --- Teslim ---------------------------------------------------------------------------------
  {
    key: 'GET /api/v1/task-submissions',
    kind: 'kayıt',
    actor: (a) => a.cookies.teacher,
    make: submission,
    request: ({ assignmentId }) => ({
      method: 'GET',
      url: `/api/v1/task-submissions?assignmentId=${assignmentId}`,
    }),
  },
  {
    key: 'GET /api/v1/task-submissions/:submissionId',
    kind: 'kayıt',
    actor: (a) => a.cookies.teacher,
    make: submission,
    request: ({ submissionId }) => ({
      method: 'GET',
      url: `/api/v1/task-submissions/${submissionId}`,
    }),
  },
  {
    key: 'GET /api/v1/task-assignments/:assignmentId/draft',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: homeworkAssignment,
    request: ({ assignmentId }) => ({
      method: 'GET',
      url: `/api/v1/task-assignments/${assignmentId}/draft`,
    }),
  },
  {
    key: 'PATCH /api/v1/task-assignments/:assignmentId/draft',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: homeworkAssignment,
    request: ({ assignmentId }) => ({
      method: 'PATCH',
      url: `/api/v1/task-assignments/${assignmentId}/draft`,
      body: { body: 'Taslak metin.' },
    }),
  },
  {
    key: 'POST /api/v1/task-assignments/:assignmentId/draft/submit',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: draftedAssignment,
    request: ({ assignmentId }) => ({
      method: 'POST',
      url: `/api/v1/task-assignments/${assignmentId}/draft/submit`,
      body: {},
      ifMatch: 1,
    }),
  },
  {
    key: 'POST /api/v1/task-assignments/:assignmentId/submissions',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: homeworkAssignment,
    request: ({ assignmentId }) => ({
      method: 'POST',
      url: `/api/v1/task-assignments/${assignmentId}/submissions`,
      body: { submissionKind: 'text', body: 'My weekend was busy.' },
    }),
  },

  // --- Puanlama ve itiraz ---------------------------------------------------------------------
  {
    key: 'POST /api/v1/task-submissions/:submissionId/second-scores',
    kind: 'kayıt',
    actor: (a) => a.cookies.colleague,
    make: submission,
    request: ({ submissionId }) => ({
      method: 'POST',
      url: `/api/v1/task-submissions/${submissionId}/second-scores`,
      body: scoreBody(),
      ifMatch: 1,
    }),
  },
  {
    key: 'POST /api/v1/task-submissions/:submissionId/final-scores',
    kind: 'kayıt',
    actor: (a) => a.cookies.head,
    make: disputed,
    request: ({ submissionId }) => ({
      method: 'POST',
      url: `/api/v1/task-submissions/${submissionId}/final-scores`,
      body: scoreBody(),
      ifMatch: 4,
    }),
  },
  {
    key: 'POST /api/v1/task-submissions/:submissionId/second-rating-requests',
    kind: 'kayıt',
    actor: (a) => a.cookies.admin,
    make: submission,
    request: ({ submissionId }) => ({
      method: 'POST',
      url: `/api/v1/task-submissions/${submissionId}/second-rating-requests`,
      body: { versionNumber: 1 },
      ifMatch: 1,
    }),
  },
  {
    key: 'POST /api/v1/task-submissions/:submissionId/appeals',
    kind: 'kayıt',
    actor: (a) => a.cookies.student,
    make: submission,
    request: ({ submissionId }) => ({
      method: 'POST',
      url: `/api/v1/task-submissions/${submissionId}/appeals`,
      body: { versionNumber: 1, reason: 'Paragraf düzeni yanlış değerlendirildi.' },
    }),
  },
  {
    // Karar öğretmenindir: yönetici rolü 403'tür, kurum sınırı A'nın öğretmeniyle sınanır.
    key: 'POST /api/v1/task-submissions/:submissionId/appeals/:appealId/decision',
    kind: 'kayıt',
    actor: (a) => a.cookies.colleague,
    make: appeal,
    request: ({ submissionId, appealId }) => ({
      method: 'POST',
      url: `/api/v1/task-submissions/${submissionId}/appeals/${appealId}/decision`,
      body: { outcome: 'rejected', reason: 'Puan yeniden okundu, değişmedi.' },
      ifMatch: 1,
    }),
  },
]

describe('IST-002: öğrenme uçlarında başka kurum (DOM-YTK-001, DOM-YTK-011, DOM-YTK-028)', () => {
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const context = {
    get app() {
      return app
    },
    tenant,
    snapshot: (institutionId: string) => tableRows(db, institutionId, LEARNING),
  }

  for (const spec of CASES) {
    const title =
      spec.kind === 'kayıt'
        ? 'başka kurumun kaydı olmayan kayıtla aynı 404; iki kurum değişmez'
        : 'gövdedeki başka kurum kimliği ve institutionId etkisiz; iki kurum değişmez'
    test(`IST-002: ${spec.key}: ${title}`, { todo: spec.todo ?? false }, () =>
      runCrossCase(context, spec),
    )
  }

  test('IST-002: başka kurumun itirazı kendi teslimin yolunda da 404 (karar ucu, kurum sınırı)', async () => {
    const a = await tenant()
    const b = await tenant()
    const own = await submission(a)
    const foreign = await appeal(b)
    const before = await tableRows(db, b.id, LEARNING)
    const response = await crossInject(app, nextIp(), a.cookies.colleague, {
      method: 'POST',
      url: `/api/v1/task-submissions/${own.submissionId}/appeals/${foreign.appealId}/decision`,
      body: { outcome: 'rejected', reason: 'Puan yeniden okundu, değişmedi.' },
      ifMatch: 1,
    })
    assert.equal(response.statusCode, 404, response.body)
    assert.deepEqual(await tableRows(db, b.id, LEARNING), before)
  })
})
