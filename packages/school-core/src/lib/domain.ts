import { z } from 'zod'
import type { questionBank } from '../data/question-bank.ts'
import type { State } from '../data/seed.ts'
import type { Role } from '../modules/navigation.ts'
import { dayKey } from './format.ts'
import type { ActorLink } from './scope.ts'
import { DomainError } from './errors.ts'
import type { FeeItemKind } from './fee-tariffs.ts'
import { OPEN_PROSPECT_STAGES } from './prospects.ts'

z.config(z.locales.tr())

export const requiredText = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(2000, 'En fazla 2000 karakter girebilirsiniz.')
export const prospectSchema = z.object({
  name: requiredText.max(80),
  phone: z.string().regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
  email: z.email('Geçerli bir e-posta adresi girin.'),
  branchId: requiredText,
  interest: requiredText,
  source: requiredText,
})
export const registrationSchema = z.object({
  prospectId: requiredText,
  classId: requiredText,
  total: z.coerce
    .number()
    .int('Tutar tam sayı olmalıdır.')
    .min(100, 'Tutar en az 100 ₺ olmalıdır.')
    .max(1000000, 'Tutar en fazla 1.000.000 ₺ olabilir.'),
  count: z.coerce.number().int().min(1).max(12),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'İlk ödeme tarihini seçin.'),
})
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

export function installmentAmounts(cents: number, count: number) {
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12
  )
    throw new DomainError('invalid_installment', 'Taksit tutarı veya sayısı geçersiz.')
  const base = Math.floor(cents / count)
  return Array.from({ length: count }, (_, i) => base + (i < cents % count ? 1 : 0))
}
/** Tahsilat yöntemleri: saklanan değer Türkçe etikettir (örnek veri ve mevcut kayıtlar aynı metni taşır). */
export const PAYMENT_METHODS = ['Banka havalesi', 'Nakit', 'Kredi kartı'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
/** Yöntem değeri → kullanıcıya gösterilen Türkçe etiket. */
export const PAYMENT_METHOD_LABELS = {
  'Banka havalesi': 'Banka havalesi',
  Nakit: 'Nakit',
  'Kredi kartı': 'Kredi kartı',
} as const satisfies Record<PaymentMethod, string>
/** Tahsilat girdisi; API gövde şeması ve web/mobil form şemasıdır. */
export const paymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS, 'Ödeme yöntemini seçin.'),
})
export type PaymentInput = z.input<typeof paymentInputSchema>
// Çevrimdışı demo (Vue "Demo Sanal POS", mobil "Kredi kartı (demo)") bu değerleri yazar; demo kalıcılığı
// silinene kadar `payInvoice` bunları da kabul eder. API ve yeni formlar `paymentInputSchema` kullanır.
const LEGACY_DEMO_PAYMENT_METHODS = ['Demo Sanal POS', 'Kredi kartı (demo)'] as const
const payInvoiceInputSchema = z.object({
  method: z.enum([...PAYMENT_METHODS, ...LEGACY_DEMO_PAYMENT_METHODS], 'Ödeme yöntemini seçin.'),
})
export function payInvoice(
  state: State,
  invoiceId: string,
  method: string,
  now = new Date().toISOString(),
) {
  const input = payInvoiceInputSchema.safeParse({ method })
  if (!input.success)
    throw new DomainError('invalid_payment_method', 'Ödeme yöntemini seçin.', {
      path: ['method'],
    })
  const invoice = state.invoices.find((i) => i.id === invoiceId)
  if (!invoice)
    throw new DomainError('invoice_not_found', 'Ödeme kaydı bulunamadı.', { kind: 'not_found' })
  if (invoice.paidAt)
    throw new DomainError('invoice_already_paid', 'Bu taksit zaten ödenmiş.', { kind: 'conflict' })
  invoice.paidAt = now
  invoice.method = input.data.method
  return invoice
}
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
type Enrollment = {
  prospectId: string
  classId: string
  totalCents: number
  count: number
  startDate: string
  contractTitle: string
  /** Tarifeli kayıtta dolu (`lib/enrollment.ts`); çevrimdışı demo vermez. */
  academicYear?: number
  extras?: readonly { kind: FeeItemKind; amountCents: number }[]
  guardian?:
    | { kind: 'self' }
    | { kind: 'existing'; parentId: string }
    | { kind: 'new'; name: string; phone: string; relationship: string }
  terms?: ContractTerms
  /**
   * Veli zorunlu mu (DOM-KAY-003, DOM-KAY-012; okulda her yaşta, kursta 18 yaş altında): `true` ise
   * adayın telefonu ve e-postası velinindir, öğrenciye yazılmaz. Tarifeli kayıt verir; çevrimdışı
   * demo vermez (`undefined`, eski davranış).
   */
  guardianContact?: boolean
  /** Öğrencinin kendi iletişimi (isteğe bağlı); verilen alan öğrenciye yazılır. */
  studentContact?: { phone?: string | undefined; email?: string | undefined }
  /** Başka kampüsün sınıfı bilinçli seçildi; yoksa 422 `class_campus_mismatch`. */
  allowOtherCampus?: boolean
}
const SCHOOL_CONTRACT_TITLE = 'Özel okul eğitim sözleşmesi'

/**
 * Çevrimdışı demo girişi: `registrationSchema` (tam TL).
 * TODO(crm-enroll): çevrimdışı demo çağıranları (Vue `Crm.vue`, mobil `model/operations.ts`) yetki
 * denetlemez; demo kalıcılığı silinince kalkar.
 */
export function enrollProspect(
  state: State,
  input: unknown,
  makeId: MakeId,
  now = new Date().toISOString(),
) {
  const data = registrationSchema.parse(input)
  return applyEnrollment(
    state,
    {
      prospectId: data.prospectId,
      classId: data.classId,
      totalCents: data.total * 100,
      count: data.count,
      startDate: data.startDate,
      contractTitle: SCHOOL_CONTRACT_TITLE,
      // Demo formu her kampüsün sınıfını listeler; seçim bilinçli sayılır (eski davranış).
      allowOtherCampus: true,
    },
    makeId,
    now,
  )
}

/**
 * Kesin kayıt: açık aşamadaki adayı öğrenci, veli, taksit ve sözleşmeyle birlikte kayda alır
 * (DOM-KAY-001, DOM-KAY-011, DOM-KAY-035). Sözleşme yalnız kendi taksitlerini listeler
 * (`invoiceIds`, DOM-FIN-012).
 */
export function applyEnrollment(state: State, data: Enrollment, makeId: MakeId, now: string) {
  const prospect = state.prospects.find((p) => p.id === data.prospectId)
  const cls = state.classes.find((c) => c.id === data.classId && c.isActive)
  if (!prospect || !cls || !state.branches.some((b) => b.id === cls.branchId && b.isActive))
    throw new DomainError('prospect_or_class_not_found', 'Aday veya sınıf bulunamadı.', {
      kind: 'not_found',
    })
  if (prospect.studentId || prospect.stage === 'Kayıt oldu')
    throw new DomainError('prospect_already_enrolled', 'Bu adayın kaydı zaten tamamlanmış.', {
      kind: 'conflict',
    })
  // Yalnız açık aşamadaki aday kayda alınır; vazgeçen aday önce yeniden açılır (DOM-KAY-035).
  if (!(OPEN_PROSPECT_STAGES as readonly (string | undefined)[]).includes(prospect.stage))
    throw new DomainError(
      'prospect_closed',
      'Yalnız açık aşamadaki aday kayda alınır; vazgeçen adayı önce yeniden açın.',
      { kind: 'conflict' },
    )
  // Aday bir kampüse başvurur; başka kampüsün sınıfı yalnız açık onayla seçilir.
  if (cls.branchId !== prospect.branchId && data.allowOtherCampus !== true)
    throw new DomainError(
      'class_campus_mismatch',
      'Seçilen sınıf adayın kampüsünde değil; başka kampüsün sınıfı için seçimi onaylayın.',
      { path: ['classId'] },
    )
  if (state.students.filter((s) => s.classId === cls.id && s.isActive).length >= cls.capacity)
    throw new DomainError('class_capacity_full', 'Seçilen sınıfın kontenjanı dolu.')
  const guardian = data.guardian
  const existingParent =
    guardian?.kind === 'existing'
      ? state.parents.find((p) => p.id === guardian.parentId)
      : undefined
  const student = {
    id: makeId('s'),
    name: prospect.name,
    classId: cls.id,
    parentId: existingParent?.id ?? makeId('p'),
    // Veli zorunluyken adayın iletişimi velinindir; öğrenciye yazılmaz (DOM-KAY-003). Öğrencinin
    // kendi iletişimi istenirse ayrıca verilir (DOM-KAY-012).
    email: data.studentContact?.email ?? (data.guardianContact === true ? '' : prospect.email),
    phone: data.studentContact?.phone ?? (data.guardianContact === true ? '' : prospect.phone),
    joinedAt: now,
    isActive: true,
    progress: 0,
  }
  const amounts = installmentAmounts(data.totalCents, data.count)
  const start = new Date(`${data.startDate}T09:00:00.000Z`)
  if (Number.isNaN(+start) || dayKey(start) !== data.startDate)
    throw new DomainError('invalid_payment_date', 'Geçerli bir ödeme tarihi girin.')
  const invoices = amounts.map((amount, i) => {
    const lastDay = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 0),
    ).getUTCDate()
    const due = new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + i,
        Math.min(start.getUTCDate(), lastDay),
        9,
      ),
    )
    return {
      id: makeId('inv'),
      studentId: student.id,
      installment: i + 1,
      amount,
      dueDate: due.toISOString(),
      paidAt: null,
      method: null,
      reminderAt: null,
      ...(data.terms ? { feeKind: 'tuition' as const } : {}),
      ...(data.academicYear === undefined ? {} : { academicYear: data.academicYear }),
    }
  })
  // Ek hizmetler ayrı borç kalemidir, öğrenim ücretine gömülmez (DOM-FIN-003).
  const extraInvoices = (data.extras ?? []).map((extra, i) => ({
    id: makeId('inv'),
    studentId: student.id,
    installment: amounts.length + i + 1,
    amount: extra.amountCents,
    dueDate: start.toISOString(),
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: extra.kind,
    ...(data.academicYear === undefined ? {} : { academicYear: data.academicYear }),
  }))
  if (existingParent) {
    existingParent.studentIds.push(student.id)
    // Mevcut velinin eksik iletişimi adayınkiyle tamamlanır; var olan telefon, e-posta ve ad
    // değişmez, adayın kendi kaydında kalır (ör. diğer ebeveynin telefonu) (DOM-KAY-003).
    if (data.guardianContact === true) {
      if (!existingParent.phone && prospect.phone) existingParent.phone = prospect.phone
      if (!existingParent.email && prospect.email) existingParent.email = prospect.email
    }
  } else
    state.parents.push({
      id: student.parentId,
      name:
        guardian?.kind === 'new'
          ? guardian.name
          : guardian?.kind === 'self'
            ? student.name
            : `${student.name} velisi`,
      studentIds: [student.id],
      ...(guardian?.kind === 'new'
        ? { phone: guardian.phone, relationship: guardian.relationship }
        : {}),
      // Yetişkin kursiyerin kendi satırı veli değildir; kardeşe önerilmez (DOM-KAY-013).
      ...(guardian?.kind === 'self' ? { relationship: 'self' } : {}),
      // kvkk: K — 18 yaş altı adayın e-postası velinindir (DOM-KAY-003).
      ...(guardian?.kind === 'new' && data.guardianContact === true && prospect.email
        ? { email: prospect.email }
        : {}),
    })
  state.students.push(student)
  const allInvoices = [...invoices, ...extraInvoices]
  state.invoices.push(...allInvoices)
  const contract = {
    id: makeId('contract'),
    studentId: student.id,
    date: now,
    amount: allInvoices.reduce((sum, invoice) => sum + invoice.amount, 0),
    title: data.contractTitle,
    invoiceIds: allInvoices.map((invoice) => invoice.id),
    ...(data.academicYear === undefined ? {} : { academicYear: data.academicYear }),
    ...(data.terms ?? {}),
  }
  state.contracts.push(contract)
  prospect.studentId = student.id
  prospect.stage = 'Kayıt oldu'
  return { student, contract }
}
