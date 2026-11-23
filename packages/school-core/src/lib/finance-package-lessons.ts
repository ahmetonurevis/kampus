import { z } from 'zod'

import { daySchema, requiredText } from './domain.ts'
import {
  PACKAGE_HOURS_MAX,
  planPackageHourEntry,
  type PackageHourEntry,
  type PackageKind,
} from './finance-packages.ts'
import { dayKey } from './format.ts'

/**
 * Yoklama köprüsünün finans ucu (ON-084; IST-078 "yoklamayla bakiye düşer"; DOM-DIL-051, DOM-DIL-054;
 * K-250). Ders saati yoklaması ya da özel ders (OG-116, OG-144, OG-269) yazıldığında çağıran yalnız
 * kursiyeri, dersi ve saati verir; hangi satıştan düşüleceği ve elle girilen saatle (K-21) birleşme
 * burada karar verilir.
 *
 * - **Satış seçimi:** özel ders yalnız `private` pakettendir. Grup dersi önce aynı kurun `course`
 *   satışından, yoksa genel `hours` paketinden düşer. Ders günü satış gününden önce ya da son
 *   kullanma gününden sonraysa satış seçilmez (süresi dolan pakete ders yazılmaz, DOM-DIL-051).
 *   Birden çok uygun satışta önce süresi en erken dolan (süresiz en son), sonra en eski satış:
 *   kursiyerin saati yanmasın.
 * - **Elle girilen saatle birleşme:** yoklama gelmeden personelin girdiği kullanılan saat (`manual`)
 *   sistem dışında yapılmış derslerin farkıdır. Yoklamadan gelen ders saati önce bu farktan düşer;
 *   toplam kullanılan saat iki kez sayılmaz, elle girilen toplamın altına da inmez.
 * - Aynı ders aynı kursiyere bir kez yazılır: kaynak kimliği `lessonHourId`'dir, yeniden gelirse
 *   hiçbir şey yazılmaz.
 */

export const LESSON_PACKAGE_KINDS = ['group', 'private'] as const

export const lessonPackageUsageSchema = z.strictObject({
  studentId: requiredText.max(200),
  /** Grup dersinin kuru; kursuz grup dersi ve özel derste boş. */
  courseId: z.string().trim().min(1).max(200).nullable(),
  lessonKind: z.enum(LESSON_PACKAGE_KINDS),
  /** Ders saati ya da özel ders kimliği; aynı kaynak ikinci kez yazılmaz. */
  lessonHourId: requiredText.max(200),
  occurredDate: daySchema,
  hours: z.number().int().min(1).max(PACKAGE_HOURS_MAX),
})
export type LessonPackageUsageInput = z.input<typeof lessonPackageUsageSchema>

export interface LessonPackageCandidate {
  id: string
  kind: PackageKind
  courseId: string | null
  soldAt: string
  expiresDate: string | null
  remainingHours: number
}

/** Dersin saatinin düşüleceği satış; uygun satış yoksa `null` (ders paketsizdir). */
export function pickLessonPackageSale(
  sales: readonly LessonPackageCandidate[],
  lesson: { courseId: string | null; lessonKind: 'group' | 'private'; occurredDate: string },
): string | null {
  const usable = sales.filter(
    (sale) =>
      sale.remainingHours > 0 &&
      dayKey(sale.soldAt) <= lesson.occurredDate &&
      (sale.expiresDate === null || lesson.occurredDate <= sale.expiresDate),
  )
  const tiers: ((sale: LessonPackageCandidate) => boolean)[] =
    lesson.lessonKind === 'private'
      ? [(sale) => sale.kind === 'private']
      : [
          (sale) =>
            sale.kind === 'course' && lesson.courseId !== null && sale.courseId === lesson.courseId,
          (sale) => sale.kind === 'hours',
        ]
  for (const matches of tiers) {
    const [first] = usable
      .filter(matches)
      .sort(
        (a, b) =>
          (a.expiresDate ?? '9999-12-31').localeCompare(b.expiresDate ?? '9999-12-31') ||
          a.soldAt.localeCompare(b.soldAt) ||
          a.id.localeCompare(b.id),
      )
    if (first) return first.id
  }
  return null
}

/**
 * Seçilen satışa ders saatini planlar (K-250). Önce etkin `manual` farkı ders saati kadar azaltılır,
 * sonra hareket `planPackageHourEntry` ile denetlenir (bakiye sıfırın altına inmez, süresi dolan
 * pakete ders yazılmaz). `manualHours`: farkın yeni değeri; `manual` yoksa ya da değişmediyse `null`.
 */
export function planLessonPackageHours(
  sale: { purchasedHours: number; expiresDate: string | null },
  entries: readonly PackageHourEntry[],
  lesson: { lessonHourId: string; occurredDate: string; hours: number },
  today: string,
) {
  const manual = entries.find((entry) => entry.sourceType === 'manual' && entry.kind === 'consumed')
  const absorbed = manual ? Math.min(manual.hours, lesson.hours) : 0
  const adjusted = entries.map((entry) =>
    entry === manual ? { ...entry, hours: entry.hours - absorbed } : entry,
  )
  const entry = planPackageHourEntry(
    sale,
    adjusted,
    {
      kind: 'consumed',
      hours: lesson.hours,
      occurredDate: lesson.occurredDate,
      sourceType: 'lesson',
      sourceId: lesson.lessonHourId,
    },
    today,
  )
  if (entry === null) return null
  return { entry, manualHours: manual && absorbed > 0 ? manual.hours - absorbed : null }
}

/** Kursiyerin satışlarından herhangi birinde bu ders zaten yazılmış mı. */
export function lessonAlreadyRecorded(
  entries: ReadonlyMap<string, readonly PackageHourEntry[]>,
  lessonHourId: string,
): string | null {
  for (const [saleId, list] of entries)
    if (list.some((entry) => entry.sourceType === 'lesson' && entry.sourceId === lessonHourId))
      return saleId
  return null
}
