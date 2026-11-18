import { and, asc, desc, eq, inArray, isNotNull, isNull, min, sql } from 'drizzle-orm'

import type {
  LeaveKind,
  LeaveProfile,
  StoredLeaveType,
} from '@kampus/school-core/lib/finance-staff-leave.ts'

import type { Database } from './client.ts'
import { memberships } from './schema/auth.ts'
import {
  staffLeaveProfiles,
  staffLeaveRecords,
  staffLeaveTypes,
} from './schema/finance-staff-leave.ts'

/**
 * Personel izin deposu (DOM-FIN-109; ON-181). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-staff-leave.ts`'tedir; depo yalnız okur ve yazar. İptal edilmiş (arşivli)
 * izin kaydı okunmaz. Personel üyeliği okuması ücret tanımı deposundadır (`findStaffMember`,
 * `listStaffMembers`).
 */

// --- Türler --------------------------------------------------------------------------------------

const TYPE_COLUMNS = {
  code: staffLeaveTypes.code,
  kind: staffLeaveTypes.kind,
  label: staffLeaveTypes.label,
  paid: staffLeaveTypes.paid,
  deductsFromAnnual: staffLeaveTypes.deductsFromAnnual,
  defaultDays: staffLeaveTypes.defaultDays,
  isActive: staffLeaveTypes.isActive,
  version: staffLeaveTypes.version,
}

/** Kurumun saklanan tür satırları (varsayılan ayarları ve ek türler). */
export async function loadStoredLeaveTypes(
  db: Database,
  institutionId: string,
): Promise<StoredLeaveType[]> {
  return db
    .select(TYPE_COLUMNS)
    .from(staffLeaveTypes)
    .where(eq(staffLeaveTypes.institutionId, institutionId))
    .orderBy(asc(staffLeaveTypes.code))
}

export type LeaveTypeRow = Omit<StoredLeaveType, 'version'>

/** Yeni tür satırı (varsayılanın ilk ayarı ya da ek tür). */
export async function insertLeaveType(
  tx: Database,
  institutionId: string,
  row: LeaveTypeRow & { userId: string; now: Date; version?: number },
): Promise<void> {
  const { userId, now, ...fields } = row
  await tx.insert(staffLeaveTypes).values({
    ...fields,
    institutionId,
    updatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Tür satırını sürümle günceller; sürüm tutmazsa `false` (409). */
export async function updateLeaveType(
  tx: Database,
  institutionId: string,
  row: LeaveTypeRow & { expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const { expectedVersion, userId, now, code } = row
  // Kod ve biçim değişmez; yalnız ayar alanları yazılır.
  const fields = {
    label: row.label,
    paid: row.paid,
    deductsFromAnnual: row.deductsFromAnnual,
    defaultDays: row.defaultDays,
    isActive: row.isActive,
  }
  const rows = await tx
    .update(staffLeaveTypes)
    .set({ ...fields, updatedByUserId: userId, updatedAt: now, version: expectedVersion + 1 })
    .where(
      and(
        eq(staffLeaveTypes.institutionId, institutionId),
        eq(staffLeaveTypes.code, code),
        eq(staffLeaveTypes.version, expectedVersion),
      ),
    )
    .returning({ code: staffLeaveTypes.code })
  return rows.length === 1
}

// --- Profil --------------------------------------------------------------------------------------

export interface StoredLeaveProfile extends LeaveProfile {
  membershipId: string
  version: number
}

const PROFILE_COLUMNS = {
  membershipId: staffLeaveProfiles.membershipId,
  seniorityStartDate: staffLeaveProfiles.seniorityStartDate,
  birthDate: staffLeaveProfiles.birthDate,
  openingBalanceDate: staffLeaveProfiles.openingBalanceDate,
  openingBalanceDays: staffLeaveProfiles.openingBalanceDays,
  version: staffLeaveProfiles.version,
}

type ProfileRow = {
  membershipId: string
  seniorityStartDate: string
  birthDate: string | null
  openingBalanceDate: string | null
  openingBalanceDays: number | null
  version: number
}
const toProfile = ({
  openingBalanceDate,
  openingBalanceDays,
  ...row
}: ProfileRow): StoredLeaveProfile => ({
  ...row,
  openingBalance:
    openingBalanceDate === null || openingBalanceDays === null
      ? null
      : { asOf: openingBalanceDate, days: openingBalanceDays },
})

/** Personellerin izin profilleri. */
export async function loadLeaveProfiles(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<StoredLeaveProfile[]> {
  if (membershipIds.length === 0) return []
  const rows = await db
    .select(PROFILE_COLUMNS)
    .from(staffLeaveProfiles)
    .where(
      and(
        eq(staffLeaveProfiles.institutionId, institutionId),
        inArray(staffLeaveProfiles.membershipId, [...new Set(membershipIds)]),
      ),
    )
  return rows.map(toProfile)
}

export async function findLeaveProfile(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredLeaveProfile | null> {
  const [row] = await loadLeaveProfiles(db, institutionId, [membershipId])
  return row ?? null
}

const profileColumns = (profile: LeaveProfile) => ({
  seniorityStartDate: profile.seniorityStartDate,
  birthDate: profile.birthDate,
  openingBalanceDate: profile.openingBalance?.asOf ?? null,
  openingBalanceDays: profile.openingBalance?.days ?? null,
})

export async function insertLeaveProfile(
  tx: Database,
  institutionId: string,
  input: { membershipId: string; profile: LeaveProfile; userId: string; now: Date },
): Promise<void> {
  await tx.insert(staffLeaveProfiles).values({
    institutionId,
    membershipId: input.membershipId,
    ...profileColumns(input.profile),
    updatedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Profil düzeltmesi; sürüm tutmazsa `false` (409). */
export async function updateLeaveProfile(
  tx: Database,
  institutionId: string,
  input: {
    membershipId: string
    profile: LeaveProfile
    expectedVersion: number
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(staffLeaveProfiles)
    .set({
      ...profileColumns(input.profile),
      updatedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(staffLeaveProfiles.institutionId, institutionId),
        eq(staffLeaveProfiles.membershipId, input.membershipId),
        eq(staffLeaveProfiles.version, input.expectedVersion),
      ),
    )
    .returning({ membershipId: staffLeaveProfiles.membershipId })
  return rows.length === 1
}

// --- Kullanılmış izin ----------------------------------------------------------------------------

export interface StoredLeaveRecord {
  id: string
  membershipId: string
  typeCode: string
  kind: LeaveKind
  typeLabel: string
  paid: boolean
  deductsFromAnnual: boolean
  startDate: string
  endDate: string
  days: number
  note: string | null
  createdAt: string
  version: number
}

const RECORD_COLUMNS = {
  id: staffLeaveRecords.id,
  membershipId: staffLeaveRecords.membershipId,
  typeCode: staffLeaveRecords.typeCode,
  kind: staffLeaveRecords.kind,
  typeLabel: staffLeaveRecords.typeLabel,
  paid: staffLeaveRecords.paid,
  deductsFromAnnual: staffLeaveRecords.deductsFromAnnual,
  startDate: staffLeaveRecords.startDate,
  endDate: staffLeaveRecords.endDate,
  days: staffLeaveRecords.days,
  note: staffLeaveRecords.note,
  createdAt: staffLeaveRecords.createdAt,
  version: staffLeaveRecords.version,
}
const toRecord = (row: Omit<StoredLeaveRecord, 'createdAt'> & { createdAt: Date }) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})
const recordsOf = (institutionId: string) =>
  and(eq(staffLeaveRecords.institutionId, institutionId), isNull(staffLeaveRecords.archivedAt))

/** Personellerin iptal edilmemiş kayıtları, yeni başlayan önce. */
export async function loadLeaveRecords(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<StoredLeaveRecord[]> {
  if (membershipIds.length === 0) return []
  const rows = await db
    .select(RECORD_COLUMNS)
    .from(staffLeaveRecords)
    .where(
      and(
        recordsOf(institutionId),
        inArray(staffLeaveRecords.membershipId, [...new Set(membershipIds)]),
      ),
    )
    .orderBy(desc(staffLeaveRecords.startDate), desc(staffLeaveRecords.createdAt))
  return rows.map(toRecord)
}

export async function findLeaveRecord(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredLeaveRecord | null> {
  const [row] = await db
    .select(RECORD_COLUMNS)
    .from(staffLeaveRecords)
    .where(and(recordsOf(institutionId), eq(staffLeaveRecords.id, id)))
    .limit(1)
  return row === undefined ? null : toRecord(row)
}

/** Personelin yıllık izinden düşen en erken kaydı (kıdem başlangıcı düzeltmesi için). */
export async function firstAnnualLeaveDate(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ first: min(staffLeaveRecords.startDate) })
    .from(staffLeaveRecords)
    .where(
      and(
        recordsOf(institutionId),
        eq(staffLeaveRecords.membershipId, membershipId),
        eq(staffLeaveRecords.deductsFromAnnual, true),
      ),
    )
  return row?.first ?? null
}

export interface LeaveRecordInsert {
  id: string
  membershipId: string
  typeCode: string
  kind: LeaveKind
  typeLabel: string
  paid: boolean
  deductsFromAnnual: boolean
  startDate: string
  endDate: string
  days: number
  note: string | null
  createdByUserId: string
  now: Date
}

export async function insertLeaveRecord(
  tx: Database,
  institutionId: string,
  input: LeaveRecordInsert,
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(staffLeaveRecords)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Gerekçeli iptal (arşiv); sürüm tutmazsa `false` (409). */
export async function cancelLeaveRecord(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffLeaveRecords)
    .set({
      archivedAt: input.now,
      cancelReason: input.reason,
      cancelledByUserId: input.userId,
      updatedAt: input.now,
      version: sql`${staffLeaveRecords.version} + 1`,
    })
    .where(
      and(
        recordsOf(institutionId),
        eq(staffLeaveRecords.id, input.id),
        eq(staffLeaveRecords.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffLeaveRecords.id })
  return rows.length === 1
}

// --- Personel ------------------------------------------------------------------------------------

/**
 * Pasifleştirilmiş üyeliklerin pasifleştirilme anı (hizmetin bittiği gün yerine; ayrılış günü
 * personel kaydı gelince oradan okunur). Etkin üyelik haritada yoktur.
 */
export async function deactivationTimes(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<Map<string, Date>> {
  if (membershipIds.length === 0) return new Map()
  const rows = await db
    .select({ id: memberships.id, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.id, [...new Set(membershipIds)]),
        isNotNull(memberships.deactivatedAt),
      ),
    )
  return new Map(
    rows.flatMap((row) => (row.deactivatedAt === null ? [] : [[row.id, row.deactivatedAt]])),
  )
}
