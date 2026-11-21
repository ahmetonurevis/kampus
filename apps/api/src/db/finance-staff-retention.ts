import { and, asc, count, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'

import type {
  StaffRetentionCategory,
  StaffRetentionCounts,
  StaffRetentionMethod,
  StaffRetentionStartEvent,
} from '@kampus/school-core/lib/finance-staff-retention.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffMedicalReports } from './schema/finance-medical-reports.ts'
import { staffPersonnelFiles } from './schema/finance-personnel-files.ts'
import { staffPayRates } from './schema/finance-pay-rates.ts'
import { professionalDevelopmentEnrollments } from './schema/finance-professional-development.ts'
import { payrollLessonHours } from './schema/finance-payroll-exports.ts'
import { payrollAdjustments } from './schema/finance-payroll-periods.ts'
import { sgkEmploymentDates, sgkMissingDays } from './schema/finance-sgk-preparation.ts'
import { staffCertificates } from './schema/finance-staff-certificates.ts'
import { staffCostAllocations, staffCostAllocationShares } from './schema/finance-staff-costs.ts'
import {
  staffAdvances,
  staffGarnishments,
  staffPensionEnrollments,
} from './schema/finance-staff-deductions.ts'
import { staffDocuments } from './schema/finance-staff-documents.ts'
import { staffLeaveProfiles, staffLeaveRecords } from './schema/finance-staff-leave.ts'
import { staffDataDestructions, staffRetentionSettings } from './schema/finance-staff-retention.ts'
import { teacherWorkPermits } from './schema/finance-work-permits.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Özlük verisi saklama ve imha deposu (DOM-FIN-122; ON-176). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-retention.ts`'tedir; depo kategori → tablo
 * eşlemesini (`CATEGORY_PARTS`) taşır, sayar, imha eder ve imha kaydını yazar. İmha edilen
 * satırların arşivli (iptal edilmiş) olanları da kategoriye girer: iptal edilen kayıt da kişisel
 * veridir. Yeni personel tablosu açıldığında bu eşlemeye eklenir.
 */

interface CategoryPart {
  table: PgTable
  institutionId: AnyPgColumn
  membershipId: AnyPgColumn
  /** Kategoriyi daraltan ek koşul (özlük belgesinde tür). */
  filter?: SQL
  /** Platform dosyasına işaret eden kolon; dosya imhaya işaretlenir. */
  fileId?: AnyPgColumn
  /** `kampus_reject_immutable_change` korumalı tablo: silme imha ayarıyla yapılır. */
  immutable?: true
}

const docsOfTypes = (types: readonly string[]): CategoryPart => ({
  table: staffDocuments,
  institutionId: staffDocuments.institutionId,
  membershipId: staffDocuments.membershipId,
  filter: inArray(staffDocuments.documentType, [
    ...types,
  ] as (typeof staffDocuments.documentType._.data)[]),
  fileId: staffDocuments.fileId,
})

/** Kategori → tablolar (K-416). Sıra silme sırasıdır; çocuk satırlar `deleteChildren`'dadır. */
const CATEGORY_PARTS: Record<StaffRetentionCategory, readonly CategoryPart[]> = {
  sick_leave_reports: [
    {
      table: staffMedicalReports,
      institutionId: staffMedicalReports.institutionId,
      membershipId: staffMedicalReports.membershipId,
      fileId: staffMedicalReports.fileId,
    },
  ],
  health_reports: [docsOfTypes(['health_report'])],
  criminal_records: [docsOfTypes(['criminal_record'])],
  personnel_file: [
    // Mesleki gelişim katılımları (DOM-FIN-125, DOM-FIN-144; K-489) ve katılım belgeleri: sertifika
    // özlük belgesine ve gelişim hedefine işaret ettikleri için özlük belgelerinden önce silinir.
    {
      table: professionalDevelopmentEnrollments,
      institutionId: professionalDevelopmentEnrollments.institutionId,
      membershipId: professionalDevelopmentEnrollments.membershipId,
      fileId: professionalDevelopmentEnrollments.documentFileId,
    },
    docsOfTypes(['diploma', 'certificate', 'id_copy', 'other']),
    {
      table: teacherWorkPermits,
      institutionId: teacherWorkPermits.institutionId,
      membershipId: teacherWorkPermits.membershipId,
      fileId: teacherWorkPermits.documentFileId,
    },
    {
      table: staffCertificates,
      institutionId: staffCertificates.institutionId,
      membershipId: staffCertificates.membershipId,
      immutable: true,
    },
    // Özlük kartı (DOM-FIN-140, K-477): kimlik, iletişim, eğitim, banka ve acil durum kişileriyle
    // birlikte fiziksel silinir; şifreli değerler satırla gider.
    {
      table: staffPersonnelFiles,
      institutionId: staffPersonnelFiles.institutionId,
      membershipId: staffPersonnelFiles.membershipId,
    },
  ],
  leave_records: [
    {
      table: staffLeaveRecords,
      institutionId: staffLeaveRecords.institutionId,
      membershipId: staffLeaveRecords.membershipId,
    },
    {
      table: staffLeaveProfiles,
      institutionId: staffLeaveProfiles.institutionId,
      membershipId: staffLeaveProfiles.membershipId,
    },
  ],
  payroll_records: [
    {
      table: staffPayRates,
      institutionId: staffPayRates.institutionId,
      membershipId: staffPayRates.membershipId,
    },
    {
      table: staffAdvances,
      institutionId: staffAdvances.institutionId,
      membershipId: staffAdvances.membershipId,
    },
    {
      table: staffGarnishments,
      institutionId: staffGarnishments.institutionId,
      membershipId: staffGarnishments.membershipId,
    },
    {
      table: staffPensionEnrollments,
      institutionId: staffPensionEnrollments.institutionId,
      membershipId: staffPensionEnrollments.membershipId,
    },
    {
      table: payrollAdjustments,
      institutionId: payrollAdjustments.institutionId,
      membershipId: payrollAdjustments.membershipId,
    },
    {
      table: payrollLessonHours,
      institutionId: payrollLessonHours.institutionId,
      membershipId: payrollLessonHours.membershipId,
    },
    {
      table: sgkMissingDays,
      institutionId: sgkMissingDays.institutionId,
      membershipId: sgkMissingDays.membershipId,
    },
    {
      table: sgkEmploymentDates,
      institutionId: sgkEmploymentDates.institutionId,
      membershipId: sgkEmploymentDates.membershipId,
    },
    {
      table: staffCostAllocations,
      institutionId: staffCostAllocations.institutionId,
      membershipId: staffCostAllocations.membershipId,
    },
  ],
}

const partWhere = (part: CategoryPart, institutionId: string, membershipIds: readonly string[]) =>
  and(
    eq(part.institutionId, institutionId),
    inArray(part.membershipId, [...membershipIds]),
    part.filter,
  )

// --- Politika ------------------------------------------------------------------------------------

export async function loadStaffRetentionSettings(
  db: Database,
  institutionId: string,
): Promise<{
  stored: Partial<Record<StaffRetentionCategory, number | null>>
  updatedAt: Partial<Record<StaffRetentionCategory, string>>
}> {
  const rows = await db
    .select({
      category: staffRetentionSettings.category,
      retentionMonths: staffRetentionSettings.retentionMonths,
      updatedAt: staffRetentionSettings.updatedAt,
    })
    .from(staffRetentionSettings)
    .where(eq(staffRetentionSettings.institutionId, institutionId))
  const stored: Partial<Record<StaffRetentionCategory, number | null>> = {}
  const updatedAt: Partial<Record<StaffRetentionCategory, string>> = {}
  for (const row of rows) {
    stored[row.category] = row.retentionMonths
    updatedAt[row.category] = row.updatedAt.toISOString()
  }
  return { stored, updatedAt }
}

/** Gönderilen kategorilerin süresini yazar (yoksa açar); `null` varsayılana döner. */
export async function upsertStaffRetentionSettings(
  tx: Database,
  institutionId: string,
  input: {
    settings: Partial<Record<StaffRetentionCategory, number | null>>
    userId: string
    now: Date
  },
): Promise<void> {
  for (const [category, retentionMonths] of Object.entries(input.settings) as [
    StaffRetentionCategory,
    number | null | undefined,
  ][]) {
    if (retentionMonths === undefined) continue
    await tx
      .insert(staffRetentionSettings)
      .values({
        institutionId,
        category,
        retentionMonths,
        updatedByUserId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [staffRetentionSettings.institutionId, staffRetentionSettings.category],
        set: {
          retentionMonths,
          updatedByUserId: input.userId,
          updatedAt: input.now,
          version: sql`${staffRetentionSettings.version} + 1`,
        },
      })
  }
}

// --- Ayrılmış personel ve kayıt sayıları ---------------------------------------------------------

export interface DepartedStaffRow {
  membershipId: string
  name: string
  role: string
  deactivatedAt: Date
}

/** Kurumun pasifleştirilmiş personeli (yönetici, öğretmen, ön büro), ada göre; `q` ad araması. */
export async function listDepartedStaff(
  db: Database,
  institutionId: string,
  q?: string,
): Promise<DepartedStaffRow[]> {
  const search = q === undefined ? undefined : foldSearch(q)
  const rows = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.role, [...STAFF_ROLES]),
        isNotNull(memberships.deactivatedAt),
        search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
      ),
    )
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
  return rows.flatMap((row) =>
    row.deactivatedAt === null ? [] : [{ ...row, deactivatedAt: row.deactivatedAt }],
  )
}

/** Kurumun üyeliği (rol ve pasifleştirme anı); yoksa ya da başka kurumdaysa `null`. */
export async function findRetentionMember(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ role: string; deactivatedAt: Date | null } | null> {
  const [row] = await db
    .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return row ?? null
}

/** Üyelik başına kategori kayıt sayıları (arşivli satırlar dahil). */
export async function countStaffRetentionRecords(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
  categories: readonly StaffRetentionCategory[] = Object.keys(
    CATEGORY_PARTS,
  ) as StaffRetentionCategory[],
): Promise<Map<string, StaffRetentionCounts>> {
  const counts = new Map<string, StaffRetentionCounts>()
  if (membershipIds.length === 0) return counts
  for (const category of categories)
    for (const part of CATEGORY_PARTS[category]) {
      const rows = await db
        .select({ membershipId: part.membershipId, total: count() })
        .from(part.table)
        .where(partWhere(part, institutionId, membershipIds))
        .groupBy(part.membershipId)
      for (const row of rows) {
        const id = String(row.membershipId)
        const own = counts.get(id) ?? {}
        own[category] = (own[category] ?? 0) + row.total
        counts.set(id, own)
      }
    }
  return counts
}

// --- İmha ----------------------------------------------------------------------------------------

/** Maliyet atamasının pay satırları atamayla birlikte gider (yabancı anahtar `restrict`). */
async function deleteChildren(
  tx: Database,
  institutionId: string,
  membershipId: string,
  category: StaffRetentionCategory,
) {
  if (category !== 'payroll_records') return
  const allocations = tx
    .select({ id: staffCostAllocations.id })
    .from(staffCostAllocations)
    .where(
      and(
        eq(staffCostAllocations.institutionId, institutionId),
        eq(staffCostAllocations.membershipId, membershipId),
      ),
    )
  await tx
    .delete(staffCostAllocationShares)
    .where(
      and(
        eq(staffCostAllocationShares.institutionId, institutionId),
        inArray(staffCostAllocationShares.allocationId, allocations),
      ),
    )
}

/**
 * Personelin kategorideki bütün satırlarını siler (K-416; kurum kilidi altında, çağıranın
 * transaction'ında). Değişmez tabloda (düzenlenen personel belgesi) silme imha ayarıyla
 * (`kampus.allow_immutable_purge`) yapılır. Silinen satır sayısını ve satırların işaret ettiği
 * dosya kimliklerini döndürür; dosyayı çağıran imhaya işaretler.
 */
export async function destroyStaffCategory(
  tx: Database,
  institutionId: string,
  membershipId: string,
  category: StaffRetentionCategory,
): Promise<{ recordCount: number; fileIds: string[] }> {
  let recordCount = 0
  const fileIds: string[] = []
  await deleteChildren(tx, institutionId, membershipId, category)
  for (const part of CATEGORY_PARTS[category]) {
    const where = partWhere(part, institutionId, [membershipId])
    if (part.fileId !== undefined) {
      const rows = await tx
        .select({ fileId: part.fileId })
        .from(part.table)
        .where(and(where, isNotNull(part.fileId)))
      for (const row of rows) if (typeof row.fileId === 'string') fileIds.push(row.fileId)
    }
    const [counted] = await tx.select({ total: count() }).from(part.table).where(where)
    if ((counted?.total ?? 0) === 0) continue
    if (part.immutable === true)
      await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
    await tx.delete(part.table).where(where)
    recordCount += counted?.total ?? 0
  }
  return { recordCount, fileIds }
}

export interface StaffDataDestructionRow {
  id: string
  category: StaffRetentionCategory
  method: StaffRetentionMethod
  recordCount: number
  fileCount: number
  retentionMonths: number
  startEvent: StaffRetentionStartEvent
  destroyedAt: string
  destroyedByUserId: string
  destroyedByName: string | null
}

export async function insertStaffDataDestruction(
  tx: Database,
  institutionId: string,
  row: Omit<StaffDataDestructionRow, 'destroyedAt' | 'destroyedByName'> & { now: Date },
): Promise<void> {
  const { now, ...values } = row
  await tx.insert(staffDataDestructions).values({
    institutionId,
    ...values,
    destroyedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

const destructionColumns = {
  id: staffDataDestructions.id,
  category: staffDataDestructions.category,
  method: staffDataDestructions.method,
  recordCount: staffDataDestructions.recordCount,
  fileCount: staffDataDestructions.fileCount,
  retentionMonths: staffDataDestructions.retentionMonths,
  startEvent: staffDataDestructions.startEvent,
  destroyedAt: staffDataDestructions.destroyedAt,
  destroyedByUserId: staffDataDestructions.destroyedByUserId,
  destroyedByName: users.name,
}

const toDestruction = (row: {
  destroyedAt: Date
  destroyedByName: string | null
}): Pick<StaffDataDestructionRow, 'destroyedAt' | 'destroyedByName'> => ({
  destroyedAt: row.destroyedAt.toISOString(),
  destroyedByName: row.destroyedByName,
})

export async function findStaffDataDestruction(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StaffDataDestructionRow | null> {
  const [row] = await db
    .select(destructionColumns)
    .from(staffDataDestructions)
    .leftJoin(users, eq(users.id, staffDataDestructions.destroyedByUserId))
    .where(
      and(eq(staffDataDestructions.institutionId, institutionId), eq(staffDataDestructions.id, id)),
    )
    .limit(1)
  return row === undefined ? null : { ...row, ...toDestruction(row) }
}

/** İmha kayıtları, en yeni önce; `category` süzgeci. */
export async function listStaffDataDestructions(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; category?: StaffRetentionCategory | undefined },
): Promise<{ items: StaffDataDestructionRow[]; total: number }> {
  const where = and(
    eq(staffDataDestructions.institutionId, institutionId),
    query.category === undefined ? undefined : eq(staffDataDestructions.category, query.category),
  )
  const [totalRow] = await db.select({ total: count() }).from(staffDataDestructions).where(where)
  const rows = await db
    .select(destructionColumns)
    .from(staffDataDestructions)
    .leftJoin(users, eq(users.id, staffDataDestructions.destroyedByUserId))
    .where(where)
    .orderBy(desc(staffDataDestructions.destroyedAt), desc(staffDataDestructions.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({ ...row, ...toDestruction(row) })),
    total: totalRow?.total ?? 0,
  }
}
