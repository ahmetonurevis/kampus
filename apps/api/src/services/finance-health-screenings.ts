import { randomUUID } from 'node:crypto'

import {
  assertHealthScreeningPublish,
  healthScreeningHealthSchema,
  healthScreeningReport,
  healthScreeningResultsInputSchema,
  healthScreeningSessionInputSchema,
  healthScreeningSessionUpdateSchema,
  planHealthScreeningResults,
  planHealthScreeningSession,
  planHealthScreeningSessionUpdate,
  type ExistingHealthScreeningResult,
  type HealthScreeningHealth,
  type HealthScreeningKind,
  type HealthScreeningPerformer,
  type HealthScreeningSessionValues,
  type HealthScreeningStatus,
  type HealthScreeningStudent,
} from '@kampus/school-core/lib/finance-health-screenings.ts'

import type { Database } from '../db/client.ts'
import { loadIncidentMembers } from '../db/finance-incidents.ts'
import {
  countHealthScreeningRows,
  findHealthScreeningSession,
  insertHealthScreeningNotifications,
  insertHealthScreeningResult,
  insertHealthScreeningSession,
  listHealthScreeningSessions,
  loadHealthScreeningResults,
  publishHealthScreeningSession,
  updateHealthScreeningResult,
  updateHealthScreeningSession,
  type HealthScreeningSessionColumns,
  type StoredHealthScreeningResult,
  type StoredHealthScreeningSession,
} from '../db/finance-health-screenings.ts'
import { listStaffMembers } from '../db/finance-pay-rates.ts'
import { loadRecords, loadRecordsByIds, type StoredRecord } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { FieldBinding, FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Okul sağlığı taramaları (DOM-FIN-153; ON-163; K-514…K-516). Kural core
 * `lib/finance-health-screenings.ts`'tedir; servis kurum kilidi altında oturumu, sınıfları,
 * öğrencileri ve sonuçları yükler, ölçüm ve notu alan anahtarıyla şifreler ve tek transaction'da
 * yazar. Bu dosyadaki uçlar sağlık değeri döndürmez (liste, sınıf raporu, yazma yanıtları); ölçüm ve
 * not dönen bütün okumalar `finance-health-screening-reads.ts`'te toplanır ve denetime düşer. Rol
 * ve modül denetimi rotadadır.
 */

export const SESSIONS = 'health_screening_sessions'
export const RESULTS = 'health_screening_results'

export interface HealthScreeningDeps {
  cipher: FieldCipher
}

// --- Şifreleme -----------------------------------------------------------------------------------

export const resultBinding = (
  institutionId: string,
  row: { id: string; sessionId: string; studentId: string },
): FieldBinding => ({
  institutionId,
  table: RESULTS,
  column: 'health',
  rowKey: row.id,
  context: [row.sessionId, row.studentId],
})

export function resultHealthOf(
  deps: HealthScreeningDeps,
  institutionId: string,
  row: StoredHealthScreeningResult,
): HealthScreeningHealth {
  return healthScreeningHealthSchema.parse(
    JSON.parse(
      deps.cipher.decrypt(resultBinding(institutionId, row), {
        ciphertext: row.healthCiphertext,
        keyVersion: row.healthKeyVersion,
      }),
    ),
  )
}

// --- Yardımcılar ---------------------------------------------------------------------------------

const textOf = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/** Sınıf kimliği → ad (`classes.name`, yoksa kimlik); arşivli sınıf da adlandırılır. */
export async function classNames(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map<string, string>()
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'classes', unique, {
    includeArchived: true,
  })
  return new Map(rows.map((row) => [row.id, textOf(row.data.name) ?? row.id]))
}

/** Öğrenci kimliği → ad; arşivli öğrenci de adlandırılır. */
export async function studentNames(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map<string, string | null>()
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', unique, {
    includeArchived: true,
  })
  return new Map(rows.map((row) => [row.id, textOf(row.data.name)]))
}

/** Sınıfların bugünkü etkin (arşivlenmemiş, `isActive` false olmayan) öğrencileri. */
export async function rosterOf(
  db: Database,
  ctx: ServiceContext,
  classIds: readonly string[],
): Promise<StoredRecord[]> {
  if (classIds.length === 0) return []
  const rows = await loadRecords(db, ctx.institutionId, ['students'], {
    match: [{ kind: 'equals', field: 'classId', values: [...classIds] }],
  })
  return rows.filter((row) => row.data.isActive !== false)
}

export const performerOf = (row: StoredHealthScreeningSession): HealthScreeningPerformer =>
  row.performerMembershipId === null
    ? { kind: 'external', name: row.performerName ?? '' }
    : { kind: 'staff', membershipId: row.performerMembershipId }

const valuesOf = (row: StoredHealthScreeningSession): HealthScreeningSessionValues => ({
  kind: row.kind,
  screenedOn: row.screenedOn,
  classIds: row.classIds,
  performer: performerOf(row),
  thresholds: row.thresholds,
})

const columnsOf = (values: HealthScreeningSessionValues): HealthScreeningSessionColumns => ({
  screenedOn: values.screenedOn,
  classIds: values.classIds,
  performerMembershipId: values.performer.kind === 'staff' ? values.performer.membershipId : null,
  performerName: values.performer.kind === 'external' ? values.performer.name : null,
  thresholds: values.thresholds,
})

/** Oturum görünümü (sağlık değeri yok): sınıf adları, yapanın adı, sonuç ve bildirim sayısı. */
export async function sessionViews(
  db: Database,
  ctx: ServiceContext,
  rows: readonly StoredHealthScreeningSession[],
) {
  const [counts, classes, members] = await Promise.all([
    countHealthScreeningRows(
      db,
      ctx.institutionId,
      rows.map((row) => row.id),
    ),
    classNames(
      db,
      ctx,
      rows.flatMap((row) => row.classIds),
    ),
    loadIncidentMembers(
      db,
      ctx.institutionId,
      rows.flatMap((row) =>
        row.performerMembershipId === null ? [] : [row.performerMembershipId],
      ),
    ),
  ])
  return rows.map((row) => {
    const count = counts.get(row.id) ?? { results: 0, notifications: 0 }
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      screenedOn: row.screenedOn,
      classes: row.classIds.map((id) => ({ id, name: classes.get(id) ?? id })),
      performer:
        row.performerMembershipId === null
          ? { kind: 'external' as const, membershipId: null, name: row.performerName ?? '' }
          : {
              kind: 'staff' as const,
              membershipId: row.performerMembershipId,
              name: members.get(row.performerMembershipId)?.name ?? '',
            },
      thresholds: row.thresholds,
      resultCount: count.results,
      notificationCount: count.notifications,
      createdByUserId: row.createdByUserId,
      publishedAt: row.publishedAt,
      publishedByUserId: row.publishedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    }
  })
}

async function sessionBody(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findHealthScreeningSession(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const [view] = await sessionViews(tx, ctx, [row])
  if (view === undefined) throw new NotFoundError()
  return view
}

/** Oturum; yoksa ya da başka kurumunsa 404. */
export async function sessionOf(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findHealthScreeningSession(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

/** İstenen sınıflardan kurumda arşivlenmemiş olanlar. */
async function existingClasses(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'classes', [...new Set(ids)])
  return new Set(rows.map((row) => row.id))
}

// --- Okuma (sağlık değeri yok) -------------------------------------------------------------------

export interface HealthScreeningListFilters {
  page: number
  pageSize: number
  status?: HealthScreeningStatus | undefined
  kind?: HealthScreeningKind | undefined
  from?: string | undefined
  to?: string | undefined
}

/** Oturum listesi: ölçüm ve not yok, denetlenmez. */
export async function listHealthScreeningsFor(
  ctx: ServiceContext,
  query: HealthScreeningListFilters,
) {
  const { items, total } = await listHealthScreeningSessions(ctx.db, ctx.institutionId, query)
  return { items: await sessionViews(ctx.db, ctx, items), total }
}

/**
 * Sınıf raporu (K-516): hedef sınıf başına bugünkü öğrenci, taranan, katılmayan, reddeden ve
 * sonucu olmayan sayısı; ileri değerlendirme sayısı küçük grupta gizli. Yalnız düz kolonlar okunur,
 * şifre çözülmez.
 */
export async function getHealthScreeningReportFor(ctx: ServiceContext, id: string) {
  const session = await sessionOf(ctx.db, ctx, id)
  const [roster, results, names] = await Promise.all([
    rosterOf(ctx.db, ctx, session.classIds),
    loadHealthScreeningResults(ctx.db, ctx.institutionId, id),
    classNames(ctx.db, ctx, session.classIds),
  ])
  const report = healthScreeningReport(
    session.classIds.map((classId) => ({
      classId,
      rosterStudentIds: roster.filter((row) => row.data.classId === classId).map((row) => row.id),
      results: results
        .filter((row) => row.classId === classId)
        .map((row) => ({
          studentId: row.studentId,
          outcome: row.outcome,
          referralRecommended: row.referralRecommended,
        })),
    })),
  )
  return {
    sessionId: session.id,
    kind: session.kind,
    status: session.status,
    classes: report.classes.map((row) => ({
      ...row,
      className: names.get(row.classId) ?? row.classId,
    })),
    total: report.total,
  }
}

/** Taramayı yapan personel seçimi: kurumun etkin personeli, ada göre. */
export function listHealthScreeningStaffFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  return listStaffMembers(ctx.db, ctx.institutionId, { ...query, status: 'active' })
}

/** Hedef sınıf seçimi: kurumun arşivlenmemiş sınıfları ve bugünkü etkin öğrenci sayısı. */
export async function listHealthScreeningClassesFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) {
  const [classes, students] = await Promise.all([
    loadRecords(ctx.db, ctx.institutionId, ['classes']),
    loadRecords(ctx.db, ctx.institutionId, ['students']),
  ])
  const counts = new Map<string, number>()
  for (const row of students) {
    const classId = textOf(row.data.classId)
    if (classId === null || row.data.isActive === false) continue
    counts.set(classId, (counts.get(classId) ?? 0) + 1)
  }
  const items = classes
    .map((row) => ({
      id: row.id,
      name: textOf(row.data.name) ?? row.id,
      studentCount: counts.get(row.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
  const start = (query.page - 1) * query.pageSize
  return { items: items.slice(start, start + query.pageSize), total: items.length }
}

// --- Yazma ---------------------------------------------------------------------------------------

const sessionCreateFields = (values: HealthScreeningSessionValues) => [
  'kind',
  'screenedOn',
  'classIds',
  'performer',
  ...(Object.values(values.thresholds).some((value) => value !== null) ? ['thresholds'] : []),
]

/** Yeni oturum (K-514); `Idempotency-Key` rotada zorunlu. 201. */
export function createHealthScreeningCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: SESSIONS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.health_screening.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = healthScreeningSessionInputSchema.parse(input)
        const [classIds, members] = await Promise.all([
          existingClasses(tx, ctx, parsed.classIds),
          loadIncidentMembers(
            tx,
            ctx.institutionId,
            parsed.performer.kind === 'staff' ? [parsed.performer.membershipId] : [],
          ),
        ])
        return {
          run: () =>
            planHealthScreeningSession(parsed, {
              now: ctx.now,
              classIds,
              performer:
                parsed.performer.kind === 'staff'
                  ? (members.get(parsed.performer.membershipId) ?? null)
                  : undefined,
            }),
        }
      },
      after: async (tx, values) => {
        await insertHealthScreeningSession(tx, ctx.institutionId, {
          id,
          kind: values.kind,
          columns: columnsOf(values),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.health_screening.create',
          entity,
          sessionCreateFields(values),
        )
        body = { data: await sessionBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Açık oturum düzeltmesi (K-514); `If-Match` oturum sürümü. */
export function updateHealthScreeningCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SESSIONS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.health_screening.update',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await sessionOf(tx, ctx, id)
        if (row.version !== expectedVersion) throw new ConflictError()
        const parsed = healthScreeningSessionUpdateSchema.parse(input)
        const performer = parsed.performer ?? performerOf(row)
        const [classIds, members, results] = await Promise.all([
          existingClasses(tx, ctx, parsed.classIds ?? []),
          loadIncidentMembers(
            tx,
            ctx.institutionId,
            performer.kind === 'staff' ? [performer.membershipId] : [],
          ),
          loadHealthScreeningResults(tx, ctx.institutionId, id),
        ])
        return {
          run: () =>
            planHealthScreeningSessionUpdate({ ...valuesOf(row), status: row.status }, parsed, {
              now: ctx.now,
              classIds,
              performer:
                performer.kind === 'staff'
                  ? (members.get(performer.membershipId) ?? null)
                  : undefined,
              resultCount: results.length,
              classesWithResults: new Set(results.map((item) => item.classId)),
            }),
        }
      },
      after: async (tx, { values, changed }) => {
        const saved = await updateHealthScreeningSession(tx, ctx.institutionId, {
          id,
          expectedVersion,
          columns: columnsOf(values),
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.health_screening.update', entity, changed)
        body = { data: await sessionBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Sonuç girişi (K-514): öğrenci başına tek sonuç; yeni sonuç eklenir, var olan sürümüyle düzeltilir,
 * değişmeyen yazılmaz. Ölçüm ve not şifrelenir. Yanıtta sağlık değeri yoktur (sayılar ve oturum);
 * güncel sonuçlar denetimli ayrıntı ucundan okunur. `Idempotency-Key` rotada zorunlu.
 */
export function recordHealthScreeningResultsCommand(
  ctx: ServiceContext,
  deps: HealthScreeningDeps,
  id: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SESSIONS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.health_screening.results',
      collections: [],
      entity,
      load: async (tx) => {
        const session = await sessionOf(tx, ctx, id)
        const parsed = healthScreeningResultsInputSchema.parse(input)
        const ids = parsed.results.map((item) => item.studentId)
        const [students, results] = await Promise.all([
          loadRecordsByIds(tx, ctx.institutionId, 'students', ids),
          loadHealthScreeningResults(tx, ctx.institutionId, id, ids),
        ])
        const studentMap = new Map<string, HealthScreeningStudent>(
          students.map((row) => [
            row.id,
            { classId: textOf(row.data.classId), active: row.data.isActive !== false },
          ]),
        )
        const existing = new Map<string, ExistingHealthScreeningResult>(
          results.map((row) => [
            row.studentId,
            {
              id: row.id,
              version: row.version,
              outcome: row.outcome,
              referralRecommended: row.referralRecommended,
              health: resultHealthOf(deps, ctx.institutionId, row),
            },
          ]),
        )
        return {
          run: () =>
            planHealthScreeningResults(session, parsed, {
              now: ctx.now,
              students: studentMap,
              existing,
            }),
        }
      },
      after: async (tx, { writes, unchanged }) => {
        let created = 0
        let updated = 0
        for (const write of writes) {
          const resultId = write.kind === 'create' ? randomUUID() : write.id
          const sealed = deps.cipher.encrypt(
            resultBinding(ctx.institutionId, {
              id: resultId,
              sessionId: id,
              studentId: write.studentId,
            }),
            JSON.stringify(write.health),
          )
          const columns = {
            outcome: write.outcome,
            referralRecommended: write.referralRecommended,
            healthCiphertext: sealed.ciphertext,
            healthKeyVersion: sealed.keyVersion,
          }
          if (write.kind === 'create') {
            await insertHealthScreeningResult(tx, ctx.institutionId, {
              id: resultId,
              sessionId: id,
              studentId: write.studentId,
              classId: write.classId,
              columns,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
            created += 1
          } else {
            const saved = await updateHealthScreeningResult(tx, ctx.institutionId, {
              id: resultId,
              expectedVersion: write.expectedVersion,
              columns,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
            if (!saved) throw new ConflictError()
            updated += 1
          }
          await auditWork(
            tx,
            ctx,
            write.kind === 'create'
              ? 'finance.health_screening.result_create'
              : 'finance.health_screening.result_update',
            { type: RESULTS, id: resultId },
            [
              'outcome',
              'referralRecommended',
              ...(write.health.measurement === null ? [] : ['measurement']),
              ...(write.health.note === null ? [] : ['note']),
            ],
          )
        }
        body = {
          data: { created, updated, unchanged, session: await sessionBody(tx, ctx, id) },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Yayımlama (K-515): sonuçlar veliye açılır ve değişmez; ileri değerlendirme önerilen her sonuç
 * için "gönderilecek" bildirim kaydı yazılır (gerçek gönderim yok). `If-Match` oturum sürümü.
 */
export function publishHealthScreeningCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SESSIONS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.health_screening.publish',
      collections: [],
      entity,
      load: async (tx) => {
        const session = await sessionOf(tx, ctx, id)
        if (session.version !== expectedVersion) throw new ConflictError()
        const results = await loadHealthScreeningResults(tx, ctx.institutionId, id)
        return {
          run: () => {
            assertHealthScreeningPublish({
              status: session.status,
              screenedOn: session.screenedOn,
              resultCount: results.length,
              now: ctx.now,
            })
            return results.filter((row) => row.referralRecommended)
          },
        }
      },
      after: async (tx, referred) => {
        const saved = await publishHealthScreeningSession(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await insertHealthScreeningNotifications(tx, ctx.institutionId, {
          sessionId: id,
          items: referred.map((row) => ({
            id: randomUUID(),
            resultId: row.id,
            studentId: row.studentId,
          })),
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.health_screening.publish', entity, [
          'status',
          'publishedAt',
          ...(referred.length === 0 ? [] : ['notifications']),
        ])
        body = { data: await sessionBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
