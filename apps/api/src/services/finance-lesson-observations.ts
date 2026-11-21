import { randomUUID } from 'node:crypto'

import {
  canViewLessonObservation,
  lessonObservationCreateSchema,
  lessonObservationEmptySchema,
  lessonObservationScore,
  lessonObservationUpdateSchema,
  planLessonObservation,
  planLessonObservationArchive,
  planLessonObservationComplete,
  planLessonObservationTemplate,
  planLessonObservationTemplateArchive,
  planLessonObservationTemplateUpdate,
  planLessonObservationTemplateVersion,
  planLessonObservationUpdate,
  ratedCount,
  type ObservationPeriodCheck,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { sampleLessonCountsByVersion } from '../db/finance-candidate-interviews.ts'
import {
  archiveLessonObservation,
  archiveObservationTemplate,
  completeLessonObservation,
  findLessonObservation,
  findObservationMember,
  findObservationTemplate,
  insertLessonObservation,
  insertObservationTemplate,
  insertObservationTemplateVersion,
  listLessonObservations,
  listObservationTemplates,
  observationCountsByVersion,
  observationRecordExists,
  observationRecordNames,
  updateLessonObservation,
  updateObservationTemplateVersion,
  type LessonObservationQuery,
  type ObservationTemplateQuery,
  type StoredLessonObservation,
  type StoredObservationTemplate,
} from '../db/finance-lesson-observations.ts'
import { findPerformancePeriod } from '../db/finance-performance.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Ders gözlem formu (DOM-FIN-130; ON-206). Kural core `lib/finance-lesson-observations.ts`'tedir;
 * servis kurum kilidi altında şablonu, gözlemi, üyelikleri, sınıf/ders kaydını ve performans
 * dönemini yükler, tek transaction'da yazar ve denetime alan adlarını yazar. Puan saklanmaz:
 * her yanıtta sürüm ölçütlerinden rubrik kuralıyla hesaplanır (istemcinin puanı alınmaz). Gözlem
 * okuması aynı transaction'da `finance.lesson_observation.read` denetimine düşer (K-447);
 * öğretmen yalnız gözlemcisi olduğu ve gözlendiği tamamlanmış kayıtları görür, gerisi 404.
 * Rol ve modül denetimi rotadadır.
 */

const TEMPLATE_ENTITY = 'lesson_observation_templates'
const OBSERVATION_ENTITY = 'lesson_observations'
const READ_ACTION = 'finance.lesson_observation.read'
/** Okuma denetimine yazılan kişisel alan adları (değer değil). */
const PERSONAL_FIELDS = ['teacherName', 'observerName', 'ratings', 'generalNote', 'score']

/** Tek kayıtlık görünüm dizisinin elemanı; görünüm satır düşürmez. */
function only<T>(items: readonly T[]): T {
  const [item] = items
  if (item === undefined) throw new Error('view row was not built')
  return item
}

// --- Şablon --------------------------------------------------------------------------------------

function templateView(
  template: StoredObservationTemplate,
  usedCount: number,
  sampleLessons: number,
) {
  return { ...template, observationCount: usedCount, used: usedCount + sampleLessons > 0 }
}

async function templateViews(
  db: Database,
  ctx: ServiceContext,
  items: StoredObservationTemplate[],
) {
  const versionIds = items.map((item) => item.versionId)
  const [counts, sampleLessons] = await Promise.all([
    observationCountsByVersion(db, ctx.institutionId, versionIds),
    sampleLessonCountsByVersion(db, ctx.institutionId, versionIds),
  ])
  return items.map((item) =>
    templateView(item, counts.get(item.versionId) ?? 0, sampleLessons.get(item.versionId) ?? 0),
  )
}

export async function listObservationTemplatesFor(
  ctx: ServiceContext,
  query: ObservationTemplateQuery,
) {
  const { items, total } = await listObservationTemplates(ctx.db, ctx.institutionId, query)
  return { items: await templateViews(ctx.db, ctx, items), total }
}

async function templateBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findObservationTemplate(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('observation template was not written')
  return only(await templateViews(tx, ctx, [saved]))
}

/** Yeni şablon, sürüm 1 (K-445). `Idempotency-Key` rotada zorunludur. 201. */
export function createObservationTemplateCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation_template.create',
      collections: [],
      entity,
      load: () => Promise.resolve({ run: () => planLessonObservationTemplate(input) }),
      after: async (tx, plan) => {
        await insertObservationTemplate(tx, ctx.institutionId, {
          id,
          versionId: randomUUID(),
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.lesson_observation_template.create', entity, [
          'name',
          'criteria',
        ])
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadTemplateForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const template = await findObservationTemplate(tx, ctx.institutionId, id)
  if (template === null) throw new NotFoundError()
  if (template.version !== expectedVersion) throw new ConflictError()
  const [counts, sampleLessons] = await Promise.all([
    observationCountsByVersion(tx, ctx.institutionId, [template.versionId]),
    // Aday örnek dersinde kullanılmış sürüm de değişmez (DOM-FIN-138, K-471).
    sampleLessonCountsByVersion(tx, ctx.institutionId, [template.versionId]),
  ])
  return {
    template,
    facts: {
      archived: template.archivedAt !== null,
      used:
        (counts.get(template.versionId) ?? 0) + (sampleLessons.get(template.versionId) ?? 0) > 0,
    },
  }
}

/** Kullanılmamış son sürümün düzeltmesi (K-445); kullanılmış sürüm 409. */
export function updateObservationTemplateCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation_template.update',
      collections: [],
      entity,
      load: async (tx) => {
        const { template, facts } = await loadTemplateForWrite(tx, ctx, id, expectedVersion)
        return {
          run: () => ({
            versionId: template.versionId,
            patch: planLessonObservationTemplateUpdate(facts, input),
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updateObservationTemplateVersion(tx, ctx.institutionId, {
          id,
          versionId: plan.versionId,
          expectedVersion,
          patch: plan.patch,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.lesson_observation_template.update',
          entity,
          Object.keys(plan.patch),
        )
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yeni sürüm (K-445): önceki sürümler ve gözlemleri değişmez; yeni gözlem bu sürümü kullanır. */
export function createObservationTemplateVersionCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation_template.version',
      collections: [],
      entity,
      load: async (tx) => {
        const { template, facts } = await loadTemplateForWrite(tx, ctx, id, expectedVersion)
        return {
          run: () => ({
            versionNumber: template.versionNumber + 1,
            ...planLessonObservationTemplateVersion(facts, input),
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await insertObservationTemplateVersion(tx, ctx.institutionId, {
          id,
          versionId: randomUUID(),
          expectedVersion,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lesson_observation_template.version', entity, [
          'versionNumber',
          'name',
          'criteria',
        ])
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Arşiv (K-445): yeni gözlemde seçilmez; eski gözlemler sürümüyle okunur. */
export function archiveObservationTemplateCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation_template.archive',
      collections: [],
      entity,
      load: async (tx) => {
        lessonObservationEmptySchema.parse(input)
        const { facts } = await loadTemplateForWrite(tx, ctx, id, expectedVersion)
        return { run: () => planLessonObservationTemplateArchive(facts) }
      },
      after: async (tx) => {
        const saved = await archiveObservationTemplate(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lesson_observation_template.archive', entity, [
          'archivedAt',
        ])
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Gözlem --------------------------------------------------------------------------------------

/** Öğretmen için satır süzgeci; yönetici süzülmez (K-447). */
const viewerFilter = (ctx: ServiceContext) =>
  ctx.actor.role === 'yonetici' ? null : ctx.actor.membershipId

async function observationViews(
  db: Database,
  ctx: ServiceContext,
  items: readonly StoredLessonObservation[],
) {
  const [classes, subjects] = await Promise.all([
    observationRecordNames(
      db,
      ctx.institutionId,
      'classes',
      items.map((item) => item.classId),
    ),
    observationRecordNames(
      db,
      ctx.institutionId,
      'subjects',
      items.map((item) => item.subjectId),
    ),
  ])
  return items.map((item) => ({
    ...item,
    className: item.classId === null ? null : (classes.get(item.classId) ?? null),
    subjectName: item.subjectId === null ? null : (subjects.get(item.subjectId) ?? null),
    criterionCount: item.criteria.length,
    ratedCount: ratedCount(item.ratings),
    score: lessonObservationScore(item.criteria, item.ratings),
  }))
}

async function auditRead(
  tx: Database,
  ctx: ServiceContext,
  entityId: string | null,
  count: number,
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: READ_ACTION,
    entityType: OBSERVATION_ENTITY,
    entityId,
    // kvkk: değer değil, dönen kişisel alanların adı ve kayıt sayısı.
    changes: { fields: PERSONAL_FIELDS, counts: { observations: count } },
    createdAt: ctx.now,
  })
}

/**
 * Gözlem listesi (K-447): yönetici hepsini, öğretmen gözlemcisi olduğu ve gözlendiği tamamlanmış
 * kayıtları görür. Okuma aynı transaction'da denetime yazılır; denetim yazılamazsa yanıt dönmez.
 */
export async function listLessonObservationsFor(
  ctx: ServiceContext,
  query: LessonObservationQuery,
) {
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listLessonObservations(
      tx,
      ctx.institutionId,
      query,
      viewerFilter(ctx),
    )
    await auditRead(tx, ctx, null, items.length)
    return { items: await observationViews(tx, ctx, items), total }
  })
}

/** Tek gözlem ve sürümünün ölçütleri; görülemeyen ya da başka kurumun kaydı 404 (K-447). */
export async function getLessonObservationFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const observation = await findLessonObservation(tx, ctx.institutionId, id)
    if (observation === null || !canViewLessonObservation(ctx.actor, observation))
      throw new NotFoundError()
    await auditRead(tx, ctx, id, 1)
    return only(await observationViews(tx, ctx, [observation]))
  })
}

async function observationBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findLessonObservation(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('lesson observation was not written')
  return only(await observationViews(tx, ctx, [saved]))
}

/** Dönem bağı: `null`/`undefined` kimlikte `undefined` (istenmedi), kurumda yoksa `null`. */
async function periodCheck(
  tx: Database,
  ctx: ServiceContext,
  periodId: string | null | undefined,
): Promise<ObservationPeriodCheck> {
  if (periodId === null || periodId === undefined) return undefined
  return findPerformancePeriod(tx, ctx.institutionId, periodId)
}

/**
 * Yeni gözlem taslağı (K-446): şablonun son sürümü, etkin öğretmen, gözlemci (boşsa isteği yapan),
 * gün ve isteğe bağlı sınıf/ders/dönem. `Idempotency-Key` rotada zorunludur. 201.
 */
export function createLessonObservationCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: OBSERVATION_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = lessonObservationCreateSchema.parse(input)
        const observerMembershipId = parsed.observerMembershipId ?? ctx.actor.membershipId
        const [template, teacher, observer, classFound, subjectFound, period] = await Promise.all([
          findObservationTemplate(tx, ctx.institutionId, parsed.templateId),
          findObservationMember(tx, ctx.institutionId, parsed.teacherMembershipId),
          findObservationMember(tx, ctx.institutionId, observerMembershipId),
          observationRecordExists(tx, ctx.institutionId, 'classes', parsed.classId),
          observationRecordExists(tx, ctx.institutionId, 'subjects', parsed.subjectId),
          periodCheck(tx, ctx, parsed.performancePeriodId),
        ])
        const today = dayKey(ctx.now)
        return {
          run: () => {
            const ratings = planLessonObservation(parsed, {
              template:
                template === null
                  ? null
                  : { archived: template.archivedAt !== null, criteria: template.criteria },
              teacher,
              observer,
              classFound,
              subjectFound,
              period,
              today,
            })
            return {
              templateVersionId: template?.versionId ?? '',
              teacherMembershipId: parsed.teacherMembershipId,
              observerMembershipId,
              observedDate: parsed.observedDate,
              classId: parsed.classId ?? null,
              subjectId: parsed.subjectId ?? null,
              performancePeriodId: parsed.performancePeriodId ?? null,
              ratings,
            }
          },
        }
      },
      after: async (tx, plan) => {
        await insertLessonObservation(tx, ctx.institutionId, {
          id,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.lesson_observation.create', entity, [
          'templateVersionId',
          'teacherMembershipId',
          'observerMembershipId',
          'observedDate',
          ...(plan.classId === null ? [] : ['classId']),
          ...(plan.subjectId === null ? [] : ['subjectId']),
          ...(plan.performancePeriodId === null ? [] : ['performancePeriodId']),
        ])
        body = { data: await observationBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadObservationForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const observation = await findLessonObservation(tx, ctx.institutionId, id)
  if (observation === null) throw new NotFoundError()
  if (observation.version !== expectedVersion) throw new ConflictError()
  return observation
}

/**
 * Taslak düzeltmesi (K-446): gün, sınıf, ders, dönem, ölçüt seviyeleri ve notları, genel
 * değerlendirme. Tamamlanan gözlem 409. Not metinleri denetime yazılmaz.
 */
export function updateLessonObservationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: OBSERVATION_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation.update',
      collections: [],
      entity,
      load: async (tx) => {
        const observation = await loadObservationForWrite(tx, ctx, id, expectedVersion)
        const parsed = lessonObservationUpdateSchema.parse(input)
        const periodId =
          parsed.performancePeriodId === undefined
            ? observation.performancePeriodId
            : parsed.performancePeriodId
        const [classFound, subjectFound, period] = await Promise.all([
          observationRecordExists(tx, ctx.institutionId, 'classes', parsed.classId),
          observationRecordExists(tx, ctx.institutionId, 'subjects', parsed.subjectId),
          periodCheck(tx, ctx, periodId),
        ])
        return {
          run: () =>
            planLessonObservationUpdate(observation, observation.criteria, parsed, {
              classFound,
              subjectFound,
              period,
              today: dayKey(ctx.now),
            }),
        }
      },
      after: async (tx, patch) => {
        const saved = await updateLessonObservation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          patch,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.lesson_observation.update',
          entity,
          Object.entries(patch)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
        )
        body = { data: await observationBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Tamamlama (K-446): her ölçüt seviyeli, hedef altı notlu, genel değerlendirme yazılı; sonra kilit. */
export function completeLessonObservationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: OBSERVATION_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation.complete',
      collections: [],
      entity,
      load: async (tx) => {
        lessonObservationEmptySchema.parse(input)
        const observation = await loadObservationForWrite(tx, ctx, id, expectedVersion)
        return { run: () => planLessonObservationComplete(observation, observation.criteria) }
      },
      after: async (tx) => {
        const saved = await completeLessonObservation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lesson_observation.complete', entity, [
          'status',
          'completedAt',
        ])
        body = { data: await observationBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Taslak arşivi (K-446): yanlış açılmış taslak listeden kalkar; tamamlanan gözlem 409. */
export function archiveLessonObservationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: OBSERVATION_ENTITY, id }
  const body = { data: { id, archivedAt: ctx.now.toISOString() } }
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_observation.archive',
      collections: [],
      entity,
      load: async (tx) => {
        lessonObservationEmptySchema.parse(input)
        const observation = await loadObservationForWrite(tx, ctx, id, expectedVersion)
        return { run: () => planLessonObservationArchive(observation) }
      },
      after: async (tx) => {
        const saved = await archiveLessonObservation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lesson_observation.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
