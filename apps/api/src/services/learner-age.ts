import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import type { LearnerAgeFacts } from '@kampus/school-core/lib/notifications.ts'

import type { Database } from '../db/client.ts'
import { loadRecords, type StoredRecord } from '../db/records.ts'
import { studentIdentities } from '../db/schema/student-identities.ts'

/**
 * Öğrencinin yaşına dair bilinenler (core `permissionDecider` girdisi; DOM-ILT-037). İzin formunda
 * kararı kimin verdiği (`permission-forms.ts`) ve sağlık bilgisine erişim (`health-profiles.ts`,
 * DOM-ILT-035) aynı yetişkinlik kaynağını okur.
 */

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * Öğrencilerin doğum tarihleri, kimlik satırından (ADR 0006 karar 9). Kurumda öğrencinin tek
 * kimlik satırı vardır (birincil anahtar kurum + öğrenci); anahtar değişse de sonuç belirsiz
 * kalmasın diye arşivlenmemiş satır, sonra en son eğitim yılı ve en son güncellenen seçilir.
 * Kişisel veri; yalnız yaş hesabında kullanılır, yanıta ve loga girmez.
 */
async function identityBirthDates(
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
        inArray(studentIdentities.studentId, [...studentIds]),
      ),
    )
    .orderBy(
      asc(studentIdentities.studentId),
      sql`${studentIdentities.archivedAt} is null desc`,
      desc(studentIdentities.academicYear),
      desc(studentIdentities.updatedAt),
    )
  const result = new Map<string, string>()
  for (const row of rows) if (!result.has(row.studentId)) result.set(row.studentId, row.birthDate)
  return result
}

/**
 * Öğrencilerin yaşına dair bilinenler (core `permissionDecider` girdisi): kimlik satırındaki
 * doğum tarihi ve kesin kayda alınan adayın 18 yaş seçimi (`prospects.minor`; birden çok aday
 * varsa en son güncellenenin açık seçimi). Sorgular sıralıdır: transaction tek bağlantıdır.
 */
export async function learnerFactsOf(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Map<string, LearnerAgeFacts>> {
  const ids = [...new Set(studentIds)]
  const facts = new Map<string, LearnerAgeFacts>(ids.map((id) => [id, {}]))
  if (ids.length === 0) return facts
  const births = await identityBirthDates(db, institutionId, ids)
  const prospects = await loadRecords(db, institutionId, ['prospects'], {
    match: [{ kind: 'equals', field: 'studentId', values: ids }],
  })
  const chosen = new Map<string, StoredRecord>()
  for (const row of prospects) {
    const studentId = text(row.data.studentId)
    if (studentId === null || typeof row.data.minor !== 'boolean') continue
    const current = chosen.get(studentId)
    if (!current || row.updatedAt > current.updatedAt) chosen.set(studentId, row)
  }
  for (const id of ids) {
    const birthDate = births.get(id)
    const minor = chosen.get(id)?.data.minor
    facts.set(id, {
      ...(birthDate === undefined ? {} : { birthDate }),
      ...(typeof minor === 'boolean' ? { prospectMinor: minor } : {}),
    })
  }
  return facts
}
