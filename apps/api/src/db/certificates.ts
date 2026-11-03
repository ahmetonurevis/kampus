import { randomUUID } from 'node:crypto'

import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import {
  certificateContentSchema,
  type CertificateCancellation,
  type CertificateDraft,
  type CertificateRecord,
  type CertificateStatus,
  type MebbisRecord,
  type MebbisRecordDraft,
} from '@kampus/school-core/cefr/certificates.ts'

import type { Database } from './client.ts'
import {
  certificateCounters,
  courseCertificates,
  mebbisCertificateRecords,
} from './schema/certificates.ts'

/**
 * Kurum başarı belgesi ve MEBBİS izi deposu (OG-088; DOM-DIL-080, 081, 082). Kurum kapsamlıdır:
 * ilk parametre `institutionId`; tek istisna kimliksiz doğrulamanın kodla aramasıdır
 * (`findCertificateByCode`). Kural core `cefr/certificates.ts` planlarındadır; servis bu
 * fonksiyonları onların çıktısıyla kurum kilidi altında tek işlemde çağırır. Belge içeriği
 * okumada core şemasıyla doğrulanır; bozuk satır sessizce gösterilmez.
 */

/** Saklanan belge: core `CertificateRecord`, kaydın grubu ve satır sürümü (`If-Match`). */
export type StoredCertificate = CertificateRecord & {
  groupId: string
  rowVersion: number
}

type CertificateRow = typeof courseCertificates.$inferSelect
const iso = (value: Date | null) => (value === null ? null : value.toISOString())

function toCertificate(row: CertificateRow): StoredCertificate {
  return {
    groupId: row.groupId,
    rowVersion: row.version,
    id: row.id,
    enrollmentId: row.enrollmentId,
    learnerId: row.learnerId,
    courseId: row.courseId,
    decisionId: row.decisionId,
    serial: row.serial,
    number: row.number,
    verificationCode: row.verificationCode,
    status: row.status,
    content: certificateContentSchema.parse(row.content),
    replacesCertificateId: row.replacesCertificateId,
    issuedByUserId: row.issuedByUserId,
    issuedAt: row.issuedAt.toISOString(),
    cancelledByUserId: row.cancelledByUserId,
    cancelledAt: iso(row.cancelledAt),
    cancellationReason: row.cancellationReason,
  }
}

/**
 * Kurumun sıradaki belge sıra numarası (DOM-DIL-082). Sayaç satırı `on conflict do update` ile
 * kilitlenerek artırılır; eşzamanlı iki düzenleme aynı numarayı alamaz. İşlem geri alınırsa sayaç
 * da geri alınır; numara hiç görünmediği için yeniden verilmesi tekrar kullanım değildir. Sayaç
 * yalnız artar (`kampus_certificate_counter_guard()`).
 */
export async function nextCertificateSerial(db: Database, institutionId: string): Promise<number> {
  const [row] = await db
    .insert(certificateCounters)
    .values({ institutionId, lastSerial: 1 })
    .onConflictDoUpdate({
      target: certificateCounters.institutionId,
      set: {
        lastSerial: sql`${certificateCounters.lastSerial} + 1`,
        updatedAt: sql`now()`,
        version: sql`${certificateCounters.version} + 1`,
      },
    })
    .returning({ lastSerial: certificateCounters.lastSerial })
  if (row === undefined) throw new Error('certificate counter returned no row')
  return row.lastSerial
}

/** Yazılacak belge: core planı, kaydın grubu, sıra ve belge numarası, doğrulama kodu. */
export type CertificateWrite = CertificateDraft & {
  groupId: string
  serial: number
  number: string
  verificationCode: string
}

/**
 * Belgeyi yazar. Aynı kayda ikinci geçerli belge (`course_certificates_valid_enrollment_key`) ve
 * aynı iptal edilmiş belgenin yerine ikinci belge 23505 ile; uyuşmaz kayıt, grup, kur ya da karar
 * 23503 ile reddedilir.
 */
export async function insertCertificate(
  db: Database,
  institutionId: string,
  write: CertificateWrite,
  id: string = randomUUID(),
): Promise<StoredCertificate> {
  const [row] = await db
    .insert(courseCertificates)
    .values({
      institutionId,
      id,
      serial: write.serial,
      number: write.number,
      verificationCode: write.verificationCode,
      enrollmentId: write.enrollmentId,
      groupId: write.groupId,
      courseId: write.courseId,
      learnerId: write.learnerId,
      decisionId: write.decisionId,
      status: write.status,
      content: write.content,
      replacesCertificateId: write.replacesCertificateId,
      issuedByUserId: write.issuedByUserId,
      issuedAt: new Date(write.issuedAt),
    })
    .returning()
  if (row === undefined) throw new Error('certificate insert returned no row')
  return toCertificate(row)
}

/** Kurumun belgesi; yoksa ya da başka kurumunsa `null`. */
export async function findCertificate(
  db: Database,
  institutionId: string,
  certificateId: string,
): Promise<StoredCertificate | null> {
  const [row] = await db
    .select()
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.institutionId, institutionId),
        eq(courseCertificates.id, certificateId),
      ),
    )
  return row === undefined ? null : toCertificate(row)
}

/**
 * Doğrulama kodunun belgesi (kanonik biçim, core `normalizeVerificationCode`). Kurumsuzdur:
 * kimliksiz doğrulama ucu kurum kimliği okumaz; kod kurumlar arası tekildir.
 */
export async function findCertificateByCode(
  db: Database,
  verificationCode: string,
): Promise<StoredCertificate | null> {
  const [row] = await db
    .select()
    .from(courseCertificates)
    .where(eq(courseCertificates.verificationCode, verificationCode))
  return row === undefined ? null : toCertificate(row)
}

/** Kur kaydının bütün belgeleri (geçerli ve iptal), düzenleme sırasıyla. */
export async function listEnrollmentCertificates(
  db: Database,
  institutionId: string,
  enrollmentId: string,
): Promise<StoredCertificate[]> {
  const rows = await db
    .select()
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.institutionId, institutionId),
        eq(courseCertificates.enrollmentId, enrollmentId),
      ),
    )
    .orderBy(courseCertificates.serial)
  return rows.map(toCertificate)
}

/**
 * Belge listesi süzgeci: kapsam (`groupIds` personel, `learnerIds` kursiyer/veli; verilmezse kurumun
 * bütünü) ve istemci süzgeçleri. Boş kapsam listesi boş sonuç demektir.
 */
export type CertificateListFilter = {
  groupIds?: readonly string[]
  learnerIds?: readonly string[]
  status?: CertificateStatus
  studentId?: string
  courseId?: string
  page: number
  pageSize: number
}

/** Kurumun belgeleri, yeniden eskiye; sayfalı ve toplamlı. */
export async function listCertificates(
  db: Database,
  institutionId: string,
  filter: CertificateListFilter,
): Promise<{ items: StoredCertificate[]; total: number }> {
  if (filter.groupIds?.length === 0 || filter.learnerIds?.length === 0)
    return { items: [], total: 0 }
  const conditions: SQL[] = [eq(courseCertificates.institutionId, institutionId)]
  if (filter.groupIds) conditions.push(inArray(courseCertificates.groupId, [...filter.groupIds]))
  if (filter.learnerIds)
    conditions.push(inArray(courseCertificates.learnerId, [...filter.learnerIds]))
  if (filter.status) conditions.push(eq(courseCertificates.status, filter.status))
  if (filter.studentId) conditions.push(eq(courseCertificates.learnerId, filter.studentId))
  if (filter.courseId) conditions.push(eq(courseCertificates.courseId, filter.courseId))
  const where = and(...conditions)
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(courseCertificates)
      .where(where)
      .orderBy(desc(courseCertificates.serial))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db.select({ total: count() }).from(courseCertificates).where(where),
  ])
  return { items: rows.map(toCertificate), total: totals?.total ?? 0 }
}

/**
 * İptali yazar (core `planCertificateCancellation` çıktısı). Yalnız geçerli ve beklenen sürümdeki
 * satır güncellenir, sürüm bir artar; aksi halde `null` (eşzamanlı ikinci iptal 409 olur).
 * İçeriği ve iptal edilmiş belgeyi tetikleyici de korur.
 */
export async function saveCertificateCancellation(
  db: Database,
  institutionId: string,
  certificateId: string,
  expectedVersion: number,
  cancellation: CertificateCancellation,
  now: Date,
): Promise<StoredCertificate | null> {
  const [row] = await db
    .update(courseCertificates)
    .set({
      status: cancellation.status,
      cancelledByUserId: cancellation.cancelledByUserId,
      cancelledAt: cancellation.cancelledAt === null ? null : new Date(cancellation.cancelledAt),
      cancellationReason: cancellation.cancellationReason,
      updatedAt: now,
      version: sql`${courseCertificates.version} + 1`,
    })
    .where(
      and(
        eq(courseCertificates.institutionId, institutionId),
        eq(courseCertificates.id, certificateId),
        eq(courseCertificates.version, expectedVersion),
        eq(courseCertificates.status, 'valid'),
      ),
    )
    .returning()
  return row === undefined ? null : toCertificate(row)
}

// --- MEBBİS izi (DOM-DIL-080) -------------------------------------------------------------

type MebbisRow = typeof mebbisCertificateRecords.$inferSelect

function toMebbis(row: MebbisRow): MebbisRecord {
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    learnerId: row.learnerId,
    decisionId: row.decisionId,
    certificateNumber: row.certificateNumber,
    issuedDate: row.issuedDate,
    recordedByUserId: row.recordedByUserId,
    recordedAt: row.recordedAt.toISOString(),
  }
}

/** MEBBİS izini yazar; karar başına ikinci iz 23505 (`mebbis_already_recorded`). */
export async function insertMebbisRecord(
  db: Database,
  institutionId: string,
  draft: MebbisRecordDraft & { groupId: string },
  id: string = randomUUID(),
): Promise<MebbisRecord> {
  const [row] = await db
    .insert(mebbisCertificateRecords)
    .values({
      institutionId,
      id,
      enrollmentId: draft.enrollmentId,
      groupId: draft.groupId,
      learnerId: draft.learnerId,
      decisionId: draft.decisionId,
      certificateNumber: draft.certificateNumber,
      issuedDate: draft.issuedDate,
      recordedByUserId: draft.recordedByUserId,
      recordedAt: new Date(draft.recordedAt),
    })
    .returning()
  if (row === undefined) throw new Error('mebbis record insert returned no row')
  return toMebbis(row)
}

/** Kayıtların MEBBİS izleri. */
export async function listMebbisRecords(
  db: Database,
  institutionId: string,
  enrollmentIds: readonly string[],
): Promise<MebbisRecord[]> {
  if (enrollmentIds.length === 0) return []
  const rows = await db
    .select()
    .from(mebbisCertificateRecords)
    .where(
      and(
        eq(mebbisCertificateRecords.institutionId, institutionId),
        inArray(mebbisCertificateRecords.enrollmentId, [...enrollmentIds]),
      ),
    )
  return rows.map(toMebbis)
}
