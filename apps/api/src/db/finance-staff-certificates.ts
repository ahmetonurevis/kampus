import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  sql,
  type SQL,
} from 'drizzle-orm'

import type {
  StaffCertificateContent,
  StaffCertificateKind,
  StaffCertificateStatus,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffCertificates } from './schema/finance-staff-certificates.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Personel belgesi deposu (DOM-FIN-106; ON-175). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-certificates.ts`'tedir. İçerik dondurulmuştur
 * (K-341): depo yalnız ekler ve iptal alanlarını yazar; veritabanı tetikleyicisi başka değişikliği
 * reddeder. Personel üyelikten (Better Auth `memberships`, `users`) yalnız okunur.
 */

export interface StoredStaffCertificate extends StaffCertificateContent {
  id: string
  membershipId: string
  certificateYear: number
  certificateNumber: number
  institutionName: string
  issuedByName: string
  createdAt: string
  cancelledAt: string | null
  cancelReason: string | null
  version: number
}

const COLUMNS = {
  id: staffCertificates.id,
  membershipId: staffCertificates.membershipId,
  kind: staffCertificates.kind,
  certificateYear: staffCertificates.certificateYear,
  certificateNumber: staffCertificates.certificateNumber,
  institutionName: staffCertificates.institutionName,
  staffName: staffCertificates.staffName,
  position: staffCertificates.position,
  identityNumber: staffCertificates.identityNumber,
  hireDate: staffCertificates.hireDate,
  exitDate: staffCertificates.exitDate,
  addressee: staffCertificates.addressee,
  wageRateType: staffCertificates.wageRateType,
  wageAmountCents: staffCertificates.wageAmountCents,
  issuedByName: staffCertificates.issuedByName,
  createdAt: staffCertificates.createdAt,
  cancelledAt: staffCertificates.cancelledAt,
  cancelReason: staffCertificates.cancelReason,
  version: staffCertificates.version,
}

type Row = Omit<StoredStaffCertificate, 'createdAt' | 'cancelledAt'> & {
  createdAt: Date
  cancelledAt: Date | null
}
const toCertificate = (row: Row): StoredStaffCertificate => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
})

const ofInstitution = (institutionId: string) => eq(staffCertificates.institutionId, institutionId)

export async function findStaffCertificate(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffCertificate | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(staffCertificates)
    .where(and(ofInstitution(institutionId), eq(staffCertificates.id, id)))
    .limit(1)
  return row === undefined ? null : toCertificate(row)
}

export interface StaffCertificateQuery {
  page: number
  pageSize: number
  q?: string | undefined
  kind?: StaffCertificateKind | undefined
  status?: StaffCertificateStatus | undefined
  year?: number | undefined
  membershipId?: string | undefined
}

/** Belgeler, yeni numara önce; arama dondurulmuş personel adında. */
export async function listStaffCertificates(
  db: Database,
  institutionId: string,
  query: StaffCertificateQuery,
): Promise<{ items: StoredStaffCertificate[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    ofInstitution(institutionId),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(staffCertificates.staffName)}, ${search}) > 0`,
    query.kind === undefined ? undefined : eq(staffCertificates.kind, query.kind),
    query.status === undefined
      ? undefined
      : query.status === 'valid'
        ? isNull(staffCertificates.cancelledAt)
        : isNotNull(staffCertificates.cancelledAt),
    query.year === undefined ? undefined : eq(staffCertificates.certificateYear, query.year),
    query.membershipId === undefined
      ? undefined
      : eq(staffCertificates.membershipId, query.membershipId),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(staffCertificates).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(staffCertificates)
    .where(where)
    .orderBy(desc(staffCertificates.certificateYear), desc(staffCertificates.certificateNumber))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toCertificate), total: totalRow?.total ?? 0 }
}

/** Ardışık numara kurum kilidi altında okunur; benzersiz indeks ikinci güvencedir. */
async function nextCertificateNumber(db: Database, institutionId: string, year: number) {
  const [row] = await db
    .select({ last: max(staffCertificates.certificateNumber) })
    .from(staffCertificates)
    .where(and(ofInstitution(institutionId), eq(staffCertificates.certificateYear, year)))
  return (row?.last ?? 0) + 1
}

export async function insertStaffCertificate(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    membershipId: string
    content: StaffCertificateContent
    certificateYear: number
    institutionName: string
    issuedByUserId: string
    issuedByName: string
    now: Date
  },
): Promise<void> {
  const { now, content, ...rest } = input
  const certificateNumber = await nextCertificateNumber(tx, institutionId, input.certificateYear)
  await tx.insert(staffCertificates).values({
    institutionId,
    ...rest,
    ...content,
    certificateNumber,
    createdAt: now,
    updatedAt: now,
  })
}

/** İptal; sürüm tutmazsa ya da zaten iptalse `false` (409). */
export async function cancelStaffCertificate(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; reason: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffCertificates)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.userId,
      cancelReason: input.reason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffCertificates.id, input.id),
        eq(staffCertificates.version, input.expectedVersion),
        isNull(staffCertificates.cancelledAt),
      ),
    )
    .returning({ id: staffCertificates.id })
  return rows.length === 1
}

export interface CertificateStaffMember {
  membershipId: string
  name: string
  role: string
  active: boolean
  /** Pasifleştirme günü (UTC anı); ayrılış günü önerisi için. */
  deactivatedAt: string | null
}

/** Kurumdaki üyelik (ad, rol, etkin mi); yoksa `null`. */
export async function findCertificateStaff(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<CertificateStaffMember | null> {
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
  return row === undefined ? null : toStaff(row)
}

const toStaff = (row: {
  membershipId: string
  name: string
  role: string
  deactivatedAt: Date | null
}): CertificateStaffMember => ({
  ...row,
  active: row.deactivatedAt === null,
  deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
})

/** Düzenleyenin adı (belgenin imza alanı); yoksa `null`. */
export async function findUserName(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.name ?? null
}

/** Kurumun personeli (yönetici, öğretmen, ön büro), ada göre; pasif personel de listelenir. */
export async function listCertificateStaff(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{ items: CertificateStaffMember[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    eq(memberships.institutionId, institutionId),
    inArray(memberships.role, [...STAFF_ROLES]),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
  )
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
  return { items: rows.map(toStaff), total: totalRow?.total ?? 0 }
}

/**
 * Personelin iptal edilmemiş son belgesindeki görev ve işe giriş günü (yeni belge formunun
 * önerisi; personel kaydında bu alanlar yoktur, K-340).
 */
export async function lastCertificateFacts(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<Map<string, { position: string; hireDate: string }>> {
  const facts = new Map<string, { position: string; hireDate: string }>()
  if (membershipIds.length === 0) return facts
  const rows = await db
    .select({
      membershipId: staffCertificates.membershipId,
      position: staffCertificates.position,
      hireDate: staffCertificates.hireDate,
    })
    .from(staffCertificates)
    .where(
      and(
        ofInstitution(institutionId),
        inArray(staffCertificates.membershipId, [...new Set(membershipIds)]),
        isNull(staffCertificates.cancelledAt),
      ),
    )
    .orderBy(desc(staffCertificates.createdAt), desc(staffCertificates.certificateNumber))
  for (const row of rows)
    if (!facts.has(row.membershipId))
      facts.set(row.membershipId, { position: row.position, hireDate: row.hireDate })
  return facts
}
