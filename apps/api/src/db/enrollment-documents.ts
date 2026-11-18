import {
  and,
  asc,
  type AnyColumn,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { ENROLLED_PROSPECT_STAGE } from '@kampus/school-core/lib/enrollment-documents.ts'

import type { Database } from './client.ts'
import { files } from './schema/files.ts'
import { prospectDocumentConsents, prospectDocuments } from './schema/prospect-documents.ts'
import { records } from './schema/records.ts'

/**
 * Kayıt belgeleri depo fonksiyonları (DOM-KAY-045; ON-344, K-384…K-386): aday belgesinin ve
 * rızanın öğrenciye bağı, imha bekletmesi ve öğrenci tarafı okuma. İlk parametre her zaman
 * kurumdur. Dosyadan yalnız durum, tür, boyut ve özgün ad okunur; depo anahtarı istemciye gitmez.
 */

const sameFile = and(
  eq(files.institutionId, prospectDocuments.institutionId),
  eq(files.id, prospectDocuments.fileId),
)

/** Adayın arşivlenmemiş belgeleri (bağlanacak aday belgeleri); `ids` verilirse yalnız onlar. */
export function listLinkCandidates(
  db: Database,
  institutionId: string,
  prospectId: string,
  ids: readonly string[] | null = null,
) {
  return db
    .select({
      id: prospectDocuments.id,
      status: prospectDocuments.status,
      specialCategory: prospectDocuments.specialCategory,
      studentId: prospectDocuments.studentId,
      fileId: prospectDocuments.fileId,
      fileStatus: files.status,
    })
    .from(prospectDocuments)
    .innerJoin(files, sameFile)
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        eq(prospectDocuments.prospectId, prospectId),
        isNull(prospectDocuments.archivedAt),
        ids === null ? undefined : inArray(prospectDocuments.id, [...ids]),
      ),
    )
}

/** Kabul edilmiş, bağsız ve arşivlenmemiş belgeleri öğrenciye bağlar; bağlanan kimlikleri döner. */
export async function linkDocumentsToStudent(
  tx: Database,
  institutionId: string,
  input: { ids: readonly string[]; studentId: string; linkedByUserId: string; now: Date },
): Promise<string[]> {
  if (input.ids.length === 0) return []
  const rows = await tx
    .update(prospectDocuments)
    .set({
      studentId: input.studentId,
      linkedAt: input.now,
      linkedByUserId: input.linkedByUserId,
      updatedAt: input.now,
      version: sql`${prospectDocuments.version} + 1`,
    })
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        inArray(prospectDocuments.id, [...input.ids]),
        eq(prospectDocuments.status, 'accepted'),
        isNull(prospectDocuments.studentId),
        isNull(prospectDocuments.archivedAt),
      ),
    )
    .returning({ id: prospectDocuments.id })
  return rows.map((row) => row.id)
}

/** Adayın etkin ve henüz bağsız rızasını öğrenciye bağlar; bağlanan rızanın kimliği ya da `null`. */
export async function linkActiveConsentToStudent(
  tx: Database,
  institutionId: string,
  input: { prospectId: string; studentId: string; now: Date },
): Promise<string | null> {
  const rows = await tx
    .update(prospectDocumentConsents)
    .set({
      studentId: input.studentId,
      linkedAt: input.now,
      updatedAt: input.now,
      version: sql`${prospectDocumentConsents.version} + 1`,
    })
    .where(
      and(
        eq(prospectDocumentConsents.institutionId, institutionId),
        eq(prospectDocumentConsents.prospectId, input.prospectId),
        isNull(prospectDocumentConsents.withdrawnAt),
        isNull(prospectDocumentConsents.archivedAt),
        isNull(prospectDocumentConsents.studentId),
      ),
    )
    .returning({ id: prospectDocumentConsents.id })
  return rows[0]?.id ?? null
}

/** İmha işi için belgenin bağ durumu (dosya kilitliyken okunur); belge yoksa `null`. */
export async function findDocumentLink(db: Database, institutionId: string, documentId: string) {
  const [row] = await db
    .select({
      studentId: prospectDocuments.studentId,
      status: prospectDocuments.status,
      archivedAt: prospectDocuments.archivedAt,
    })
    .from(prospectDocuments)
    .where(
      and(eq(prospectDocuments.institutionId, institutionId), eq(prospectDocuments.id, documentId)),
    )
    .limit(1)
  return row ?? null
}

const text = (data: AnyColumn, path: string) => sql<string | null>`(${data} ->> ${path}::text)`

export type EnrolledProspect = { prospectId: string; studentId: string; name: string }

const student = alias(records, 'student_record')

/**
 * Kesin kayda dönmüş adaylar ve öğrencileri: aday arşivlenmemiş, öğrenci arşivlenmemiş ve aktif
 * (ayrılan ve mezun listede yok; K-386). `studentId` verilirse yalnız o öğrenci, aktiflik aranmaz.
 * Ad öğrenci kaydından okunur; iletişim bilgisi belleğe yüklenmez.
 */
export async function loadEnrolledProspects(
  db: Database,
  institutionId: string,
  options: { studentId?: string } = {},
): Promise<EnrolledProspect[]> {
  const rows = await db
    .select({
      prospectId: records.id,
      studentId: student.id,
      name: text(student.data, 'name'),
    })
    .from(records)
    .innerJoin(
      student,
      and(
        eq(student.institutionId, records.institutionId),
        eq(student.collection, 'students'),
        eq(student.id, text(records.data, 'studentId')),
        isNull(student.archivedAt),
      ),
    )
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'prospects'),
        isNull(records.archivedAt),
        eq(text(records.data, 'stage'), ENROLLED_PROSPECT_STAGE),
        options.studentId === undefined
          ? sql`coalesce(${student.data} ->> 'isActive', 'true') <> 'false'`
          : eq(student.id, options.studentId),
      ),
    )
    .orderBy(asc(records.id))
  return rows.map((row) => ({
    prospectId: row.prospectId,
    studentId: row.studentId,
    name: row.name ?? '',
  }))
}

/** Öğrenci (arşivlenmemiş); başka kurumun ya da olmayan öğrenci `null`. */
export async function findStudentName(db: Database, institutionId: string, studentId: string) {
  const [row] = await db
    .select({ id: records.id, name: text(records.data, 'name') })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        eq(records.id, studentId),
        isNull(records.archivedAt),
      ),
    )
    .limit(1)
  return row === undefined ? null : { id: row.id, name: row.name ?? '' }
}

/**
 * Adayların güncel (yerine yenisi yüklenmemiş, arşivlenmemiş) belgeleri: eksik hesabı ve bağlı
 * belge sayısı için.
 */
export function loadEnrollmentDocumentStates(
  db: Database,
  institutionId: string,
  prospectIds: readonly string[],
) {
  if (prospectIds.length === 0) return Promise.resolve([])
  return db
    .select({
      prospectId: prospectDocuments.prospectId,
      documentTypeId: prospectDocuments.documentTypeId,
      status: prospectDocuments.status,
      studentId: prospectDocuments.studentId,
      fileStatus: files.status,
    })
    .from(prospectDocuments)
    .innerJoin(files, sameFile)
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        inArray(prospectDocuments.prospectId, [...prospectIds]),
        ne(prospectDocuments.status, 'superseded'),
        isNull(prospectDocuments.archivedAt),
      ),
    )
}

/** Öğrenciye bağlı, kabul edilmiş ve arşivlenmemiş belgeler; en yeni bağ önce. */
export function listStudentDocuments(db: Database, institutionId: string, studentId: string) {
  return db
    .select({
      id: prospectDocuments.id,
      prospectId: prospectDocuments.prospectId,
      documentTypeId: prospectDocuments.documentTypeId,
      specialCategory: prospectDocuments.specialCategory,
      reviewedAt: prospectDocuments.reviewedAt,
      linkedAt: prospectDocuments.linkedAt,
      fileStatus: files.status,
      fileName: files.originalName,
      fileContentType: files.contentType,
      fileByteSize: files.byteSize,
    })
    .from(prospectDocuments)
    .innerJoin(files, sameFile)
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        eq(prospectDocuments.studentId, studentId),
        eq(prospectDocuments.status, 'accepted'),
        isNull(prospectDocuments.archivedAt),
      ),
    )
    .orderBy(desc(prospectDocuments.linkedAt), desc(prospectDocuments.id))
}

/** Öğrenciye bağlı etkin rıza (geri çekilmemiş); yoksa `null`. */
export async function findStudentConsent(db: Database, institutionId: string, studentId: string) {
  const [row] = await db
    .select({
      id: prospectDocumentConsents.id,
      grantor: prospectDocumentConsents.grantor,
      grantedAt: prospectDocumentConsents.grantedAt,
      linkedAt: prospectDocumentConsents.linkedAt,
    })
    .from(prospectDocumentConsents)
    .where(
      and(
        eq(prospectDocumentConsents.institutionId, institutionId),
        eq(prospectDocumentConsents.studentId, studentId),
        isNotNull(prospectDocumentConsents.linkedAt),
        isNull(prospectDocumentConsents.withdrawnAt),
        isNull(prospectDocumentConsents.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}
