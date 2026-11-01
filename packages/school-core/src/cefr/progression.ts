import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import { isCalendarDay, isUnderAdultAge } from '../lib/age.ts'
import type { Role } from '../modules/navigation.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { enumKeys, type CefrLevel } from '../content/taxonomy.ts'
import {
  CORE_SKILLS,
  evidenceSnapshotOf,
  type CefrSuggestion,
  type EvidenceSnapshot,
} from './suggestion.ts'

/**
 * Dil okulu kur ilerlemesi: kur içi ölçmeler, ders saati bazlı devam, devamsızlık bildirimi ve kur
 * geçme kararı (docs/domain/dil-okulu.md DOM-DIL-013, 060, 061, 062, 070; ADR 0004 karar 5, 8, 11;
 * IST-062).
 *
 * Satırlar servisin yüklediği tipli satırlardır: kur kaydı (dil grubu kaydı, `records` kimliği),
 * ders saati yoklaması, ölçme sonuçları ve `progression_decisions`. Devam oranı, koşullar ve izin
 * verilen sonuçlar saklanmaz, her istekte hesaplanır; karar satırı karar anının dayanağını
 * (`basis`) ve seviye önerisini (`evidenceSnapshot`) kopya olarak taşır (karar 5). Kur atlama
 * (DOM-DIL-071) ve yanlış yerleştirme düzeltmesi (DOM-DIL-072) bu dosyada yoktur.
 *
 * Yalnız `language_school`'dadır (DOM-YTK-012); okulda uç bulunmaz gibi davranır.
 */

z.config(z.locales.tr())

type Instant = Date | string
/** Geçersiz `now` programlama hatası değil, alan yollu iş kuralı reddidir (`lib/domain.ts` deseni). */
function toMs(value: Instant): number {
  const ms = typeof value === 'string' ? Date.parse(value) : value.getTime()
  if (!Number.isFinite(ms)) {
    throw new DomainError('invalid_now', 'Geçerli bir tarih ve saat girin.', { path: ['now'] })
  }
  return ms
}
const toIso = (value: Instant) => new Date(toMs(value)).toISOString()

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const coreSkill = z.enum(CORE_SKILLS)
const score100 = z
  .number({ error: 'Puan 0–100 arasında olmalıdır.' })
  .min(0, 'Puan 0–100 arasında olmalıdır.')
  .max(100, 'Puan 0–100 arasında olmalıdır.')

function assertLanguageSchool(institutionType: InstitutionType): void {
  if (institutionType !== 'language_school') {
    throw new DomainError(
      'module_unavailable_for_type',
      'Kur geçişi yalnız dil okulunda kullanılır.',
      { kind: 'not_found' },
    )
  }
}

// --- Kur ve kurum ayarı -------------------------------------------------------------------

/** Servisin yüklediği kur kaydı: kursiyerin bir dil grubundaki kaydı ve kurun tanımı. */
export type CourseEnrollment = {
  /** Dil grubu kaydı (`records` kimliği). */
  id: string
  learnerId: string
  courseId: string
  /** Kurun bağlı olduğu seviye (DOM-DIL-001). */
  level: CefrLevel
  /** Kurun toplam ders saati (DOM-DIL-002). */
  totalHours: number
  /** Grubun öğretmenleri; ölçme ve kararı yalnız onlar girer. */
  // kvkk: K
  teacherUserIds: readonly string[]
}

/**
 * Devam şartı (DOM-DIL-060): toplam kur saatinin en az 4/5'i, binde 800. Oran binde tamsayı
 * tutulur; karşılaştırma `katılım × 1000 ≥ oran × toplam` tamsayı aritmetiğiyle yapılır.
 */
export const MIN_ATTENDANCE_PERMILLE = 800

/** Kur geçme eşikleri (DOM-DIL-070), 100 üzerinden. */
export const PASS_RULES = {
  /** Kur sonu değerlendirmesinde varsayılan kurum eşiği. */
  finalScore: 60,
  /** Dört becerinin her birinde ayrı ayrı alt sınır. */
  skillScore: 50,
} as const

/**
 * Kurumun kur geçiş ayarı. Devam oranı yalnız daha sıkı olabilir (DOM-DIL-060); kur sonu eşiği
 * varsayılanın altına inemez.
 */
// TODO(cefr-meb-esigi): Kurum eşiği MEB kurs başarı ölçütünün altına inemez (DOM-DIL-070), ölçüt
// doğrulanmadı; en muhafazakâr yorumla varsayılan 60'ın altı reddedilir.
export const progressionSettingsSchema = z.object({
  minAttendancePermille: z
    .number()
    .int('Devam oranı binde tamsayı olarak girilir.')
    .min(
      MIN_ATTENDANCE_PERMILLE,
      'Devam oranı en az binde 800 (4/5) olmalıdır; kurum yalnız artırabilir.',
    )
    .max(1000, 'Devam oranı en fazla binde 1.000 olabilir.')
    .default(MIN_ATTENDANCE_PERMILLE),
  finalPassScore: score100
    .min(PASS_RULES.finalScore, 'Kur sonu eşiği 60’ın altına inemez.')
    .default(PASS_RULES.finalScore),
})
export type ProgressionSettingsInput = z.input<typeof progressionSettingsSchema>
export type ProgressionSettings = z.output<typeof progressionSettingsSchema>

// --- Devam (DOM-DIL-060, 061) -------------------------------------------------------------

/** Ders saati yoklama durumu (DOM-DIL-061): geç kalan o saate katılmış sayılır. */
export const LESSON_ATTENDANCE_STATUSES = {
  present: { label: 'Katıldı', attended: true },
  late: { label: 'Geç', attended: true },
  absent: { label: 'Gelmedi', attended: false },
} as const
export type LessonAttendanceStatus = keyof typeof LESSON_ATTENDANCE_STATUSES

/**
 * Bir ders saatinin yoklama satırı (DOM-DIL-061). 90 dakikalık blok iki satırdır. Özür yalnız
 * bilgi içindir: mevzuat ayrım yapmadığından özürlü devamsızlık da devamsızlıktır (DOM-DIL-060).
 */
export const lessonHourAttendanceSchema = z.object({
  /** Ders saati kimliği; aynı ders saati için ikinci satır yoktur. */
  lessonHourId: identifier,
  status: z.enum(enumKeys(LESSON_ATTENDANCE_STATUSES)),
  excused: z.boolean().default(false),
})
export type LessonHourAttendance = z.input<typeof lessonHourAttendanceSchema>

export type AttendanceSummary = {
  totalHours: number
  recordedHours: number
  /** Katıldı + geç. */
  attendedHours: number
  /** Gelmedi (özürlü dahil). */
  absentHours: number
  excusedAbsentHours: number
  /** Henüz yoklaması alınmamış saat (ileri dersler). */
  unrecordedHours: number
  /** Sınava girmek için gereken en az katılım saati. */
  requiredHours: number
  minAttendancePermille: number
  /**
   * `eligible`: şart sağlandı; `ineligible`: kalan saatlerin hepsine katılsa da sağlanamaz;
   * `pending`: henüz belli değil.
   */
  status: 'eligible' | 'ineligible' | 'pending'
}

/**
 * Devam özeti (DOM-DIL-060, 061): ders saati bazında hesaplanır, saklanmaz. Katılım oranı kurun
 * toplam saatine göredir; yoklaması alınmamış saat katılmış sayılmaz.
 */
export function attendanceSummary(input: {
  totalHours: number
  rows: readonly LessonHourAttendance[]
  minAttendancePermille?: number
}): AttendanceSummary {
  const { totalHours } = input
  if (!Number.isInteger(totalHours) || totalHours < 1) {
    throw new DomainError('course_hours_invalid', 'Kurun toplam ders saati tanımlı değil.', {
      path: ['totalHours'],
    })
  }
  const permille = progressionSettingsSchema.shape.minAttendancePermille.parse(
    input.minAttendancePermille,
  )
  const seen = new Set<string>()
  let attendedHours = 0
  let absentHours = 0
  let excusedAbsentHours = 0
  input.rows.forEach((raw, index) => {
    const row = lessonHourAttendanceSchema.parse(raw)
    if (seen.has(row.lessonHourId)) {
      throw new DomainError('attendance_duplicate', 'Bu ders saatinin yoklaması zaten alındı.', {
        kind: 'conflict',
        path: ['rows', String(index), 'lessonHourId'],
      })
    }
    seen.add(row.lessonHourId)
    if (LESSON_ATTENDANCE_STATUSES[row.status].attended) attendedHours += 1
    else {
      absentHours += 1
      if (row.excused) excusedAbsentHours += 1
    }
  })
  const recordedHours = attendedHours + absentHours
  if (recordedHours > totalHours) {
    throw new DomainError(
      'attendance_exceeds_course',
      'Yoklama satırı kurun toplam ders saatini aşıyor.',
      { kind: 'conflict', path: ['rows'] },
    )
  }
  const unrecordedHours = totalHours - recordedHours
  // Tamsayı aritmetiği: katılım × 1000 ≥ binde oran × toplam.
  const meets = (hours: number) => hours * 1000 >= permille * totalHours
  const requiredHours = Math.floor((permille * totalHours + 999) / 1000)
  const status = meets(attendedHours)
    ? 'eligible'
    : meets(attendedHours + unrecordedHours)
      ? 'pending'
      : 'ineligible'
  return {
    totalHours,
    recordedHours,
    attendedHours,
    absentHours,
    excusedAbsentHours,
    unrecordedHours,
    requiredHours,
    minAttendancePermille: permille,
    status,
  }
}

// --- Devamsızlık bildirimi (DOM-DIL-062) --------------------------------------------------

/**
 * Devamsızlık bildirimleri (DOM-DIL-062): devamsızlık kur saatinin %10'una ve %15'ine ulaşınca.
 * İkinci bildirim sınava girememe uyarısını taşır (`warnsExamBar`, metin anahtarı `messageKey`).
 * Devamsızlık kurumun sınırını zaten aşmışsa (sıkı kurum oranı) bildirim uyarı değil, sınava
 * girilemeyeceği bilgisidir (`examBarred`, `EXAM_BARRED_MESSAGE_KEY`).
 */
// TODO(cefr-bildirim-kurum-orani): Kurum daha sıkı devam oranı tanımlarsa bildirim eşiklerinin ne
// olacağı domain'de yok; eşikler sabit kalır, uyarı kurumun kendi sınırını yazar.
export const ABSENCE_NOTICES = {
  first: {
    percent: 10,
    label: 'Birinci devamsızlık bildirimi',
    warnsExamBar: false,
    messageKey: 'absence_notice_first',
  },
  second: {
    percent: 15,
    label: 'İkinci devamsızlık bildirimi',
    warnsExamBar: true,
    messageKey: 'absence_notice_second_exam_bar',
  },
} as const
export type AbsenceNoticeKind = keyof typeof ABSENCE_NOTICES
const NOTICE_KINDS = enumKeys(ABSENCE_NOTICES)

/** Devamsızlık kurum sınırını aşmışken gönderilen bildirimin metin anahtarı. */
export const EXAM_BARRED_MESSAGE_KEY = 'absence_notice_exam_barred'

/** Bildirimin alıcısı: kursiyer her zaman, 18 yaş altında veli de (DOM-DIL-062, 091). */
export type NoticeRecipient = 'learner' | 'guardian'

export type AbsenceNoticeDue = {
  kind: AbsenceNoticeKind
  label: string
  percent: number
  warnsExamBar: boolean
  /** Devamsızlık kurumun sınırını aştı: kursiyer kur sonu sınavına giremez (DOM-DIL-060). */
  examBarred: boolean
  messageKey: string
  /** Ekranda ve bildirimde kullanılacak Türkçe metin. */
  message: string
  recipients: NoticeRecipient[]
  absentHours: number
  totalHours: number
}

/**
 * Kayıt gününde değil, bildirim anında reşit mi (DOM-DIL-091, 092): yaş Europe/Istanbul gününe
 * göre hesaplanır. 29 Şubat doğumlu artık olmayan yılda 1 Mart'ta 18'ine girer (veli daha uzun
 * bilgilenir; muhafazakâr).
 */
export function isMinorOn(birthDate: string, now: Instant): boolean {
  if (!isCalendarDay(birthDate)) {
    throw new DomainError('birth_date_invalid', 'Doğum tarihi geçerli değil.', {
      path: ['birthDate'],
    })
  }
  return isUnderAdultAge(birthDate, toMs(now))
}

/**
 * Şu an gönderilmesi gereken devamsızlık bildirimi (DOM-DIL-062) veya `null`. Gönderilmiş
 * bildirimler girdi olarak gelir; aynı eşik iki kez önerilmez. İki eşik birlikte aşılmışsa yalnız
 * üstteki (ikinci) bildirim önerilir, çünkü uyarıyı o taşır; alttaki atlanmış sayılır. Üst eşik
 * gönderildiyse yoklama düzeltmesiyle oran düşse de alttaki artık önerilmez.
 */
export function absenceNoticeDue(input: {
  totalHours: number
  rows: readonly LessonHourAttendance[]
  minAttendancePermille?: number
  sentNotices: readonly { kind: AbsenceNoticeKind }[]
  // kvkk: K
  birthDate: string
  now: Instant
}): AbsenceNoticeDue | null {
  const summary = attendanceSummary(input)
  const sentRank = Math.max(-1, ...input.sentNotices.map((n) => NOTICE_KINDS.indexOf(n.kind)))
  const reached = NOTICE_KINDS.filter(
    (kind) => summary.absentHours * 100 >= ABSENCE_NOTICES[kind].percent * summary.totalHours,
  )
  const highest = reached.at(-1)
  if (highest === undefined || NOTICE_KINDS.indexOf(highest) <= sentRank) return null
  const notice = ABSENCE_NOTICES[highest]
  // Kurum oranı daha sıkıysa metin kurumun sınırını yazar (%20 yerine ör. %10).
  const barPercent = String((1000 - summary.minAttendancePermille) / 10).replace('.', ',')
  const examBarred = summary.status === 'ineligible'
  const reachedText = `Devamsızlık kur saatinin %${notice.percent} eşiğine ulaştı.`
  const message = examBarred
    ? `${reachedText} Devamsızlık %${barPercent} sınırını aştı; kur sonu sınavına girilemez.`
    : notice.warnsExamBar
      ? `${reachedText} Devamsızlık %${barPercent} sınırını aşarsa kur sonu sınavına girilemez.`
      : reachedText
  return {
    kind: highest,
    label: notice.label,
    percent: notice.percent,
    warnsExamBar: notice.warnsExamBar,
    examBarred,
    messageKey: examBarred ? EXAM_BARRED_MESSAGE_KEY : notice.messageKey,
    message,
    recipients: isMinorOn(input.birthDate, input.now) ? ['learner', 'guardian'] : ['learner'],
    absentHours: summary.absentHours,
    totalHours: summary.totalHours,
  }
}

// --- Kur içi ölçmeler (DOM-DIL-013) -------------------------------------------------------

/**
 * Kurun ölçme noktaları (DOM-DIL-013). Başlangıç ölçmesi tanılayıcıdır, not yerine geçmez ve kur
 * geçme hesabına girmez; yalnız ara ve kur sonu girer.
 */
export const ASSESSMENT_POINTS = {
  baseline: { label: 'Başlangıç (tanılayıcı)', countsForProgression: false },
  midterm: { label: 'Ara değerlendirme', countsForProgression: true },
  final: { label: 'Kur sonu değerlendirmesi', countsForProgression: true },
} as const
export type AssessmentPoint = keyof typeof ASSESSMENT_POINTS
const POINT_KEYS = enumKeys(ASSESSMENT_POINTS)

const feedback = z
  .string()
  .trim()
  .min(1, 'Beceri geri bildirimini yazın.')
  .max(2000, 'En fazla 2.000 karakter girebilirsiniz.')

/**
 * Ölçme sonucu gövdesi (DOM-DIL-013): dört becerinin her biri için 100 üzerinden puan ve yazılı
 * geri bildirim zorunludur; geri bildirimi boş ölçme kaydedilmez.
 */
// TODO(cefr-konu-geri-bildirimi): Domain "beceri ve konu bazında" geri bildirim istiyor; kurun konu
// listesi modeli yok. Konu geri bildirimi beceri geri bildirimi metninde yazılır.
// TODO(cefr-ek-olcme): Domain "en az üç" ölçme diyor; ek ara ölçme modeli yok, her nokta bir kez.
export const courseAssessmentInputSchema = z.object({
  enrollmentId: identifier,
  point: z.enum(POINT_KEYS, { error: 'Bir ölçme noktası seçin.' }),
  /** Ölçmenin 100 üzerinden toplam puanı (puanlama modülünün çıktısı). */
  score: score100,
  skills: z
    .array(
      z.object({
        skill: coreSkill,
        score: score100,
        // kvkk: K
        feedback,
      }),
    )
    .length(CORE_SKILLS.length, 'Dört becerinin her biri için puan ve geri bildirim girin.')
    .refine((list) => new Set(list.map((s) => s.skill)).size === list.length, {
      error: 'Her beceri bir kez girilir.',
    }),
})
export type CourseAssessmentInput = z.input<typeof courseAssessmentInputSchema>

/** Ölçme satırı. Servisten gelen eski veya eksik satır `assessmentGaps` ile denetlenir. */
export type CourseAssessmentRow = {
  id: string
  enrollmentId: string
  point: AssessmentPoint
  score: number
  skills: readonly { skill: string; score: number; feedback: string | null }[]
  assessedAt: string
  // kvkk: K
  assessedByUserId: string
}
export type CourseAssessmentDraft = Omit<CourseAssessmentRow, 'id'>

/**
 * Kişi: kullanıcı kimliği, rolü ve akademik koordinatör yetkisi. Koordinatör F4a2 puanlayıcısıyla
 * aynı modeldir (`skills/rubric.ts` `RubricRater.coordinator`, DOM-YTK-027): öğretmene verilen ek
 * yetkinin bayrağı; hangi kurdan sorumlu olduğu serviste çözülür. Yönetici koordinatörün yerine
 * geçmez.
 */
export type ProgressionActor = {
  // kvkk: K
  userId: string
  role: Role
  coordinator?: boolean | undefined
}

function assertCourseTeacher(actor: ProgressionActor, enrollment: CourseEnrollment, what: string) {
  if (actor.role !== 'ogretmen' || !enrollment.teacherUserIds.includes(actor.userId)) {
    throw new DomainError('permission_denied', `${what} yalnız grubun öğretmeni girer.`, {
      kind: 'forbidden',
    })
  }
}

function assertEnrollment(enrollment: CourseEnrollment, enrollmentId: string) {
  if (enrollment.id !== enrollmentId) {
    throw new DomainError('enrollment_not_found', 'Kur kaydı bulunamadı.', {
      kind: 'not_found',
      path: ['enrollmentId'],
    })
  }
}

/**
 * Ölçme sonucunu kaydeder (DOM-DIL-013). Grubun öğretmeni girer; her nokta kayıt başına bir kez
 * girilir. Hiçbir şeyi değiştirmez, yazılacak satırı döndürür.
 */
export function planCourseAssessment(input: {
  institutionType: InstitutionType
  enrollment: CourseEnrollment
  existing: readonly Pick<CourseAssessmentRow, 'enrollmentId' | 'point'>[]
  actor: ProgressionActor
  input: unknown
  now: Instant
}): CourseAssessmentDraft {
  assertLanguageSchool(input.institutionType)
  assertCourseTeacher(input.actor, input.enrollment, 'Ölçme sonucunu')
  const data = courseAssessmentInputSchema.parse(input.input)
  assertEnrollment(input.enrollment, data.enrollmentId)
  if (
    input.existing.some((row) => row.enrollmentId === data.enrollmentId && row.point === data.point)
  ) {
    throw new DomainError(
      'assessment_already_recorded',
      `${ASSESSMENT_POINTS[data.point].label} bu kayıt için girildi.`,
      { kind: 'conflict', path: ['point'] },
    )
  }
  return {
    enrollmentId: data.enrollmentId,
    point: data.point,
    score: data.score,
    skills: CORE_SKILLS.flatMap((skill) => data.skills.filter((s) => s.skill === skill)),
    assessedAt: toIso(input.now),
    assessedByUserId: input.actor.userId,
  }
}

export type AssessmentGap =
  | { point: AssessmentPoint; reason: 'missing' }
  | { point: AssessmentPoint; reason: 'skill_missing' | 'feedback_missing'; skill: string }

/**
 * Eksik ölçmeler (DOM-DIL-013): her kurda başlangıç, ara ve kur sonu bulunur; bir ölçme dört
 * becerinin her birinde puan ve boş olmayan geri bildirim taşımadıkça tamamlanmış sayılmaz.
 */
export function assessmentGaps(rows: readonly CourseAssessmentRow[]): AssessmentGap[] {
  const byPoint = new Map<AssessmentPoint, CourseAssessmentRow>()
  for (const row of rows) {
    if (byPoint.has(row.point)) {
      throw new DomainError('assessment_duplicate', 'Ölçme noktası tekrar ediyor.', {
        kind: 'conflict',
        path: ['assessments', row.point],
      })
    }
    byPoint.set(row.point, row)
  }
  return POINT_KEYS.flatMap((point): AssessmentGap[] => {
    const row = byPoint.get(point)
    if (row === undefined) return [{ point, reason: 'missing' }]
    return CORE_SKILLS.flatMap((skill): AssessmentGap[] => {
      const entry = row.skills.find((s) => s.skill === skill)
      if (entry === undefined) return [{ point, reason: 'skill_missing', skill }]
      if ((entry.feedback ?? '').trim() === '')
        return [{ point, reason: 'feedback_missing', skill }]
      return []
    })
  })
}

// --- Kur geçme koşulları (DOM-DIL-070) ----------------------------------------------------

/** Kur sonu kararı (DOM-DIL-070, ADR 0004 karar 8 `progression_decisions.outcome`). */
export const PROGRESSION_OUTCOMES = {
  passed: { label: 'Geçti' },
  repeat: { label: 'Tekrar' },
  incomplete_attendance: { label: 'Devamsızlıktan tamamlamadı' },
} as const
export type ProgressionOutcome = keyof typeof PROGRESSION_OUTCOMES
const OUTCOME_KEYS = enumKeys(PROGRESSION_OUTCOMES)

/**
 * Kararın dayanağının kopyası (ADR 0004 karar 5, 8: devam ve beceri puanı kopyası). Başlangıç
 * ölçmesi kopyaya girmez, çünkü kur geçme hesabına girmez (DOM-DIL-013).
 */
export const progressionBasisSchema = z.object({
  schemaVersion: z.literal(1),
  attendance: z.object({
    totalHours: z.number().int().min(1),
    attendedHours: z.number().int().min(0),
    absentHours: z.number().int().min(0),
    unrecordedHours: z.number().int().min(0),
    requiredHours: z.number().int().min(0),
    minAttendancePermille: z.number().int().min(MIN_ATTENDANCE_PERMILLE).max(1000),
    met: z.boolean(),
  }),
  finalPassScore: score100,
  assessments: z.array(
    z.object({
      point: z.enum(['midterm', 'final']),
      score: score100,
      skills: z.array(z.object({ skill: coreSkill, score: score100 })),
    }),
  ),
  conditions: z.object({ attendance: z.boolean(), finalScore: z.boolean(), skills: z.boolean() }),
})
export type ProgressionBasis = z.output<typeof progressionBasisSchema>

export type ProgressionBlocker =
  | { reason: 'attendance_pending' }
  | { reason: 'assessments_incomplete'; gaps: [AssessmentGap, ...AssessmentGap[]] }

export type ProgressionEvaluation = {
  attendance: AttendanceSummary
  /** Ölçme eksikleri; devam şartı sağlanmadıysa kur sonu sınavı olmayabilir, engel sayılmaz. */
  gaps: AssessmentGap[]
  conditions: { attendance: boolean; finalScore: boolean; skills: boolean }
  /** Kur sonu değerlendirmesinde şartı sağlamayan beceriler. */
  failingSkills: string[]
  /** Öğretmenin verebileceği sonuçlar; karar verilemiyorsa boş. */
  allowedOutcomes: ProgressionOutcome[]
  blocker: ProgressionBlocker | null
  basis: ProgressionBasis
}

/**
 * Kur geçme koşulları (DOM-DIL-060, 013, 070); saftır ve saklanmaz.
 * - Devam şartı sağlanmıyorsa sonuç yalnız `devamsızlıktan tamamlamadı` olabilir; ölçme aranmaz,
 *   çünkü kursiyer kur sonu sınavına alınmaz.
 * - Devam henüz belli değilse (yoklaması alınmamış saat) karar verilemez.
 * - Devam şartı sağlanmışsa üç ölçme tamamlanmış olmalıdır. `geçti` için kur sonu puanı kurum
 *   eşiğine ve dört becerinin her biri ayrı ayrı 50'ye ulaşmalıdır; aksi halde yalnız `tekrar`.
 *   Koşullar sağlansa da öğretmen `tekrar` verebilir (koşullar zorunlu, yeterli değil).
 */
// TODO(cefr-ara-olcme-agirligi): Domain eşikleri "kur sonu değerlendirmesi"ne bağlıyor, ara
// ölçmenin ağırlığını vermiyor. Eşikler kur sonu ölçmesine uygulanır; ara ölçme tamamlanmış olmak
// zorundadır ve dayanak kopyasına girer.
export function evaluateProgression(input: {
  enrollment: CourseEnrollment
  settings?: ProgressionSettingsInput
  attendance: readonly LessonHourAttendance[]
  assessments: readonly CourseAssessmentRow[]
}): ProgressionEvaluation {
  const settings = progressionSettingsSchema.parse(input.settings ?? {})
  const own = input.assessments.filter((row) => row.enrollmentId === input.enrollment.id)
  const attendance = attendanceSummary({
    totalHours: input.enrollment.totalHours,
    rows: input.attendance,
    minAttendancePermille: settings.minAttendancePermille,
  })
  const gaps = assessmentGaps(own)
  const final = own.find((row) => row.point === 'final')
  const skillScore = (skill: string) => final?.skills.find((s) => s.skill === skill)?.score
  const failingSkills = CORE_SKILLS.filter((skill) => {
    const value = skillScore(skill)
    return value === undefined || value < PASS_RULES.skillScore
  })
  const conditions = {
    attendance: attendance.status === 'eligible',
    finalScore: final !== undefined && final.score >= settings.finalPassScore,
    skills: final !== undefined && failingSkills.length === 0,
  }
  const [firstGap, ...otherGaps] = gaps
  const blocker: ProgressionBlocker | null =
    attendance.status === 'pending'
      ? { reason: 'attendance_pending' }
      : attendance.status === 'eligible' && firstGap !== undefined
        ? { reason: 'assessments_incomplete', gaps: [firstGap, ...otherGaps] }
        : null
  const allowedOutcomes: ProgressionOutcome[] =
    blocker !== null
      ? []
      : attendance.status === 'ineligible'
        ? ['incomplete_attendance']
        : conditions.finalScore && conditions.skills
          ? ['passed', 'repeat']
          : ['repeat']
  const basis = progressionBasisSchema.parse({
    schemaVersion: 1,
    attendance: {
      totalHours: attendance.totalHours,
      attendedHours: attendance.attendedHours,
      absentHours: attendance.absentHours,
      unrecordedHours: attendance.unrecordedHours,
      requiredHours: attendance.requiredHours,
      minAttendancePermille: attendance.minAttendancePermille,
      met: conditions.attendance,
    },
    finalPassScore: settings.finalPassScore,
    assessments: own
      .filter((row) => ASSESSMENT_POINTS[row.point].countsForProgression)
      .sort((a, b) => POINT_KEYS.indexOf(a.point) - POINT_KEYS.indexOf(b.point))
      .map((row) => ({
        point: row.point,
        score: row.score,
        skills: CORE_SKILLS.flatMap((skill) => {
          const entry = row.skills.find((s) => s.skill === skill)
          return entry === undefined ? [] : [{ skill, score: entry.score }]
        }),
      })),
    conditions,
  })
  return { attendance, gaps, conditions, failingSkills, allowedOutcomes, blocker, basis }
}

// --- Kur geçme kararı ---------------------------------------------------------------------

/** Kararın durumu: öğretmen önerir, akademik koordinatör onaylar veya reddeder. */
export const PROGRESSION_DECISION_STATUSES = {
  pending: { label: 'Onay bekliyor' },
  approved: { label: 'Onaylandı' },
  rejected: { label: 'Reddedildi' },
} as const
export type ProgressionDecisionStatus = keyof typeof PROGRESSION_DECISION_STATUSES

/** `progression_decisions` satırı (ADR 0004 karar 8). */
export type ProgressionDecisionRecord = {
  id: string
  enrollmentId: string
  learnerId: string
  courseId: string
  outcome: ProgressionOutcome
  status: ProgressionDecisionStatus
  // kvkk: K
  rationale: string
  /** Düzeltme kararında düzeltilen onaylı karar; ilk kararda `null`. */
  correctsDecisionId: string | null
  // kvkk: K
  decidedByUserId: string
  decidedAt: string
  // kvkk: K
  reviewedByUserId: string | null
  reviewedAt: string | null
  // kvkk: K
  rejectionReason: string | null
  basis: ProgressionBasis
  /** Karar anının seviye önerisi; kararın gerekçesidir, kararı vermez (DOM-BEC-030). */
  evidenceSnapshot: EvidenceSnapshot
}
export type ProgressionDecisionDraft = Omit<ProgressionDecisionRecord, 'id'>

const rationale = z
  .string()
  .trim()
  .min(1, 'Karar gerekçesini yazın.')
  .max(2000, 'En fazla 2.000 karakter girebilirsiniz.')

/** Karar gövdesi. Düzeltme, öncekine referans veren gerekçeli yeni karardır. */
export const progressionDecisionInputSchema = z.object({
  enrollmentId: identifier,
  outcome: z.enum(OUTCOME_KEYS, { error: 'Bir karar seçin.' }),
  // kvkk: K
  rationale,
  correctsDecisionId: identifier.nullable().default(null),
})
export type ProgressionDecisionInput = z.input<typeof progressionDecisionInputSchema>

/**
 * Kaydın geçerli kararı: düzeltilmemiş en son onaylı karar. Düzeltme zinciri bir önceki onaylı
 * karara referans verir; onaylanmış düzeltme öncekinin yerine geçer.
 */
export function effectiveProgressionDecision<
  T extends Pick<ProgressionDecisionRecord, 'id' | 'status' | 'correctsDecisionId'>,
>(decisions: readonly T[]): T | null {
  const approved = decisions.filter((d) => d.status === 'approved')
  const corrected = new Set(approved.map((d) => d.correctsDecisionId))
  return approved.find((d) => !corrected.has(d.id)) ?? null
}

function outcomeError(evaluation: ProgressionEvaluation, outcome: ProgressionOutcome): DomainError {
  if (evaluation.blocker?.reason === 'attendance_pending') {
    return new DomainError(
      'attendance_pending',
      'Devam şartı henüz belli değil; kalan ders saatlerinin yoklaması alınmalıdır.',
      { kind: 'conflict', path: ['attendance'] },
    )
  }
  if (evaluation.blocker?.reason === 'assessments_incomplete') {
    const [gap] = evaluation.blocker.gaps
    const path = ['assessments', gap.point]
    if (gap.reason !== 'missing') path.push('skills', gap.skill)
    if (gap.reason === 'feedback_missing') path.push('feedback')
    return new DomainError(
      'assessments_incomplete',
      'Kur sonu kararı için başlangıç, ara ve kur sonu ölçmeleri geri bildirimleriyle tamamlanmalıdır.',
      { path },
    )
  }
  if (evaluation.attendance.status === 'ineligible') {
    return new DomainError(
      'attendance_not_met',
      'Devam şartı sağlanmadı; karar yalnız “devamsızlıktan tamamlamadı” olabilir.',
      { path: ['outcome'] },
    )
  }
  if (outcome === 'incomplete_attendance') {
    return new DomainError(
      'attendance_met',
      'Devam şartı sağlandı; “devamsızlıktan tamamlamadı” verilemez.',
      { path: ['outcome'] },
    )
  }
  return new DomainError(
    'pass_conditions_not_met',
    'Geçti için kur sonu puanı kurum eşiğine ve dört becerinin her biri 50’ye ulaşmalıdır.',
    { path: ['outcome'] },
  )
}

/**
 * Kur sonu kararını önerir (DOM-DIL-070): grubun öğretmeni karar verir, akademik koordinatör
 * onaylar (`planProgressionReview`). Koşulları sağlamayan sonuç reddedilir; seviye önerisi karara
 * gerekçe olarak eklenir. Kayıt başına aynı anda tek açık karar bulunur; onaylanmış karar
 * değişmez, düzeltme `correctsDecisionId` ile geçerli karara referans veren yeni karardır.
 * Hiçbir şeyi değiştirmez, yazılacak satırı döndürür.
 */
export function planProgressionDecision(input: {
  institutionType: InstitutionType
  enrollment: CourseEnrollment
  settings?: ProgressionSettingsInput
  attendance: readonly LessonHourAttendance[]
  assessments: readonly CourseAssessmentRow[]
  /** Karar anındaki seviye önerisi (DOM-BEC-030); karara gerekçe olarak eklenir. */
  suggestion: CefrSuggestion
  /** Bu kaydın bütün kararları (bekleyen, onaylı, reddedilmiş). */
  existingDecisions: readonly ProgressionDecisionRecord[]
  actor: ProgressionActor
  input: unknown
  now: Instant
}): ProgressionDecisionDraft {
  assertLanguageSchool(input.institutionType)
  assertCourseTeacher(input.actor, input.enrollment, 'Kur sonu kararını')
  const data = progressionDecisionInputSchema.parse(input.input)
  assertEnrollment(input.enrollment, data.enrollmentId)
  const own = input.existingDecisions.filter((d) => d.enrollmentId === input.enrollment.id)
  if (own.some((d) => d.status === 'pending')) {
    throw new DomainError('progression_pending', 'Bu kayıt için onay bekleyen bir karar var.', {
      kind: 'conflict',
    })
  }
  const effective = effectiveProgressionDecision(own)
  if (data.correctsDecisionId === null && effective !== null) {
    throw new DomainError(
      'progression_already_decided',
      'Bu kur için onaylanmış karar var; değişiklik gerekçeli düzeltme kararıyla yapılır.',
      { kind: 'conflict' },
    )
  }
  if (data.correctsDecisionId !== null && data.correctsDecisionId !== effective?.id) {
    throw new DomainError(
      'progression_correction_target_invalid',
      'Düzeltme yalnız kaydın geçerli onaylı kararına yapılır.',
      { path: ['correctsDecisionId'] },
    )
  }
  const evaluation = evaluateProgression(input)
  if (!evaluation.allowedOutcomes.includes(data.outcome)) {
    throw outcomeError(evaluation, data.outcome)
  }
  return {
    enrollmentId: input.enrollment.id,
    learnerId: input.enrollment.learnerId,
    courseId: input.enrollment.courseId,
    outcome: data.outcome,
    status: 'pending',
    rationale: data.rationale,
    correctsDecisionId: data.correctsDecisionId,
    decidedByUserId: input.actor.userId,
    decidedAt: toIso(input.now),
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    basis: evaluation.basis,
    evidenceSnapshot: evidenceSnapshotOf(input.suggestion),
  }
}

/** Koordinatörün onay veya ret gövdesi; ret gerekçesi zorunludur. */
export const progressionReviewInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), decisionId: identifier }),
  z.object({
    action: z.literal('reject'),
    decisionId: identifier,
    // kvkk: K
    reason: z
      .string()
      .trim()
      .min(1, 'Reddetme gerekçesini yazın.')
      .max(2000, 'En fazla 2.000 karakter girebilirsiniz.'),
  }),
])
export type ProgressionReviewInput = z.input<typeof progressionReviewInputSchema>

/**
 * Onaylayabilen yalnız akademik koordinatördür (DOM-DIL-070, DOM-YTK-027); yönetici rolü tek başına
 * yetki vermez. F4a2'de uyuşmazlık puanını veren koordinatörle aynı kural (DOM-BEC-024).
 */
// TODO(cefr-koordinator-kapsam): Koordinatörün sorumlu olduğu seviye/kur verisi yok (F4a2 ile
// aynı); kapsamı servis daraltır.
export function canReviewProgression(actor: ProgressionActor): boolean {
  return actor.coordinator === true
}

/** Anahtar sırasından bağımsız karşılaştırma için kararlı JSON (jsonb sırayı korumaz). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Kararı onaylar veya reddeder (DOM-DIL-070). Kararı veren kendi kararını onaylayamaz (dört göz,
 * DOM-KYN-031 ile aynı ilke). Onay anında koşullar güncel verilerle yeniden hesaplanır; dayanak
 * (devam, ara ve kur sonu puanları, eşik) öneri anındakinden farklıysa onay reddedilir ve öğretmen
 * yeniden önerir (`progression_basis_changed`). Onaylı veya reddedilmiş karar değişmez.
 */
export function planProgressionReview(input: {
  institutionType: InstitutionType
  enrollment: CourseEnrollment
  settings?: ProgressionSettingsInput
  attendance: readonly LessonHourAttendance[]
  assessments: readonly CourseAssessmentRow[]
  decision: ProgressionDecisionRecord
  actor: ProgressionActor
  input: unknown
  now: Instant
}): ProgressionDecisionRecord {
  assertLanguageSchool(input.institutionType)
  if (!canReviewProgression(input.actor)) {
    throw new DomainError('permission_denied', 'Kur sonu kararını akademik koordinatör onaylar.', {
      kind: 'forbidden',
    })
  }
  const data = progressionReviewInputSchema.parse(input.input)
  const { decision } = input
  if (decision.id !== data.decisionId || decision.enrollmentId !== input.enrollment.id) {
    throw new DomainError('progression_not_found', 'Kur sonu kararı bulunamadı.', {
      kind: 'not_found',
      path: ['decisionId'],
    })
  }
  if (decision.status !== 'pending') {
    throw new DomainError(
      'progression_already_reviewed',
      'Bu karar sonuçlandı; değişiklik gerekçeli düzeltme kararıyla yapılır.',
      { kind: 'conflict' },
    )
  }
  if (decision.decidedByUserId === input.actor.userId) {
    throw new DomainError(
      'progression_self_review',
      'Kararı veren kişi kendi kararını onaylayamaz.',
      { kind: 'forbidden' },
    )
  }
  const reviewed = { reviewedByUserId: input.actor.userId, reviewedAt: toIso(input.now) }
  if (data.action === 'reject') {
    return { ...decision, ...reviewed, status: 'rejected', rejectionReason: data.reason }
  }
  const evaluation = evaluateProgression(input)
  if (canonical(evaluation.basis) !== canonical(decision.basis)) {
    throw new DomainError(
      'progression_basis_changed',
      'Karardan sonra devam veya ölçme verisi değişti; öğretmen kararı yeniden önermelidir.',
      { kind: 'conflict', path: ['basis'] },
    )
  }
  if (!evaluation.allowedOutcomes.includes(decision.outcome)) {
    throw outcomeError(evaluation, decision.outcome)
  }
  return { ...decision, ...reviewed, status: 'approved' }
}
