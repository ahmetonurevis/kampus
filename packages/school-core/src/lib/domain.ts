import { z } from 'zod'
import type { questionBank } from '../data/question-bank.ts'
import type { State } from '../data/seed.ts'
import type { Role } from '../modules/navigation.ts'
import { dayKey } from './format.ts'
import type { ActorLink } from './scope.ts'
import { DomainError } from './errors.ts'

z.config(z.locales.tr())

export const requiredText = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(2000, 'En fazla 2000 karakter girebilirsiniz.')
export type MakeId = (prefix: string) => string
/** Tarifeli sözleşmenin karar anı kopyası (DOM-FIN-010). */
export interface ContractTerms {
  tariffId: string
  tariffVersion: number
  grossCents: number
  netCents: number
  discounts: readonly { kind: string; amountCents: number }[]
  extras: readonly { kind: string; amountCents: number }[]
  approvedByUserId: string
  payer: 'guardian' | 'student'
  /** Kayıtta atanan burs (DOM-FIN-025); `netCents` burstan sonraki tutardır. */
  scholarship?: { programId: string; amountCents: number }
}
// Oturum: rol ve velinin seçili çocuğu. API oturumu üyelik bağlantılarını (`links`) ve işlemi
// yapan kişinin kullanıcı kimliğini (`userId`) da taşır; çevrimdışı demoda bağlantılar sabit demo
// kimliklerinden türetilir (`lib/scope.ts`) ve `userId` verilmez (denetimde demo kimliği yazılır).
export type Session = {
  role: Role
  childId?: string
  links?: readonly ActorLink[]
  // kvkk: K — işlemi yapan kişinin kimliği; denetim girdisinin `user_id` alanına yazılır.
  userId?: string
}
export type BankQuestion = (typeof questionBank)[number]

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/**
 * Takvim günü (`YYYY-MM-DD`); geçersiz gün (ör. 2026-02-30) reddedilir. Biçim `regex` ile
 * denetlenir (OpenAPI `pattern`); takvim denetimi yalnız biçimi doğru değerde hata ekler, böylece
 * tek hata döner.
 */
export const daySchema = z
  .string()
  .regex(DAY_PATTERN, 'Geçerli bir tarih seçin.')
  .refine(
    (v) =>
      !DAY_PATTERN.test(v) ||
      (Number.isFinite(Date.parse(`${v}T09:00:00Z`)) &&
        new Date(`${v}T09:00:00Z`).toISOString().slice(0, 10) === v),
    'Geçerli bir tarih seçin.',
  )

/** Yoklama durumları (DOM-AKD-030); saklanan değer İngilizce anahtardır. */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]
const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES, 'Yoklama durumunu seçin.')
const isAttendanceStatus = (value: unknown): value is AttendanceStatus =>
  attendanceStatusSchema.safeParse(value).success
// kvkk: K — serbest metin; loglanmaz, denetim kaydına yazılmaz. Yöneticide zorunluluk yetki
// kuralıdır (`authorize('attendance.record')`, `correction_reason_required`); öğretmende isteğe bağlı.
const attendanceReasonSchema = z
  .string()
  .trim()
  .max(500, 'En fazla 500 karakter girebilirsiniz.')
  .optional()

/**
 * Sınıf yoklaması girdisi; API gövde şeması ve web/mobil form şemasıdır. `marks` sınıfın bütün
 * aktif öğrencilerini içermelidir (işlem denetler).
 */
export const attendanceInputSchema = z.object({
  date: daySchema,
  marks: z.record(z.string().min(1).max(200), attendanceStatusSchema),
  reason: attendanceReasonSchema,
})
export type AttendanceInput = z.input<typeof attendanceInputSchema>

/** Yönetici düzeltmesinde gerekçenin alt sınırı (DOM-AKD-035); `authorize` aynı sayıyı uygular. */
export const ATTENDANCE_CORRECTION_REASON_MIN = 2

/**
 * Yönetici yoklama düzeltmesinin gerekçesi (DOM-AKD-035): kırpılmış en az 2, en çok 500
 * karakter. API'de alt sınır yetki kuralıdır (`authorize('attendance.record')`, 422
 * `correction_reason_required`); web ve mobil form bu şemayla istek atmadan aynı kuralı uygular.
 */
// kvkk: K — serbest metin; loglanmaz, denetim kaydına yazılmaz.
export const attendanceCorrectionReasonSchema = z
  .string()
  .trim()
  .min(ATTENDANCE_CORRECTION_REASON_MIN, 'Düzeltme için gerekçe yazın.')
  .max(500, 'En fazla 500 karakter girebilirsiniz.')

/**
 * Yoklama düzeltmesi (DOM-AKD-035): kayıt üzerine iz bırakmadan yazılmaz; eski ve yeni durum,
 * gerekçe, düzelten ve zaman geçmişte kalır. Öğrenci ve veli bu geçmişi görmez (`lib/scope.ts`).
 */
export type AttendanceCorrection = {
  /** Eski kayıt örnek veri veya demo kalıcılığından gelir; değer olduğu gibi saklanır. */
  previousStatus: string
  status: AttendanceStatus
  // kvkk: K
  reason: string
  /** Düzelten kullanıcının kimliği; çevrimdışı demoda boş. */
  // kvkk: K
  by: string
  at: string
}
export type AttendanceOptions = {
  /** Düzeltme gerekçesi; yalnız durumu değişen öğrencilerin geçmişine yazılır. */
  reason?: string | undefined
  /** İşlemi yapan kullanıcının kimliği (API: oturum kullanıcısı). */
  by?: string | undefined
}

/**
 * Sınıfın günlük yoklaması: aynı öğrenci ve gün için tek kayıt bulunur. Var olan kaydın durumu
 * değişince eski durum `corrections` geçmişine yazılır (DOM-AKD-035); durumu değişmeyen öğrenciye
 * geçmiş düşülmez. Yetki çağıranın işidir (`requireAuthorized(…, 'attendance.record', …)`).
 * Önce bütün girdi doğrulanır; hata olursa hiçbir kayıt değişmez.
 */
export function recordAttendance(
  state: State,
  classId: string,
  date: string,
  marks: Readonly<Record<string, string>>,
  now = new Date().toISOString(),
  options: AttendanceOptions = {},
) {
  const students = state.students.filter((s) => s.classId === classId && s.isActive)
  if (!Number.isFinite(+new Date(date)))
    throw new DomainError('invalid_attendance_date', 'Geçerli bir yoklama tarihi seçin.')
  if (dayKey(date) > dayKey(now))
    throw new DomainError('attendance_future_date', 'Gelecek tarih için yoklama alınamaz.')
  if (!students.length)
    throw new DomainError('class_has_no_active_students', 'Bu sınıfta aktif öğrenci bulunmuyor.')
  const reason = attendanceReasonSchema.parse(options.reason) ?? ''
  // Önce tüm işaretler doğrulanır; geçersiz işaret varsa hiçbir kayıt değişmez.
  const marked = students.map((student) => {
    const status = marks[student.id]
    if (!isAttendanceStatus(status))
      throw new DomainError('attendance_incomplete', 'Tüm öğrencilerin yoklama durumunu seçin.')
    return { student, status }
  })
  const day = dayKey(date)
  const byStudent = new Map<string, State['attendance'][number]>()
  for (const a of state.attendance)
    if (dayKey(a.date) === day && !byStudent.has(a.studentId)) byStudent.set(a.studentId, a)
  for (const { student, status } of marked) {
    const existing = byStudent.get(student.id)
    if (existing) {
      if (existing.status === status) continue
      const correction: AttendanceCorrection = {
        previousStatus: existing.status,
        status,
        reason,
        by: options.by ?? '',
        at: now,
      }
      existing.corrections = [...(existing.corrections ?? []), correction]
      existing.status = status
    } else
      state.attendance.push({
        id: `att-${student.id}-${dayKey(date)}`,
        studentId: student.id,
        classId,
        date,
        status,
        reason: '',
      })
  }
}
// Parametreler yapısal tiplidir; örnek veri üreticisi de bu fonksiyonu çağırdığından State'e bağlanmaz.
export function gradeQuiz(
  quiz: { questionIds: readonly string[] },
  bank: readonly BankQuestion[],
  answers: Readonly<Record<string, number | null | undefined>>,
  allowUnanswered = false,
) {
  const found = quiz.questionIds.map((id) => bank.find((q) => q.id === id))
  const questions = found.filter((q) => q !== undefined)
  if (!found.length || questions.length !== found.length)
    throw new DomainError('quiz_questions_not_found', 'Sınav soruları bulunamadı.', {
      kind: 'not_found',
    })
  if (
    questions.some((q) => {
      const answer = answers[q.id]
      return (
        !(allowUnanswered && answer == null) &&
        (typeof answer !== 'number' ||
          !Number.isInteger(answer) ||
          answer < 0 ||
          answer >= q.options.length)
      )
    })
  )
    throw new DomainError('quiz_unanswered', 'Lütfen tüm soruları yanıtlayın.')
  const correct = questions.filter((q) => answers[q.id] === q.answer).length
  const topicScores = [...new Set(questions.map((q) => q.topic))].map((topic) => {
    const subset = questions.filter((q) => q.topic === topic)
    return {
      topic,
      score: Math.round(
        (subset.filter((q) => answers[q.id] === q.answer).length / subset.length) * 100,
      ),
    }
  })
  return {
    correct,
    total: questions.length,
    score: Math.round((correct / questions.length) * 100),
    topicScores,
  }
}
