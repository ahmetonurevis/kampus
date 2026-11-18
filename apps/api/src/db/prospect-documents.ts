import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import type {
  DocumentConsentGrantor,
  DocumentConsentMethod,
  ProspectDocumentStatus,
  ProspectDocumentTypeSeed,
} from '@kampus/school-core/lib/prospect-documents.ts'

import type { Database } from './client.ts'
import { files } from './schema/files.ts'
import {
  prospectDocumentConsents,
  prospectDocuments,
  prospectDocumentTypes,
} from './schema/prospect-documents.ts'
import { records } from './schema/records.ts'

/**
 * Aday belgelerinin kurum kapsamlı depo fonksiyonları (DOM-KAY-043; ON-263). İlk parametre her
 * zaman kurumdur. Belge okuması dosya satırının yalnız durumunu, türünü, boyutunu, özgün adını ve
 * imha anını alır; depo anahtarı ve özet istemciye gitmez.
 */

export type StoredDocumentType = typeof prospectDocumentTypes.$inferSelect
export type StoredProspectDocument = typeof prospectDocuments.$inferSelect
export type StoredDocumentConsent = typeof prospectDocumentConsents.$inferSelect

const typeColumns = {
  id: prospectDocumentTypes.id,
  kind: prospectDocumentTypes.kind,
  label: prospectDocumentTypes.label,
  required: prospectDocumentTypes.required,
  stage: prospectDocumentTypes.stage,
  specialCategory: prospectDocumentTypes.specialCategory,
  position: prospectDocumentTypes.position,
  archivedAt: prospectDocumentTypes.archivedAt,
  version: prospectDocumentTypes.version,
  createdAt: prospectDocumentTypes.createdAt,
  updatedAt: prospectDocumentTypes.updatedAt,
}

/** Kurumun belge türleri, sıraya göre; arşivliler istenirse (belge geçmişi adları için). */
export function listDocumentTypes(
  db: Database,
  institutionId: string,
  options: { includeArchived?: boolean } = {},
) {
  return db
    .select(typeColumns)
    .from(prospectDocumentTypes)
    .where(
      and(
        eq(prospectDocumentTypes.institutionId, institutionId),
        options.includeArchived === true ? undefined : isNull(prospectDocumentTypes.archivedAt),
      ),
    )
    .orderBy(asc(prospectDocumentTypes.position), asc(prospectDocumentTypes.id))
}

export async function findDocumentType(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(typeColumns)
    .from(prospectDocumentTypes)
    .where(
      and(eq(prospectDocumentTypes.institutionId, institutionId), eq(prospectDocumentTypes.id, id)),
    )
    .limit(1)
  return row ?? null
}

/**
 * Kurumun hiç türü yoksa (arşivliler dahil) varsayılan listeyi yazar (K-320). Varsayılan kimlikler
 * sabit olduğu için eşzamanlı iki ilk okuma aynı satırı iki kez yazamaz (`on conflict do nothing`).
 */
export async function ensureDocumentTypes(
  db: Database,
  institutionId: string,
  seeds: readonly ProspectDocumentTypeSeed[],
  now: Date,
): Promise<void> {
  const [existing] = await db
    .select({ id: prospectDocumentTypes.id })
    .from(prospectDocumentTypes)
    .where(eq(prospectDocumentTypes.institutionId, institutionId))
    .limit(1)
  if (existing !== undefined || seeds.length === 0) return
  await db
    .insert(prospectDocumentTypes)
    .values(seeds.map((seed) => ({ ...seed, institutionId, createdAt: now, updatedAt: now })))
    .onConflictDoNothing()
}

export async function insertDocumentType(
  tx: Database,
  institutionId: string,
  input: Omit<ProspectDocumentTypeSeed, 'position'> & { now: Date },
): Promise<void> {
  const [last] = await tx
    .select({ position: sql<number>`coalesce(max(${prospectDocumentTypes.position}), 0)` })
    .from(prospectDocumentTypes)
    .where(eq(prospectDocumentTypes.institutionId, institutionId))
  const { now, ...values } = input
  await tx.insert(prospectDocumentTypes).values({
    ...values,
    institutionId,
    position: Number(last?.position ?? 0) + 10,
    createdAt: now,
    updatedAt: now,
  })
}

/** Sürümü tutan arşivlenmemiş türü günceller; tutmazsa `false`. */
export async function updateDocumentType(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<Pick<StoredDocumentType, 'label' | 'required' | 'stage' | 'specialCategory'>>
    archive?: boolean
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(prospectDocumentTypes)
    .set({
      ...input.changes,
      ...(input.archive === true ? { archivedAt: input.now } : {}),
      updatedAt: input.now,
      version: sql`${prospectDocumentTypes.version} + 1`,
    })
    .where(
      and(
        eq(prospectDocumentTypes.institutionId, institutionId),
        eq(prospectDocumentTypes.id, input.id),
        eq(prospectDocumentTypes.version, input.expectedVersion),
        isNull(prospectDocumentTypes.archivedAt),
      ),
    )
    .returning({ id: prospectDocumentTypes.id })
  return rows.length === 1
}

const documentColumns = {
  id: prospectDocuments.id,
  prospectId: prospectDocuments.prospectId,
  documentTypeId: prospectDocuments.documentTypeId,
  fileId: prospectDocuments.fileId,
  status: prospectDocuments.status,
  specialCategory: prospectDocuments.specialCategory,
  rejectionReason: prospectDocuments.rejectionReason,
  uploadedByUserId: prospectDocuments.uploadedByUserId,
  reviewedAt: prospectDocuments.reviewedAt,
  supersededAt: prospectDocuments.supersededAt,
  studentId: prospectDocuments.studentId,
  linkedAt: prospectDocuments.linkedAt,
  createdAt: prospectDocuments.createdAt,
  version: prospectDocuments.version,
  fileStatus: files.status,
  fileName: files.originalName,
  fileContentType: files.contentType,
  fileByteSize: files.byteSize,
  fileRetentionUntil: files.retentionUntil,
}
export type ProspectDocumentRow = Awaited<ReturnType<typeof listProspectDocuments>>[number]

const sameFile = and(
  eq(files.institutionId, prospectDocuments.institutionId),
  eq(files.id, prospectDocuments.fileId),
)

/** Adayın arşivlenmemiş belgeleri, en yeni önce; dosyanın durumu ve imha anıyla. */
export function listProspectDocuments(db: Database, institutionId: string, prospectId: string) {
  return (
    db
      .select(documentColumns)
      .from(prospectDocuments)
      .innerJoin(files, sameFile)
      .where(
        and(
          eq(prospectDocuments.institutionId, institutionId),
          eq(prospectDocuments.prospectId, prospectId),
          isNull(prospectDocuments.archivedAt),
        ),
      )
      // Aynı anda yazılan belgelerde (sabit saatli istek) güncel belge yerine geçtiğinden önce gelir.
      .orderBy(
        desc(prospectDocuments.createdAt),
        sql`${prospectDocuments.status} = 'superseded'`,
        desc(prospectDocuments.id),
      )
  )
}

/** Adayın belgesi (başka adayın ya da başka kurumun belgesi bulunmaz). */
export async function findProspectDocument(
  db: Database,
  institutionId: string,
  prospectId: string,
  documentId: string,
): Promise<ProspectDocumentRow | null> {
  const [row] = await db
    .select(documentColumns)
    .from(prospectDocuments)
    .innerJoin(files, sameFile)
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        eq(prospectDocuments.prospectId, prospectId),
        eq(prospectDocuments.id, documentId),
        isNull(prospectDocuments.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Adayın (yerine yenisi yüklenenler dahil) belge sayısı; arşivliler sayılmaz. */
export async function countProspectDocuments(
  db: Database,
  institutionId: string,
  prospectId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(prospectDocuments)
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        eq(prospectDocuments.prospectId, prospectId),
        isNull(prospectDocuments.archivedAt),
      ),
    )
  return row?.total ?? 0
}

export async function insertProspectDocument(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    prospectId: string
    documentTypeId: string
    fileId: string
    specialCategory: boolean
    uploadedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...values } = input
  await tx.insert(prospectDocuments).values({
    ...values,
    institutionId,
    status: 'uploaded',
    createdAt: now,
    updatedAt: now,
  })
}

/** Türün güncel belgesini `superseded` yapar; dosya kimliğini döndürür (yoksa `null`). */
export async function supersedeCurrentDocument(
  tx: Database,
  institutionId: string,
  input: { prospectId: string; documentTypeId: string; supersededById: string; now: Date },
): Promise<string | null> {
  const rows = await tx
    .update(prospectDocuments)
    .set({
      status: 'superseded',
      supersededAt: input.now,
      supersededById: input.supersededById,
      updatedAt: input.now,
      version: sql`${prospectDocuments.version} + 1`,
    })
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        eq(prospectDocuments.prospectId, input.prospectId),
        eq(prospectDocuments.documentTypeId, input.documentTypeId),
        ne(prospectDocuments.status, 'superseded'),
        isNull(prospectDocuments.archivedAt),
      ),
    )
    .returning({ fileId: prospectDocuments.fileId })
  return rows[0]?.fileId ?? null
}

/** İnceleme kararı; sürüm tutmazsa ya da belge artık incelemede değilse `false`. */
export async function reviewProspectDocumentRow(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: Extract<ProspectDocumentStatus, 'accepted' | 'rejected'>
    rejectionReason: string | null
    reviewedByUserId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(prospectDocuments)
    .set({
      status: input.status,
      rejectionReason: input.rejectionReason,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: input.now,
      updatedAt: input.now,
      version: sql`${prospectDocuments.version} + 1`,
    })
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        eq(prospectDocuments.id, input.id),
        eq(prospectDocuments.version, input.expectedVersion),
        eq(prospectDocuments.status, 'uploaded'),
        isNull(prospectDocuments.archivedAt),
      ),
    )
    .returning({ id: prospectDocuments.id })
  return rows.length === 1
}

/**
 * Adayın belgeleri: `specialOnly` ile yalnız özel nitelikliler. Arşivlenmemiş satırların kimliği ve
 * dosyası; imha işaretlemesi için.
 */
export function listProspectDocumentFiles(
  db: Database,
  institutionId: string,
  prospectId: string,
  options: { specialOnly?: boolean } = {},
) {
  return db
    .select({ id: prospectDocuments.id, fileId: prospectDocuments.fileId })
    .from(prospectDocuments)
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        eq(prospectDocuments.prospectId, prospectId),
        isNull(prospectDocuments.archivedAt),
        options.specialOnly === true ? eq(prospectDocuments.specialCategory, true) : undefined,
      ),
    )
}

/** Verilen belgeleri arşivler (rıza geri çekildi; K-322). */
export async function archiveProspectDocuments(
  tx: Database,
  institutionId: string,
  ids: readonly string[],
  now: Date,
): Promise<void> {
  if (ids.length === 0) return
  await tx
    .update(prospectDocuments)
    .set({ archivedAt: now, updatedAt: now, version: sql`${prospectDocuments.version} + 1` })
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        inArray(prospectDocuments.id, [...ids]),
        isNull(prospectDocuments.archivedAt),
      ),
    )
}

/** Eksik belge hesabı için adayların güncel (yerine yenisi yüklenmemiş) belgeleri. */
export function loadGapDocuments(
  db: Database,
  institutionId: string,
  prospectIds: readonly string[] | null,
) {
  return db
    .select({
      prospectId: prospectDocuments.prospectId,
      documentTypeId: prospectDocuments.documentTypeId,
      status: prospectDocuments.status,
      fileStatus: files.status,
    })
    .from(prospectDocuments)
    .innerJoin(files, sameFile)
    .where(
      and(
        eq(prospectDocuments.institutionId, institutionId),
        ne(prospectDocuments.status, 'superseded'),
        isNull(prospectDocuments.archivedAt),
        prospectIds === null ? undefined : inArray(prospectDocuments.prospectId, [...prospectIds]),
      ),
    )
}

const text = (path: string) => sql<string | null>`(${records.data} ->> ${path}::text)`

export type DocumentProspect = {
  id: string
  name: string
  stage: string
  branchId: string | null
}

/**
 * Eksik belge listesinin adayları: açık aşamadaki arşivlenmemiş adaylar (K-321), ad sırasıyla.
 * Adaydan yalnız ad, aşama ve kampüs okunur; iletişim bilgisi belleğe yüklenmez.
 */
export async function loadOpenDocumentProspects(
  db: Database,
  institutionId: string,
  prospectIds: readonly string[] | null,
): Promise<DocumentProspect[]> {
  const rows = await db
    .select({
      id: records.id,
      name: text('name'),
      stage: text('stage'),
      branchId: text('branchId'),
    })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'prospects'),
        isNull(records.archivedAt),
        inArray(text('stage'), [...OPEN_PROSPECT_STAGES]),
        prospectIds === null ? undefined : inArray(records.id, [...prospectIds]),
      ),
    )
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name ?? '',
      stage: row.stage ?? '',
      branchId: row.branchId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id))
}

/** Adayın etkin (geri çekilmemiş) rızası. */
export async function findActiveDocumentConsent(
  db: Database,
  institutionId: string,
  prospectId: string,
): Promise<StoredDocumentConsent | null> {
  const [row] = await db
    .select()
    .from(prospectDocumentConsents)
    .where(
      and(
        eq(prospectDocumentConsents.institutionId, institutionId),
        eq(prospectDocumentConsents.prospectId, prospectId),
        isNull(prospectDocumentConsents.withdrawnAt),
        isNull(prospectDocumentConsents.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Adayın bütün rıza kayıtları, en yeni önce (ispat geçmişi). */
export function listDocumentConsents(db: Database, institutionId: string, prospectId: string) {
  return db
    .select()
    .from(prospectDocumentConsents)
    .where(
      and(
        eq(prospectDocumentConsents.institutionId, institutionId),
        eq(prospectDocumentConsents.prospectId, prospectId),
        isNull(prospectDocumentConsents.archivedAt),
      ),
    )
    .orderBy(desc(prospectDocumentConsents.grantedAt), desc(prospectDocumentConsents.id))
}

export async function insertDocumentConsent(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    prospectId: string
    grantor: DocumentConsentGrantor
    method: DocumentConsentMethod
    grantedByUserId: string
    /** Kesin kayda dönmüş adayda rızanın bağlandığı öğrenci (DOM-KAY-045, K-385). */
    studentId: string | null
    now: Date
  },
): Promise<void> {
  const { now, studentId, ...values } = input
  await tx.insert(prospectDocumentConsents).values({
    ...values,
    institutionId,
    studentId,
    linkedAt: studentId === null ? null : now,
    grantedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/** Etkin rızayı geri çeker; sürüm tutmazsa ya da rıza zaten geri çekildiyse `false`. */
export async function withdrawDocumentConsentRow(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; withdrawnByUserId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(prospectDocumentConsents)
    .set({
      withdrawnAt: input.now,
      withdrawnByUserId: input.withdrawnByUserId,
      updatedAt: input.now,
      version: sql`${prospectDocumentConsents.version} + 1`,
    })
    .where(
      and(
        eq(prospectDocumentConsents.institutionId, institutionId),
        eq(prospectDocumentConsents.id, input.id),
        eq(prospectDocumentConsents.version, input.expectedVersion),
        isNull(prospectDocumentConsents.withdrawnAt),
      ),
    )
    .returning({ id: prospectDocumentConsents.id })
  return rows.length === 1
}
