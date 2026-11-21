import { randomInt, randomUUID } from 'node:crypto'

import {
  planStaffSurveyArchive,
  planStaffSurveyCopy,
  planStaffSurveyCreate,
  planStaffSurveyPublish,
  planStaffSurveyResponse,
  planStaffSurveyUpdate,
  STAFF_SURVEY_NO_UNIT,
  staffSurveyCreateSchema,
  staffSurveyParticipants,
  staffSurveyParticipation,
  staffSurveyPhase,
  staffSurveyResponseSchema,
  staffSurveyResult,
  staffSurveyUpdateSchema,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  archiveStaffSurvey,
  findStaffSurvey,
  findStaffSurveyParticipant,
  insertStaffSurvey,
  insertStaffSurveyParticipants,
  insertStaffSurveyResponse,
  listAssignedStaffSurveys,
  listStaffSurveys,
  loadStaffSurveyCandidates,
  loadStaffSurveyResponses,
  markStaffSurveyResponded,
  orgUnitNames,
  publishStaffSurvey,
  staffSurveyCopyExists,
  staffSurveyParticipationCounts,
  unknownOrgUnitIds,
  updateStaffSurveyDraft,
  type StaffSurveyListQuery,
  type StoredStaffSurvey,
} from '../db/finance-staff-surveys.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { loadStaffFeedbackThreshold } from './finance-staff-feedback.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel memnuniyet anketi (DOM-FIN-143; ON-191; K-484…K-486). Kural core
 * `lib/finance-staff-surveys.ts`'tedir; servis kurum kilidi altında anketi, hedef kitleyi ve
 * katılımcıyı yükler, tek transaction'da yazar ve denetime alan adlarını yazar. Yanıt satırı
 * kişiye bağlanmaz: katılım işareti ve yanıt ayrı tablolardadır, yanıtın zaman kolonları yayım
 * anıdır; yanıt komutu denetime yalnız katılımı yazar, cevapları yazmaz ve yanıtta döndürmez.
 * Sonuç yalnız `staffSurveyResult`'tan toplu çıkar ve okunuşu aynı transaction'da denetime düşer.
 * Rol ve modül denetimi rotadadır; bugün Europe/Istanbul günüdür.
 */

const SURVEY_ENTITY = 'staff_surveys'
const RESULT_ACTION = 'finance.staff_survey_result.read'

const today = (ctx: ServiceContext) => dayKey(ctx.now)

/** Açık uçlu cevapları karıştırmak için [0, 1) (K-486). */
const random = () => randomInt(0, 2 ** 32) / 2 ** 32

type Counts = Map<string, { participants: number; responded: number }>

/** Liste satırı: aşama ve (yayımlanmışsa) katılım; sorular ayrıntıda. */
function surveyRow(survey: StoredStaffSurvey, counts: Counts, day: string) {
  const { questions, ...rest } = survey
  const count = counts.get(survey.id)
  return {
    ...rest,
    questionCount: questions.length,
    phase: staffSurveyPhase(survey, day),
    participation:
      survey.status === 'published'
        ? staffSurveyParticipation(count?.participants ?? 0, count?.responded ?? 0)
        : null,
  }
}

async function loadSurvey(db: Database, ctx: ServiceContext, id: string) {
  const survey = await findStaffSurvey(db, ctx.institutionId, id)
  if (survey === null) throw new NotFoundError()
  return survey
}

/** Kurumun anketleri (arşivli taslak hariç), aşama ve başlık süzgeciyle. */
export async function listStaffSurveysFor(ctx: ServiceContext, query: StaffSurveyListQuery) {
  const day = today(ctx)
  const { items, total } = await listStaffSurveys(ctx.db, ctx.institutionId, {
    ...query,
    today: day,
  })
  const counts = await staffSurveyParticipationCounts(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  return { items: items.map((item) => surveyRow(item, counts, day)), total }
}

/**
 * Anket ayrıntısı: sorular, hedef kitle birimlerinin adları ve hedef kitle büyüklüğü (taslakta
 * bugünkü personelle hesaplanır, yayımlanmışta donan katılımcı sayısı). Başka kurum 404.
 */
export async function getStaffSurveyFor(ctx: ServiceContext, id: string) {
  const day = today(ctx)
  const survey = await loadSurvey(ctx.db, ctx, id)
  const [counts, names] = await Promise.all([
    staffSurveyParticipationCounts(ctx.db, ctx.institutionId, [id]),
    orgUnitNames(ctx.db, ctx.institutionId, survey.audience.unitIds),
  ])
  const audienceSize =
    survey.status === 'published'
      ? (counts.get(id)?.participants ?? 0)
      : staffSurveyParticipants(
          await loadStaffSurveyCandidates(ctx.db, ctx.institutionId, day),
          survey.audience,
        ).length
  return {
    ...surveyRow(survey, counts, day),
    questions: survey.questions,
    audienceSize,
    audienceUnits: survey.audience.unitIds.map((unitId) => ({
      id: unitId,
      name: names.get(unitId) ?? '—',
    })),
  }
}

async function surveyBody(tx: Database, ctx: ServiceContext, id: string) {
  const counts = await staffSurveyParticipationCounts(tx, ctx.institutionId, [id])
  const saved = await findStaffSurvey(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('staff survey was not written')
  return { ...surveyRow(saved, counts, today(ctx)), questions: saved.questions }
}

const DRAFT_FIELDS = [
  'title',
  'openDate',
  'closeDate',
  'anonymityThreshold',
  'audience',
  'questions',
]

/** Taslak açar (K-484); eşik verilmezse kurumun anonimlik eşiği. `Idempotency-Key` zorunlu. 201. */
export function createStaffSurveyCommand(
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
      action: 'finance.staff_survey.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffSurveyCreateSchema.parse(input)
        const [unknownUnitIds, defaultThreshold] = await Promise.all([
          unknownOrgUnitIds(tx, ctx.institutionId, parsed.audience.unitIds),
          loadStaffFeedbackThreshold(tx, ctx.institutionId),
        ])
        return { run: () => planStaffSurveyCreate(parsed, { defaultThreshold, unknownUnitIds }) }
      },
      after: async (tx, draft) => {
        await insertStaffSurvey(tx, ctx.institutionId, {
          ...draft,
          id,
          revision: 1,
          sourceSurveyId: null,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_survey.create', entity, DRAFT_FIELDS)
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Taslak düzeltmesi (K-484): yalnız gönderilen alanlar değişir. */
export function updateStaffSurveyCommand(
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
      action: 'finance.staff_survey.update',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, id)
        const parsed = staffSurveyUpdateSchema.parse(input)
        if (survey.version !== expectedVersion) throw new ConflictError()
        changed = Object.entries(parsed).flatMap(([key, value]) =>
          value === undefined ? [] : [key],
        )
        const unknownUnitIds = await unknownOrgUnitIds(
          tx,
          ctx.institutionId,
          parsed.audience?.unitIds ?? [],
        )
        return { run: () => planStaffSurveyUpdate(survey, parsed, { unknownUnitIds }) }
      },
      after: async (tx, draft) => {
        const saved = await updateStaffSurveyDraft(tx, ctx.institutionId, {
          ...draft,
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_survey.update', entity, changed)
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Yayım (K-484): bugünkü hedef kitle katılımcı listesi olarak donar; liste eşikten küçükse 422
 * (K-486). Sorular, tarihler ve eşik bundan sonra değişmez (tetikleyici).
 */
export function publishStaffSurveyCommand(
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
      action: 'finance.staff_survey.publish',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, id)
        if (survey.version !== expectedVersion) throw new ConflictError()
        const day = today(ctx)
        const participants = staffSurveyParticipants(
          await loadStaffSurveyCandidates(tx, ctx.institutionId, day),
          survey.audience,
        )
        return {
          run: () => {
            planStaffSurveyPublish(survey, { today: day, audienceSize: participants.length })
            return participants
          },
        }
      },
      after: async (tx, participants) => {
        const saved = await publishStaffSurvey(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await insertStaffSurveyParticipants(tx, ctx.institutionId, {
          surveyId: id,
          participants,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_survey.publish', entity, [
          'status',
          'publishedAt',
          'participants',
        ])
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Taslağı kaldırır (arşiv; K-484). */
export function archiveStaffSurveyCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SURVEY_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.staff_survey.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, id)
        if (survey.version !== expectedVersion) throw new ConflictError()
        return { run: () => planStaffSurveyArchive(survey) }
      },
      after: async (tx) => {
        const saved = await archiveStaffSurvey(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_survey.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

/** Yayımlanmış anketin yeni sürümünü taslak olarak açar (K-484). `Idempotency-Key` zorunlu. 201. */
export function copyStaffSurveyCommand(
  ctx: ServiceContext,
  sourceId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: SURVEY_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_survey.copy',
      collections: [],
      entity,
      load: async (tx) => {
        const survey = await loadSurvey(tx, ctx, sourceId)
        const copyExists = await staffSurveyCopyExists(tx, ctx.institutionId, sourceId)
        return { run: () => planStaffSurveyCopy(survey, { copyExists }) }
      },
      after: async (tx, draft) => {
        await insertStaffSurvey(tx, ctx.institutionId, {
          ...draft,
          id,
          sourceSurveyId: sourceId,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_survey.copy', entity, [
          'sourceSurveyId',
          'revision',
          ...DRAFT_FIELDS,
        ])
        body = { data: await surveyBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Toplu sonuç (K-486): yalnız kapanıştan sonra ve eşik üstünde; birim kırılımı (`unit`: birim
 * kimliği ya da `none`) eşik ve tamamlayıcı gizlemeyle. Okuma aynı transaction'da denetime
 * yazılır (görünür alan adları); denetim yazılamazsa sonuç dönmez. Başka kurum 404.
 */
export async function getStaffSurveyResultFor(
  ctx: ServiceContext,
  id: string,
  unit: string | null,
) {
  return ctx.db.transaction(async (tx) => {
    const survey = await loadSurvey(tx, ctx, id)
    const day = today(ctx)
    const [counts, responses] = await Promise.all([
      staffSurveyParticipationCounts(tx, ctx.institutionId, [id]),
      loadStaffSurveyResponses(tx, ctx.institutionId, id),
    ])
    const result = staffSurveyResult({
      questions: survey.questions,
      threshold: survey.anonymityThreshold,
      closed: survey.status === 'published' && staffSurveyPhase(survey, day) === 'closed',
      participants: counts.get(id)?.participants ?? 0,
      responses: survey.status === 'published' ? responses : [],
      unit,
      random,
    })
    const names = await orgUnitNames(
      tx,
      ctx.institutionId,
      result.units.flatMap(({ unit: key }) => (key === STAFF_SURVEY_NO_UNIT ? [] : [key])),
    )
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: RESULT_ACTION,
      entityType: SURVEY_ENTITY,
      entityId: id,
      // kvkk: değer değil, dönen toplu alanların adı; birim kırılımı yalnız anahtar olarak.
      changes: {
        fields: result.visible ? ['aggregate', 'openTexts'] : [],
        ...(unit === null ? {} : { unit }),
      },
      createdAt: ctx.now,
    })
    return {
      surveyId: id,
      title: survey.title,
      phase: staffSurveyPhase(survey, day),
      closeDate: survey.closeDate,
      ...result,
      units: result.units.map((row) => ({
        ...row,
        name: row.unit === STAFF_SURVEY_NO_UNIT ? 'Birimsiz' : (names.get(row.unit) ?? '—'),
      })),
    }
  })
}

// --- Personelin kendi yanıtı ---------------------------------------------------------------------

/** Personelin katılımcısı olduğu kapanmamış anketler; sorular ve katılım işaretiyle (K-485). */
export async function listAssignedStaffSurveysFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) {
  const day = today(ctx)
  const { items, total } = await listAssignedStaffSurveys(ctx.db, ctx.institutionId, {
    membershipId: ctx.actor.membershipId,
    today: day,
    ...query,
  })
  return {
    items: items.map((survey) => ({
      id: survey.id,
      title: survey.title,
      openDate: survey.openDate,
      closeDate: survey.closeDate,
      phase: staffSurveyPhase(survey, day),
      anonymityThreshold: survey.anonymityThreshold,
      questions: survey.questions,
      responded: survey.responded,
    })),
    total,
  }
}

/**
 * Personelin kendi yanıtı (K-485): katılımcı değilse anket bulunmaz (404); katılım işareti ve
 * anonim yanıt aynı transaction'da yazılır. Yanıt satırı kişi kimliği ve yanıt anı taşımaz
 * (zaman kolonları yayım anıdır); denetime yalnız katılım yazılır, cevaplar yazılmaz ve yanıtta
 * dönmez. `Idempotency-Key` zorunlu (özeti rotada gövdesiz hesaplanır).
 */
export function respondStaffSurveyCommand(
  ctx: ServiceContext,
  surveyId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SURVEY_ENTITY, id: surveyId }
  return runCommand(
    ctx,
    {
      action: 'finance.staff_survey.respond',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffSurveyResponseSchema.parse(input)
        const [survey, participant] = await Promise.all([
          findStaffSurvey(tx, ctx.institutionId, surveyId),
          findStaffSurveyParticipant(tx, ctx.institutionId, surveyId, ctx.actor.membershipId),
        ])
        if (survey === null || participant === null || survey.publishedAt === null)
          throw new NotFoundError()
        const publishedAt = new Date(survey.publishedAt)
        return {
          run: () => ({
            answers: planStaffSurveyResponse(survey, participant, parsed, today(ctx)),
            unitId: participant.unitId,
            publishedAt,
          }),
        }
      },
      after: async (tx, plan) => {
        const marked = await markStaffSurveyResponded(tx, ctx.institutionId, {
          surveyId,
          membershipId: ctx.actor.membershipId,
        })
        if (!marked) throw new ConflictError()
        await insertStaffSurveyResponse(tx, ctx.institutionId, {
          id: randomUUID(),
          surveyId,
          unitId: plan.unitId,
          answers: plan.answers,
          at: plan.publishedAt,
        })
        await auditWork(tx, ctx, 'finance.staff_survey.respond', entity, ['participation'])
      },
    },
    () => ({ statusCode: 201, body: { data: { surveyId, responded: true } } }),
    idempotency,
  )
}
