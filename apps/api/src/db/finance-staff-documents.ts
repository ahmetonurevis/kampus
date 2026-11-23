import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import type {
  HealthReportKind,
  StaffDocumentType,
  StaffDocumentTypeSetting,
  ValidUntilSource,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import type { StaffMember } from './finance-pay-rates.ts'
import { memberships, users } from './schema/auth.ts'
import { staffDocuments, staffDocumentTypeSettings } from './schema/finance-staff-documents.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Personel özlük belgesi deposu (DOM-FIN-113; ON-173). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-documents.ts`'tedir; depo yalnız okur ve yazar.
 * Belge silinmez; yerine geçilen belge `superseded_at` taşır.
 */

export interface StoredStaffDocument {
  id: string
  membershipId: string
  documentType: StaffDocumentType
  healthReportKind: HealthReportKind | null
  documentDate: string
  validUntil: string | null
  validUntilSource: ValidUntilSource
  fileId: string | null
  note: string | null
  replacesId: string | null
  supersededAt: string | null
  createdAt: string
  version: number
}

const COLUMNS = {
  id: staffDocuments.id,
  membershipId: staffDocuments.membershipId,
  documentType: staffDocuments.documentType,
  healthReportKind: staffDocuments.healthReportKind,
  documentDate: staffDocuments.documentDate,
  validUntil: staffDocuments.validUntil,
  validUntilSource: staffDocuments.validUntilSource,
  fileId: staffDocuments.fileId,
  note: staffDocuments.note,
  replacesId: staffDocuments.replacesId,
  supersededAt: staffDocuments.supersededAt,
  createdAt: staffDocuments.createdAt,
  version: staffDocuments.version,
}

type Row = Omit<StoredStaffDocument, 'createdAt' | 'supersededAt'> & {
  createdAt: Date
  supersededAt: Date | null
}
const toDocument = (row: Row): StoredStaffDocument => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  supersededAt: row.supersededAt?.toISOString() ?? null,
})

const ofInstitution = (institutionId: string) => eq(staffDocuments.institutionId, institutionId)

// --- Tür ayarları --------------------------------------------------------------------------------

/** Kurumun kayıtlı tür ayarları (satırı olmayan tür yok). */
export async function loadStaffDocumentSettings(
  db: Database,
  institutionId: string,
): Promise<{
  stored: Partial<Record<StaffDocumentType, StaffDocumentTypeSetting>>
  updatedAt: Partial<Record<StaffDocumentType, string>>
}> {
  const rows = await db
    .select({
      documentType: staffDocumentTypeSettings.documentType,
      required: staffDocumentTypeSettings.required,
      validityMonths: staffDocumentTypeSettings.validityMonths,
      sensitive: staffDocumentTypeSettings.sensitive,
      updatedAt: staffDocumentTypeSettings.updatedAt,
    })
    .from(staffDocumentTypeSettings)
    .where(eq(staffDocumentTypeSettings.institutionId, institutionId))
  const stored: Partial<Record<StaffDocumentType, StaffDocumentTypeSetting>> = {}
  const updatedAt: Partial<Record<StaffDocumentType, string>> = {}
  for (const row of rows) {
    stored[row.documentType] = {
      required: row.required,
      validityMonths: row.validityMonths,
      sensitive: row.sensitive,
    }
    updatedAt[row.documentType] = row.updatedAt.toISOString()
  }
  return { stored, updatedAt }
}

/** Gönderilen türlerin ayarını bütünüyle yazar (yoksa açar). */
export async function upsertStaffDocumentSettings(
  tx: Database,
  institutionId: string,
  input: {
    settings: Partial<Record<StaffDocumentType, StaffDocumentTypeSetting>>
    userId: string
    now: Date
  },
): Promise<void> {
  for (const [documentType, setting] of Object.entries(input.settings) as [
    StaffDocumentType,
    StaffDocumentTypeSetting | undefined,
  ][]) {
    if (setting === undefined) continue
    await tx
      .insert(staffDocumentTypeSettings)
      .values({
        institutionId,
        documentType,
        ...setting,
        updatedByUserId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [staffDocumentTypeSettings.institutionId, staffDocumentTypeSettings.documentType],
        set: {
          ...setting,
          updatedByUserId: input.userId,
          updatedAt: input.now,
          version: sql`${staffDocumentTypeSettings.version} + 1`,
        },
      })
  }
}

// --- Belgeler ------------------------------------------------------------------------------------

export async function findStaffDocument(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffDocument | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(staffDocuments)
    .where(and(ofInstitution(institutionId), eq(staffDocuments.id, id)))
    .limit(1)
  return row === undefined ? null : toDocument(row)
}

/** Personellerin bütün belgeleri (yerine geçilenler dahil), tür ve tarihe göre (yeni önce). */
export async function loadMemberDocuments(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
  options: { currentOnly?: boolean } = {},
): Promise<StoredStaffDocument[]> {
  if (membershipIds.length === 0) return []
  const rows = await db
    .select(COLUMNS)
    .from(staffDocuments)
    .where(
      and(
        ofInstitution(institutionId),
        inArray(staffDocuments.membershipId, [...new Set(membershipIds)]),
        options.currentOnly === true ? isNull(staffDocuments.supersededAt) : undefined,
      ),
    )
    .orderBy(
      asc(staffDocuments.documentType),
      sql`${staffDocuments.documentDate} desc`,
      sql`${staffDocuments.createdAt} desc`,
    )
  return rows.map(toDocument)
}

/** Personelin bu türdeki yerine geçilmemiş belgeleri (kurum kilidi altında). */
export async function loadCurrentDocumentsOfType(
  tx: Database,
  institutionId: string,
  membershipId: string,
  documentType: StaffDocumentType,
): Promise<StoredStaffDocument[]> {
  const rows = await tx
    .select(COLUMNS)
    .from(staffDocuments)
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffDocuments.membershipId, membershipId),
        eq(staffDocuments.documentType, documentType),
        isNull(staffDocuments.supersededAt),
      ),
    )
    .orderBy(sql`${staffDocuments.documentDate} desc`)
  return rows.map(toDocument)
}

export interface StaffDocumentInsert {
  id: string
  membershipId: string
  documentType: StaffDocumentType
  healthReportKind: HealthReportKind | null
  documentDate: string
  validUntil: string | null
  validUntilSource: ValidUntilSource
  fileId: string | null
  note: string | null
  replacesId: string | null
  createdByUserId: string
  now: Date
}

export async function insertStaffDocument(
  tx: Database,
  institutionId: string,
  input: StaffDocumentInsert,
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(staffDocuments)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/**
 * Belgeyi "yerine geçti" yapar; yeni belge yazılmadan önce çağrılır (tekil türün kısmi tekil
 * indeksi yeni belgeyi ancak eskisi geçmiş olunca kabul eder). Belge zaten geçmişse `false`.
 */
export async function supersedeStaffDocument(
  tx: Database,
  institutionId: string,
  input: { id: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffDocuments)
    .set({
      supersededAt: input.now,
      updatedAt: input.now,
      version: sql`${staffDocuments.version} + 1`,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffDocuments.id, input.id),
        isNull(staffDocuments.supersededAt),
      ),
    )
    .returning({ id: staffDocuments.id })
  return rows.length === 1
}

export async function staffDocumentExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffDocuments.id })
    .from(staffDocuments)
    .where(and(ofInstitution(institutionId), eq(staffDocuments.id, id)))
    .limit(1)
  return row !== undefined
}

// --- Takip ---------------------------------------------------------------------------------------

/** Takip süzgeci: `today` ve `horizon` (bugün + N gün) servis tarafından hesaplanır. */
export type DocumentDueFilter = 'expired' | 'expiring' | 'attention' | 'valid'

export interface StaffDocumentQuery {
  page: number
  pageSize: number
  q?: string | undefined
  documentType?: StaffDocumentType | undefined
  due?: DocumentDueFilter | undefined
  today: string
  horizon: string
}

function dueCondition(due: DocumentDueFilter | undefined, today: string, horizon: string) {
  const until = staffDocuments.validUntil
  switch (due) {
    case undefined:
      return undefined
    case 'expired':
      return sql`${until} < ${today}`
    case 'expiring':
      return sql`${until} >= ${today} and ${until} <= ${horizon}`
    case 'attention':
      return sql`${until} <= ${horizon}`
    case 'valid':
      return sql`(${until} is null or ${until} > ${horizon})`
    default:
      return due satisfies never
  }
}

/** Etkin personelin yerine geçilmemiş belgeleri (geçerlilik takibi), bitişe göre (yakın önce). */
const activeCurrent = (institutionId: string) =>
  and(
    ofInstitution(institutionId),
    isNull(staffDocuments.supersededAt),
    isNull(memberships.deactivatedAt),
  )

export interface StaffDocumentListRow extends StoredStaffDocument {
  staff: StaffMember
}

export async function listStaffDocuments(
  db: Database,
  institutionId: string,
  query: StaffDocumentQuery,
): Promise<{ items: StaffDocumentListRow[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    activeCurrent(institutionId),
    query.documentType === undefined
      ? undefined
      : eq(staffDocuments.documentType, query.documentType),
    dueCondition(query.due, query.today, query.horizon),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
  )
  const base = () =>
    db
      .select({
        ...COLUMNS,
        name: users.name,
        role: memberships.role,
        deactivatedAt: memberships.deactivatedAt,
      })
      .from(staffDocuments)
      .innerJoin(
        memberships,
        and(
          eq(memberships.institutionId, staffDocuments.institutionId),
          eq(memberships.id, staffDocuments.membershipId),
        ),
      )
      .innerJoin(users, eq(users.id, memberships.userId))
  const [totalRow] = await db
    .select({ total: count() })
    .from(staffDocuments)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffDocuments.institutionId),
        eq(memberships.id, staffDocuments.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await base()
    .where(where)
    .orderBy(
      sql`${staffDocuments.validUntil} asc nulls last`,
      asc(foldSql(users.name)),
      asc(staffDocuments.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ name, role, deactivatedAt, ...row }) => ({
      ...toDocument(row),
      staff: { membershipId: row.membershipId, name, role, active: deactivatedAt === null },
    })),
    total: totalRow?.total ?? 0,
  }
}

/** Süresi geçen ve `horizon`'a kadar bitecek belge sayısı (etkin personel). */
export async function countDocumentAlerts(
  db: Database,
  institutionId: string,
  today: string,
  horizon: string,
): Promise<{ expired: number; expiring: number }> {
  const until = staffDocuments.validUntil
  const [row] = await db
    .select({
      expired: sql<number>`count(*) filter (where ${until} < ${today})`.mapWith(Number),
      expiring:
        sql<number>`count(*) filter (where ${until} >= ${today} and ${until} <= ${horizon})`.mapWith(
          Number,
        ),
    })
    .from(staffDocuments)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffDocuments.institutionId),
        eq(memberships.id, staffDocuments.membershipId),
      ),
    )
    .where(and(activeCurrent(institutionId), isNotNull(until)))
  return { expired: row?.expired ?? 0, expiring: row?.expiring ?? 0 }
}

// --- Personel ------------------------------------------------------------------------------------

export interface DocumentStaffQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: 'active' | 'passive' | undefined
  /** Verilirse yalnız bu zorunlu türlerden en az biri eksik etkin personel. */
  missingOf?: readonly StaffDocumentType[] | undefined
}

/** Etkin personelde zorunlu türlerden en az biri eksik mi (SQL koşulu). */
function missingCondition(institutionId: string, required: readonly StaffDocumentType[]) {
  if (required.length === 0) return sql`false`
  return and(
    isNull(memberships.deactivatedAt),
    sql`(select count(distinct ${staffDocuments.documentType}) from ${staffDocuments}
      where ${staffDocuments.institutionId} = ${institutionId}
        and ${staffDocuments.membershipId} = ${memberships.id}
        and ${staffDocuments.supersededAt} is null
        and ${inArray(staffDocuments.documentType, [...required])}) < ${required.length}`,
  )
}

/** Kurumun personeli (yönetici, öğretmen, ön büro), ada göre; pasif personel de listelenir. */
export async function listDocumentStaff(
  db: Database,
  institutionId: string,
  query: DocumentStaffQuery,
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
    query.missingOf === undefined ? undefined : missingCondition(institutionId, query.missingOf),
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

/** Zorunlu belgesi eksik etkin personel sayısı. */
export async function countStaffMissingDocuments(
  db: Database,
  institutionId: string,
  required: readonly StaffDocumentType[],
): Promise<number> {
  if (required.length === 0) return 0
  const [row] = await db
    .select({ total: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.role, [...STAFF_ROLES]),
        missingCondition(institutionId, required),
      ),
    )
  return row?.total ?? 0
}
