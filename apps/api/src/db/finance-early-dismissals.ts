import { and, asc, count, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm'

import {
  EARLY_DISMISSAL_ACTIVE_STATUSES,
  type EarlyDismissalPickupKind,
  type EarlyDismissalReason,
  type EarlyDismissalSource,
  type EarlyDismissalStatus,
  type PickupRelationship,
} from '@kampus/school-core/lib/finance-early-dismissals.ts'

import type { Database } from './client.ts'
import { earlyDismissals } from './schema/finance-early-dismissals.ts'

/**
 * Erken çıkış deposu (DOM-FIN-161; ON-168). Kurum kapsamlıdır: ilk parametre `institutionId`. Kural
 * core `lib/finance-early-dismissals.ts`'tedir; depo yalnız okur ve sürüm koşuluyla yazar. Kayıt
 * silinmez; durumla kapanır.
 */

export interface StoredEarlyDismissal {
  id: string
  studentId: string
  classId: string | null
  dismissalOn: string
  plannedAt: string
  reason: EarlyDismissalReason
  reasonNote: string | null
  pickupKind: EarlyDismissalPickupKind
  pickupGuardianLinkId: string | null
  pickupName: string | null
  pickupIdLast4: string | null
  pickupRelationship: PickupRelationship | null
  status: EarlyDismissalStatus
  source: EarlyDismissalSource
  requestedByUserId: string
  decidedAt: string | null
  decidedByUserId: string | null
  rejectionReason: string | null
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  releasedAt: string | null
  releasedByUserId: string | null
  releasedToKind: EarlyDismissalPickupKind | null
  releasedToGuardianLinkId: string | null
  releasedToName: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const COLUMNS = {
  id: earlyDismissals.id,
  studentId: earlyDismissals.studentId,
  classId: earlyDismissals.classId,
  dismissalOn: earlyDismissals.dismissalOn,
  plannedAt: earlyDismissals.plannedAt,
  reason: earlyDismissals.reason,
  reasonNote: earlyDismissals.reasonNote,
  pickupKind: earlyDismissals.pickupKind,
  pickupGuardianLinkId: earlyDismissals.pickupGuardianLinkId,
  pickupName: earlyDismissals.pickupName,
  pickupIdLast4: earlyDismissals.pickupIdLast4,
  pickupRelationship: earlyDismissals.pickupRelationship,
  status: earlyDismissals.status,
  source: earlyDismissals.source,
  requestedByUserId: earlyDismissals.requestedByUserId,
  decidedAt: earlyDismissals.decidedAt,
  decidedByUserId: earlyDismissals.decidedByUserId,
  rejectionReason: earlyDismissals.rejectionReason,
  cancelledAt: earlyDismissals.cancelledAt,
  cancelledByUserId: earlyDismissals.cancelledByUserId,
  cancelReason: earlyDismissals.cancelReason,
  releasedAt: earlyDismissals.releasedAt,
  releasedByUserId: earlyDismissals.releasedByUserId,
  releasedToKind: earlyDismissals.releasedToKind,
  releasedToGuardianLinkId: earlyDismissals.releasedToGuardianLinkId,
  releasedToName: earlyDismissals.releasedToName,
  createdAt: earlyDismissals.createdAt,
  updatedAt: earlyDismissals.updatedAt,
  version: earlyDismissals.version,
}
type Instant = 'plannedAt' | 'decidedAt' | 'cancelledAt' | 'releasedAt' | 'createdAt' | 'updatedAt'
type Row = Omit<StoredEarlyDismissal, Instant> & {
  plannedAt: Date
  decidedAt: Date | null
  cancelledAt: Date | null
  releasedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toDismissal = (row: Row): StoredEarlyDismissal => ({
  ...row,
  plannedAt: row.plannedAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  releasedAt: row.releasedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
const ofInstitution = (institutionId: string) => eq(earlyDismissals.institutionId, institutionId)

export async function findEarlyDismissal(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredEarlyDismissal | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(earlyDismissals)
    .where(and(ofInstitution(institutionId), eq(earlyDismissals.id, id)))
    .limit(1)
  return row === undefined ? null : toDismissal(row)
}

/** Öğrencinin o gün açık (bekleyen, onaylı ya da teslim edilmiş) talebi var mı. */
export async function activeDismissalExists(
  db: Database,
  institutionId: string,
  studentId: string,
  day: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: earlyDismissals.id })
    .from(earlyDismissals)
    .where(
      and(
        ofInstitution(institutionId),
        eq(earlyDismissals.studentId, studentId),
        eq(earlyDismissals.dismissalOn, day),
        inArray(earlyDismissals.status, [...EARLY_DISMISSAL_ACTIVE_STATUSES]),
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface EarlyDismissalQuery {
  page: number
  pageSize: number
  /** Çıkış günü (Europe/Istanbul). */
  date?: string | undefined
  status?: EarlyDismissalStatus | undefined
  classId?: string | undefined
  /** Yalnız bu öğrenciler (veli kapsamı; sınıf kapsamı `classIds`). */
  studentIds?: readonly string[] | undefined
  classIds?: readonly string[] | undefined
  /** Bu günden itibaren (veli listesi). */
  fromDate?: string | undefined
}

/**
 * Talepler: gün ve planlanan saat sırasıyla; günsüz listede en yeni gün önce. Öğrenci ya da sınıf
 * kapsamı verilirse boş küme hiçbir satır döndürmez.
 */
export async function listEarlyDismissals(
  db: Database,
  institutionId: string,
  query: EarlyDismissalQuery,
): Promise<{ items: StoredEarlyDismissal[]; total: number }> {
  if (query.studentIds?.length === 0 || query.classIds?.length === 0) return { items: [], total: 0 }
  const filters: (SQL | undefined)[] = [
    ofInstitution(institutionId),
    query.date === undefined ? undefined : eq(earlyDismissals.dismissalOn, query.date),
    query.fromDate === undefined ? undefined : gte(earlyDismissals.dismissalOn, query.fromDate),
    query.status === undefined ? undefined : eq(earlyDismissals.status, query.status),
    query.classId === undefined ? undefined : eq(earlyDismissals.classId, query.classId),
    query.studentIds === undefined
      ? undefined
      : inArray(earlyDismissals.studentId, [...query.studentIds]),
    query.classIds === undefined
      ? undefined
      : inArray(earlyDismissals.classId, [...query.classIds]),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(earlyDismissals).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(earlyDismissals)
    .where(where)
    .orderBy(
      ...(query.date === undefined
        ? [desc(earlyDismissals.dismissalOn), asc(earlyDismissals.plannedAt)]
        : [asc(earlyDismissals.plannedAt)]),
      asc(earlyDismissals.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toDismissal), total: totalRow?.total ?? 0 }
}

export async function insertEarlyDismissal(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    studentId: string
    classId: string | null
    dismissalOn: string
    plannedAt: string
    reason: EarlyDismissalReason
    reasonNote: string | null
    pickupKind: EarlyDismissalPickupKind
    pickupGuardianLinkId: string | null
    pickupName: string | null
    pickupIdLast4: string | null
    pickupRelationship: PickupRelationship | null
    status: 'pending' | 'approved'
    source: EarlyDismissalSource
    requestedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, plannedAt, ...fields } = input
  const decided = input.status === 'approved'
  await tx.insert(earlyDismissals).values({
    ...fields,
    institutionId,
    plannedAt: new Date(plannedAt),
    decidedAt: decided ? now : null,
    decidedByUserId: decided ? input.requestedByUserId : null,
    createdAt: now,
    updatedAt: now,
  })
}

/** Karar, iptal ya da teslim yazması; sürüm tutmazsa `false` (409). */
export async function updateEarlyDismissal(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      status: EarlyDismissalStatus
      decidedAt: Date
      decidedByUserId: string
      rejectionReason: string
      cancelledAt: Date
      cancelledByUserId: string
      cancelReason: string | null
      releasedAt: Date
      releasedByUserId: string
      releasedToKind: EarlyDismissalPickupKind
      releasedToGuardianLinkId: string | null
      releasedToName: string
      releaseIdentityVerified: boolean
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(earlyDismissals)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(earlyDismissals.id, input.id),
        eq(earlyDismissals.version, input.expectedVersion),
      ),
    )
    .returning({ id: earlyDismissals.id })
  return rows.length === 1
}

/** Kurumun o günkü talepleri; yoklamaya yansıma okuması için (sayfasız, gün ölçeğinde küçük). */
export async function loadDayDismissals(
  db: Database,
  institutionId: string,
  day: string,
  statuses: readonly EarlyDismissalStatus[],
): Promise<StoredEarlyDismissal[]> {
  const rows = await db
    .select(COLUMNS)
    .from(earlyDismissals)
    .where(
      and(
        ofInstitution(institutionId),
        eq(earlyDismissals.dismissalOn, day),
        inArray(earlyDismissals.status, [...statuses]),
      ),
    )
    .orderBy(asc(earlyDismissals.plannedAt), asc(earlyDismissals.id))
  return rows.map(toDismissal)
}

/** Sayım: günün durum dağılımı (ön büro özeti). */
export async function dayStatusCounts(
  db: Database,
  institutionId: string,
  day: string,
): Promise<Record<EarlyDismissalStatus, number>> {
  const rows = await db
    .select({ status: earlyDismissals.status, total: sql<number>`count(*)::int` })
    .from(earlyDismissals)
    .where(and(ofInstitution(institutionId), eq(earlyDismissals.dismissalOn, day)))
    .groupBy(earlyDismissals.status)
  const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0, released: 0 }
  for (const row of rows) counts[row.status] = row.total
  return counts
}
