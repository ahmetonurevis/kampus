import { sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { records } from './schema/records.ts'

/**
 * Kampüs ve kadro ekranlarının toplu ölçüleri (IST-010): sınıf not ortalaması ve öğretmen soru
 * süresi uyumu SQL'de toplanır; not ve soru kayıtları belleğe yüklenmez. Yalnız kurumun
 * arşivlenmemiş (`archived_at is null`) kayıtları sayılır. Kapsam kararı serviste verilir
 * (`services/management-metrics.ts`); burası yalnız kurum kapsamlı sorgudur.
 */

/** Soru yanıt süresi hedefi (Vue `slaStatus`, web SLA Raporu `SLA_HOURS` ile aynı). */
const SLA_INTERVAL = sql`interval '24 hours'`
/** Bozuk tarihli kayıt sorguyu düşürmesin: yalnız ISO biçimli değer zamana çevrilir. */
const ISO_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T'

export interface ClassGradeRow {
  classId: string
  students: number
  gradedStudents: number
  averageScore: number | null
}

/**
 * Sınıf başına aktif öğrenci sayısı ve not ortalaması (Vue `SchoolManagement.vue` "Ortalama"):
 * önce öğrencinin notlarının yuvarlanmış ortalaması, sonra sınıftaki notu olan öğrencilerin
 * ortalaması (yuvarlanmış). Öğrencinin güncel sınıfı esastır; notu olmayan öğrenci ortalamaya
 * girmez (Vue 0 sayıyordu, bilerek düzeltildi). Sayısal olmayan puan sayılmaz.
 */
export async function classGradeRows(
  db: Database,
  institutionId: string,
): Promise<ClassGradeRow[]> {
  const result = await db.execute<Record<string, unknown>>(sql`
    with s as (
      select r."id", r."data" ->> 'classId' as class_id
        from ${records} as r
       where r."institution_id" = ${institutionId}
         and r."collection" = 'students'
         and r."archived_at" is null
         and coalesce(r."data" ->> 'isActive', 'true') <> 'false'
         and r."data" ->> 'classId' is not null
    ), g as (
      select r."data" ->> 'studentId' as student_id,
             round(avg((r."data" ->> 'score')::numeric)) as average
        from ${records} as r
       where r."institution_id" = ${institutionId}
         and r."collection" = 'grades'
         and r."archived_at" is null
         and jsonb_typeof(r."data" -> 'score') = 'number'
       group by 1
    )
    select s.class_id as "classId",
           count(*)::int as "students",
           count(g.average)::int as "gradedStudents",
           round(avg(g.average))::int as "averageScore"
      from s
      left join g on g.student_id = s."id"
     group by s.class_id
     order by s.class_id`)
  return rowsOf(result).map((row) => ({
    classId: String(row.classId),
    students: Number(row.students),
    gradedStudents: Number(row.gradedStudents),
    averageScore: row.averageScore === null ? null : Number(row.averageScore),
  }))
}

export interface TeacherQuestionRow {
  teacherId: string
  attendanceRate: number | null
  homeworkRate: number | null
  questions: number
  breaches: number
}

/**
 * Öğretmen başına soru sayısı ve süre ihlali (web `sla-rows.ts` `isBreach` ile aynı): yanıtlanan
 * soruda yanıt 24 saati aştıysa, yanıtsız soruda `now` soru anından 24 saat sonrasına ulaştıysa
 * ihlaldir. Geri çekilen soru sayılmaz (DOM-ILT-091). Arşivdeki öğretmen de döner (Arşiv sekmesi).
 */
export async function teacherQuestionRows(
  db: Database,
  institutionId: string,
  now: Date,
): Promise<TeacherQuestionRow[]> {
  const created = sql`(q."data" ->> 'createdAt')::timestamptz`
  const answered = sql`(q."data" ->> 'answeredAt')::timestamptz`
  const result = await db.execute<Record<string, unknown>>(sql`
    with qs as (
      select q."data" ->> 'teacherId' as teacher_id,
             count(*)::int as questions,
             count(*) filter (where case
               when coalesce(q."data" ->> 'answeredAt', '') ~ ${ISO_PATTERN}
                 then ${answered} - ${created} > ${SLA_INTERVAL}
               else ${now.toISOString()}::timestamptz - ${created} >= ${SLA_INTERVAL}
             end)::int as breaches
        from ${records} as q
       where q."institution_id" = ${institutionId}
         and q."collection" = 'questions'
         and q."archived_at" is null
         and coalesce(q."data" ->> 'withdrawnAt', '') = ''
         and coalesce(q."data" ->> 'createdAt', '') ~ ${ISO_PATTERN}
       group by 1
    )
    select t."id" as "teacherId",
           case when jsonb_typeof(t."data" -> 'attendanceRate') = 'number'
             then (t."data" ->> 'attendanceRate')::numeric end as "attendanceRate",
           case when jsonb_typeof(t."data" -> 'homeworkRate') = 'number'
             then (t."data" ->> 'homeworkRate')::numeric end as "homeworkRate",
           coalesce(qs.questions, 0) as "questions",
           coalesce(qs.breaches, 0) as "breaches"
      from ${records} as t
      left join qs on qs.teacher_id = t."id"
     where t."institution_id" = ${institutionId}
       and t."collection" = 'teachers'
       and t."archived_at" is null
     order by t."position", t."id"`)
  return rowsOf(result).map((row) => ({
    teacherId: String(row.teacherId),
    attendanceRate: row.attendanceRate === null ? null : Number(row.attendanceRate),
    homeworkRate: row.homeworkRate === null ? null : Number(row.homeworkRate),
    questions: Number(row.questions),
    breaches: Number(row.breaches),
  }))
}

/** `execute` sonucu: node-postgres ve PGlite `{ rows }` döndürür. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  const rows = (result as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}
