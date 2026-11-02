import type { Scope } from '@kampus/school-core/lib/scope.ts'

import {
  classGradeRows,
  teacherQuestionRows,
  type ClassGradeRow,
} from '../db/management-metrics.ts'
import { ForbiddenError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { readScope } from './read-scope.ts'

/**
 * Kampüsler & Sınıflar ve Eğitim Kadrosu ekranlarının toplu ölçüleri (IST-010; Vue
 * `SchoolManagement.vue` "Ortalama" ve "Performans" sütunları). Toplam SQL'dedir; yalnız sonuç
 * satırları döner, kayıt metni ve kişisel veri dönmez.
 *
 * Kapsam: ölçü kurumun bütün kayıtlarından hesaplandığı için aktör ilgili koleksiyonların
 * tamamını okuyabilmelidir (core `scope.readsWhole`; modül ve rol dahil). Okuyamıyorsa 403: kısmi
 * kapsamla toplanmış bir ortalama yanıltıcı olur ve gizli kaydı sayıyla sızdırabilir.
 */

function requireWhole(scope: Scope, collections: readonly string[]) {
  if (!collections.every((collection) => scope.readsWhole(collection))) throw new ForbiddenError()
}

export type ClassMetric = ClassGradeRow

/** Sınıf başına aktif öğrenci ve not ortalaması; öğrencisi olmayan sınıf dönmez. */
export async function getClassMetrics(ctx: ServiceContext): Promise<ClassMetric[]> {
  requireWhole(await readScope(ctx), ['students', 'grades'])
  return classGradeRows(ctx.db, ctx.institutionId)
}

export interface TeacherMetric {
  teacherId: string
  /** Geri çekilmemiş soru sayısı. */
  questions: number
  /** 24 saat yanıt hedefini aşan soru. */
  breaches: number
  /** Hedefe uyan soruların yüzdesi (yuvarlanmış, 0–100); soru yoksa 100. */
  slaRate: number
  /**
   * Yoklama, ödev takibi ve soru süresi uyumunun ortalaması (0–100, yuvarlanmış; Vue
   * `teacherPerformance`). Kaydın oranları sayı değilse `null`.
   */
  performance: number | null
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

/**
 * Uyum oranı yuvarlanmadan ortalamaya girer (Vue ile aynı sonuç). Kayıttaki yoklama ve ödev oranı
 * bozuk olabilir (`-5`, `140`); yanıt şeması 0–100 tam sayıdır, bu yüzden oranlar 0–100'e
 * sıkıştırılır ve uç 500'e düşmez.
 */
export function teacherPerformance(row: {
  attendanceRate: number | null
  homeworkRate: number | null
  questions: number
  breaches: number
}): Pick<TeacherMetric, 'slaRate' | 'performance'> {
  const exact = clampPercent(
    row.questions ? ((row.questions - row.breaches) / row.questions) * 100 : 100,
  )
  const performance =
    row.attendanceRate === null || row.homeworkRate === null
      ? null
      : Math.round((clampPercent(row.attendanceRate) + clampPercent(row.homeworkRate) + exact) / 3)
  return { slaRate: Math.round(exact), performance }
}

/** Öğretmen başına soru süresi uyumu ve performans; arşivlenmiş öğretmen ve soru dışlanır. */
export async function getTeacherMetrics(ctx: ServiceContext): Promise<TeacherMetric[]> {
  requireWhole(await readScope(ctx), ['teachers', 'questions'])
  const rows = await teacherQuestionRows(ctx.db, ctx.institutionId, ctx.now)
  return rows.map((row) => ({
    teacherId: row.teacherId,
    questions: row.questions,
    breaches: row.breaches,
    ...teacherPerformance(row),
  }))
}
