import type { ProgressionOutcome } from '@kampus/school-core/cefr/progression.ts'
import { courseOfferRows } from '@kampus/school-core/lib/renewal-course-offer-list.ts'

import { listProgressionDecisions } from '../db/cefr.ts'
import { loadCourses } from '../db/courses.ts'
import { findPublishedTariff } from '../db/fee-tariffs.ts'
import { loadRecordsByIds } from '../db/records.ts'
import {
  listActiveLessonPackages,
  listCourseEnrollments,
  listCourseOfferSales,
} from '../db/renewal-course-offer.ts'
import { foldSearch } from '../db/text-search.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { saleAcademicYear } from './finance-packages.ts'

/**
 * Kur yenileme ve üst kur teklif listesi (IST-088, ON-082; dil-okulu.md DOM-DIL-070, DOM-DIL-071,
 * DOM-DIL-050; finans.md DOM-FIN-020). Kur kayıtları, kurlar, kararlar, paketler ve satışlar kurum
 * kapsamında okunur; hesap core `courseOfferRows`'tadır. Kur sonu kararı OG-086'nın tablosudur,
 * burada yalnız okunur. Hiçbir şey yazılmaz; teklif paket satışıyla açılır. Liste kurum geneli
 * olduğundan sayfa bellekte kesilir: dil okulunda kursiyer sayısı yüzlerle sınırlıdır.
 */

const nameOf = (data: Record<string, unknown>) =>
  typeof data.name === 'string' && data.name.trim() !== '' ? data.name : '—'

export async function listCourseOffersFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    outcome?: ProgressionOutcome | undefined
    studentId?: string | undefined
  },
) {
  const { db, institutionId } = ctx
  if (query.studentId !== undefined) {
    const [student] = await loadRecordsByIds(db, institutionId, 'students', [query.studentId])
    if (student === undefined) throw new NotFoundError()
  }
  const allEnrollments = await listCourseEnrollments(db, institutionId)
  const enrollments =
    query.studentId === undefined
      ? allEnrollments
      : allEnrollments.filter((item) => item.studentId === query.studentId)
  const studentIds = [...new Set(enrollments.map((item) => item.studentId))]
  const academicYear = await saleAcademicYear(db, ctx)
  const [students, courses, decisions, packages, sales, tariff] = await Promise.all([
    loadRecordsByIds(db, institutionId, 'students', studentIds),
    loadCourses(db, institutionId),
    listProgressionDecisions(db, institutionId, {
      enrollmentIds: enrollments.map((item) => item.id),
    }),
    listActiveLessonPackages(db, institutionId),
    listCourseOfferSales(db, institutionId),
    findPublishedTariff(db, institutionId, academicYear),
  ])
  const rows = courseOfferRows({
    students: students.map((row) => ({
      id: row.id,
      name: nameOf(row.data),
      isActive: row.data.isActive !== false,
    })),
    enrollments,
    courses,
    decisions,
    packages,
    sales,
    tariff,
  })
  const needle = query.q === undefined ? null : foldSearch(query.q)
  const filtered = rows.filter(
    (row) =>
      (query.outcome === undefined || row.outcome === query.outcome) &&
      (needle === null || foldSearch(row.studentName).includes(needle)),
  )
  const start = (query.page - 1) * query.pageSize
  return { items: filtered.slice(start, start + query.pageSize), total: filtered.length }
}
