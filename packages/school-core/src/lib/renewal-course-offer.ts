import { z } from 'zod'

import {
  effectiveProgressionDecision,
  progressionNextStep,
  PROGRESSION_OUTCOMES,
  type ProgressionDecisionRecord,
} from '../cefr/progression.ts'
import { CEFR_LEVELS, enumKeys, type CefrLevel } from '../content/taxonomy.ts'
import { DomainError } from './errors.ts'

/**
 * Dil okulu yenileme teklifinin kur sonu kararı dayanağı (docs/domain/dil-okulu.md DOM-DIL-070,
 * DOM-DIL-007; IST-062 "üst kur kaydı ve yenileme teklifi karardan başlatılır"; ON-295, #30).
 * Teklif kursiyerin son kurundaki geçerli (düzeltilmemiş en son onaylı) karardan başlar: `geçti`
 * üst kura (`nextCourseId`) ya da üst seviyeye, `tekrar` ve `devamsızlıktan tamamlamadı` aynı kura
 * açılır. Üst kur hesabı OG-086'nın core `progressionNextStep` işlevidir; burada yeniden yazılmaz.
 * Onay bekleyen ya da hiç verilmemiş kararda önizleme açılır ama plan yazılmaz
 * (`assertCourseOfferReady`). Okul (`school`) kurumunda teklif yoktur. Saftır.
 */

const LEVELS = enumKeys(CEFR_LEVELS)
const OUTCOMES = enumKeys(PROGRESSION_OUTCOMES)

/**
 * `ready`: onaylı karar var, teklif `level` seviyesine (`courseId` biliniyorsa o kura) açılır.
 * `pending`: son kurun kararı onay bekliyor (düzeltme kararı da). `missing`: son kur yok ya da
 * onaylı kararı yok (reddedilen karar öğretmence yeniden önerilir). `no_next_level`: kursiyer
 * geçti ama üst seviye yok (C2) ya da sonraki kur okunamadı.
 */
export const COURSE_OFFER_STATUSES = ['ready', 'pending', 'missing', 'no_next_level'] as const
export type CourseOfferStatus = (typeof COURSE_OFFER_STATUSES)[number]

export const renewalCourseOfferSchema = z.object({
  status: z.enum(COURSE_OFFER_STATUSES),
  /** Teklifin başladığı karar; `pending` durumunda onay bekleyen karar, `missing`'de yok. */
  decisionId: z.string().nullable(),
  outcome: z.enum(OUTCOMES).nullable().describe('Geçerli kararın sonucu; onaylı karar yoksa yok'),
  fromCourseId: z.string().nullable().describe('Kursiyerin son kuru'),
  fromLevel: z.enum(LEVELS).nullable(),
  courseId: z
    .string()
    .nullable()
    .describe('Teklif edilen kur: geçtiyse sonraki kur, tekrarda aynı kur; zincirsiz kurda yok'),
  level: z.enum(LEVELS).nullable().describe('Teklif edilen seviye; yalnız `ready` durumunda dolu'),
})
export type RenewalCourseOffer = z.output<typeof renewalCourseOfferSchema>

/** Kursiyerin bir kur kaydı: dil grubundaki satırı ve grubun kuru, başlangıcı. */
export type CourseOfferEnrollment = {
  id: string
  studentId: string
  courseId: string
  /** Grubun başlangıç günü (`YYYY-MM-DD`); son kur en geç başlayandır. */
  startDate: string
  /** İptal edilen grup kur sayılmaz. */
  cancelled: boolean
}

export type CourseOfferCourse = { id: string; level: CefrLevel; nextCourseId: string | null }

type DecisionInput = ProgressionDecisionRecord

const EMPTY = {
  decisionId: null,
  outcome: null,
  courseId: null,
  level: null,
} as const

/** Son kur: iptal edilmemiş grupların en geç başlayanı; eşitlikte kimlik sırası belirler. */
function lastEnrollment(studentId: string, enrollments: readonly CourseOfferEnrollment[]) {
  return enrollments
    .filter((item) => item.studentId === studentId && !item.cancelled)
    .toSorted((a, b) => b.startDate.localeCompare(a.startDate) || b.id.localeCompare(a.id))[0]
}

/**
 * Öğrencinin yenileme teklifinin kur dayanağı. Yalnız son kurun kararları okunur; başka kursiyerin
 * ya da başka kaydın kararı sayılmaz.
 */
export function renewalCourseOffer(input: {
  studentId: string
  enrollments: readonly CourseOfferEnrollment[]
  courses: readonly CourseOfferCourse[]
  decisions: readonly DecisionInput[]
}): RenewalCourseOffer {
  const last = lastEnrollment(input.studentId, input.enrollments)
  const course =
    last === undefined ? undefined : input.courses.find((item) => item.id === last.courseId)
  if (last === undefined || course === undefined)
    return { status: 'missing', ...EMPTY, fromCourseId: null, fromLevel: null }
  const from = { fromCourseId: course.id, fromLevel: course.level }
  const own = input.decisions.filter(
    (item) => item.enrollmentId === last.id && item.learnerId === input.studentId,
  )
  // Bekleyen karar (ilk karar ya da düzeltme) geçerli kararı değiştirebilir: teklif onayı bekler.
  const pending = own.findLast((item) => item.status === 'pending')
  if (pending !== undefined) return { status: 'pending', ...EMPTY, ...from, decisionId: pending.id }
  const effective = effectiveProgressionDecision(own)
  if (effective === null) return { status: 'missing', ...EMPTY, ...from }
  const decided = { decisionId: effective.id, outcome: effective.outcome }
  if (effective.outcome !== 'passed')
    return { status: 'ready', ...from, ...decided, courseId: course.id, level: course.level }
  const nextCourse =
    course.nextCourseId === null
      ? null
      : (input.courses.find((item) => item.id === course.nextCourseId) ?? null)
  const next = progressionNextStep({ decisions: own, course, nextCourse })
  if (next === null || next.nextLevel === null)
    return { status: 'no_next_level', ...from, ...decided, courseId: null, level: null }
  return {
    status: 'ready',
    ...from,
    ...decided,
    courseId: next.nextCourseId,
    level: next.nextLevel,
  }
}

/** Teklifin kullanıcı uyarısı; hazır teklifte yok. Ekran ve plan reddi aynı metni kullanır. */
export const COURSE_OFFER_MESSAGES = {
  pending: 'Kur sonu kararı onay bekliyor; karar onaylanmadan yenileme planlanamaz.',
  missing: 'Son kur için onaylı kur sonu kararı yok; yenileme planlanamaz.',
  no_next_level:
    'Kursiyer son kurunu geçti ama üst seviye ya da sonraki kur yok; yenileme planlanamaz.',
} as const satisfies Record<Exclude<CourseOfferStatus, 'ready'>, string>

const OFFER_ERROR_CODES = {
  pending: 'course_decision_pending',
  missing: 'course_decision_missing',
  no_next_level: 'course_next_level_missing',
} as const satisfies Record<Exclude<CourseOfferStatus, 'ready'>, string>

/** Plan yalnız onaylı karardan yazılır (DOM-DIL-070); değilse 422. */
export function assertCourseOfferReady(offer: RenewalCourseOffer): void {
  if (offer.status === 'ready') return
  throw new DomainError(OFFER_ERROR_CODES[offer.status], COURSE_OFFER_MESSAGES[offer.status], {
    path: ['studentId'],
  })
}
