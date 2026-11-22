import { randomInt, randomUUID } from 'node:crypto'

import {
  isTeacherFeedbackRespondent,
  planTeacherFeedbackArchive,
  planTeacherFeedbackClose,
  planTeacherFeedbackCreate,
  planTeacherFeedbackPublish,
  planTeacherFeedbackResponse,
  planTeacherFeedbackUpdate,
  TEACHER_FEEDBACK_OTHER_GROUP,
  TEACHER_FEEDBACK_TREND_MAX,
  teacherFeedbackCreateSchema,
  teacherFeedbackPhase,
  teacherFeedbackResponseSchema,
  teacherFeedbackResults,
  teacherFeedbackTeacherResult,
  teacherFeedbackTeachersFor,
  teacherFeedbackTrend,
  teacherFeedbackUpdateSchema,
  type TeacherFeedbackGroup,
  type TeacherFeedbackRespondentRole,
  type TeacherFeedbackStoredResponse,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  archiveTeacherFeedbackSurvey,
  closedSurveysOfTeacher,
  closeTeacherFeedbackSurvey,
  findTeacherFeedbackSurvey,
  insertTeacherFeedbackParticipation,
  insertTeacherFeedbackResponse,
  insertTeacherFeedbackSurvey,
  listOpenTeacherFeedbackSurveys,
  listTeacherFeedbackSurveys,
  loadTeacherFeedbackResponses,
  publishTeacherFeedbackSurvey,
  respondedTeachers,
  teacherFeedbackCounts,
  updateTeacherFeedbackDraft,
  type StoredTeacherFeedbackSurvey,
  type TeacherFeedbackListQuery,
} from '../db/finance-teacher-feedback.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Öğretmen geri bildirim anketi (DOM-FIN-159; ON-213; K-532…K-534). Kural core
 * `lib/finance-teacher-feedback.ts`'tedir; servis kurum kilidi altında anketi yükler, tek
 * transaction'da yazar ve denetime alan adlarını yazar. Yanıtlayanın değerlendirebileceği
 * öğretmenler okuma kapsamının kaynağından (öğrencinin sınıfı, sınıf öğretmeni, ders atamaları)
 * core'da hesaplanır; velinin çocukları velayet süzgecinden geçmiş bağlantılardır. Katılım
 * işareti ve yanıt ayrı tablolardadır; yanıt satırı kişi, rol ve yanıt anı taşımaz; yanıt
 * komutu denetime yalnız katılımı yazar. Sonucun ve eğilimin her okunuşu aynı transaction'da
 * denetime düşer. Rol ve modül denetimi rotadadır; bugün Europe/Istanbul günüdür.
 */

const SURVEY_ENTITY = 'teacher_feedback_surveys'
const RESULT_ACTION = 'finance.teacher_feedback_result.read'

const today = (ctx: ServiceContext) => dayKey(ctx.now)

/** Açık uçlu cevapları karıştırmak için [0, 1) (K-532). */
const random = () => randomInt(0, 2 ** 32) / 2 ** 32

const textOf = (data: Record<string, unknown>, key: string) => {
  const value = data[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Öğretmen ve sınıf adları (`records`); bulunmayan kimlik `—`. */
async function namesOf(
  db: Database,
  ctx: ServiceContext,
  collection: 'teachers' | 'classes',
  ids: readonly string[],
): Promise<Map<string, string>> {
  const rows = await loadRecordsByIds(db, ctx.institutionId, collection, [...new Set(ids)], {
    includeArchived: true,
  })
  return new Map(rows.map((row) => [row.id, textOf(row.data, 'name') ?? row.id]))
}

type Counts = Map<string, { responses: number; respondents: number }>

function surveyRow(survey: StoredTeacherFeedbackSurvey, counts: Counts, day: string) {
  const { questions, ...rest } = survey
  const count = counts.get(survey.id)
  return {
    ...rest,
    questionCount: questions.length,
    phase: teacherFeedbackPhase(survey, day),
    participation:
      survey.status === 'published'
        ? { responses: count?.responses ?? 0, respondents: count?.respondents ?? 0 }
        : null,
  }
}

async function loadSurvey(db: Database, ctx: ServiceContext, id: string) {
  const survey = await findTeacherFeedbackSurvey(db, ctx.institutionId, id)
  if (survey === null) throw new NotFoundError()
  return survey
}

/** Kurumda bulunmayan (arşivlenmemiş) sınıf kimlikleri. */
async function unknownClassIds(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  if (ids.length === 0) return []
  const known = new Set(
    (await loadRecordsByIds(db, ctx.institutionId, 'classes', ids)).map((row) => row.id),
  )
  return ids.filter((id) => !known.has(id))
}

export async function listTeacherFeedbackSurveysFor(
  ctx: ServiceContext,
  query: TeacherFeedbackListQuery,
) {
  const day = today(ctx)
  const { items, total } = await listTeacherFeedbackSurveys(ctx.db, ctx.institutionId, {
    ...query,
    today: day,
  })
  const counts = await teacherFeedbackCounts(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  return { items: items.map((item) => surveyRow(item, counts, day)), total }
}

/** Ayrıntı: sorular ve hedef kitle sınıflarının adları. Başka kurum 404. */
export async function getTeacherFeedbackSurveyFor(ctx: ServiceContext, id: string) {
  const survey = await loadSurvey(ctx.db, ctx, id)
  const [counts, names] = await Promise.all([
    teacherFeedbackCounts(ctx.db, ctx.institutionId, [id]),
    namesOf(ctx.db, ctx, 'classes', survey.audience.classIds),
  ])
  return {
    ...surveyRow(survey, counts, today(ctx)),
    questions: survey.questions,
    audienceClasses: survey.audience.classIds.map((classId) => ({
      id: classId,
      name: names.get(classId) ?? '—',
    })),
  }
}

async function surveyBody(tx: Database, ctx: ServiceContext, id: string) {
  const counts = await teacherFeedbackCounts(tx, ctx.institutionId, [id])
  const saved = await findTeacherFeedbackSurvey(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('teacher feedback survey was not written')
  return { ...surveyRow(saved, counts, today(ctx)), questions: saved.questions }
}

const DRAFT_FIELDS = [
  'title',
  'term',
  'openDate',
  'closeDate',
  'anonymityThreshold',
  'audience',
  'questions',
]

/** Taslak açar; eşik verilmezse 5 (K-532). `Idempotency-Key` zorunlu. 201. */
export function createTeacherFeedbackCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: SURVEY_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.teacher_feedback.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = teacherFeedbackCreateSchema.parse(input)
        const unknown = await unknownClassIds(tx, ctx, parsed.audience.classIds)
        return { run: () => planTeacherFeedbackCreate(parsed, { unknownClassIds: unknown }) }
      },
      after: async (tx, draft) => {
        await insertTeacherFeedbackSurvey(tx, ctx.institutionId, {
          ...draft,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.teacher_feedback.create', entity, DRAFT_FIELDS)
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

export function updateTeacherFeedbackCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SURVEY_ENTITY, id }
  let body: unknown
  let changed: string[] = []
  return runCommand(
    ctx,
    {
      action: 'finance.teacher_feedback.update',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, id)
        const parsed = teacherFeedbackUpdateSchema.parse(input)
        if (survey.version !== expectedVersion) throw new ConflictError()
        changed = Object.entries(parsed).flatMap(([key, value]) =>
          value === undefined ? [] : [key],
        )
        const unknown = await unknownClassIds(tx, ctx, parsed.audience?.classIds ?? [])
        return {
          run: () => planTeacherFeedbackUpdate(survey, parsed, { unknownClassIds: unknown }),
        }
      },
      after: async (tx, draft) => {
        const saved = await updateTeacherFeedbackDraft(tx, ctx.institutionId, {
          ...draft,
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.teacher_feedback.update', entity, changed)
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yayım: sorular, tarihler, hedef kitle ve eşik bundan sonra değişmez (tetikleyici). */
export function publishTeacherFeedbackCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SURVEY_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.teacher_feedback.publish',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, id)
        if (survey.version !== expectedVersion) throw new ConflictError()
        // Taslak açıldıktan sonra arşivlenen sınıf yayımı durdurur.
        const unknown = await unknownClassIds(tx, ctx, survey.audience.classIds)
        return {
          run: () =>
            planTeacherFeedbackPublish(survey, { today: today(ctx), unknownClassIds: unknown }),
        }
      },
      after: async (tx) => {
        const saved = await publishTeacherFeedbackSurvey(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.teacher_feedback.publish', entity, [
          'status',
          'publishedAt',
        ])
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

export function archiveTeacherFeedbackCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SURVEY_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.teacher_feedback.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, id)
        if (survey.version !== expectedVersion) throw new ConflictError()
        return { run: () => planTeacherFeedbackArchive(survey) }
      },
      after: async (tx) => {
        const saved = await archiveTeacherFeedbackSurvey(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.teacher_feedback.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

/** Erken kapatma: yanıt alınmaz, sonuç açılır; geri alınmaz. */
export function closeTeacherFeedbackCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SURVEY_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.teacher_feedback.close',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, id)
        if (survey.version !== expectedVersion) throw new ConflictError()
        return { run: () => planTeacherFeedbackClose(survey, today(ctx)) }
      },
      after: async (tx) => {
        const saved = await closeTeacherFeedbackSurvey(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.teacher_feedback.close', entity, ['closedAt'])
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Sonuç ve eğilim -----------------------------------------------------------------------------

async function readAudit(
  tx: Database,
  ctx: ServiceContext,
  entity: { type: string; id: string },
  changes: Record<string, unknown>,
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: RESULT_ACTION,
    entityType: entity.type,
    entityId: entity.id,
    // kvkk: değer değil, dönen toplu alanların adı ve öğretmen kaydı anahtarı.
    changes,
    createdAt: ctx.now,
  })
}

const groupsWithNames = (groups: readonly TeacherFeedbackGroup[], names: Map<string, string>) =>
  groups.map((group) => ({
    ...group,
    name:
      group.key === TEACHER_FEEDBACK_OTHER_GROUP ? 'Diğer sınıflar' : (names.get(group.key) ?? '—'),
  }))

const isClosed = (survey: StoredTeacherFeedbackSurvey, day: string) =>
  survey.status === 'published' && teacherFeedbackPhase(survey, day) === 'closed'

/**
 * Anketin öğretmen başına sonucu (yönetici, K-532): kapanmadan ve eşik altında gizli; sınıf
 * kırılımı eşik ve birleştirmeyle. Okuma aynı transaction'da denetime yazılır. Başka kurum 404.
 */
export async function getTeacherFeedbackResultsFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const survey = await loadSurvey(tx, ctx, id)
    const day = today(ctx)
    const [counts, responses] = await Promise.all([
      teacherFeedbackCounts(tx, ctx.institutionId, [id]),
      survey.status === 'published'
        ? loadTeacherFeedbackResponses(tx, ctx.institutionId, [id])
        : Promise.resolve([]),
    ])
    const results = teacherFeedbackResults({
      questions: survey.questions,
      threshold: survey.anonymityThreshold,
      closed: isClosed(survey, day),
      responses,
      random,
    })
    const [teacherNames, classNames] = await Promise.all([
      namesOf(
        tx,
        ctx,
        'teachers',
        results.map((result) => result.teacherId),
      ),
      namesOf(
        tx,
        ctx,
        'classes',
        results.flatMap((result) => result.groups.flatMap((group) => group.classIds)),
      ),
    ])
    await readAudit(
      tx,
      ctx,
      { type: SURVEY_ENTITY, id },
      {
        fields: results.some((result) => result.visible) ? ['aggregate', 'openTexts'] : [],
      },
    )
    const count = counts.get(id)
    return {
      surveyId: id,
      title: survey.title,
      term: survey.term,
      phase: teacherFeedbackPhase(survey, day),
      closeDate: survey.closeDate,
      threshold: survey.anonymityThreshold,
      responses: count?.responses ?? 0,
      respondents: count?.respondents ?? 0,
      teachers: results
        .map((result) => ({
          ...result,
          teacherName: teacherNames.get(result.teacherId) ?? '—',
          groups: groupsWithNames(result.groups, classNames),
        }))
        .sort(
          (a, b) =>
            a.teacherName.localeCompare(b.teacherName, 'tr') ||
            a.teacherId.localeCompare(b.teacherId),
        ),
    }
  })
}

/** Öğretmenin kapanmış anketleri, sonuçları ve eğilimi (denetimsiz iç yardımcı). */
async function teacherHistory(tx: Database, ctx: ServiceContext, teacherId: string) {
  const day = today(ctx)
  const surveys = await closedSurveysOfTeacher(tx, ctx.institutionId, {
    teacherId,
    today: day,
    limit: TEACHER_FEEDBACK_TREND_MAX,
  })
  const responses = await loadTeacherFeedbackResponses(
    tx,
    ctx.institutionId,
    surveys.map((survey) => survey.id),
    teacherId,
  )
  const bySurvey = new Map<string, TeacherFeedbackStoredResponse[]>()
  for (const row of responses)
    bySurvey.set(row.surveyId, [...(bySurvey.get(row.surveyId) ?? []), row])
  const trend = teacherFeedbackTrend(
    surveys.map((survey) => ({
      surveyId: survey.id,
      title: survey.title,
      term: survey.term,
      closeDate: survey.closeDate,
      questions: survey.questions,
      threshold: survey.anonymityThreshold,
      responses: bySurvey.get(survey.id) ?? [],
    })),
  )
  return { surveys, bySurvey, trend }
}

/** Bir öğretmenin dönemler arası eğilimi (yönetici, K-532). Öğretmen kaydı yoksa 404. */
export async function getTeacherFeedbackTrendFor(ctx: ServiceContext, teacherId: string) {
  return ctx.db.transaction(async (tx) => {
    const names = await namesOf(tx, ctx, 'teachers', [teacherId])
    const name = names.get(teacherId)
    if (name === undefined) throw new NotFoundError()
    const { trend } = await teacherHistory(tx, ctx, teacherId)
    await readAudit(tx, ctx, { type: 'teachers', id: teacherId }, { fields: ['trend'] })
    return { teacherId, teacherName: name, trend }
  })
}

/**
 * Öğretmenin kendi sonuçları (K-532): bağlı etkin öğretmen kaydının kapanmış anketlerdeki sonucu
 * (yeniden eskiye) ve eğilimi. Bağlantısı olmayan öğretmene boş liste. Okuma denetime yazılır.
 */
export async function listMyTeacherFeedbackResultsFor(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  const teacherId = scope.teacher?.id
  if (teacherId === undefined) return { teacherId: null, surveys: [], trend: [] }
  return ctx.db.transaction(async (tx) => {
    const { surveys, bySurvey, trend } = await teacherHistory(tx, ctx, teacherId)
    const results = surveys.map((survey) => ({
      survey,
      result: teacherFeedbackTeacherResult({
        teacherId,
        questions: survey.questions,
        threshold: survey.anonymityThreshold,
        closed: true,
        responses: bySurvey.get(survey.id) ?? [],
        random,
      }),
    }))
    const classNames = await namesOf(
      tx,
      ctx,
      'classes',
      results.flatMap(({ result }) => result.groups.flatMap((group) => group.classIds)),
    )
    await readAudit(
      tx,
      ctx,
      { type: 'teachers', id: teacherId },
      {
        fields: results.some(({ result }) => result.visible)
          ? ['aggregate', 'openTexts', 'trend']
          : ['trend'],
        own: true,
      },
    )
    return {
      teacherId,
      surveys: results.map(({ survey, result }) => ({
        surveyId: survey.id,
        title: survey.title,
        term: survey.term,
        closeDate: survey.closeDate,
        threshold: survey.anonymityThreshold,
        ...result,
        groups: groupsWithNames(result.groups, classNames),
      })),
      trend,
    }
  })
}

// --- Öğrenci ve velinin yanıtı -------------------------------------------------------------------

/**
 * Yanıtlayanın değerlendirebileceği öğretmenleri (öğretmen → kırılım sınıfı) hesaplayan işlev.
 * Kapsam ve kaynağı komut transaction'ından önce okunur (istek başına bir kez, önbellekli);
 * işlev ankete göre yalnız sınıf süzgecini uygular.
 */
async function eligibilityOf(ctx: ServiceContext) {
  const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
  return (survey: StoredTeacherFeedbackSurvey): Map<string, string> =>
    teacherFeedbackTeachersFor(source, scope.studentIds, survey.audience.classIds)
}

const respondentRole = (ctx: ServiceContext): TeacherFeedbackRespondentRole | null =>
  ctx.actor.role === 'ogrenci' || ctx.actor.role === 'veli' ? ctx.actor.role : null

/**
 * Yanıtlanacak anketler (K-533): rolün hedef kitlede olduğu, kapanmamış yayımlanmış anketler ve
 * her birinde değerlendirilebilecek öğretmenler (ad ve değerlendirdiniz mi). Öğretmeni olmayan
 * anket dönmez.
 */
export async function listAssignedTeacherFeedbackFor(ctx: ServiceContext) {
  const role = respondentRole(ctx)
  if (role === null) return []
  const day = today(ctx)
  const surveys = await listOpenTeacherFeedbackSurveys(ctx.db, ctx.institutionId, {
    role,
    today: day,
  })
  const [responded, eligibleFor] = await Promise.all([
    respondedTeachers(
      ctx.db,
      ctx.institutionId,
      ctx.actor.membershipId,
      surveys.map((survey) => survey.id),
    ),
    eligibilityOf(ctx),
  ])
  const eligible = surveys.map(eligibleFor)
  const names = await namesOf(
    ctx.db,
    ctx,
    'teachers',
    eligible.flatMap((map) => [...map.keys()]),
  )
  return surveys.flatMap((survey, index) => {
    const teachers = eligible[index] ?? new Map<string, string>()
    if (teachers.size === 0) return []
    const done = responded.get(survey.id) ?? new Set<string>()
    return [
      {
        id: survey.id,
        title: survey.title,
        term: survey.term,
        openDate: survey.openDate,
        closeDate: survey.closeDate,
        phase: teacherFeedbackPhase(survey, day),
        anonymityThreshold: survey.anonymityThreshold,
        questions: survey.questions,
        teachers: [...teachers.keys()]
          .map((teacherId) => ({
            teacherId,
            name: names.get(teacherId) ?? '—',
            responded: done.has(teacherId),
          }))
          .sort(
            (a, b) => a.name.localeCompare(b.name, 'tr') || a.teacherId.localeCompare(b.teacherId),
          ),
      },
    ]
  })
}

/**
 * Öğrenci ya da velinin bir öğretmen için yanıtı (K-533): rol hedef kitlede değilse anket
 * bulunmaz (404); katılım işareti ve anonim yanıt aynı transaction'da yazılır. Yanıt satırı
 * kişi, rol ve yanıt anı taşımaz; denetime yalnız katılım yazılır, cevaplar yanıtta dönmez.
 * `Idempotency-Key` zorunlu (özeti rotada gövdesiz hesaplanır).
 */
export async function respondTeacherFeedbackCommand(
  ctx: ServiceContext,
  surveyId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SURVEY_ENTITY, id: surveyId }
  const eligibleFor = await eligibilityOf(ctx)
  let teacherId = ''
  return runCommand(
    ctx,
    {
      action: 'finance.teacher_feedback.respond',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = teacherFeedbackResponseSchema.parse(input)
        teacherId = parsed.teacherId
        const survey = await findTeacherFeedbackSurvey(tx, ctx.institutionId, surveyId)
        const role = respondentRole(ctx)
        if (
          survey === null ||
          survey.publishedAt === null ||
          role === null ||
          !isTeacherFeedbackRespondent(survey.audience, role)
        )
          throw new NotFoundError()
        const eligible = eligibleFor(survey)
        const responded = await respondedTeachers(tx, ctx.institutionId, ctx.actor.membershipId, [
          surveyId,
        ])
        const publishedAt = new Date(survey.publishedAt)
        return {
          run: () => ({
            ...planTeacherFeedbackResponse(
              survey,
              {
                eligible,
                responded: responded.get(surveyId)?.has(parsed.teacherId) ?? false,
                today: today(ctx),
              },
              parsed,
            ),
            publishedAt,
          }),
        }
      },
      after: async (tx, plan) => {
        const marked = await insertTeacherFeedbackParticipation(tx, ctx.institutionId, {
          surveyId,
          membershipId: ctx.actor.membershipId,
          teacherId,
          at: plan.publishedAt,
        })
        if (!marked) throw new ConflictError()
        await insertTeacherFeedbackResponse(tx, ctx.institutionId, {
          id: randomUUID(),
          surveyId,
          teacherId,
          classId: plan.classId,
          answers: plan.answers,
          at: plan.publishedAt,
        })
        await auditWork(tx, ctx, 'finance.teacher_feedback.respond', entity, ['participation'])
      },
    },
    () => ({ statusCode: 201, body: { data: { surveyId, teacherId, responded: true } } }),
    idempotency,
  )
}
