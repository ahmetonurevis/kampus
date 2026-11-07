import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'

import { effectiveProgressionDecision } from '@kampus/school-core/cefr/progression.ts'
import {
  E_OZEL_INITIAL_VERSION,
  eOzelKey,
  type EOzelKind,
  type EOzelMark,
} from '@kampus/school-core/lib/finance-e-ozel.ts'

import { listMebbisRecords } from './certificates.ts'
import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { lessonHourAttendances, progressionDecisions } from './schema/cefr.ts'
import { courses } from './schema/courses.ts'
import { eOzelRecords } from './schema/finance-e-ozel.ts'
import { languageGroups } from './schema/language-groups.ts'
import { payments, PAYMENT_METHOD_KEYS } from './schema/payments.ts'
import { records } from './schema/records.ts'
import { studentIdentities } from './schema/student-identities.ts'

/**
 * e-Özel işlem listesinin deposu (IST-085). Yazdığı tek tablo `e_ozel_records`'tur. Kur, grup,
 * yoklama ve kur sonu tabloları başka alanındır, burada yalnız okunur.
 */

export async function listEOzelMarks(
  db: Database,
  institutionId: string,
): Promise<Map<string, EOzelMark>> {
  const rows = await db
    .select({
      kind: eOzelRecords.kind,
      sourceId: eOzelRecords.sourceId,
      recordedAt: eOzelRecords.recordedAt,
      recordedByUserId: eOzelRecords.recordedByUserId,
      version: eOzelRecords.version,
      fingerprint: eOzelRecords.recordedFingerprint,
    })
    .from(eOzelRecords)
    .where(and(eq(eOzelRecords.institutionId, institutionId), isNull(eOzelRecords.archivedAt)))
  return new Map(
    rows.map((row) => [
      eOzelKey(row.kind as EOzelKind, row.sourceId),
      {
        recordedAt: row.recordedAt?.toISOString() ?? null,
        recordedByUserId: row.recordedByUserId,
        version: row.version,
        fingerprint: row.fingerprint,
      },
    ]),
  )
}

/**
 * İşareti yazar ya da boşaltır; sürüm tutmazsa `null` (409). Satırı olmayan kaydın sürümü
 * `E_OZEL_INITIAL_VERSION`'dır: ilk yazım satırı açar, eşzamanlı ikinci yazım birincil anahtara
 * takılır.
 */
export async function saveEOzelMark(
  tx: Database,
  institutionId: string,
  input: {
    kind: EOzelKind
    sourceId: string
    expectedVersion: number
    recordedByUserId: string | null
    fingerprint: string | null
    now: Date
  },
): Promise<{ version: number } | null> {
  const recordedAt = input.recordedByUserId === null ? null : input.now
  if (input.expectedVersion === E_OZEL_INITIAL_VERSION) {
    const [created] = await tx
      .insert(eOzelRecords)
      .values({
        institutionId,
        kind: input.kind,
        sourceId: input.sourceId,
        recordedAt,
        recordedByUserId: input.recordedByUserId,
        recordedFingerprint: input.fingerprint,
        version: E_OZEL_INITIAL_VERSION + 1,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ version: eOzelRecords.version })
    return created ?? null
  }
  const [updated] = await tx
    .update(eOzelRecords)
    .set({
      recordedAt,
      recordedByUserId: input.recordedByUserId,
      recordedFingerprint: input.fingerprint,
      version: sql`${eOzelRecords.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(eOzelRecords.institutionId, institutionId),
        eq(eOzelRecords.kind, input.kind),
        eq(eOzelRecords.sourceId, input.sourceId),
        eq(eOzelRecords.version, input.expectedVersion),
      ),
    )
    .returning({ version: eOzelRecords.version })
  return updated ?? null
}

/**
 * Arşivlenmemiş kimlikler. Numara yalnız maskeleme için okunur; loglanmaz, dışarı çıkmaz. Sürüm
 * parmak izine girer: kimlik satırının değişimi numara özetlenmeden anlaşılır.
 */
export async function loadLearnerIdentities(db: Database, institutionId: string) {
  const rows = await db
    .select({
      studentId: studentIdentities.studentId,
      kind: studentIdentities.identityKind,
      number: studentIdentities.identityNumber,
      birthDate: studentIdentities.birthDate,
      createdAt: studentIdentities.createdAt,
      version: studentIdentities.version,
    })
    .from(studentIdentities)
    .where(
      and(eq(studentIdentities.institutionId, institutionId), isNull(studentIdentities.archivedAt)),
    )
  return new Map(rows.map((row) => [row.studentId, row]))
}

/**
 * Tek kursiyerin tam kimlik numarası (satır başına "Göster", DOM-YTK-052). Arşivlenmiş kimlik listede
 * görünmediği için burada da okunmaz. Çağıran aynı transaction'da denetime yazar.
 */
export async function findLearnerFullIdentity(
  db: Database,
  institutionId: string,
  studentId: string,
) {
  const [row] = await db
    .select({
      identityKind: studentIdentities.identityKind,
      identityNumber: studentIdentities.identityNumber,
    })
    .from(studentIdentities)
    .where(
      and(
        eq(studentIdentities.institutionId, institutionId),
        eq(studentIdentities.studentId, studentId),
        isNull(studentIdentities.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

const METHOD_LABELS = new Map<string, string>(
  Object.entries(PAYMENT_METHOD_KEYS).map(([label, key]) => [key, label]),
)

/**
 * İptal edilmemiş tahsilatlar ve işaretliyken iptal edilenler, MEBBİS işaretleriyle (DOM-FIN-032).
 * İşlenmiş tahsilatın iptali e-Özel'de düzeltme gerektirir, satır listede kalır.
 */
export async function loadFeeRows(db: Database, institutionId: string) {
  const rows = await db
    .select({
      id: payments.id,
      studentId: payments.studentId,
      studentName: sql<string | null>`${records.data} ->> 'name'`,
      amountCents: payments.amountCents,
      method: payments.method,
      reference: payments.reference,
      paidAt: payments.paidAt,
      receiptYear: payments.receiptYear,
      receiptNumber: payments.receiptNumber,
      reversedAt: payments.reversedAt,
      mebbisRecordedAt: payments.mebbisRecordedAt,
      mebbisRecordedByUserId: payments.mebbisRecordedByUserId,
      mebbisFingerprint: payments.mebbisFingerprint,
      version: payments.version,
    })
    .from(payments)
    .leftJoin(
      records,
      and(
        eq(records.institutionId, payments.institutionId),
        eq(records.collection, 'students'),
        eq(records.id, payments.studentId),
        isNull(records.archivedAt),
      ),
    )
    .where(
      and(
        eq(payments.institutionId, institutionId),
        or(isNull(payments.reversedAt), isNotNull(payments.mebbisRecordedAt)),
        isNull(payments.archivedAt),
      ),
    )
  return rows.map((row) => ({ ...row, method: METHOD_LABELS.get(row.method) ?? row.method }))
}

/**
 * `gelmedi` ders saati satırları (DOM-DIL-061) ve durumu sonradan değişmiş olabilecek işaretli
 * satırlar; grup ve kur adıyla, yalnız okunur.
 */
export async function loadAbsentLessonHours(
  db: Database,
  institutionId: string,
  markedIds: ReadonlySet<string>,
) {
  const current = and(
    eq(lessonHourAttendances.status, 'absent'),
    isNull(lessonHourAttendances.archivedAt),
  )
  const rows = await db
    .select({
      id: lessonHourAttendances.id,
      learnerId: lessonHourAttendances.learnerId,
      lessonHourId: lessonHourAttendances.lessonHourId,
      status: lessonHourAttendances.status,
      excused: lessonHourAttendances.excused,
      recordedAt: lessonHourAttendances.recordedAt,
      archivedAt: lessonHourAttendances.archivedAt,
      groupName: languageGroups.name,
      courseName: courses.name,
    })
    .from(lessonHourAttendances)
    .leftJoin(
      languageGroups,
      and(
        eq(languageGroups.institutionId, lessonHourAttendances.institutionId),
        eq(languageGroups.id, lessonHourAttendances.groupId),
      ),
    )
    .leftJoin(
      courses,
      and(
        eq(courses.institutionId, languageGroups.institutionId),
        eq(courses.id, languageGroups.courseId),
      ),
    )
    .where(
      and(
        eq(lessonHourAttendances.institutionId, institutionId),
        // İşaretli kimliklerde gün bazlı yoklamanın uuid olmayan kimlikleri de var: metin karşılaştırılır.
        markedIds.size === 0
          ? current
          : or(current, inArray(sql`${lessonHourAttendances.id}::text`, [...markedIds])),
      ),
    )
  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }))
}

/** Kaydın geçerli onaylı kur sonu kararları (core `effectiveProgressionDecision`), yalnız okunur. */
export async function loadEffectiveCourseDecisions(db: Database, institutionId: string) {
  const rows = await db
    .select({
      id: progressionDecisions.id,
      enrollmentId: progressionDecisions.enrollmentId,
      learnerId: progressionDecisions.learnerId,
      outcome: progressionDecisions.outcome,
      status: progressionDecisions.status,
      correctsDecisionId: progressionDecisions.correctsDecisionId,
      decidedAt: progressionDecisions.decidedAt,
      reviewedAt: progressionDecisions.reviewedAt,
      groupName: languageGroups.name,
      courseName: courses.name,
    })
    .from(progressionDecisions)
    .leftJoin(
      languageGroups,
      and(
        eq(languageGroups.institutionId, progressionDecisions.institutionId),
        eq(languageGroups.id, progressionDecisions.groupId),
      ),
    )
    .leftJoin(
      courses,
      and(
        eq(courses.institutionId, progressionDecisions.institutionId),
        eq(courses.id, progressionDecisions.courseId),
      ),
    )
    .where(
      and(
        eq(progressionDecisions.institutionId, institutionId),
        isNull(progressionDecisions.archivedAt),
      ),
    )
    .orderBy(asc(progressionDecisions.decidedAt), asc(progressionDecisions.id))
  const byEnrollment = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = byEnrollment.get(row.enrollmentId) ?? []
    list.push(row)
    byEnrollment.set(row.enrollmentId, list)
  }
  const effective = [...byEnrollment.values()].flatMap((list) => {
    const decision = effectiveProgressionDecision(list)
    return decision === null ? [] : [decision]
  })
  const certificates = await listMebbisRecords(db, institutionId, [...byEnrollment.keys()])
  const numbers = new Map(certificates.map((item) => [item.decisionId, item.certificateNumber]))
  return effective.map((decision) => ({
    ...decision,
    certificateNumber: numbers.get(decision.id) ?? null,
  }))
}

/** İşaretleyen personelin adı; yalnız kurum üyeleri. */
export async function memberNames(
  db: Database,
  institutionId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ userId: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.userId, [...new Set(userIds)]),
      ),
    )
  return new Map(rows.map((row) => [row.userId, row.name]))
}
