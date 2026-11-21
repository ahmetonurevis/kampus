import { randomUUID } from 'node:crypto'

import {
  administrationHealthSchema,
  assertConsentDecision,
  assertConsentWithdrawable,
  consentHealthSchema,
  infirmaryDischargeSchema,
  infirmaryVisitInputSchema,
  infirmaryVisitUpdateSchema,
  medicationAdministrationSchema,
  medicationConsentInputSchema,
  medicationConsentRejectSchema,
  medicationScheduleSlots,
  planInfirmaryDischarge,
  planInfirmaryVisit,
  planInfirmaryVisitUpdate,
  planMedicationAdministration,
  planMedicationConsent,
  visitHealthSchema,
  visitPresence,
  type ConsentHealth,
  type ConsentStatus,
  type VisitHealth,
  type VisitStatus,
  type VisitValues,
} from '@kampus/school-core/lib/finance-infirmary.ts'
import {
  assertDoseSlotOpen,
  doseSlotKey,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'

import type { Database } from '../db/client.ts'
import { findIncidentReport, loadIncidentMembers } from '../db/finance-incidents.ts'
import {
  closeVisit,
  findConsent,
  findVisit,
  hasOpenVisit,
  insertAdministration,
  insertConsent,
  insertVisit,
  listApprovedConsentsOn,
  listConsents,
  listVisits,
  listVisitStates,
  loadAdministrations,
  transitionConsent,
  updateVisit,
  type StoredAdministration,
  type StoredConsent,
  type StoredVisit,
  type VisitColumns,
} from '../db/finance-infirmary.ts'
import { listStaffMembers } from '../db/finance-pay-rates.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { FieldBinding, FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { loadDoseSlots } from './finance-infirmary-schedule-slots.ts'
import { istanbulDayStart } from './list-filters.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Revir ve ilaç onayı (DOM-FIN-151; ON-101; IST-102; K-508…K-510). Kural core
 * `lib/finance-infirmary.ts`'tedir; servis kurum kilidi altında ziyareti, talebi ve uygulamaları
 * yükler, sağlık grubunu (şikâyet, yapılanlar, not; ilaç adı, doz, not; ret gerekçesi) alan
 * anahtarıyla şifreleyip çözer ve tek transaction'da yazar. Sağlık ayrıntısı dönen her okuma aynı
 * transaction'da denetime yazılır (dönen alanların adları; değer yok); denetim yazılamazsa yanıt
 * dönmez. Öğretmen yalnız kendi sınıfının durumunu, veli yalnız kapsamındaki (velayetli ve kısıtsız
 * bağ) çocuklarını görür. Sağlık değerleri loga verilmez. Rol ve modül denetimi rotadadır.
 */

const VISITS = 'infirmary_visits'
const CONSENTS = 'infirmary_medication_consents'
const ADMINISTRATIONS = 'infirmary_medication_administrations'

export interface InfirmaryDeps {
  cipher: FieldCipher
}

// --- Şifreleme -----------------------------------------------------------------------------------

const visitBinding = (
  institutionId: string,
  row: { id: string; studentId: string },
): FieldBinding => ({
  institutionId,
  table: VISITS,
  column: 'health',
  rowKey: row.id,
  context: [row.studentId],
})

const consentBinding = (
  institutionId: string,
  row: { id: string; studentId: string },
  column: 'health' | 'decision',
): FieldBinding => ({
  institutionId,
  table: CONSENTS,
  column,
  rowKey: row.id,
  context: [row.studentId],
})

export const administrationBinding = (
  institutionId: string,
  row: { id: string; consentId: string },
): FieldBinding => ({
  institutionId,
  table: ADMINISTRATIONS,
  column: 'health',
  rowKey: row.id,
  context: [row.consentId],
})

function visitHealthOf(deps: InfirmaryDeps, institutionId: string, row: StoredVisit): VisitHealth {
  return visitHealthSchema.parse(
    JSON.parse(
      deps.cipher.decrypt(visitBinding(institutionId, row), {
        ciphertext: row.healthCiphertext,
        keyVersion: row.healthKeyVersion,
      }),
    ),
  )
}

export function consentHealthOf(
  deps: InfirmaryDeps,
  institutionId: string,
  row: StoredConsent,
): ConsentHealth {
  return consentHealthSchema.parse(
    JSON.parse(
      deps.cipher.decrypt(consentBinding(institutionId, row, 'health'), {
        ciphertext: row.healthCiphertext,
        keyVersion: row.healthKeyVersion,
      }),
    ),
  )
}

function rejectionOf(deps: InfirmaryDeps, institutionId: string, row: StoredConsent) {
  if (row.decisionCiphertext === null || row.decisionKeyVersion === null) return null
  return deps.cipher.decrypt(consentBinding(institutionId, row, 'decision'), {
    ciphertext: row.decisionCiphertext,
    keyVersion: row.decisionKeyVersion,
  })
}

function visitColumns(
  deps: InfirmaryDeps,
  institutionId: string,
  row: { id: string; studentId: string },
  values: VisitValues,
): VisitColumns {
  const health = deps.cipher.encrypt(
    visitBinding(institutionId, row),
    JSON.stringify(values.health),
  )
  return {
    arrivedAt: values.arrivedAt,
    referredByMembershipId: values.referredByMembershipId,
    incidentReportId: values.incidentReportId,
    healthCiphertext: health.ciphertext,
    healthKeyVersion: health.keyVersion,
  }
}

// --- Yardımcılar ---------------------------------------------------------------------------------

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

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)

const dayBounds = (from: string | undefined, to: string | undefined) => ({
  fromAt: from === undefined ? undefined : new Date(istanbulDayStart(from)),
  toAt: to === undefined ? undefined : new Date(istanbulDayStart(nextDay(to))),
})

/** Velinin kapsamındaki çocuklar; isteğe bağlı tek çocuğa daraltılır. */
async function guardianChildren(ctx: ServiceContext, studentId?: string) {
  const scope = await readScope(ctx)
  return [...scope.studentIds].filter((id) => studentId === undefined || id === studentId)
}

// --- Ziyaret görünümü ----------------------------------------------------------------------------

async function visitRows(db: Database, ctx: ServiceContext, rows: readonly StoredVisit[]) {
  const [names, members] = await Promise.all([
    studentNames(
      db,
      ctx,
      rows.map((row) => row.studentId),
    ),
    loadIncidentMembers(
      db,
      ctx.institutionId,
      rows.flatMap((row) =>
        row.referredByMembershipId === null ? [] : [row.referredByMembershipId],
      ),
    ),
  ])
  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    studentName: names.get(row.studentId) ?? null,
    status: row.status,
    arrivedAt: row.arrivedAt,
    returnedAt: row.returnedAt,
    outcome: row.outcome,
    referredByMembershipId: row.referredByMembershipId,
    referredByName:
      row.referredByMembershipId === null
        ? null
        : (members.get(row.referredByMembershipId)?.name ?? null),
    incidentReportId: row.incidentReportId,
    createdByUserId: row.createdByUserId,
    version: row.version,
  }))
}

/** Ayrıntıda dönen sağlık alanları; okuma denetimine alan adları olarak yazılır. */
const VISIT_HEALTH_FIELDS = ['complaint', 'actions', 'note', 'outcome']

async function visitDetail(
  db: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  row: StoredVisit,
) {
  const [base] = await visitRows(db, ctx, [row])
  if (base === undefined) throw new NotFoundError()
  const health = visitHealthOf(deps, ctx.institutionId, row)
  return {
    ...base,
    complaint: health.complaint,
    actions: health.actions,
    note: health.note,
    closedByUserId: row.closedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function visitOf(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findVisit(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

// --- Ziyaret okuma -------------------------------------------------------------------------------

export interface VisitListFilters {
  page: number
  pageSize: number
  status?: VisitStatus | undefined
  studentId?: string | undefined
  from?: string | undefined
  to?: string | undefined
}

/** Ziyaret listesi (yönetici, ön büro): sağlık grubu yok, denetlenmez. */
export async function listVisitsFor(ctx: ServiceContext, query: VisitListFilters) {
  const { items, total } = await listVisits(ctx.db, ctx.institutionId, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    studentIds: query.studentId === undefined ? undefined : [query.studentId],
    ...dayBounds(query.from, query.to),
  })
  return { items: await visitRows(ctx.db, ctx, items), total }
}

/** Ziyaret ayrıntısı (K-510): şikâyet, yapılanlar, not; okuma `finance.infirmary.visit_read`. */
export function getVisitFor(ctx: ServiceContext, deps: InfirmaryDeps, id: string) {
  return ctx.db.transaction(async (tx) => {
    const row = await visitOf(tx, ctx, id)
    const body = await visitDetail(tx, ctx, deps, row)
    await auditWork(
      tx,
      ctx,
      'finance.infirmary.visit_read',
      { type: VISITS, id },
      VISIT_HEALTH_FIELDS,
    )
    return body
  })
}

/**
 * Revir durumu (K-510): günün (Europe/Istanbul) ziyaretlerinden öğrenci başına "revirde / döndü".
 * Öğretmen yalnız sınıf öğretmeni olduğu sınıfların öğrencilerini görür; sonuç, şikâyet ve
 * yapılanlar dönmez, okuma denetlenmez.
 */
export async function listVisitStatesFor(ctx: ServiceContext, day: string) {
  let studentIds: string[] | undefined
  if (ctx.actor.role === 'ogretmen') {
    const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
    const teacherId = scope.teacher?.id
    const homerooms = new Set(
      teacherId === undefined
        ? []
        : source.classes.filter((item) => item.teacherId === teacherId).map((item) => item.id),
    )
    studentIds = source.students
      .filter((student) => homerooms.has(student.classId) && scope.studentIds.has(student.id))
      .map((student) => student.id)
  }
  const rows = await listVisitStates(ctx.db, ctx.institutionId, {
    studentIds,
    fromAt: new Date(istanbulDayStart(day)),
    toAt: new Date(istanbulDayStart(nextDay(day))),
  })
  const names = await studentNames(
    ctx.db,
    ctx,
    rows.map((row) => row.studentId),
  )
  return rows.map((row) => ({
    visitId: row.id,
    studentId: row.studentId,
    studentName: names.get(row.studentId) ?? null,
    state: visitPresence(row.status),
    arrivedAt: row.arrivedAt,
    returnedAt: row.returnedAt,
  }))
}

const GUARDIAN_VISIT_FIELDS = ['arrivedAt', 'returnedAt', 'outcome', 'complaint', 'actions']

/**
 * Veli ziyaret özeti (K-510): kapsamdaki çocukların ziyaretleri; geliş, dönüş, sonuç, şikâyet ve
 * yapılanlar. Revir notu, gönderen ve tutanak bağı dönmez. Her dönen ziyaret
 * `finance.infirmary.guardian_read` denetimine düşer.
 */
export async function listGuardianVisitsFor(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  query: { page: number; pageSize: number; studentId?: string | undefined },
) {
  // Kapsam işlemden önce okunur: tek bağlantılı sürücüde işlem içinden `ctx.db` beklemede kalır.
  const children = await guardianChildren(ctx, query.studentId)
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listVisits(tx, ctx.institutionId, {
      page: query.page,
      pageSize: query.pageSize,
      studentIds: children,
    })
    const names = await studentNames(
      tx,
      ctx,
      items.map((row) => row.studentId),
    )
    const data = []
    for (const row of items) {
      const health = visitHealthOf(deps, ctx.institutionId, row)
      data.push({
        id: row.id,
        studentId: row.studentId,
        studentName: names.get(row.studentId) ?? null,
        status: row.status,
        arrivedAt: row.arrivedAt,
        returnedAt: row.returnedAt,
        outcome: row.outcome,
        complaint: health.complaint,
        actions: health.actions,
      })
      await auditWork(
        tx,
        ctx,
        'finance.infirmary.guardian_read',
        { type: VISITS, id: row.id },
        GUARDIAN_VISIT_FIELDS,
      )
    }
    return { items: data, total }
  })
}

/** Gönderen ve uygulayan seçimi: kurumun etkin personeli, ada göre. */
export function listInfirmaryStaffFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  return listStaffMembers(ctx.db, ctx.institutionId, { ...query, status: 'active' })
}

// --- Ziyaret yazma -------------------------------------------------------------------------------

const visitCreateFields = (values: VisitValues) => [
  'studentId',
  'arrivedAt',
  'complaint',
  ...(values.health.actions.length === 0 ? [] : ['actions']),
  ...(values.health.note === null ? [] : ['note']),
  ...(values.referredByMembershipId === null ? [] : ['referredByMembershipId']),
  ...(values.incidentReportId === null ? [] : ['incidentReportId']),
]

/** Yeni ziyaret (K-508); `Idempotency-Key` rotada zorunlu. 201. */
export function createVisitCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: VISITS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.visit_create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = infirmaryVisitInputSchema.parse(input)
        const [students, openVisitExists, members, incident] = await Promise.all([
          loadRecordsByIds(tx, ctx.institutionId, 'students', [parsed.studentId]),
          hasOpenVisit(tx, ctx.institutionId, parsed.studentId),
          loadIncidentMembers(
            tx,
            ctx.institutionId,
            parsed.referredByMembershipId === null ? [] : [parsed.referredByMembershipId],
          ),
          parsed.incidentReportId === null
            ? Promise.resolve(null)
            : findIncidentReport(tx, ctx.institutionId, parsed.incidentReportId),
        ])
        return {
          run: () => ({
            parsed,
            values: planInfirmaryVisit(parsed, {
              now: ctx.now,
              studentExists: students.length > 0,
              openVisitExists,
              referredBy:
                parsed.referredByMembershipId === null
                  ? undefined
                  : (members.get(parsed.referredByMembershipId) ?? null),
              incident,
            }),
          }),
        }
      },
      after: async (tx, { parsed, values }) => {
        const key = { id, studentId: parsed.studentId }
        await insertVisit(tx, ctx.institutionId, {
          id,
          studentId: parsed.studentId,
          columns: visitColumns(deps, ctx.institutionId, key, values),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.infirmary.visit_create',
          entity,
          visitCreateFields(values),
        )
        body = { data: await visitDetail(tx, ctx, deps, await visitOf(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function versionedVisit(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const row = await visitOf(tx, ctx, id)
  if (row.version !== expectedVersion) throw new ConflictError()
  return row
}

/** Açık ziyaret düzeltmesi (K-508); `If-Match` ziyaret sürümü. */
export function updateVisitCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: VISITS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.visit_update',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await versionedVisit(tx, ctx, id, expectedVersion)
        const parsed = infirmaryVisitUpdateSchema.parse(input)
        const health = visitHealthOf(deps, ctx.institutionId, row)
        const referredId = parsed.referredByMembershipId ?? null
        const [members, incident] = await Promise.all([
          loadIncidentMembers(tx, ctx.institutionId, referredId === null ? [] : [referredId]),
          parsed.incidentReportId === undefined || parsed.incidentReportId === null
            ? Promise.resolve(undefined)
            : findIncidentReport(tx, ctx.institutionId, parsed.incidentReportId),
        ])
        return {
          run: () =>
            planInfirmaryVisitUpdate(
              {
                status: row.status,
                studentId: row.studentId,
                arrivedAt: row.arrivedAt,
                referredByMembershipId: row.referredByMembershipId,
                incidentReportId: row.incidentReportId,
                health,
              },
              parsed,
              {
                now: ctx.now,
                referredBy: referredId === null ? undefined : (members.get(referredId) ?? null),
                incident,
              },
            ),
        }
      },
      after: async (tx, { values, changed }) => {
        const row = await visitOf(tx, ctx, id)
        const saved = await updateVisit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          columns: visitColumns(deps, ctx.institutionId, row, values),
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.infirmary.visit_update', entity, changed)
        body = { data: await visitDetail(tx, ctx, deps, await visitOf(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Ziyareti kapatma (K-508): dönüş anı ve sonuç; sonra ziyaret değişmez. `If-Match`. */
export function dischargeVisitCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: VISITS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.visit_discharge',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await versionedVisit(tx, ctx, id, expectedVersion)
        const parsed = infirmaryDischargeSchema.parse(input)
        const health = visitHealthOf(deps, ctx.institutionId, row)
        return {
          run: () => ({
            parsed,
            row,
            plan: planInfirmaryDischarge(
              { status: row.status, arrivedAt: row.arrivedAt, health },
              parsed,
              ctx.now,
            ),
          }),
        }
      },
      after: async (tx, { parsed, row, plan }) => {
        const health = deps.cipher.encrypt(
          visitBinding(ctx.institutionId, row),
          JSON.stringify(plan.health),
        )
        const saved = await closeVisit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          returnedAt: plan.returnedAt,
          outcome: parsed.outcome,
          healthCiphertext: health.ciphertext,
          healthKeyVersion: health.keyVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.infirmary.visit_discharge', entity, plan.changed)
        body = { data: await visitDetail(tx, ctx, deps, await visitOf(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- İlaç talebi görünümü ------------------------------------------------------------------------

/** Talep görünümünde dönen sağlık alanları; okuma denetimine alan adları olarak yazılır. */
const CONSENT_HEALTH_FIELDS = ['medicationName', 'dose', 'note', 'rejectionReason']

async function consentViews(
  db: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  rows: readonly StoredConsent[],
) {
  const names = await studentNames(
    db,
    ctx,
    rows.map((row) => row.studentId),
  )
  return rows.map((row) => {
    const health = consentHealthOf(deps, ctx.institutionId, row)
    return {
      id: row.id,
      studentId: row.studentId,
      studentName: names.get(row.studentId) ?? null,
      status: row.status,
      medicationName: health.medicationName,
      dose: health.dose,
      times: row.doseTimes,
      startDate: row.startDate,
      endDate: row.endDate,
      note: health.note,
      requestedByName: row.requestedByName,
      decidedAt: row.decidedAt,
      decidedByName: row.decidedByName,
      rejectionReason: rejectionOf(deps, ctx.institutionId, row),
      withdrawnAt: row.withdrawnAt,
      createdAt: row.createdAt,
      version: row.version,
    }
  })
}

function administrationView(
  deps: InfirmaryDeps,
  institutionId: string,
  item: StoredAdministration,
) {
  const health = administrationHealthSchema.parse(
    JSON.parse(
      deps.cipher.decrypt(administrationBinding(institutionId, item), {
        ciphertext: item.healthCiphertext,
        keyVersion: item.healthKeyVersion,
      }),
    ),
  )
  return {
    id: item.id,
    doseDay: item.doseDay,
    scheduledTime: item.scheduledTime,
    administeredAt: item.administeredAt,
    administeredByMembershipId: item.administeredByMembershipId,
    administeredByName: item.administeredByName,
    dose: health.dose,
    note: health.note,
    createdAt: item.createdAt,
  }
}

async function consentDetail(
  db: Database,
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  row: StoredConsent,
) {
  const [view] = await consentViews(db, ctx, deps, [row])
  if (view === undefined) throw new NotFoundError()
  const administrations = await loadAdministrations(db, ctx.institutionId, [row.id])
  return {
    ...view,
    administrations: (administrations.get(row.id) ?? []).map((item) =>
      administrationView(deps, ctx.institutionId, item),
    ),
  }
}

/** Okunabilen talep: yoksa, başka kurumunsa ya da velinin kapsamında değilse 404. */
async function readableConsent(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  children: ReadonlySet<string> | null,
) {
  const row = await findConsent(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  if (children !== null && !children.has(row.studentId)) throw new NotFoundError()
  return row
}

/** Velide kapsamdaki çocuklar, okulda `null` (kısıt yok). İşlemden önce okunur. */
async function childrenFor(ctx: ServiceContext): Promise<ReadonlySet<string> | null> {
  return ctx.actor.role === 'veli' ? new Set(await guardianChildren(ctx)) : null
}

// --- İlaç talebi okuma ---------------------------------------------------------------------------

/**
 * Talep listesi: okul bütün talepleri, veli kapsamdaki çocuklarınınkini görür. Satır ilaç adı ve doz
 * taşıdığından her dönen talep `finance.infirmary.consent_read` denetimine düşer.
 */
export async function listConsentsFor(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  query: {
    page: number
    pageSize: number
    status?: ConsentStatus | undefined
    studentId?: string | undefined
  },
) {
  const children = await childrenFor(ctx)
  return ctx.db.transaction(async (tx) => {
    const studentIds =
      children === null
        ? query.studentId === undefined
          ? undefined
          : [query.studentId]
        : [...children].filter((id) => query.studentId === undefined || id === query.studentId)
    const { items, total } = await listConsents(tx, ctx.institutionId, {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      studentIds,
    })
    const data = await consentViews(tx, ctx, deps, items)
    for (const row of items)
      await auditWork(
        tx,
        ctx,
        'finance.infirmary.consent_read',
        { type: CONSENTS, id: row.id },
        CONSENT_HEALTH_FIELDS,
      )
    return { items: data, total }
  })
}

/** Talep ayrıntısı ve uygulamaları; okuma `finance.infirmary.consent_read`. */
export async function getConsentFor(ctx: ServiceContext, deps: InfirmaryDeps, id: string) {
  const children = await childrenFor(ctx)
  return ctx.db.transaction(async (tx) => {
    const row = await readableConsent(tx, ctx, id, children)
    const body = await consentDetail(tx, ctx, deps, row)
    await auditWork(tx, ctx, 'finance.infirmary.consent_read', { type: CONSENTS, id }, [
      ...CONSENT_HEALTH_FIELDS,
      'administrations',
    ])
    return body
  })
}

/**
 * Gün planı (K-509): günü kapsayan onaylı taleplerin her doz saati ve o günkü uygulaması. Her
 * talep `finance.infirmary.schedule_read` denetimine düşer.
 */
export function getMedicationScheduleFor(ctx: ServiceContext, deps: InfirmaryDeps, day: string) {
  return ctx.db.transaction(async (tx) => {
    const consents = await listApprovedConsentsOn(tx, ctx.institutionId, day)
    const [views, given] = await Promise.all([
      consentViews(tx, ctx, deps, consents),
      loadAdministrations(
        tx,
        ctx.institutionId,
        consents.map((row) => row.id),
        day,
      ),
    ])
    const slots = medicationScheduleSlots(
      views.map((view) => ({ ...view, times: view.times })),
      day,
    ).map(({ consent, scheduledTime }) => {
      const done = (given.get(consent.id) ?? []).find(
        (item) => item.scheduledTime === scheduledTime,
      )
      return {
        consentId: consent.id,
        consentVersion: consent.version,
        studentId: consent.studentId,
        studentName: consent.studentName,
        medicationName: consent.medicationName,
        dose: consent.dose,
        scheduledTime,
        administration:
          done === undefined
            ? null
            : {
                id: done.id,
                administeredAt: done.administeredAt,
                administeredByName: done.administeredByName,
              },
      }
    })
    for (const row of consents)
      await auditWork(tx, ctx, 'finance.infirmary.schedule_read', { type: CONSENTS, id: row.id }, [
        'medicationName',
        'dose',
        'administrations',
      ])
    return slots
  })
}

// --- İlaç talebi yazma ---------------------------------------------------------------------------

/** Velinin ilaç talebi (K-509); `Idempotency-Key` rotada zorunlu. 201. */
export async function createConsentCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CONSENTS, id }
  const children = new Set(await guardianChildren(ctx))
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.consent_create',
      collections: [],
      entity,
      load: () => {
        const parsed = medicationConsentInputSchema.parse(input)
        return Promise.resolve({
          run: () => ({
            parsed,
            plan: planMedicationConsent(parsed, {
              now: ctx.now,
              studentInScope: children.has(parsed.studentId),
            }),
          }),
        })
      },
      after: async (tx, { parsed, plan }) => {
        const health = deps.cipher.encrypt(
          consentBinding(ctx.institutionId, { id, studentId: parsed.studentId }, 'health'),
          JSON.stringify(plan.health),
        )
        await insertConsent(tx, ctx.institutionId, {
          id,
          studentId: parsed.studentId,
          startDate: plan.startDate,
          endDate: plan.endDate,
          doseTimes: plan.times,
          healthCiphertext: health.ciphertext,
          healthKeyVersion: health.keyVersion,
          membershipId: ctx.actor.membershipId,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.infirmary.consent_create', entity, [
          'studentId',
          'medicationName',
          'dose',
          'times',
          'startDate',
          'endDate',
          ...(plan.health.note === null ? [] : ['note']),
        ])
        body = {
          data: await consentDetail(tx, ctx, deps, await readableConsent(tx, ctx, id, null)),
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

type ConsentTransition = 'approve' | 'reject' | 'withdraw'

/**
 * Onay, ret (gerekçe şifreli) ve velinin geri çekmesi (K-509); `If-Match` talep sürümü. Veli
 * yalnız kapsamındaki çocuğun talebini geri çeker (değilse 404).
 */
export async function transitionConsentCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  id: string,
  transition: ConsentTransition,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CONSENTS, id }
  const children = transition === 'withdraw' ? await childrenFor(ctx) : null
  let body: unknown
  return runCommand(
    ctx,
    {
      action: `finance.infirmary.consent_${transition}`,
      collections: [],
      entity,
      load: async (tx) => {
        const row = await readableConsent(tx, ctx, id, children)
        if (row.version !== expectedVersion) throw new ConflictError()
        const reason =
          transition === 'reject' ? medicationConsentRejectSchema.parse(input).reason : null
        return {
          run: () => {
            if (transition === 'withdraw') assertConsentWithdrawable(row.status)
            else assertConsentDecision(row, transition, ctx.now)
            return { row, reason }
          },
        }
      },
      after: async (tx, { row, reason }) => {
        const decision =
          transition === 'withdraw'
            ? undefined
            : {
                userId: ctx.actor.userId,
                ...(reason === null
                  ? { ciphertext: null, keyVersion: null }
                  : (() => {
                      const encrypted = deps.cipher.encrypt(
                        consentBinding(ctx.institutionId, row, 'decision'),
                        reason,
                      )
                      return { ciphertext: encrypted.ciphertext, keyVersion: encrypted.keyVersion }
                    })()),
              }
        const saved = await transitionConsent(tx, ctx.institutionId, {
          id,
          expectedVersion,
          from: transition === 'withdraw' ? ['pending', 'approved'] : ['pending'],
          to:
            transition === 'approve'
              ? 'approved'
              : transition === 'reject'
                ? 'rejected'
                : 'withdrawn',
          decision,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          `finance.infirmary.consent_${transition}`,
          entity,
          transition === 'withdraw'
            ? ['status', 'withdrawnAt']
            : ['status', 'decidedAt', ...(reason === null ? [] : ['rejectionReason'])],
        )
        body = {
          data: await consentDetail(tx, ctx, deps, await readableConsent(tx, ctx, id, null)),
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** İlaç uygulaması (K-509): onaylı talep, onaydaki saat ve doz; aynı doz saati yinelenmez. 201. */
export function recordAdministrationCommand(
  ctx: ServiceContext,
  deps: InfirmaryDeps,
  consentId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CONSENTS, id: consentId }
  const administrationId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.infirmary.administration_create',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await readableConsent(tx, ctx, consentId, null)
        const parsed = medicationAdministrationSchema.parse(input)
        const administeredById = parsed.administeredByMembershipId ?? ctx.actor.membershipId
        // Etkin sonuç iptal ve atlamayı da sayar (DOM-FIN-152, K-512, K-513).
        const [members, slots] = await Promise.all([
          loadIncidentMembers(tx, ctx.institutionId, [administeredById]),
          loadDoseSlots(tx, ctx.institutionId, [consentId]),
        ])
        const slotOf = (day: string, time: string) => slots.get(doseSlotKey(consentId, day, time))
        const health = consentHealthOf(deps, ctx.institutionId, row)
        return {
          run: () => {
            const plan = planMedicationAdministration(
              {
                status: row.status,
                startDate: row.startDate,
                endDate: row.endDate,
                times: row.doseTimes,
              },
              health.dose,
              parsed,
              {
                now: ctx.now,
                administeredBy: members.get(administeredById) ?? null,
                alreadyGiven: (day, time) => slotOf(day, time)?.active?.kind === 'administration',
              },
            )
            const { replacesId } = assertDoseSlotOpen(
              slotOf(plan.doseDay, parsed.scheduledTime),
              'administration',
            )
            return { row, parsed, administeredById, plan, replacesId }
          },
        }
      },
      after: async (tx, { row, parsed, administeredById, plan, replacesId }) => {
        const health = deps.cipher.encrypt(
          administrationBinding(ctx.institutionId, { id: administrationId, consentId }),
          JSON.stringify(plan.health),
        )
        await insertAdministration(tx, ctx.institutionId, {
          id: administrationId,
          consentId,
          studentId: row.studentId,
          doseDay: plan.doseDay,
          scheduledTime: parsed.scheduledTime,
          administeredAt: plan.administeredAt,
          administeredByMembershipId: administeredById,
          healthCiphertext: health.ciphertext,
          healthKeyVersion: health.keyVersion,
          replacesAdministrationId: replacesId,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.infirmary.administration_create', entity, [
          'scheduledTime',
          'administeredAt',
          'administeredByMembershipId',
          'dose',
          ...(plan.health.note === null ? [] : ['note']),
        ])
        body = { data: await consentDetail(tx, ctx, deps, row) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}
