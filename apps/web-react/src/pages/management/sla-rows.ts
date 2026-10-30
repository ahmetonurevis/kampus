// SLA Raporu saf hesapları (Vue `Management.vue` `sla-raporu`): öğretmen başına soru kuyruğu
// yanıt süresi ve ihlal. Girdi kapsamlı öğretmen ve soru kayıtlarıdır; oran, ortalama ve ihlal
// saklanmaz, kayıtlardan hesaplanır. Saat parametredir (`now`), hesap saate bağlı kalmaz.
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import { teacherClasses, type ManagementLookups } from './management-rows.ts'

/** Hedef yanıt süresi: soru oluştuğu andan 24 saat (Vue `slaStatus` ile aynı). */
export const SLA_HOURS = 24
const SLA_MS = SLA_HOURS * 3_600_000
export const NO_RESPONSE = 'Henüz yanıt yok'

type QuestionTimes = { createdAt: string; answeredAt?: string | null }

/** Soru süre hedefini aştı mı: yanıtlandıysa yanıt süresi 24 saati geçti mi, değilse süre doldu mu. */
export function isBreach(question: QuestionTimes, now: number): boolean {
  const created = Date.parse(question.createdAt)
  if (Number.isNaN(created)) return false
  if (question.answeredAt) return Date.parse(question.answeredAt) - created > SLA_MS
  return now - created >= SLA_MS
}

/** Yanıt süresi (saat); yanıtlanmamış ya da tarihi bozuk soruda `null`. */
export function responseHours(question: QuestionTimes): number | null {
  if (!question.answeredAt) return null
  const hours = (Date.parse(question.answeredAt) - Date.parse(question.createdAt)) / 3_600_000
  return Number.isFinite(hours) && hours >= 0 ? hours : null
}

export type SlaRow = {
  id: string
  name: string
  classes: string
  /** Öğretmene sorulan toplam soru. */
  total: number
  /** Ortalama yanıt süresi (saat, 1 ondalık); yanıt yoksa `null`. */
  response: number | null
  /** Yanıt bekleyen soru. */
  pending: number
  /** Süre hedefini aşan soru (yanıtlanmış ya da hâlâ bekleyen). */
  breaches: number
  /** Hedefe uyan soruların yüzdesi; soru yoksa 100. */
  slaRate: number
}

/** Ortalama yanıt süresi gösterimi: "3,5 sa" ya da "Henüz yanıt yok". */
export function responseText(hours: number | null): string {
  if (hours === null) return NO_RESPONSE
  return `${hours.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sa`
}

/** "7. Sınıf · A" → "7. Sınıf"; sınıf adının şube eki atılır (Vue ile aynı). */
const shortClass = (name: string) => name.split(' · ')[0] ?? name

/**
 * Aktif öğretmenlerin SLA satırları. Sıra: ihlali çok olan önce, sonra bekleyen, sonra ad.
 * Soru, öğretmene `teacherId` ile bağlıdır; arşivdeki öğretmen listelenmez. Geri çekilen soru
 * (`withdrawnAt`) toplam, bekleyen, ihlal ve uyum hesabına girmez (DOM-ILT-091).
 */
export function slaRows(
  teachers: readonly CoreRow<'teachers'>[],
  questions: readonly CoreRow<'questions'>[],
  lookups: ManagementLookups,
  now: number,
): SlaRow[] {
  const byTeacher = new Map<string, QuestionTimes[]>()
  for (const { record } of questions) {
    if (record.withdrawnAt) continue
    const list = byTeacher.get(record.teacherId)
    if (list) list.push(record)
    else byTeacher.set(record.teacherId, [record])
  }
  return teachers
    .filter(({ record }) => record.isActive)
    .map(({ record }): SlaRow => {
      const own = byTeacher.get(record.id) ?? []
      const hours = own.flatMap((question) => responseHours(question) ?? [])
      const breaches = own.filter((question) => isBreach(question, now)).length
      const classNames = teacherClasses(record.id, lookups).map((schoolClass) =>
        shortClass(schoolClass.name),
      )
      return {
        id: record.id,
        name: record.name,
        classes: [...new Set(classNames)].join(', ') || '—',
        total: own.length,
        response: hours.length
          ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
          : null,
        pending: own.filter((question) => !question.answeredAt).length,
        breaches,
        slaRate: own.length ? Math.round(((own.length - breaches) / own.length) * 100) : 100,
      }
    })
    .sort(
      (a, b) =>
        b.breaches - a.breaches || b.pending - a.pending || a.name.localeCompare(b.name, 'tr'),
    )
}

export type SlaSummary = {
  teachers: number
  questions: number
  pending: number
  breaches: number
  /** Genel hedef uyumu (%); soru yoksa `null`. */
  slaRate: number | null
}

export function slaSummary(rows: readonly SlaRow[]): SlaSummary {
  const questions = rows.reduce((sum, row) => sum + row.total, 0)
  const breaches = rows.reduce((sum, row) => sum + row.breaches, 0)
  return {
    teachers: rows.length,
    questions,
    pending: rows.reduce((sum, row) => sum + row.pending, 0),
    breaches,
    slaRate: questions ? Math.round(((questions - breaches) / questions) * 100) : null,
  }
}
