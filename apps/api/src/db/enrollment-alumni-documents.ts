import { and, asc, count, desc, eq, inArray, isNull, max, ne, or, sql, type SQL } from 'drizzle-orm'

import type {
  AlumniCourseFact,
  AlumniDeliveryMethod,
  AlumniDocumentContent,
  AlumniDocumentFees,
  AlumniDocumentType,
  AlumniFeePaymentMethod,
  AlumniRequestChannel,
  AlumniRequesterKind,
  AlumniRequestStatus,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'
import type { CustodyKind } from '@kampus/school-core/lib/guardianship.ts'

import type { Database } from './client.ts'
import { courses } from './schema/courses.ts'
import { alumniDocumentFees, alumniDocumentRequests } from './schema/enrollment-alumni-documents.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'
import { records } from './schema/records.ts'
import { studentGuardians } from './schema/student-guardians.ts'
import { studentIdentities } from './schema/student-identities.ts'
import { studentWithdrawals } from './schema/withdrawals.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Mezun belge talebi deposu (DOM-KAY-044; ON-260). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/enrollment-alumni-documents.ts`'tedir. Öğrenci, veli, sınıf,
 * not ve yenileme kayıtları `records`'tadır; burada yalnız belgenin okuduğu alanlar alınır.
 */

const ofInstitution = (institutionId: string) =>
  eq(alumniDocumentRequests.institutionId, institutionId)
const studentName = sql<string>`${records.data} ->> 'name'`

export interface StoredAlumniRequest {
  id: string
  studentId: string
  studentName: string | null
  documentType: AlumniDocumentType
  copies: number
  channel: AlumniRequestChannel
  requesterKind: AlumniRequesterKind
  guardianParentId: string | null
  requesterName: string
  authorizationFileId: string | null
  deliveryMethod: AlumniDeliveryMethod
  deliveryEmail: string | null
  deliveryAddress: string | null
  feeCents: number
  status: AlumniRequestStatus
  receivedByUserId: string
  preparingAt: Date | null
  preparingByUserId: string | null
  readyAt: Date | null
  readyByUserId: string | null
  documentYear: number | null
  documentSequence: number | null
  documentContent: AlumniDocumentContent | null
  manualNote: string | null
  diplomaFileId: string | null
  deliveredAt: Date | null
  deliveredByUserId: string | null
  identityCheckNote: string | null
  paymentMethod: AlumniFeePaymentMethod | null
  paidAt: Date | null
  rejectedAt: Date | null
  rejectedByUserId: string | null
  rejectionReason: string | null
  createdAt: Date
  version: number
}

function selectRequests(db: Database) {
  const t = alumniDocumentRequests
  return db
    .select({
      id: t.id,
      studentId: t.studentId,
      studentName,
      documentType: t.documentType,
      copies: t.copies,
      channel: t.channel,
      requesterKind: t.requesterKind,
      guardianParentId: t.guardianParentId,
      requesterName: t.requesterName,
      authorizationFileId: t.authorizationFileId,
      deliveryMethod: t.deliveryMethod,
      deliveryEmail: t.deliveryEmail,
      deliveryAddress: t.deliveryAddress,
      feeCents: t.feeCents,
      status: t.status,
      receivedByUserId: t.receivedByUserId,
      preparingAt: t.preparingAt,
      preparingByUserId: t.preparingByUserId,
      readyAt: t.readyAt,
      readyByUserId: t.readyByUserId,
      documentYear: t.documentYear,
      documentSequence: t.documentSequence,
      documentContent: t.documentContent,
      manualNote: t.manualNote,
      diplomaFileId: t.diplomaFileId,
      deliveredAt: t.deliveredAt,
      deliveredByUserId: t.deliveredByUserId,
      identityCheckNote: t.identityCheckNote,
      paymentMethod: t.paymentMethod,
      paidAt: t.paidAt,
      rejectedAt: t.rejectedAt,
      rejectedByUserId: t.rejectedByUserId,
      rejectionReason: t.rejectionReason,
      createdAt: t.createdAt,
      version: t.version,
    })
    .from(t)
    .leftJoin(
      records,
      and(
        eq(records.institutionId, t.institutionId),
        eq(records.collection, 'students'),
        eq(records.id, t.studentId),
      ),
    )
}

export async function findAlumniRequest(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredAlumniRequest | null> {
  const [row] = await selectRequests(db)
    .where(
      and(
        ofInstitution(institutionId),
        eq(alumniDocumentRequests.id, id),
        isNull(alumniDocumentRequests.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export interface AlumniRequestQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: AlumniRequestStatus | undefined
  documentType?: AlumniDocumentType | undefined
  studentId?: string | undefined
}

/** `MB-2026-0007` biçimindeki belge numarası; değilse `null`. */
function numberOf(search: string): { year: number; sequence: number } | null {
  const match = /^mb-?(\d{4})-?0*(\d{1,9})$/i.exec(search.trim())
  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { year: Number(match[1]), sequence: Number(match[2]) }
}

/**
 * Talepler, yeni alınan önce. `q` öğrencinin ya da talep edenin adında ve belge numarasında arar.
 * Arşivlenmiş talep listelenmez.
 */
export async function listAlumniRequests(
  db: Database,
  institutionId: string,
  query: AlumniRequestQuery,
): Promise<{ items: StoredAlumniRequest[]; total: number }> {
  const t = alumniDocumentRequests
  const filters: SQL[] = [ofInstitution(institutionId), isNull(t.archivedAt)]
  if (query.q !== undefined && query.q.trim() !== '') {
    const search = foldSearch(query.q.trim())
    const number = numberOf(query.q)
    const matches: SQL[] = [
      sql`strpos(${foldSql(studentName)}, ${search}) > 0`,
      sql`strpos(${foldSql(t.requesterName)}, ${search}) > 0`,
    ]
    if (number !== null) {
      const exact = and(eq(t.documentYear, number.year), eq(t.documentSequence, number.sequence))
      if (exact) matches.push(exact)
    }
    const combined = or(...matches)
    if (combined) filters.push(combined)
  }
  if (query.status !== undefined) filters.push(eq(t.status, query.status))
  if (query.documentType !== undefined) filters.push(eq(t.documentType, query.documentType))
  if (query.studentId !== undefined) filters.push(eq(t.studentId, query.studentId))
  const where = and(...filters)
  const studentJoin = and(
    eq(records.institutionId, t.institutionId),
    eq(records.collection, 'students'),
    eq(records.id, t.studentId),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(t)
    .leftJoin(records, studentJoin)
    .where(where)
  const rows = await selectRequests(db)
    .where(where)
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows, total: totalRow?.total ?? 0 }
}

export async function insertAlumniRequest(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    studentId: string
    documentType: AlumniDocumentType
    copies: number
    channel: AlumniRequestChannel
    requesterKind: AlumniRequesterKind
    guardianParentId: string | null
    requesterName: string
    authorizationFileId: string | null
    deliveryMethod: AlumniDeliveryMethod
    deliveryEmail: string | null
    deliveryAddress: string | null
    feeCents: number
    receivedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...values } = input
  await tx
    .insert(alumniDocumentRequests)
    .values({ institutionId, ...values, createdAt: now, updatedAt: now })
}

export type AlumniRequestUpdate = Partial<
  Pick<
    typeof alumniDocumentRequests.$inferInsert,
    | 'status'
    | 'preparingAt'
    | 'preparingByUserId'
    | 'readyAt'
    | 'readyByUserId'
    | 'documentYear'
    | 'documentSequence'
    | 'documentContent'
    | 'manualNote'
    | 'diplomaFileId'
    | 'deliveredAt'
    | 'deliveredByUserId'
    | 'identityCheckNote'
    | 'paymentMethod'
    | 'paidAt'
    | 'rejectedAt'
    | 'rejectedByUserId'
    | 'rejectionReason'
  >
>

export async function updateAlumniRequest(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: AlumniRequestUpdate; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(alumniDocumentRequests)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(alumniDocumentRequests.id, input.id),
        eq(alumniDocumentRequests.version, input.expectedVersion),
      ),
    )
    .returning({ id: alumniDocumentRequests.id })
  return rows.length === 1
}

/** Yılın sıradaki belge numarası; kurum kilidi altında çağrılır. */
export async function nextAlumniDocumentSequence(
  tx: Database,
  institutionId: string,
  year: number,
): Promise<number> {
  const [row] = await tx
    .select({ last: max(alumniDocumentRequests.documentSequence) })
    .from(alumniDocumentRequests)
    .where(and(ofInstitution(institutionId), eq(alumniDocumentRequests.documentYear, year)))
  return (row?.last ?? 0) + 1
}

// --- Ücret ayarı ---------------------------------------------------------------------------------

export async function loadAlumniFees(
  db: Database,
  institutionId: string,
): Promise<{ fees: AlumniDocumentFees; updatedAt: Date | null }> {
  const rows = await db
    .select({
      documentType: alumniDocumentFees.documentType,
      feeCents: alumniDocumentFees.feeCents,
      updatedAt: alumniDocumentFees.updatedAt,
    })
    .from(alumniDocumentFees)
    .where(
      and(
        eq(alumniDocumentFees.institutionId, institutionId),
        isNull(alumniDocumentFees.archivedAt),
      ),
    )
  const fees: AlumniDocumentFees = { education_certificate: 0, transcript: 0, diploma_copy: 0 }
  let updatedAt: Date | null = null
  for (const row of rows) {
    fees[row.documentType] = row.feeCents
    if (updatedAt === null || row.updatedAt > updatedAt) updatedAt = row.updatedAt
  }
  return { fees, updatedAt }
}

export async function upsertAlumniFees(
  tx: Database,
  institutionId: string,
  input: { fees: Partial<AlumniDocumentFees>; userId: string; now: Date },
): Promise<void> {
  for (const [documentType, feeCents] of Object.entries(input.fees) as [
    AlumniDocumentType,
    number,
  ][]) {
    await tx
      .insert(alumniDocumentFees)
      .values({
        institutionId,
        documentType,
        feeCents,
        updatedByUserId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [alumniDocumentFees.institutionId, alumniDocumentFees.documentType],
        set: {
          feeCents,
          updatedByUserId: input.userId,
          updatedAt: input.now,
          archivedAt: null,
          version: sql`${alumniDocumentFees.version} + 1`,
        },
      })
  }
}

// --- Öğrenci bilgileri ---------------------------------------------------------------------------

export interface AlumniStudentRow {
  id: string
  data: Record<string, unknown>
}

/**
 * Pasif (mezun ya da ayrılmış) öğrenciler, ada göre; `q` adda ya da okul numarasında arar. Arşivlenmiş
 * öğrenci kaydı yoktur.
 */
export async function listInactiveStudents(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{ items: AlumniStudentRow[]; total: number }> {
  const filters: SQL[] = [
    eq(records.institutionId, institutionId),
    eq(records.collection, 'students'),
    isNull(records.archivedAt),
    sql`${records.data} -> 'isActive' = 'false'::jsonb`,
  ]
  if (query.q !== undefined && query.q.trim() !== '') {
    const search = foldSearch(query.q.trim())
    const match = or(
      sql`strpos(${foldSql(studentName)}, ${search}) > 0`,
      sql`strpos(${foldSql(sql`coalesce(${records.data} ->> 'number', '')`)}, ${search}) > 0`,
    )
    if (match) filters.push(match)
  }
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(records).where(where)
  const rows = await db
    .select({ id: records.id, data: records.data })
    .from(records)
    .where(where)
    .orderBy(asc(studentName), asc(records.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({ id: row.id, data: row.data as Record<string, unknown> })),
    total: totalRow?.total ?? 0,
  }
}

/** Öğrencilerin doğum günleri (kimlik tablosu; ayrılışta arşivlenen satır da okunur). */
export async function loadBirthDates(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map()
  const rows = await db
    .select({ studentId: studentIdentities.studentId, birthDate: studentIdentities.birthDate })
    .from(studentIdentities)
    .where(
      and(
        eq(studentIdentities.institutionId, institutionId),
        inArray(studentIdentities.studentId, [...new Set(studentIds)]),
      ),
    )
  return new Map(rows.map((row) => [row.studentId, row.birthDate]))
}

/** Öğrencilerin son ayrılış günü. */
export async function loadWithdrawalDates(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map()
  const rows = await db
    .select({
      studentId: studentWithdrawals.studentId,
      withdrawalDate: studentWithdrawals.withdrawalDate,
    })
    .from(studentWithdrawals)
    .where(
      and(
        eq(studentWithdrawals.institutionId, institutionId),
        isNull(studentWithdrawals.archivedAt),
        inArray(studentWithdrawals.studentId, [...new Set(studentIds)]),
      ),
    )
  const latest = new Map<string, string>()
  for (const row of rows) {
    const current = latest.get(row.studentId)
    if (current === undefined || row.withdrawalDate > current)
      latest.set(row.studentId, row.withdrawalDate)
  }
  return latest
}

export interface AlumniGuardianBondRow {
  studentId: string
  parentId: string
  custody: CustodyKind
  contactRestricted: boolean
}

/** Öğrencilerin veli kaydına bağlı etkin bağları (velayet ve kısıt; DOM-ILT-070, DOM-ILT-074). */
export async function loadGuardianBonds(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<AlumniGuardianBondRow[]> {
  if (studentIds.length === 0) return []
  const rows = await db
    .select({
      studentId: studentGuardians.studentId,
      parentId: studentGuardians.parentId,
      custody: studentGuardians.custody,
      contactRestricted: studentGuardians.isContactRestricted,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.institutionId, institutionId),
        isNull(studentGuardians.archivedAt),
        inArray(studentGuardians.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(asc(studentGuardians.studentId), asc(studentGuardians.id))
  return rows.flatMap((row) => (row.parentId === null ? [] : [{ ...row, parentId: row.parentId }]))
}

/**
 * Dil okulunda kursiyerin katıldığı kurlar (not dökümü): iptal edilmemiş gruplardaki üyelikler,
 * dondurulmuş ve arşivlenmiş (birleştirme, ayrılış) satırlar dahil. Gelecekte başlayan grup yazılmaz.
 */
export async function loadAlumniCourses(
  db: Database,
  institutionId: string,
  studentId: string,
  today: string,
): Promise<AlumniCourseFact[]> {
  const rows = await db
    .select({
      name: courses.name,
      level: courses.level,
      groupName: languageGroups.name,
      startDate: languageGroups.startDate,
      endDate: languageGroups.endDate,
    })
    .from(languageGroupMembers)
    .innerJoin(
      languageGroups,
      and(
        eq(languageGroups.institutionId, languageGroupMembers.institutionId),
        eq(languageGroups.id, languageGroupMembers.groupId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.institutionId, languageGroups.institutionId),
        eq(courses.id, languageGroups.courseId),
      ),
    )
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        eq(languageGroupMembers.studentId, studentId),
        isNull(languageGroups.archivedAt),
        ne(languageGroups.state, 'cancelled'),
        sql`${languageGroups.startDate} <= ${today}`,
      ),
    )
  return rows.map((row) => ({ ...row, level: String(row.level) }))
}
