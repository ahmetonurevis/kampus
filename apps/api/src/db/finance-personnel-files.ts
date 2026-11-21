import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  sql,
  type SQL,
} from 'drizzle-orm'

import type {
  PersonnelEducation,
  PersonnelEmergencyContact,
} from '@kampus/school-core/lib/finance-personnel-files.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffPersonnelFiles } from './schema/finance-personnel-files.ts'
import { staffDocuments } from './schema/finance-staff-documents.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Personel özlük kartı deposu (DOM-FIN-140; ON-172). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-personnel-files.ts`'tedir; şifreleme ve çözme serviste
 * yapılır, depo şifreli değeri olduğu gibi okur ve yazar. Ad ve rol üyelik/kullanıcı
 * tablolarından yalnız okunur.
 */

/** Saklanan satır (şifreli alanlar çözülmemiş). */
export interface StoredPersonnelFile {
  membershipId: string
  nationalIdCiphertext: string | null
  nationalIdKeyVersion: number | null
  birthDate: string | null
  address: string | null
  phone: string | null
  email: string | null
  education: PersonnelEducation[]
  ibanCiphertext: string | null
  ibanKeyVersion: number | null
  bankAccountHolder: string | null
  emergencyContacts: PersonnelEmergencyContact[]
  updatedAt: Date
  version: number
}

/** Yazılacak kolonlar (şifreli alanlar şifrelenmiş). */
export type PersonnelFileColumns = Omit<
  StoredPersonnelFile,
  'membershipId' | 'updatedAt' | 'version'
>

const storedColumns = {
  membershipId: staffPersonnelFiles.membershipId,
  nationalIdCiphertext: staffPersonnelFiles.nationalIdCiphertext,
  nationalIdKeyVersion: staffPersonnelFiles.nationalIdKeyVersion,
  birthDate: staffPersonnelFiles.birthDate,
  address: staffPersonnelFiles.address,
  phone: staffPersonnelFiles.phone,
  email: staffPersonnelFiles.email,
  education: staffPersonnelFiles.education,
  ibanCiphertext: staffPersonnelFiles.ibanCiphertext,
  ibanKeyVersion: staffPersonnelFiles.ibanKeyVersion,
  bankAccountHolder: staffPersonnelFiles.bankAccountHolder,
  emergencyContacts: staffPersonnelFiles.emergencyContacts,
  updatedAt: staffPersonnelFiles.updatedAt,
  version: staffPersonnelFiles.version,
}

const ownFile = (institutionId: string, membershipId: string) =>
  and(
    eq(staffPersonnelFiles.institutionId, institutionId),
    eq(staffPersonnelFiles.membershipId, membershipId),
    isNull(staffPersonnelFiles.archivedAt),
  )

export async function findPersonnelFile(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredPersonnelFile | null> {
  const [row] = await db
    .select(storedColumns)
    .from(staffPersonnelFiles)
    .where(ownFile(institutionId, membershipId))
    .limit(1)
  return row ?? null
}

export async function insertPersonnelFile(
  tx: Database,
  institutionId: string,
  input: { membershipId: string; columns: PersonnelFileColumns; userId: string; now: Date },
): Promise<void> {
  await tx.insert(staffPersonnelFiles).values({
    institutionId,
    membershipId: input.membershipId,
    ...input.columns,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Sürüm tutarsa yazar; tutmazsa `false` (409). */
export async function updatePersonnelFile(
  tx: Database,
  institutionId: string,
  input: {
    membershipId: string
    columns: PersonnelFileColumns
    expectedVersion: number
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(staffPersonnelFiles)
    .set({
      ...input.columns,
      updatedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ownFile(institutionId, input.membershipId),
        eq(staffPersonnelFiles.version, input.expectedVersion),
      ),
    )
    .returning({ membershipId: staffPersonnelFiles.membershipId })
  return rows.length === 1
}

export interface PersonnelFileStaffQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: 'active' | 'passive' | undefined
  file?: 'with' | 'without' | undefined
}

/** Liste satırı: personel ve kartın dolu grupları (değer yok). */
export interface PersonnelFileStaffRow {
  membershipId: string
  name: string
  role: string
  active: boolean
  version: number | null
  updatedAt: Date | null
  filled: {
    identity: boolean
    contact: boolean
    education: boolean
    bank: boolean
    emergencyContacts: boolean
  }
}

/**
 * Kurumun personeli (yönetici, öğretmen, ön büro) ve varsa kartı, ada göre; pasif personel de
 * listelenir. Değer okunmaz, yalnız grupların dolu olup olmadığı.
 */
export async function listPersonnelFileStaff(
  db: Database,
  institutionId: string,
  query: PersonnelFileStaffQuery,
): Promise<{ items: PersonnelFileStaffRow[]; total: number }> {
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
    query.file === undefined
      ? undefined
      : query.file === 'with'
        ? isNotNull(staffPersonnelFiles.membershipId)
        : isNull(staffPersonnelFiles.membershipId),
  ]
  const where = and(...filters)
  const fileJoin = and(
    eq(staffPersonnelFiles.institutionId, memberships.institutionId),
    eq(staffPersonnelFiles.membershipId, memberships.id),
    isNull(staffPersonnelFiles.archivedAt),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(staffPersonnelFiles, fileJoin)
    .where(where)
  const rows = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
      version: staffPersonnelFiles.version,
      updatedAt: staffPersonnelFiles.updatedAt,
      hasNationalId: sql<boolean>`${staffPersonnelFiles.nationalIdCiphertext} is not null`,
      birthDate: staffPersonnelFiles.birthDate,
      address: staffPersonnelFiles.address,
      phone: staffPersonnelFiles.phone,
      email: staffPersonnelFiles.email,
      educationCount: sql<number | null>`jsonb_array_length(${staffPersonnelFiles.education})`,
      hasIban: sql<boolean>`${staffPersonnelFiles.ibanCiphertext} is not null`,
      emergencyCount: sql<
        number | null
      >`jsonb_array_length(${staffPersonnelFiles.emergencyContacts})`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(staffPersonnelFiles, fileJoin)
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({
      membershipId: row.membershipId,
      name: row.name,
      role: row.role,
      active: row.deactivatedAt === null,
      version: row.version,
      updatedAt: row.updatedAt,
      filled: {
        identity: row.version !== null && (row.hasNationalId || row.birthDate !== null),
        contact: row.address !== null || row.phone !== null || row.email !== null,
        education: Number(row.educationCount ?? 0) > 0,
        bank: row.version !== null && row.hasIban,
        emergencyContacts: Number(row.emergencyCount ?? 0) > 0,
      },
    })),
    total: totalRow?.total ?? 0,
  }
}

/**
 * Kartın sertifika özeti (DOM-FIN-113 özlük belgelerinden; K-475): yerine geçilmemiş sertifika/kurs
 * belgesi sayısı, süresi geçmiş olanlar ve en yeni belge günü.
 */
export async function personnelCertificateSummary(
  db: Database,
  institutionId: string,
  membershipId: string,
  today: string,
): Promise<{ count: number; expiredCount: number; latestDate: string | null }> {
  const current = and(
    eq(staffDocuments.institutionId, institutionId),
    eq(staffDocuments.membershipId, membershipId),
    eq(staffDocuments.documentType, 'certificate'),
    isNull(staffDocuments.supersededAt),
    isNull(staffDocuments.archivedAt),
  )
  const [summary] = await db
    .select({ total: count(), latestDate: max(staffDocuments.documentDate) })
    .from(staffDocuments)
    .where(current)
  const [expired] = await db
    .select({ total: count() })
    .from(staffDocuments)
    .where(and(current, lt(staffDocuments.validUntil, today)))
  return {
    count: summary?.total ?? 0,
    expiredCount: expired?.total ?? 0,
    latestDate: summary?.latestDate ?? null,
  }
}
