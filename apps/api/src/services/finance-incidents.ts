import { randomUUID } from 'node:crypto'

import {
  assertIncidentAddendum,
  assertIncidentFinalize,
  guardianIncidentSummary,
  incidentAccess,
  incidentAddendumSchema,
  incidentHealthSchema,
  incidentNotificationSchema,
  incidentReportInputSchema,
  incidentReportUpdateSchema,
  planIncidentNotification,
  planIncidentReport,
  planIncidentReportUpdate,
  type IncidentAccess,
  type IncidentHealth,
  type IncidentStatus,
  type IncidentValues,
  type InjuredKind,
} from '@kampus/school-core/lib/finance-incidents.ts'

import type { Database } from '../db/client.ts'
import { listStaffMembers } from '../db/finance-pay-rates.ts'
import {
  countIncidentAddenda,
  findIncidentReport,
  finalizeIncidentReport,
  insertIncidentAddendum,
  insertIncidentNotification,
  insertIncidentReport,
  listFinalizedStudentReports,
  listIncidentReports,
  loadIncidentAddenda,
  loadIncidentMembers,
  loadIncidentNotifications,
  loadIncidentWitnesses,
  updateIncidentReport,
  type IncidentReportColumns,
  type StoredIncidentNotification,
  type StoredIncidentReport,
} from '../db/finance-incidents.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { FieldBinding, FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { istanbulDayStart } from './list-filters.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Kaza ve yaralanma tutanağı (DOM-FIN-146; ON-162; K-493…K-495). Kural ve erişim matrisi core
 * `lib/finance-incidents.ts`'tedir; servis kurum kilidi altında tutanağı, kişileri ve bildirimleri
 * yükler, açıklama, sağlık grubu ve ek notu alan anahtarıyla şifreleyip çözer ve tek transaction'da
 * yazar. Açan personel olmayan yönetici dışı rol tutanağı göremez (404, varlık ipucu yok). Her
 * ayrıntı ve veli özeti okuması aynı transaction'da denetime yazılır (dönen alanların adları; değer
 * yok); denetim yazılamazsa yanıt dönmez. Açıklama, sağlık değerleri ve notlar loga verilmez. Rol ve
 * modül denetimi rotadadır.
 */

const ENTITY = 'incident_reports'
const TABLE = 'incident_reports'
const ADDENDA_TABLE = 'incident_report_addenda'

export interface IncidentDeps {
  cipher: FieldCipher
}

// --- Şifreleme -----------------------------------------------------------------------------------

type Injured = Pick<
  StoredIncidentReport,
  'id' | 'injuredKind' | 'studentId' | 'injuredMembershipId'
>

const injuredIdOf = (row: Pick<Injured, 'studentId' | 'injuredMembershipId'>) =>
  row.studentId ?? row.injuredMembershipId ?? ''

const reportBinding = (
  institutionId: string,
  row: Injured,
  column: 'description' | 'health',
): FieldBinding => ({
  institutionId,
  table: TABLE,
  column,
  rowKey: row.id,
  context: [row.injuredKind, injuredIdOf(row)],
})

function decryptReport(deps: IncidentDeps, institutionId: string, row: StoredIncidentReport) {
  const description = deps.cipher.decrypt(reportBinding(institutionId, row, 'description'), {
    ciphertext: row.descriptionCiphertext,
    keyVersion: row.descriptionKeyVersion,
  })
  const health: IncidentHealth = incidentHealthSchema.parse(
    JSON.parse(
      deps.cipher.decrypt(reportBinding(institutionId, row, 'health'), {
        ciphertext: row.healthCiphertext,
        keyVersion: row.healthKeyVersion,
      }),
    ),
  )
  return { description, health }
}

function encryptColumns(
  deps: IncidentDeps,
  institutionId: string,
  row: Injured,
  values: IncidentValues,
): IncidentReportColumns {
  const description = deps.cipher.encrypt(
    reportBinding(institutionId, row, 'description'),
    values.description,
  )
  const health = deps.cipher.encrypt(
    reportBinding(institutionId, row, 'health'),
    JSON.stringify(values.health),
  )
  return {
    occurredAt: values.occurredAt,
    location: values.location,
    kind: values.kind,
    descriptionCiphertext: description.ciphertext,
    descriptionKeyVersion: description.keyVersion,
    healthCiphertext: health.ciphertext,
    healthKeyVersion: health.keyVersion,
    firstAidByMembershipId: values.firstAidByMembershipId,
    responsibleMembershipId: values.responsibleMembershipId,
  }
}

const addendumBinding = (institutionId: string, reportId: string, id: string): FieldBinding => ({
  institutionId,
  table: ADDENDA_TABLE,
  column: 'note',
  rowKey: id,
  context: [reportId],
})

// --- Görünüm -------------------------------------------------------------------------------------

const accessOf = (
  ctx: ServiceContext,
  row: Pick<StoredIncidentReport, 'createdByUserId' | 'status'>,
) => incidentAccess({ role: ctx.actor.role, userId: ctx.actor.userId }, row)

async function studentNames(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map<string, string | null>()
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', unique, {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
}

async function rowsView(db: Database, ctx: ServiceContext, rows: readonly StoredIncidentReport[]) {
  const ids = rows.map((row) => row.id)
  const [notifications, students, members] = await Promise.all([
    loadIncidentNotifications(db, ctx.institutionId, ids),
    studentNames(
      db,
      ctx,
      rows.flatMap((row) => (row.studentId === null ? [] : [row.studentId])),
    ),
    loadIncidentMembers(
      db,
      ctx.institutionId,
      rows.flatMap((row) => [
        row.responsibleMembershipId,
        ...(row.injuredMembershipId === null ? [] : [row.injuredMembershipId]),
      ]),
    ),
  ])
  return rows.map((row) => {
    const sent = notifications.get(row.id) ?? []
    return {
      id: row.id,
      status: row.status,
      injuredKind: row.injuredKind,
      studentId: row.studentId,
      injuredMembershipId: row.injuredMembershipId,
      injuredName:
        row.studentId !== null
          ? (students.get(row.studentId) ?? null)
          : (members.get(row.injuredMembershipId ?? '')?.name ?? null),
      occurredAt: row.occurredAt,
      location: row.location,
      kind: row.kind,
      responsibleMembershipId: row.responsibleMembershipId,
      responsibleName: members.get(row.responsibleMembershipId)?.name ?? null,
      notificationCount: sent.length,
      lastNotifiedAt: sent.at(-1)?.notifiedAt ?? null,
      createdByUserId: row.createdByUserId,
      mine: row.createdByUserId === ctx.actor.userId,
      finalizedAt: row.finalizedAt,
      version: row.version,
    }
  })
}

/** Ayrıntıda dönen alanlar; okuma denetimine alan adları olarak yazılır. */
const EVENT_FIELDS = ['injured', 'occurredAt', 'location', 'kind', 'description', 'witnesses']
const HEALTH_FIELDS = ['bodyParts', 'severity', 'injuryNote', 'firstAid', 'referral']

async function detailOf(
  db: Database,
  ctx: ServiceContext,
  deps: IncidentDeps,
  row: StoredIncidentReport,
  access: IncidentAccess,
) {
  const [base] = await rowsView(db, ctx, [row])
  if (base === undefined) throw new NotFoundError()
  const [witnessMap, notificationMap] = await Promise.all([
    loadIncidentWitnesses(db, ctx.institutionId, [row.id]),
    loadIncidentNotifications(db, ctx.institutionId, [row.id]),
  ])
  const witnessIds = witnessMap.get(row.id) ?? []
  const notifications = notificationMap.get(row.id) ?? []
  const members = await loadIncidentMembers(db, ctx.institutionId, [
    ...witnessIds,
    ...notifications.map((item) => item.notifiedByMembershipId),
    ...(row.firstAidByMembershipId === null ? [] : [row.firstAidByMembershipId]),
  ])
  const { description, health } = decryptReport(deps, ctx.institutionId, row)
  const addenda = access.manage ? await loadIncidentAddenda(db, ctx.institutionId, row.id) : null
  const fields = [
    ...EVENT_FIELDS,
    'notifications',
    ...(access.health ? HEALTH_FIELDS : []),
    ...(addenda === null ? [] : ['addenda']),
  ]
  const body = {
    ...base,
    description,
    witnesses: witnessIds.map((membershipId) => ({
      membershipId,
      name: members.get(membershipId)?.name ?? null,
    })),
    notifications: notifications.map((item) => notificationView(item, members)),
    ...(access.health
      ? {
          health: {
            bodyParts: health.bodyParts,
            severity: health.severity,
            injuryNote: health.injuryNote,
            firstAid:
              health.firstAidAction === null
                ? null
                : {
                    byMembershipId: row.firstAidByMembershipId,
                    byName:
                      row.firstAidByMembershipId === null
                        ? null
                        : (members.get(row.firstAidByMembershipId)?.name ?? null),
                    action: health.firstAidAction,
                  },
            referral: health.referral,
          },
        }
      : {}),
    ...(addenda === null
      ? {}
      : {
          addenda: addenda.map((item) => ({
            id: item.id,
            note: deps.cipher.decrypt(addendumBinding(ctx.institutionId, row.id, item.id), {
              ciphertext: item.noteCiphertext,
              keyVersion: item.noteKeyVersion,
            }),
            createdByUserId: item.createdByUserId,
            createdByName: item.createdByName,
            createdAt: item.createdAt,
          })),
        }),
    access: {
      health: access.health,
      edit: access.edit,
      notify: access.notify,
      manage: access.manage,
    },
    finalizedByUserId: row.finalizedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  return { body, fields }
}

function notificationView(
  item: StoredIncidentNotification,
  members: ReadonlyMap<string, { name: string }>,
) {
  return {
    id: item.id,
    notifiedAt: item.notifiedAt,
    channel: item.channel,
    notifiedByMembershipId: item.notifiedByMembershipId,
    notifiedByName: members.get(item.notifiedByMembershipId)?.name ?? null,
    createdAt: item.createdAt,
  }
}

/** Erişilebilen tutanak; yoksa, başka kurumunsa ya da açan değilse 404 (K-494). */
async function readable(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findIncidentReport(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const access = accessOf(ctx, row)
  if (!access.read) throw new NotFoundError()
  return { row, access }
}

async function detailBody(tx: Database, ctx: ServiceContext, deps: IncidentDeps, id: string) {
  const { row, access } = await readable(tx, ctx, id)
  return (await detailOf(tx, ctx, deps, row, access)).body
}

// --- Okuma ---------------------------------------------------------------------------------------

export interface IncidentListFilters {
  page: number
  pageSize: number
  status?: IncidentStatus | undefined
  injuredKind?: InjuredKind | undefined
  studentId?: string | undefined
  from?: string | undefined
  to?: string | undefined
}

/** Liste: yönetici bütün tutanakları, diğerleri yalnız açtıklarını görür; sağlık grubu yok. */
export async function listIncidentsFor(ctx: ServiceContext, query: IncidentListFilters) {
  const nextDay = (day: string) =>
    new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
  const { items, total } = await listIncidentReports(ctx.db, ctx.institutionId, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    injuredKind: query.injuredKind,
    studentId: query.studentId,
    fromAt: query.from === undefined ? undefined : new Date(istanbulDayStart(query.from)),
    toAt: query.to === undefined ? undefined : new Date(istanbulDayStart(nextDay(query.to))),
    createdByUserId: ctx.actor.role === 'yonetici' ? undefined : ctx.actor.userId,
  })
  return { items: await rowsView(ctx.db, ctx, items), total }
}

/**
 * Ayrıntı (K-494): erişim matrisine göre alanlar; okuma aynı transaction'da
 * `finance.incident.read` denetimine düşer (dönen alanların adları).
 */
export function getIncidentFor(ctx: ServiceContext, deps: IncidentDeps, id: string) {
  return ctx.db.transaction(async (tx) => {
    const { row, access } = await readable(tx, ctx, id)
    const { body, fields } = await detailOf(tx, ctx, deps, row, access)
    await auditWork(tx, ctx, 'finance.incident.read', { type: ENTITY, id }, fields)
    return body
  })
}

const GUARDIAN_FIELDS = [
  'occurredAt',
  'location',
  'kind',
  'bodyParts',
  'severity',
  'firstAidAction',
  'referral',
  'notifications',
]

/**
 * Veli özeti (K-495): kapsamdaki çocukların (velayetli ve kısıtsız bağ) kesinleşmiş tutanakları.
 * Her dönen tutanak aynı transaction'da `finance.incident.guardian_read` denetimine düşer.
 */
export async function listGuardianIncidentsFor(
  ctx: ServiceContext,
  deps: IncidentDeps,
  query: { page: number; pageSize: number; studentId?: string | undefined },
) {
  // Kapsam işlemden önce okunur: tek bağlantılı sürücüde işlem içinden `ctx.db` beklemede kalır.
  const scope = await readScope(ctx)
  return ctx.db.transaction(async (tx) => {
    const children = [...scope.studentIds].filter(
      (id) => query.studentId === undefined || id === query.studentId,
    )
    const { items, total } = await listFinalizedStudentReports(tx, ctx.institutionId, {
      page: query.page,
      pageSize: query.pageSize,
      studentIds: children,
    })
    const [notifications, names] = await Promise.all([
      loadIncidentNotifications(
        tx,
        ctx.institutionId,
        items.map((row) => row.id),
      ),
      studentNames(
        tx,
        ctx,
        items.flatMap((row) => (row.studentId === null ? [] : [row.studentId])),
      ),
    ])
    const data = []
    for (const row of items) {
      const { health } = decryptReport(deps, ctx.institutionId, row)
      const studentId = row.studentId ?? ''
      data.push({
        ...guardianIncidentSummary({
          id: row.id,
          studentId,
          occurredAt: row.occurredAt,
          location: row.location,
          kind: row.kind,
          health,
          finalizedAt: row.finalizedAt ?? row.updatedAt,
          notifications: notifications.get(row.id) ?? [],
        }),
        studentName: names.get(studentId) ?? null,
      })
      await auditWork(
        tx,
        ctx,
        'finance.incident.guardian_read',
        { type: ENTITY, id: row.id },
        GUARDIAN_FIELDS,
      )
    }
    return { items: data, total }
  })
}

/** Tanık, sorumlu ve bildiren seçimi: kurumun etkin personeli, ada göre. */
export function listIncidentStaffFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  return listStaffMembers(ctx.db, ctx.institutionId, { ...query, status: 'active' })
}

// --- Yazma ---------------------------------------------------------------------------------------

const changedOnCreate = (values: IncidentValues) => [
  'injured',
  'occurredAt',
  'location',
  'kind',
  'description',
  ...HEALTH_FIELDS.filter(
    (field) =>
      (field !== 'injuryNote' || values.health.injuryNote !== null) &&
      (field !== 'firstAid' || values.health.firstAidAction !== null),
  ),
  ...(values.witnessMembershipIds.length === 0 ? [] : ['witnessMembershipIds']),
  'responsibleMembershipId',
]

/** Yeni taslak (K-493); `Idempotency-Key` rotada zorunlu. 201. */
export function createIncidentCommand(
  ctx: ServiceContext,
  deps: IncidentDeps,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.incident.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = incidentReportInputSchema.parse(input)
        const injuredMembershipId =
          parsed.injured.kind === 'staff' ? parsed.injured.membershipId : null
        const members = await loadIncidentMembers(tx, ctx.institutionId, [
          parsed.responsibleMembershipId,
          ...parsed.witnessMembershipIds,
          ...(parsed.firstAid?.byMembershipId ? [parsed.firstAid.byMembershipId] : []),
          ...(injuredMembershipId === null ? [] : [injuredMembershipId]),
        ])
        const studentExists =
          parsed.injured.kind === 'student'
            ? (
                await loadRecordsByIds(tx, ctx.institutionId, 'students', [
                  parsed.injured.studentId,
                ])
              ).length > 0
            : undefined
        return {
          run: () => ({
            parsed,
            values: planIncidentReport(parsed, {
              now: ctx.now,
              members,
              studentExists,
              injuredMember:
                injuredMembershipId === null
                  ? undefined
                  : (members.get(injuredMembershipId) ?? null),
            }),
          }),
        }
      },
      after: async (tx, { parsed, values }) => {
        const injured = {
          id,
          injuredKind: parsed.injured.kind,
          studentId: parsed.injured.kind === 'student' ? parsed.injured.studentId : null,
          injuredMembershipId: parsed.injured.kind === 'staff' ? parsed.injured.membershipId : null,
        }
        await insertIncidentReport(tx, ctx.institutionId, {
          ...injured,
          columns: encryptColumns(deps, ctx.institutionId, injured, values),
          witnessMembershipIds: values.witnessMembershipIds,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.incident.create', entity, changedOnCreate(values))
        body = { data: await detailBody(tx, ctx, deps, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzenlenebilen tutanak: erişim yoksa 404, kesinleştiyse 409, sürüm tutmazsa 409. */
async function editable(tx: Database, ctx: ServiceContext, id: string, expectedVersion: number) {
  const { row, access } = await readable(tx, ctx, id)
  if (row.version !== expectedVersion) throw new ConflictError()
  return { row, access }
}

/** Taslak düzeltmesi (K-493); `If-Match` tutanak sürümü. */
export function updateIncidentCommand(
  ctx: ServiceContext,
  deps: IncidentDeps,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.incident.update',
      collections: [],
      entity,
      load: async (tx) => {
        const { row } = await editable(tx, ctx, id, expectedVersion)
        const parsed = incidentReportUpdateSchema.parse(input)
        const { description, health } = decryptReport(deps, ctx.institutionId, row)
        const [witnesses, notifications] = await Promise.all([
          loadIncidentWitnesses(tx, ctx.institutionId, [id]),
          loadIncidentNotifications(tx, ctx.institutionId, [id]),
        ])
        const current: IncidentValues = {
          occurredAt: row.occurredAt,
          location: row.location,
          kind: row.kind,
          description,
          health,
          firstAidByMembershipId: row.firstAidByMembershipId,
          witnessMembershipIds: witnesses.get(id) ?? [],
          responsibleMembershipId: row.responsibleMembershipId,
        }
        const members = await loadIncidentMembers(tx, ctx.institutionId, [
          parsed.responsibleMembershipId ?? row.responsibleMembershipId,
          ...(parsed.witnessMembershipIds ?? current.witnessMembershipIds),
          ...(parsed.firstAid?.byMembershipId
            ? [parsed.firstAid.byMembershipId]
            : row.firstAidByMembershipId === null
              ? []
              : [row.firstAidByMembershipId]),
        ])
        return {
          run: () =>
            planIncidentReportUpdate(
              { ...current, status: row.status, injuredMembershipId: row.injuredMembershipId },
              parsed,
              {
                now: ctx.now,
                members,
                firstNotifiedAt: notifications.get(id)?.[0]?.notifiedAt ?? null,
              },
            ),
        }
      },
      after: async (tx, { values, changed }) => {
        const row = await findIncidentReport(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        const saved = await updateIncidentReport(tx, ctx.institutionId, {
          id,
          expectedVersion,
          columns: encryptColumns(deps, ctx.institutionId, row, values),
          witnessMembershipIds: changed.includes('witnessMembershipIds')
            ? values.witnessMembershipIds
            : undefined,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.incident.update', entity, changed)
        body = { data: await detailBody(tx, ctx, deps, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Kesinleştirme (K-493): ağır öğrenci olayında bildirim kaydı ister; `If-Match`. */
export function finalizeIncidentCommand(
  ctx: ServiceContext,
  deps: IncidentDeps,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.incident.finalize',
      collections: [],
      entity,
      load: async (tx) => {
        const { row } = await editable(tx, ctx, id, expectedVersion)
        const { health } = decryptReport(deps, ctx.institutionId, row)
        const notifications = await loadIncidentNotifications(tx, ctx.institutionId, [id])
        return {
          run: () =>
            assertIncidentFinalize({
              status: row.status,
              injuredKind: row.injuredKind,
              severity: health.severity,
              notificationCount: notifications.get(id)?.length ?? 0,
            }),
        }
      },
      after: async (tx) => {
        const saved = await finalizeIncidentReport(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.incident.finalize', entity, ['status', 'finalizedAt'])
        body = { data: await detailBody(tx, ctx, deps, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Veli bildirimi kaydı (K-493): dış gönderim yok; taslakta ve kesinleşmişte. 201. */
export function recordIncidentNotificationCommand(
  ctx: ServiceContext,
  deps: IncidentDeps,
  id: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const notificationId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.incident.notify',
      collections: [],
      entity,
      load: async (tx) => {
        const { row, access } = await readable(tx, ctx, id)
        if (!access.notify) throw new NotFoundError()
        const parsed = incidentNotificationSchema.parse(input)
        const notifiedById = parsed.notifiedByMembershipId ?? ctx.actor.membershipId
        const [notifications, members] = await Promise.all([
          loadIncidentNotifications(tx, ctx.institutionId, [id]),
          loadIncidentMembers(tx, ctx.institutionId, [notifiedById]),
        ])
        return {
          run: () => ({
            notifiedById,
            parsed,
            plan: planIncidentNotification(
              {
                injuredKind: row.injuredKind,
                occurredAt: row.occurredAt,
                notificationCount: notifications.get(id)?.length ?? 0,
              },
              parsed,
              { now: ctx.now, notifiedBy: members.get(notifiedById) ?? null },
            ),
          }),
        }
      },
      after: async (tx, { notifiedById, parsed, plan }) => {
        await insertIncidentNotification(tx, ctx.institutionId, {
          id: notificationId,
          reportId: id,
          notifiedAt: plan.notifiedAt,
          channel: parsed.channel,
          notifiedByMembershipId: notifiedById,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.incident.notify', entity, [
          'notifiedAt',
          'channel',
          'notifiedByMembershipId',
        ])
        body = { data: await detailBody(tx, ctx, deps, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Ek not (K-493): yalnız yönetici ve kesinleşmiş tutanak; not şifreli. 201. */
export function addIncidentAddendumCommand(
  ctx: ServiceContext,
  deps: IncidentDeps,
  id: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const addendumId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.incident.addendum',
      collections: [],
      entity,
      load: async (tx) => {
        const { row, access } = await readable(tx, ctx, id)
        if (!access.manage) throw new NotFoundError()
        const parsed = incidentAddendumSchema.parse(input)
        const addendumCount = await countIncidentAddenda(tx, ctx.institutionId, id)
        return {
          run: () => {
            assertIncidentAddendum({ status: row.status, addendumCount })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const note = deps.cipher.encrypt(
          addendumBinding(ctx.institutionId, id, addendumId),
          parsed.note,
        )
        await insertIncidentAddendum(tx, ctx.institutionId, {
          id: addendumId,
          reportId: id,
          noteCiphertext: note.ciphertext,
          noteKeyVersion: note.keyVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.incident.addendum', entity, ['addenda'])
        body = { data: await detailBody(tx, ctx, deps, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}
