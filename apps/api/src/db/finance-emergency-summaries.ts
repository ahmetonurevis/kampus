import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'

import type { Database } from './client.ts'
import { emergencySummaries } from './schema/finance-emergency-summaries.ts'
import { infirmaryMedicationConsents } from './schema/finance-infirmary.ts'

/**
 * Acil durum özeti deposu (DOM-FIN-155; ON-165). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-emergency-summaries.ts`'tedir; şifreleme ve çözme servistedir, depo
 * şifreli değeri olduğu gibi okur ve yazar. Arşivli özet okunmaz.
 */

const s = emergencySummaries
const c = infirmaryMedicationConsents

/** Şifreli metin ve anahtar sürümü; metin yoksa `null`. */
export interface SealedText {
  ciphertext: string
  keyVersion: number
}

export interface StoredEmergencySummary {
  id: string
  studentId: string
  published: SealedText | null
  draft: SealedText | null
  reviewedProfileVersion: number | null
  reviewedProfileUpdatedAt: string | null
  approvedAt: string | null
  approvedByUserId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const COLUMNS = {
  id: s.id,
  studentId: s.studentId,
  publishedCiphertext: s.publishedCiphertext,
  publishedKeyVersion: s.publishedKeyVersion,
  draftCiphertext: s.draftCiphertext,
  draftKeyVersion: s.draftKeyVersion,
  reviewedProfileVersion: s.reviewedProfileVersion,
  reviewedProfileUpdatedAt: s.reviewedProfileUpdatedAt,
  approvedAt: s.approvedAt,
  approvedByUserId: s.approvedByUserId,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  version: s.version,
}
type Row = Pick<typeof s.$inferSelect, keyof typeof COLUMNS>

const sealed = (ciphertext: string | null, keyVersion: number | null): SealedText | null =>
  ciphertext === null || keyVersion === null ? null : { ciphertext, keyVersion }

const toSummary = (row: Row): StoredEmergencySummary => ({
  id: row.id,
  studentId: row.studentId,
  published: sealed(row.publishedCiphertext, row.publishedKeyVersion),
  draft: sealed(row.draftCiphertext, row.draftKeyVersion),
  reviewedProfileVersion: row.reviewedProfileVersion,
  reviewedProfileUpdatedAt: row.reviewedProfileUpdatedAt?.toISOString() ?? null,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  approvedByUserId: row.approvedByUserId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
})

const active = (institutionId: string) =>
  and(eq(s.institutionId, institutionId), isNull(s.archivedAt))

/** Etkin özet; arşivli, olmayan ya da başka kurumun özeti `null`. */
export async function findEmergencySummary(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredEmergencySummary | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(s)
    .where(and(active(institutionId), eq(s.id, id)))
    .limit(1)
  return row === undefined ? null : toSummary(row)
}

/** Öğrencinin etkin özeti; yoksa `null`. */
export async function findStudentEmergencySummary(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<StoredEmergencySummary | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(s)
    .where(and(active(institutionId), eq(s.studentId, studentId)))
    .limit(1)
  return row === undefined ? null : toSummary(row)
}

/**
 * Etkin özetler; `studentIds` verilirse yalnız onlar (boş dizi boş sonuç). Kurumda öğrenci başına
 * en çok bir satır olduğundan liste öğrenci sayısıyla sınırlıdır.
 */
export async function listEmergencySummaries(
  db: Database,
  institutionId: string,
  query: { studentIds?: readonly string[] | undefined; publishedOnly?: boolean } = {},
): Promise<StoredEmergencySummary[]> {
  if (query.studentIds !== undefined && query.studentIds.length === 0) return []
  const rows = await db
    .select(COLUMNS)
    .from(s)
    .where(
      and(
        active(institutionId),
        query.studentIds === undefined
          ? undefined
          : inArray(s.studentId, [...new Set(query.studentIds)]),
      ),
    )
    .orderBy(asc(s.studentId))
  const items = rows.map(toSummary)
  return query.publishedOnly === true ? items.filter((item) => item.published !== null) : items
}

export async function insertEmergencySummary(
  tx: Database,
  institutionId: string,
  input: { id: string; studentId: string; draft: SealedText; userId: string; now: Date },
): Promise<void> {
  await tx.insert(s).values({
    institutionId,
    id: input.id,
    studentId: input.studentId,
    draftCiphertext: input.draft.ciphertext,
    draftKeyVersion: input.draft.keyVersion,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

const versioned = (institutionId: string, id: string, expectedVersion: number) =>
  and(active(institutionId), eq(s.id, id), eq(s.version, expectedVersion))

/** Onay bekleyen metni yazar ya da kaldırır; sürüm tutmazsa `false` (409). */
export async function updateEmergencySummaryDraft(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    draft: SealedText | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(s)
    .set({
      draftCiphertext: input.draft?.ciphertext ?? null,
      draftKeyVersion: input.draft?.keyVersion ?? null,
      updatedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: s.id })
  return rows.length > 0
}

/** Onay: metni yayına alır, taslağı boşaltır, profil damgasını yazar; sürüm tutmazsa `false`. */
export async function publishEmergencySummary(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    published: SealedText
    reviewed: { version: number; updatedAt: string | null }
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(s)
    .set({
      publishedCiphertext: input.published.ciphertext,
      publishedKeyVersion: input.published.keyVersion,
      draftCiphertext: null,
      draftKeyVersion: null,
      reviewedProfileVersion: input.reviewed.version,
      reviewedProfileUpdatedAt:
        input.reviewed.updatedAt === null ? null : new Date(input.reviewed.updatedAt),
      approvedAt: input.now,
      approvedByUserId: input.userId,
      updatedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: s.id })
  return rows.length > 0
}

/** Arşiv; sürüm tutmazsa `false`. */
export async function archiveEmergencySummary(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(s)
    .set({
      archivedAt: input.now,
      updatedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: s.id })
  return rows.length > 0
}

/**
 * Günü kapsayan onaylı revir ilaç onayı olan öğrenciler (DOM-FIN-151, K-522). İlaç adı ve doz
 * okunmaz; yalnız öğrenci kimliği.
 */
export async function studentsWithMedicationOn(
  db: Database,
  institutionId: string,
  day: string,
  studentIds: readonly string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set()
  const rows = await db
    .selectDistinct({ studentId: c.studentId })
    .from(c)
    .where(
      and(
        eq(c.institutionId, institutionId),
        eq(c.status, 'approved'),
        lte(c.startDate, day),
        gte(c.endDate, day),
        inArray(c.studentId, [...new Set(studentIds)]),
      ),
    )
  return new Set(rows.map((row) => row.studentId))
}
