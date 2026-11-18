import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import type {
  BenefitForm,
  PayRateComponent,
  PayRateType,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffPayRates } from './schema/finance-pay-rates.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Personel ücret tanımı deposu (DOM-FIN-099; ON-194). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-pay-rates.ts`'tedir; depo yalnız okur ve yazar. İptal
 * edilmiş (arşivli) tanım okunmaz. Uçlar yalnız yöneticiye açıktır (K-306).
 */

export interface StoredPayRate {
  id: string
  membershipId: string
  component: PayRateComponent
  rateType: PayRateType
  slot: string
  amountCents: number
  currency: 'TRY'
  benefitForm: BenefitForm | null
  taxable: boolean | null
  startDate: string
  endDate: string | null
  note: string | null
  closedByRateId: string | null
  closedFromEndDate: string | null
  createdAt: string
  version: number
}

const COLUMNS = {
  id: staffPayRates.id,
  membershipId: staffPayRates.membershipId,
  component: staffPayRates.component,
  rateType: staffPayRates.rateType,
  slot: staffPayRates.slot,
  amountCents: staffPayRates.amountCents,
  currency: staffPayRates.currency,
  benefitForm: staffPayRates.benefitForm,
  taxable: staffPayRates.taxable,
  startDate: staffPayRates.startDate,
  endDate: staffPayRates.endDate,
  note: staffPayRates.note,
  closedByRateId: staffPayRates.closedByRateId,
  closedFromEndDate: staffPayRates.closedFromEndDate,
  createdAt: staffPayRates.createdAt,
  version: staffPayRates.version,
}

type Row = Omit<StoredPayRate, 'createdAt' | 'currency'> & { createdAt: Date; currency: string }
const toPayRate = (row: Row): StoredPayRate => ({
  ...row,
  currency: 'TRY',
  createdAt: row.createdAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(eq(staffPayRates.institutionId, institutionId), isNull(staffPayRates.archivedAt))

/** Yeni başlayan önce; yuva sırası bileşen ve türe göre istemcide kurulur. */
const ORDER = [asc(staffPayRates.slot), asc(staffPayRates.startDate), asc(staffPayRates.id)]

export async function findPayRate(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPayRate | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(staffPayRates)
    .where(and(ofInstitution(institutionId), eq(staffPayRates.id, id)))
    .limit(1)
  return row === undefined ? null : toPayRate(row)
}

/** Personelin iptal edilmemiş bütün tanımları (yuva ve başlangıca göre). */
export async function loadStaffPayRates(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<StoredPayRate[]> {
  if (membershipIds.length === 0) return []
  const rows = await db
    .select(COLUMNS)
    .from(staffPayRates)
    .where(
      and(
        ofInstitution(institutionId),
        inArray(staffPayRates.membershipId, [...new Set(membershipIds)]),
      ),
    )
    .orderBy(...ORDER)
  return rows.map(toPayRate)
}

/** Yuvanın iptal edilmemiş tanımları (kurum kilidi altında). */
export async function loadSlotPayRates(
  tx: Database,
  institutionId: string,
  membershipId: string,
  slot: string,
): Promise<StoredPayRate[]> {
  const rows = await tx
    .select(COLUMNS)
    .from(staffPayRates)
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffPayRates.membershipId, membershipId),
        eq(staffPayRates.slot, slot),
      ),
    )
    .orderBy(...ORDER)
  return rows.map(toPayRate)
}

export interface StaffMember {
  membershipId: string
  name: string
  role: string
  active: boolean
}

/** Kurumdaki üyelik (ad, rol, etkin mi); yoksa `null`. */
export async function findStaffMember(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StaffMember | null> {
  const [row] = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  if (row === undefined) return null
  const { deactivatedAt, ...member } = row
  return { ...member, active: deactivatedAt === null }
}

export interface StaffQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: 'active' | 'passive' | undefined
}

/** Kurumun personeli (yönetici, öğretmen, ön büro), ada göre; pasif personel de listelenir. */
export async function listStaffMembers(
  db: Database,
  institutionId: string,
  query: StaffQuery,
): Promise<{ items: StaffMember[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    eq(memberships.institutionId, institutionId),
    inArray(memberships.role, [...STAFF_ROLES]),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    query.status === undefined
      ? undefined
      : query.status === 'active'
        ? isNull(memberships.deactivatedAt)
        : isNotNull(memberships.deactivatedAt),
  ]
  const where = and(...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ deactivatedAt, ...row }) => ({ ...row, active: deactivatedAt === null })),
    total: totalRow?.total ?? 0,
  }
}

export interface PayRateInsert {
  id: string
  membershipId: string
  component: PayRateComponent
  rateType: PayRateType
  slot: string
  amountCents: number
  benefitForm: BenefitForm | null
  taxable: boolean | null
  startDate: string
  endDate: string | null
  note: string | null
  createdByUserId: string
  now: Date
}

export async function insertPayRate(
  tx: Database,
  institutionId: string,
  input: PayRateInsert,
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(staffPayRates).values({
    ...fields,
    institutionId,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Önceki tanımı yeni tanımla kapatır (K-304). İki adımdır: önce bitiş çekilir (yeni tanım yuvanın
 * tek süresiz tanımı olabilsin), yeni tanım yazıldıktan sonra kapatan ve eski bitiş bağlanır
 * (`linkClosedPayRate`; yabancı anahtar yeni satırı ister). Aynı transaction'dadır.
 */
export async function closePayRate(
  tx: Database,
  institutionId: string,
  input: { id: string; endDate: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffPayRates)
    .set({
      endDate: input.endDate,
      updatedAt: input.now,
      version: sql`${staffPayRates.version} + 1`,
    })
    .where(and(ofInstitution(institutionId), eq(staffPayRates.id, input.id)))
    .returning({ id: staffPayRates.id })
  return rows.length === 1
}

/** Kapatılan tanıma kapatanı ve iptalde geri yazılacak eski bitişi bağlar. */
export async function linkClosedPayRate(
  tx: Database,
  institutionId: string,
  input: { id: string; closedByRateId: string; previousEndDate: string | null },
): Promise<void> {
  await tx
    .update(staffPayRates)
    .set({ closedByRateId: input.closedByRateId, closedFromEndDate: input.previousEndDate })
    .where(and(ofInstitution(institutionId), eq(staffPayRates.id, input.id)))
}

/** Son tanımın bitişi; sürüm tutmazsa `false` (409). */
export async function setPayRateEnd(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; endDate: string | null; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffPayRates)
    .set({ endDate: input.endDate, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffPayRates.id, input.id),
        eq(staffPayRates.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffPayRates.id })
  return rows.length === 1
}

/** İptal (arşiv) gerekçeyle; sürüm tutmazsa `false` (409). */
export async function cancelPayRate(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffPayRates)
    .set({
      archivedAt: input.now,
      cancelReason: input.reason,
      cancelledByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffPayRates.id, input.id),
        eq(staffPayRates.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffPayRates.id })
  return rows.length === 1
}

/** İptal edilen tanımın kapattığı tanım (eski bitişiyle); yoksa `null`. */
export async function findClosedBy(
  tx: Database,
  institutionId: string,
  rateId: string,
): Promise<{ id: string; previousEndDate: string | null } | null> {
  const [row] = await tx
    .select({ id: staffPayRates.id, previousEndDate: staffPayRates.closedFromEndDate })
    .from(staffPayRates)
    .where(and(ofInstitution(institutionId), eq(staffPayRates.closedByRateId, rateId)))
    .limit(1)
  return row ?? null
}

/** İptalde önceki tanımın eski bitişini geri yazar, kapatma bağını kaldırır. */
export async function reopenPayRate(
  tx: Database,
  institutionId: string,
  input: { id: string; endDate: string | null; now: Date },
): Promise<void> {
  await tx
    .update(staffPayRates)
    .set({
      endDate: input.endDate,
      closedByRateId: null,
      closedFromEndDate: null,
      updatedAt: input.now,
      version: sql`${staffPayRates.version} + 1`,
    })
    .where(and(ofInstitution(institutionId), eq(staffPayRates.id, input.id)))
}
