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

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

/**
 * Saat dilimli ISO anını (`2026-01-31T10:00:00Z`) milisaniyeye çevirir; biçime uymayan ya da
 * takvimde olmayan (`2026-13-01T…`, `2026-02-30T…`) değer `null`. API'deki `db/management-metrics.ts`
 * `ISO_INSTANT` + `pg_input_is_valid` ile aynı kural: tek kural iki ekranda aynı sayıyı verir.
 */
export function parseInstant(value: string | null | undefined): number | null {
  const match = value ? INSTANT.exec(value) : null
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const inMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > inMonth) return null
  const time = Date.parse(value as string)
  return Number.isNaN(time) ? null : time
}

/** Soru ancak geçerli oluşturma anıyla SLA hesabına girer; tarihi bozuk soru hiçbir sayıya girmez. */
const hasCreatedAt = (question: QuestionTimes) => parseInstant(question.createdAt) !== null

/** Geçersiz `answeredAt` yanıtsız sayılır (API ile aynı). */
const answeredTime = (question: QuestionTimes) => parseInstant(question.answeredAt)

/** Soru süre hedefini aştı mı: yanıtlandıysa yanıt süresi 24 saati geçti mi, değilse süre doldu mu. */
export function isBreach(question: QuestionTimes, now: number): boolean {
  const created = parseInstant(question.createdAt)
  if (created === null) return false
  const answered = answeredTime(question)
  if (answered !== null) return answered - created > SLA_MS
  return now - created >= SLA_MS
}

/** Yanıt süresi (saat); yanıtlanmamış ya da tarihi bozuk soruda `null`. */
export function responseHours(question: QuestionTimes): number | null {
  const created = parseInstant(question.createdAt)
  const answered = answeredTime(question)
  if (created === null || answered === null) return null
  const hours = (answered - created) / 3_600_000
  return hours >= 0 ? hours : null
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
 * (`withdrawnAt`, DOM-ILT-091) ve geçerli `createdAt`'i olmayan soru toplam, bekleyen, ihlal ve
 * uyum hesabına girmez.
 */
export function slaRows(
  teachers: readonly CoreRow<'teachers'>[],
  questions: readonly CoreRow<'questions'>[],
  lookups: ManagementLookups,
  now: number,
): SlaRow[] {
  const byTeacher = new Map<string, QuestionTimes[]>()
  for (const { record } of questions) {
    if (record.withdrawnAt || !hasCreatedAt(record)) continue
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
        pending: own.filter((question) => answeredTime(question) === null).length,
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
