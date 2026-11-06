import { and, asc, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  RENEWAL_STATUS_BY_PLAN,
  type RenewalPlanStatus,
} from '@kampus/school-core/lib/renewal-bulk.ts'

import type { Database } from './client.ts'
import { recordFilter } from './records.ts'
import { records } from './schema/records.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Yeni yıl listesinin sayfası (ON-086, IST-105). Sayfalama ve durum süzgeci SQL'dedir: kurumun bütün
 * öğrencisi yüklenmeden yalnız sayfanın kimlikleri çıkar, satırın ücret ve borcu yalnız onlar için
 * hesaplanır. Yenileme `records`'ta kaldığı için durum öğrenciyle anti/yarı birleştirmedir.
 */

const renewal = alias(records, 'renewal')

function renewalOfYear(institutionId: string, academicYear: number): SQL | undefined {
  return and(
    eq(renewal.institutionId, institutionId),
    eq(renewal.collection, 'renewals'),
    isNull(renewal.archivedAt),
    sql`${renewal.data} ->> 'studentId' = ${records.id}`,
    sql`${renewal.data} ->> 'year' = ${String(academicYear)}`,
  )
}

function planStatusMatch(
  institutionId: string,
  academicYear: number,
  status: RenewalPlanStatus,
): SQL {
  const ofYear = renewalOfYear(institutionId, academicYear)
  if (status === 'not_planned')
    return sql`not exists (select 1 from ${records} as ${sql.identifier('renewal')} where ${ofYear})`
  const statuses = sql.join(
    RENEWAL_STATUS_BY_PLAN[status].map((value) => sql`${value}`),
    sql`, `,
  )
  return sql`exists (select 1 from ${records} as ${sql.identifier('renewal')} where ${ofYear} and ${renewal.data} ->> 'status' in (${statuses}))`
}

export interface RenewalCandidateQuery {
  academicYear: number
  /** Yenilenebilir sınıflar: etkin ve son düzey değil; boşsa sonuç boştur. */
  classIds: readonly string[]
  planStatus?: RenewalPlanStatus | undefined
  q?: string | undefined
  offset: number
  limit: number
}

/** Etkin öğrencilerin ada göre sayfası; sıra aynı adda kimlikle sabittir. */
export async function loadRenewalCandidatePage(
  db: Database,
  institutionId: string,
  query: RenewalCandidateQuery,
): Promise<{ rows: { id: string; parentId: string | null }[]; total: number }> {
  if (query.classIds.length === 0) return { rows: [], total: 0 }
  const name = sql`${records.data} ->> 'name'`
  const where = and(
    eq(records.institutionId, institutionId),
    eq(records.collection, 'students'),
    isNull(records.archivedAt),
    recordFilter({ kind: 'active', field: 'isActive', active: true }),
    recordFilter({ kind: 'equals', field: 'classId', values: query.classIds }),
    query.planStatus === undefined
      ? undefined
      : planStatusMatch(institutionId, query.academicYear, query.planStatus),
    query.q === undefined ? undefined : sql`strpos(${foldSql(name)}, ${foldSearch(query.q)}) > 0`,
  )
  const [rows, [counted]] = await Promise.all([
    db
      .select({ id: records.id, parentId: sql<string | null>`${records.data} ->> 'parentId'` })
      .from(records)
      .where(where)
      .orderBy(foldSql(name), asc(records.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: count() }).from(records).where(where),
  ])
  return { rows, total: counted?.total ?? 0 }
}

/** Velilerin etkin öğrencileri: kardeş kuralı ve tavan için kardeşin sözleşmesi de okunur. */
export async function loadStudentFamilies(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<string[]> {
  if (studentIds.length === 0) return []
  const self = alias(records, 'self')
  const rows = await db
    .selectDistinct({ id: records.id })
    .from(records)
    .innerJoin(
      self,
      and(
        eq(self.institutionId, institutionId),
        eq(self.collection, 'students'),
        inArray(self.id, [...studentIds]),
        sql`${self.data} ->> 'parentId' = ${records.data} ->> 'parentId'`,
      ),
    )
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        isNull(records.archivedAt),
      ),
    )
  return [...new Set([...studentIds, ...rows.map((row) => row.id)])]
}
