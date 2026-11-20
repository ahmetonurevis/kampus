import { randomUUID } from 'node:crypto'

import {
  assertVisitorAnonymization,
  maskVisitorPhone,
  planVisitorBadgeRelease,
  planVisitorCheckIn,
  planVisitorCheckOut,
  planVisitorSettings,
  visitorAnonymizationSchema,
  visitorBadgeReleaseSchema,
  visitorCheckInSchema,
  visitorCheckOutSchema,
  visitorOverdue,
  visitorRetentionDueOn,
  visitorSettingsSchema,
  type VisitorAnonymizationTarget,
  type VisitorBadgeRelease,
} from '@kampus/school-core/lib/finance-visitors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember, listStaffMembers } from '../db/finance-pay-rates.ts'
import {
  anonymizeVisitor,
  findVisitor,
  insertVisitor,
  listRetentionDueVisitors,
  listVisitors,
  loadVisitorSettings,
  loadVisitorsByIds,
  memberNames,
  outstandingBadges,
  saveVisitorSettings,
  updateVisitor,
  visitorCounts,
  type StoredVisitor,
  type VisitorQuery,
} from '../db/finance-visitors.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Ziyaretçi kaydı (DOM-FIN-141; ON-166; K-478…K-480). Kural core `lib/finance-visitors.ts`'tedir;
 * servis kurum kilidi altında kaydı, kart havuzunu ve ayarı yükler, tek transaction'da yazar ve
 * denetime alan adlarını düşer (ziyaretçi verisi, telefon ve açıklama yazılmaz). Telefon listede
 * yalnız maskelidir; tam telefon yalnız ayrıntıda döner ve ayrıntı okuması aynı transaction'da
 * `finance.visitor.read` denetimine düşer. Rol ve modül denetimi rotadadır; periyodik iş yoktur.
 */

const VISITOR = 'visitor_logs'
const SETTINGS = 'visitor_settings'

/** Anonimleştirmede temizlenen alanlar (K-480); denetime alan adı olarak yazılır. */
const ANONYMIZED_FIELDS = [
  'visitorName',
  'phone',
  'purposeNote',
  'studentId',
  'anonymizedAt',
  'anonymizationReason',
]
/** Ayrıntıda dönen kişisel alanlar; okuma denetimine alan adı olarak yazılır. */
const DETAIL_FIELDS = ['visitorName', 'phone', 'purposeNote', 'studentId', 'hostMembershipId']

// --- Görünüm -------------------------------------------------------------------------------------

interface Names {
  hosts: ReadonlyMap<string, string>
  students: ReadonlyMap<string, string | null>
}

async function namesOf(db: Database, ctx: ServiceContext, rows: readonly StoredVisitor[]) {
  const hostIds = rows.flatMap((row) =>
    row.hostMembershipId === null ? [] : [row.hostMembershipId],
  )
  const studentIds = [
    ...new Set(rows.flatMap((row) => (row.studentId === null ? [] : [row.studentId]))),
  ]
  const [hosts, students] = await Promise.all([
    memberNames(db, ctx.institutionId, hostIds),
    loadRecordsByIds(db, ctx.institutionId, 'students', studentIds, { includeArchived: true }),
  ])
  return {
    hosts,
    students: new Map(
      students.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
    ),
  } satisfies Names
}

const badgeStatusOf = (row: StoredVisitor): 'none' | 'out' | VisitorBadgeRelease =>
  row.badgeNumber === null ? 'none' : (row.badgeRelease ?? 'out')

/** Liste satırı: telefon maskeli, açıklama yok (K-478). */
function visitorRow(row: StoredVisitor, names: Names, retentionDays: number, today: string) {
  return {
    id: row.id,
    visitorName: row.visitorName,
    identityVerified: row.identityVerified,
    identityDocumentType: row.identityDocumentType,
    maskedPhone: maskVisitorPhone(row.phone),
    purpose: row.purpose,
    hostMembershipId: row.hostMembershipId,
    hostName:
      row.hostMembershipId === null ? null : (names.hosts.get(row.hostMembershipId) ?? null),
    studentId: row.studentId,
    studentName: row.studentId === null ? null : (names.students.get(row.studentId) ?? null),
    visitOn: row.visitOn,
    checkedInAt: row.checkedInAt,
    checkedOutAt: row.checkedOutAt,
    inside: row.checkedOutAt === null,
    overdue: visitorOverdue(row, today),
    badgeNumber: row.badgeNumber,
    badgeStatus: badgeStatusOf(row),
    anonymized: row.anonymizedAt !== null,
    retentionDueOn: visitorRetentionDueOn(row.visitOn, retentionDays),
    version: row.version,
  }
}

async function rowsView(db: Database, ctx: ServiceContext, rows: readonly StoredVisitor[]) {
  const [names, settings] = await Promise.all([
    namesOf(db, ctx, rows),
    loadVisitorSettings(db, ctx.institutionId),
  ])
  const today = dayKey(ctx.now)
  return rows.map((row) => visitorRow(row, names, settings.retentionDays, today))
}

async function visitorDetail(db: Database, ctx: ServiceContext, id: string) {
  const row = await findVisitor(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const [view] = await rowsView(db, ctx, [row])
  if (view === undefined) throw new NotFoundError()
  return {
    ...view,
    phone: row.phone,
    purposeNote: row.purposeNote,
    privacyNoticeVersion: row.privacyNoticeVersion,
    badgeReleasedAt: row.badgeReleasedAt,
    anonymizedAt: row.anonymizedAt,
    anonymizationReason: row.anonymizationReason,
    checkedInByUserId: row.checkedInByUserId,
    checkedOutByUserId: row.checkedOutByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listVisitorsFor(ctx: ServiceContext, query: VisitorQuery) {
  const { items, total } = await listVisitors(ctx.db, ctx.institutionId, query)
  return { items: await rowsView(ctx.db, ctx, items), total }
}

/** Ayrıntı: tam telefon ve açıklama; okuma aynı transaction'da denetime düşer (K-478). */
export function getVisitorFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const detail = await visitorDetail(tx, ctx, id)
    await auditWork(tx, ctx, 'finance.visitor.read', { type: VISITOR, id }, DETAIL_FIELDS)
    return detail
  })
}

/** Günün özeti ve kart havuzu (K-479): ziyaretçide kalan kart dolu sayılır. */
export async function visitorSummaryFor(ctx: ServiceContext) {
  const today = dayKey(ctx.now)
  const [counts, settings, outstanding] = await Promise.all([
    visitorCounts(ctx.db, ctx.institutionId, today),
    loadVisitorSettings(ctx.db, ctx.institutionId),
    outstandingBadges(ctx.db, ctx.institutionId),
  ])
  return {
    date: today,
    ...counts,
    privacyNoticeVersion: settings.privacyNoticeVersion,
    badges: settings.badgeNumbers.map((number) => ({
      number,
      visitorId: outstanding.get(number) ?? null,
    })),
  }
}

/** Ziyaret edilebilecek kişiler: kurumun etkin personeli, ada göre. */
export function listVisitorHostsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  return listStaffMembers(ctx.db, ctx.institutionId, { ...query, status: 'active' })
}

/** Saklama süresi dolan kayıtlar (K-480): en eski ziyaret günü önce. */
export async function listVisitorRetentionFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) {
  const settings = await loadVisitorSettings(ctx.db, ctx.institutionId)
  const { items, total } = await listRetentionDueVisitors(ctx.db, ctx.institutionId, {
    ...query,
    retentionDays: settings.retentionDays,
    today: dayKey(ctx.now),
  })
  return {
    items: await rowsView(ctx.db, ctx, items),
    total,
    retentionDays: settings.retentionDays,
  }
}

export function visitorSettingsFor(ctx: ServiceContext) {
  return loadVisitorSettings(ctx.db, ctx.institutionId)
}

// --- Yazma ---------------------------------------------------------------------------------------

async function studentExists(tx: Database, ctx: ServiceContext, studentId: string | null) {
  if (studentId === null) return undefined
  const rows = await loadRecordsByIds(tx, ctx.institutionId, 'students', [studentId])
  return rows.length > 0
}

/**
 * Giriş (K-478, K-479): kart havuzu ve kartın açık kaydı kurum kilidi altında okunur; ziyaret
 * edilen kişi ve öğrenci doğrulanır. Denetime alan adları (ziyaretçi verisi değil).
 * `Idempotency-Key` rotada zorunlu. 201.
 */
export function checkInVisitorCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: VISITOR, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.visitor.check_in',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = visitorCheckInSchema.parse(input)
        const [settings, outstanding, host, student] = await Promise.all([
          loadVisitorSettings(tx, ctx.institutionId),
          outstandingBadges(tx, ctx.institutionId),
          parsed.hostMembershipId === null
            ? Promise.resolve(undefined)
            : findStaffMember(tx, ctx.institutionId, parsed.hostMembershipId),
          studentExists(tx, ctx, parsed.studentId),
        ])
        return {
          run: () => ({
            parsed,
            plan: planVisitorCheckIn(parsed, {
              now: ctx.now,
              host,
              studentExists: student,
              badgePool: settings.badgeNumbers,
              badgeInUse: parsed.badgeNumber !== null && outstanding.has(parsed.badgeNumber),
            }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        await insertVisitor(tx, ctx.institutionId, {
          id,
          visitorName: parsed.visitorName,
          identityVerified: parsed.identityVerified,
          identityDocumentType: parsed.identityDocumentType,
          phone: parsed.phone,
          purpose: parsed.purpose,
          purposeNote: parsed.purposeNote,
          hostMembershipId: parsed.hostMembershipId,
          studentId: parsed.studentId,
          visitOn: plan.visitOn,
          checkedInAt: plan.checkedInAt,
          badgeNumber: parsed.badgeNumber,
          privacyNoticeVersion: parsed.privacyNoticeVersion,
          checkedInByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.visitor.check_in', entity, [
          ...Object.keys(parsed).filter(
            (key) => key !== 'checkedInAt' && parsed[key as keyof typeof parsed] !== null,
          ),
          'checkedInAt',
          'visitOn',
        ])
        body = { data: await visitorDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Çıkış (K-479): kart iade edildiyse aynı anda kapanır. `If-Match` kayıt sürümü. */
export function checkOutVisitorCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: VISITOR, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.visitor.check_out',
      collections: [],
      entity,
      load: async (tx) => {
        const visitor = await findVisitor(tx, ctx.institutionId, id)
        if (visitor === null) throw new NotFoundError()
        if (visitor.version !== expectedVersion) throw new ConflictError()
        const parsed = visitorCheckOutSchema.parse(input)
        return { run: () => planVisitorCheckOut(visitor, parsed, ctx.now) }
      },
      after: async (tx, plan) => {
        const saved = await updateVisitor(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            checkedOutAt: new Date(plan.checkedOutAt),
            checkedOutByUserId: ctx.actor.userId,
            ...(plan.badgeRelease === null
              ? {}
              : { badgeReleasedAt: ctx.now, badgeRelease: plan.badgeRelease }),
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.visitor.check_out',
          entity,
          plan.badgeRelease === null
            ? ['checkedOutAt']
            : ['checkedOutAt', 'badgeReleasedAt', 'badgeRelease'],
        )
        body = { data: await visitorDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Kart iadesi ya da kayıp (K-479): kart havuzda serbest kalır. `If-Match` kayıt sürümü. */
export function releaseVisitorBadgeCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: VISITOR, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.visitor.badge_release',
      collections: [],
      entity,
      load: async (tx) => {
        const visitor = await findVisitor(tx, ctx.institutionId, id)
        if (visitor === null) throw new NotFoundError()
        if (visitor.version !== expectedVersion) throw new ConflictError()
        const parsed = visitorBadgeReleaseSchema.parse(input)
        return { run: () => planVisitorBadgeRelease(visitor, parsed) }
      },
      after: async (tx, outcome) => {
        const saved = await updateVisitor(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { badgeReleasedAt: ctx.now, badgeRelease: outcome },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.visitor.badge_release', entity, [
          'badgeReleasedAt',
          'badgeRelease',
        ])
        body = { data: await visitorDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Toplu anonimleştirme (K-480): seçilen kayıtların hepsi kurala uymalı, biri reddedilirse hiçbiri
 * değişmez. Kayıt başına `finance.visitor.anonymize` denetimi. Taze oturum ve `Idempotency-Key`
 * rotada zorunlu.
 */
export function anonymizeVisitorsCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: VISITOR, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.visitor.anonymize',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = visitorAnonymizationSchema.parse(input)
        const [rows, settings] = await Promise.all([
          loadVisitorsByIds(tx, ctx.institutionId, parsed.visitorIds),
          loadVisitorSettings(tx, ctx.institutionId),
        ])
        const found = new Map<string, VisitorAnonymizationTarget & { row: StoredVisitor }>(
          rows.map((row) => [
            row.id,
            {
              id: row.id,
              visitOn: row.visitOn,
              checkedOutAt: row.checkedOutAt,
              anonymizedAt: row.anonymizedAt,
              row,
            },
          ]),
        )
        return {
          run: () => {
            assertVisitorAnonymization(parsed, found, {
              retentionDays: settings.retentionDays,
              today: dayKey(ctx.now),
            })
            return { parsed, found }
          },
        }
      },
      after: async (tx, { parsed, found }) => {
        for (const visitorId of parsed.visitorIds) {
          const target = found.get(visitorId)
          if (target === undefined) throw new NotFoundError()
          const saved = await anonymizeVisitor(tx, ctx.institutionId, {
            id: visitorId,
            expectedVersion: target.row.version,
            reason: parsed.reason,
            now: ctx.now,
          })
          if (!saved) throw new ConflictError()
          await auditWork(
            tx,
            ctx,
            'finance.visitor.anonymize',
            { type: VISITOR, id: visitorId },
            ANONYMIZED_FIELDS,
          )
        }
        body = { data: { anonymizedCount: parsed.visitorIds.length, reason: parsed.reason } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Ayar (K-479, K-480): gönderilmeyen alan korunur; `If-Match` ayar sürümü (hiç yoksa 1). */
export function setVisitorSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.visitor.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = visitorSettingsSchema.parse(input)
        const [current, outstanding] = await Promise.all([
          loadVisitorSettings(tx, ctx.institutionId),
          outstandingBadges(tx, ctx.institutionId),
        ])
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planVisitorSettings(current, parsed, [...outstanding.keys()]) }
      },
      after: async (tx, plan) => {
        const saved = await saveVisitorSettings(tx, ctx.institutionId, {
          ...plan.next,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.visitor.settings', entity, plan.changed)
        body = { data: await loadVisitorSettings(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
