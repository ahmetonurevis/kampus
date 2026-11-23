import { and, asc, count, desc, eq, gte, inArray, lt, lte, type SQL } from 'drizzle-orm'

import type {
  ConsentStatus,
  VisitOutcome,
  VisitStatus,
} from '@kampus/school-core/lib/finance-infirmary.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  infirmaryMedicationAdministrations,
  infirmaryMedicationConsents,
  infirmaryVisits,
} from './schema/finance-infirmary.ts'

/**
 * Revir ve ilaç onayı deposu (DOM-FIN-151; ON-101). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-infirmary.ts`'tedir; şifreleme ve çözme servistedir, depo
 * şifreli değeri olduğu gibi okur ve yazar. Kapanan ziyareti, kapanan talebi ve uygulamayı
 * tetikleyici korur.
 */

const v = infirmaryVisits
const c = infirmaryMedicationConsents
const a = infirmaryMedicationAdministrations

const iso = (value: Date) => value.toISOString()
const isoOrNull = (value: Date | null) => (value === null ? null : value.toISOString())

// --- Ziyaret -------------------------------------------------------------------------------------

export interface StoredVisit {
  id: string
  studentId: string
  status: VisitStatus
  arrivedAt: string
  returnedAt: string | null
  outcome: VisitOutcome | null
  referredByMembershipId: string | null
  incidentReportId: string | null
  healthCiphertext: string
  healthKeyVersion: number
  createdByUserId: string
  closedByUserId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const VISIT_COLUMNS = {
  id: v.id,
  studentId: v.studentId,
  status: v.status,
  arrivedAt: v.arrivedAt,
  returnedAt: v.returnedAt,
  outcome: v.outcome,
  referredByMembershipId: v.referredByMembershipId,
  incidentReportId: v.incidentReportId,
  healthCiphertext: v.healthCiphertext,
  healthKeyVersion: v.healthKeyVersion,
  createdByUserId: v.createdByUserId,
  closedByUserId: v.closedByUserId,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
  version: v.version,
}

type VisitRow = Omit<StoredVisit, 'arrivedAt' | 'returnedAt' | 'createdAt' | 'updatedAt'> & {
  arrivedAt: Date
  returnedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toVisit = (row: VisitRow): StoredVisit => ({
  ...row,
  arrivedAt: iso(row.arrivedAt),
  returnedAt: isoOrNull(row.returnedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

/** Ziyaret; başka kurumun ya da olmayan ziyaret `null`. */
export async function findVisit(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredVisit | null> {
  const [row] = await db
    .select(VISIT_COLUMNS)
    .from(v)
    .where(and(eq(v.institutionId, institutionId), eq(v.id, id)))
    .limit(1)
  return row === undefined ? null : toVisit(row)
}

/** Öğrencinin açık ziyareti var mı (tek açık ziyaret kuralı, K-508). */
export async function hasOpenVisit(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: v.id })
    .from(v)
    .where(
      and(eq(v.institutionId, institutionId), eq(v.studentId, studentId), eq(v.status, 'open')),
    )
    .limit(1)
  return row !== undefined
}

export interface VisitListQuery {
  page: number
  pageSize: number
  status?: VisitStatus | undefined
  /** Yalnız bu öğrenciler (veli ve öğretmen kapsamı); boş dizi boş sonuç verir. */
  studentIds?: readonly string[] | undefined
  /** Europe/Istanbul gün sınırlarının UTC anları (`from` dahil, `to` hariç). */
  fromAt?: Date | undefined
  toAt?: Date | undefined
}

/** Ziyaret listesi: en yeni geliş önce. */
export async function listVisits(
  db: Database,
  institutionId: string,
  query: VisitListQuery,
): Promise<{ items: StoredVisit[]; total: number }> {
  if (query.studentIds !== undefined && query.studentIds.length === 0)
    return { items: [], total: 0 }
  const filters: (SQL | undefined)[] = [
    eq(v.institutionId, institutionId),
    query.status === undefined ? undefined : eq(v.status, query.status),
    query.studentIds === undefined
      ? undefined
      : inArray(v.studentId, [...new Set(query.studentIds)]),
    query.fromAt === undefined ? undefined : gte(v.arrivedAt, query.fromAt),
    query.toAt === undefined ? undefined : lt(v.arrivedAt, query.toAt),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(v).where(where)
  const rows = await db
    .select(VISIT_COLUMNS)
    .from(v)
    .where(where)
    .orderBy(desc(v.arrivedAt), asc(v.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toVisit), total: totalRow?.total ?? 0 }
}

export interface VisitColumns {
  arrivedAt: string
  referredByMembershipId: string | null
  incidentReportId: string | null
  healthCiphertext: string
  healthKeyVersion: number
}

export async function insertVisit(
  tx: Database,
  institutionId: string,
  input: { id: string; studentId: string; columns: VisitColumns; userId: string; now: Date },
): Promise<void> {
  const { columns, now } = input
  await tx.insert(v).values({
    institutionId,
    id: input.id,
    studentId: input.studentId,
    ...columns,
    arrivedAt: new Date(columns.arrivedAt),
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Açık ziyaret düzeltmesi; sürüm tutmazsa ya da ziyaret kapandıysa `false` (409). */
export async function updateVisit(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; columns: VisitColumns; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(v)
    .set({
      ...input.columns,
      arrivedAt: new Date(input.columns.arrivedAt),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(v.institutionId, institutionId),
        eq(v.id, input.id),
        eq(v.status, 'open'),
        eq(v.version, input.expectedVersion),
      ),
    )
    .returning({ id: v.id })
  return rows.length === 1
}

/** Ziyareti kapatma; sürüm tutmazsa ya da ziyaret kapandıysa `false` (409). */
export async function closeVisit(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    returnedAt: string
    outcome: VisitOutcome
    healthCiphertext: string
    healthKeyVersion: number
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(v)
    .set({
      status: 'closed',
      returnedAt: new Date(input.returnedAt),
      outcome: input.outcome,
      healthCiphertext: input.healthCiphertext,
      healthKeyVersion: input.healthKeyVersion,
      closedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(v.institutionId, institutionId),
        eq(v.id, input.id),
        eq(v.status, 'open'),
        eq(v.version, input.expectedVersion),
      ),
    )
    .returning({ id: v.id })
  return rows.length === 1
}

/** Öğrencilerin bir Europe/Istanbul gününe düşen ziyaretleri (öğretmen durum görünümü). */
export async function listVisitStates(
  db: Database,
  institutionId: string,
  query: { studentIds?: readonly string[] | undefined; fromAt: Date; toAt: Date },
): Promise<
  {
    id: string
    studentId: string
    status: VisitStatus
    arrivedAt: string
    returnedAt: string | null
  }[]
> {
  if (query.studentIds !== undefined && query.studentIds.length === 0) return []
  const rows = await db
    .select({
      id: v.id,
      studentId: v.studentId,
      status: v.status,
      arrivedAt: v.arrivedAt,
      returnedAt: v.returnedAt,
    })
    .from(v)
    .where(
      and(
        eq(v.institutionId, institutionId),
        query.studentIds === undefined
          ? undefined
          : inArray(v.studentId, [...new Set(query.studentIds)]),
        gte(v.arrivedAt, query.fromAt),
        lt(v.arrivedAt, query.toAt),
      ),
    )
    .orderBy(desc(v.arrivedAt), asc(v.id))
    .limit(500)
  return rows.map((row) => ({
    ...row,
    arrivedAt: iso(row.arrivedAt),
    returnedAt: isoOrNull(row.returnedAt),
  }))
}

// --- İlaç talebi ---------------------------------------------------------------------------------

export interface StoredConsent {
  id: string
  studentId: string
  status: ConsentStatus
  startDate: string
  endDate: string
  doseTimes: string[]
  healthCiphertext: string
  healthKeyVersion: number
  requestedByMembershipId: string
  requestedByUserId: string
  requestedByName: string | null
  decidedAt: string | null
  decidedByUserId: string | null
  decidedByName: string | null
  decisionCiphertext: string | null
  decisionKeyVersion: number | null
  withdrawnAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const requester = users
const CONSENT_COLUMNS = {
  id: c.id,
  studentId: c.studentId,
  status: c.status,
  startDate: c.startDate,
  endDate: c.endDate,
  doseTimes: c.doseTimes,
  healthCiphertext: c.healthCiphertext,
  healthKeyVersion: c.healthKeyVersion,
  requestedByMembershipId: c.requestedByMembershipId,
  requestedByUserId: c.requestedByUserId,
  requestedByName: requester.name,
  decidedAt: c.decidedAt,
  decidedByUserId: c.decidedByUserId,
  decisionCiphertext: c.decisionCiphertext,
  decisionKeyVersion: c.decisionKeyVersion,
  withdrawnAt: c.withdrawnAt,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  version: c.version,
}

type ConsentRow = Omit<
  StoredConsent,
  'decidedAt' | 'withdrawnAt' | 'createdAt' | 'updatedAt' | 'decidedByName'
> & {
  decidedAt: Date | null
  withdrawnAt: Date | null
  createdAt: Date
  updatedAt: Date
}

async function withDeciderNames(db: Database, rows: readonly ConsentRow[]) {
  const ids = [
    ...new Set(rows.flatMap((row) => (row.decidedByUserId === null ? [] : [row.decidedByUserId]))),
  ]
  const names =
    ids.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, ids))
          ).map((row) => [row.id, row.name]),
        )
  return rows.map((row): StoredConsent => ({
    ...row,
    decidedByName: row.decidedByUserId === null ? null : (names.get(row.decidedByUserId) ?? null),
    decidedAt: isoOrNull(row.decidedAt),
    withdrawnAt: isoOrNull(row.withdrawnAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }))
}

const consentSelect = (db: Database) =>
  db.select(CONSENT_COLUMNS).from(c).leftJoin(requester, eq(requester.id, c.requestedByUserId))

/** Talep; başka kurumun ya da olmayan talep `null`. */
export async function findConsent(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredConsent | null> {
  const rows = await consentSelect(db)
    .where(and(eq(c.institutionId, institutionId), eq(c.id, id)))
    .limit(1)
  const [row] = await withDeciderNames(db, rows)
  return row ?? null
}

export interface ConsentListQuery {
  page: number
  pageSize: number
  status?: ConsentStatus | undefined
  /** Yalnız bu öğrenciler (veli kapsamı); boş dizi boş sonuç verir. */
  studentIds?: readonly string[] | undefined
}

/** Talep listesi: en yeni talep önce. */
export async function listConsents(
  db: Database,
  institutionId: string,
  query: ConsentListQuery,
): Promise<{ items: StoredConsent[]; total: number }> {
  if (query.studentIds !== undefined && query.studentIds.length === 0)
    return { items: [], total: 0 }
  const where = and(
    eq(c.institutionId, institutionId),
    query.status === undefined ? undefined : eq(c.status, query.status),
    query.studentIds === undefined
      ? undefined
      : inArray(c.studentId, [...new Set(query.studentIds)]),
  )
  const [totalRow] = await db.select({ total: count() }).from(c).where(where)
  const rows = await consentSelect(db)
    .where(where)
    .orderBy(desc(c.createdAt), asc(c.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: await withDeciderNames(db, rows), total: totalRow?.total ?? 0 }
}

/** Günü kapsayan onaylı talepler (gün planı, K-509). */
export async function listApprovedConsentsOn(
  db: Database,
  institutionId: string,
  day: string,
): Promise<StoredConsent[]> {
  const rows = await consentSelect(db)
    .where(
      and(
        eq(c.institutionId, institutionId),
        eq(c.status, 'approved'),
        lte(c.startDate, day),
        gte(c.endDate, day),
      ),
    )
    .orderBy(asc(c.studentId), asc(c.id))
    .limit(500)
  return withDeciderNames(db, rows)
}

export async function insertConsent(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    studentId: string
    startDate: string
    endDate: string
    doseTimes: readonly string[]
    healthCiphertext: string
    healthKeyVersion: number
    membershipId: string
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(c).values({
    institutionId,
    id: input.id,
    studentId: input.studentId,
    startDate: input.startDate,
    endDate: input.endDate,
    doseTimes: [...input.doseTimes],
    healthCiphertext: input.healthCiphertext,
    healthKeyVersion: input.healthKeyVersion,
    requestedByMembershipId: input.membershipId,
    requestedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Onay, ret ya da geri çekme; sürüm ya da beklenen durum tutmazsa `false` (409). */
export async function transitionConsent(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    from: readonly ConsentStatus[]
    to: ConsentStatus
    decision?: { userId: string; ciphertext: string | null; keyVersion: number | null } | undefined
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(c)
    .set({
      status: input.to,
      ...(input.decision === undefined
        ? {}
        : {
            decidedAt: input.now,
            decidedByUserId: input.decision.userId,
            decisionCiphertext: input.decision.ciphertext,
            decisionKeyVersion: input.decision.keyVersion,
          }),
      ...(input.to === 'withdrawn' ? { withdrawnAt: input.now } : {}),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(c.institutionId, institutionId),
        eq(c.id, input.id),
        inArray(c.status, [...input.from]),
        eq(c.version, input.expectedVersion),
      ),
    )
    .returning({ id: c.id })
  return rows.length === 1
}

// --- Uygulama ------------------------------------------------------------------------------------

export interface StoredAdministration {
  id: string
  consentId: string
  studentId: string
  doseDay: string
  scheduledTime: string
  administeredAt: string
  administeredByMembershipId: string
  administeredByName: string | null
  healthCiphertext: string
  healthKeyVersion: number
  createdAt: string
}

/** Taleplerin uygulamaları (en eski önce); isteğe bağlı tek gün. */
export async function loadAdministrations(
  db: Database,
  institutionId: string,
  consentIds: readonly string[],
  day?: string,
): Promise<Map<string, StoredAdministration[]>> {
  const map = new Map<string, StoredAdministration[]>()
  if (consentIds.length === 0) return map
  const rows = await db
    .select({
      id: a.id,
      consentId: a.consentId,
      studentId: a.studentId,
      doseDay: a.doseDay,
      scheduledTime: a.scheduledTime,
      administeredAt: a.administeredAt,
      administeredByMembershipId: a.administeredByMembershipId,
      administeredByName: users.name,
      healthCiphertext: a.healthCiphertext,
      healthKeyVersion: a.healthKeyVersion,
      createdAt: a.createdAt,
    })
    .from(a)
    .leftJoin(
      memberships,
      and(
        eq(memberships.institutionId, a.institutionId),
        eq(memberships.id, a.administeredByMembershipId),
      ),
    )
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(a.institutionId, institutionId),
        inArray(a.consentId, [...new Set(consentIds)]),
        day === undefined ? undefined : eq(a.doseDay, day),
      ),
    )
    .orderBy(asc(a.consentId), asc(a.administeredAt), asc(a.id))
  for (const row of rows)
    map.set(row.consentId, [
      ...(map.get(row.consentId) ?? []),
      { ...row, administeredAt: iso(row.administeredAt), createdAt: iso(row.createdAt) },
    ])
  return map
}

export async function insertAdministration(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    consentId: string
    studentId: string
    doseDay: string
    scheduledTime: string
    administeredAt: string
    administeredByMembershipId: string
    healthCiphertext: string
    healthKeyVersion: number
    /** İptal edilen aynı doz saati uygulamasının yerine geçiyorsa onun kimliği (DOM-FIN-152). */
    replacesAdministrationId?: string | null
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(a).values({
    institutionId,
    id: input.id,
    consentId: input.consentId,
    studentId: input.studentId,
    doseDay: input.doseDay,
    scheduledTime: input.scheduledTime,
    administeredAt: new Date(input.administeredAt),
    administeredByMembershipId: input.administeredByMembershipId,
    recordedByUserId: input.userId,
    healthCiphertext: input.healthCiphertext,
    healthKeyVersion: input.healthKeyVersion,
    replacesAdministrationId: input.replacesAdministrationId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  })
}
