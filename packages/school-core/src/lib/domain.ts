import { z } from 'zod'
import type { questionBank } from '../data/question-bank.ts'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { ADULT_AGE, ageOn, isCalendarDay } from './age.ts'
import { dayKey } from './format.ts'
import type { ActorLink } from './scope.ts'
import { DomainError } from './errors.ts'
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
// Oturum: rol ve velinin seçili çocuğu. API oturumu üyelik bağlantılarını (`links`) da taşır;
// çevrimdışı demoda bağlantılar sabit demo kimliklerinden türetilir (`lib/scope.ts`).
export type Session = { role: Role; childId?: string; links?: readonly ActorLink[] }
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
// --- Kesin kayıt ------------------------------------------------------------------------------

/** Kesin kayıt tutarının sınırları (kuruş): 100–1.000.000 ₺. */
export const ENROLLMENT_TOTAL_CENTS = { min: 10_000, max: 100_000_000 } as const
/** Velinin öğrenciye yakınlık derecesi (DOM-KAY-012). */
export const GUARDIAN_RELATIONS = ['mother', 'father', 'legal_guardian', 'other'] as const
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number]
export const GUARDIAN_RELATION_LABELS = {
  mother: 'Anne',
  father: 'Baba',
  legal_guardian: 'Vasi',
  other: 'Diğer',
} as const satisfies Record<GuardianRelation, string>
/** Sözleşmenin ödeyicisi: veli ya da öğrencinin kendisi (DOM-KAY-012). */
export const ENROLLMENT_PAYERS = ['guardian', 'student'] as const
export type EnrollmentPayer = (typeof ENROLLMENT_PAYERS)[number]
export const ENROLLMENT_PAYER_LABELS = {
  guardian: 'Veli',
  student: 'Öğrencinin kendisi',
} as const satisfies Record<EnrollmentPayer, string>
/** Kurum türüne göre kesin kayıt sözleşmesinin başlığı. */
export const ENROLLMENT_CONTRACT_TITLES = {
  school: 'Özel okul eğitim sözleşmesi',
  language_school: 'Dil kursu eğitim sözleşmesi',
} as const satisfies Record<InstitutionType, string>

/**
 * T.C. kimlik numarası (yabancı uyruklu kimlik numarası da aynı algoritmayı kullanır): 11 hane,
 * ilk hane sıfır değil; 10. hane tek ve çift sıradaki hanelerden, 11. hane ilk on hanenin
 * toplamından türetilir.
 */
export function isValidNationalId(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const d = [...value].map(Number)
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const even = d[1]! + d[3]! + d[5]! + d[7]!
  const tenth = (((odd * 7 - even) % 10) + 10) % 10
  const eleventh = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10
  return d[9] === tenth && d[10] === eleventh
}
// kvkk: Ç — T.C. veya yabancı uyruklu kimlik numarası; loglanmaz, listelerde maskelenir.
export const nationalIdSchema = z
  .string()
  .trim()
  .regex(/^\d{11}$/, { message: 'Kimlik numarası 11 haneli olmalıdır.', abort: true })
  .refine(isValidNationalId, 'Geçerli bir kimlik numarası girin.')
// kvkk: Ç — öğrencinin doğum tarihi (`YYYY-MM-DD`).
export const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Doğum tarihini seçin.', abort: true })
  .refine(isCalendarDay, 'Geçerli bir doğum tarihi seçin.')

/**
 * Kesin kayıt girdisi: para kuruş cinsinden tamsayıdır (`totalCents`). İsteğe bağlı alanlar:
 * başka kampüsün sınıfı için bilinçli onay (`allowOtherCampus`), kardeşin mevcut velisi
 * (`parentId`, DOM-KAY-013), kimlik no, doğum tarihi, yakınlık ve ödeyici (DOM-KAY-012).
 * TODO(enroll-required-fields): DOM-KAY-012 alanları web formu gelince `school`'da zorunlu olur.
 */
export const enrollmentSchema = z.object({
  prospectId: requiredText,
  classId: requiredText,
  totalCents: z
    .number('Tutar sayı olmalıdır.')
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .min(ENROLLMENT_TOTAL_CENTS.min, 'Tutar en az 100 ₺ olmalıdır.')
    .max(ENROLLMENT_TOTAL_CENTS.max, 'Tutar en fazla 1.000.000 ₺ olabilir.'),
  count: z.number().int().min(1).max(12),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'İlk ödeme tarihini seçin.'),
  allowOtherCampus: z.boolean().optional(),
  parentId: requiredText.optional(),
  nationalId: nationalIdSchema.optional(),
  birthDate: birthDateSchema.optional(),
  guardianRelation: z.enum(GUARDIAN_RELATIONS, 'Yakınlık derecesini seçin.').optional(),
  payer: z.enum(ENROLLMENT_PAYERS, 'Ödeyiciyi seçin.').optional(),
})
export type EnrollmentInput = z.input<typeof enrollmentSchema>
export type EnrollmentOptions = { institutionType?: InstitutionType }

/**
 * Çevrimdışı demo formu (`registrationSchema`, tam lira) → core kesin kayıt girdisi (kuruş).
 * Demo formları kampüs onayı sormaz ve her kampüsün sınıfını listeler; davranışları korunur
 * (`allowOtherCampus`). TODO(crm-enroll): demo kalıcılığı silinince kalkar.
 */
export function enrollmentFromRegistration(input: unknown): EnrollmentInput {
  const data = registrationSchema.parse(input)
  return {
    prospectId: data.prospectId,
    classId: data.classId,
    totalCents: data.total * 100,
    count: data.count,
    startDate: data.startDate,
    allowOtherCampus: true,
  }
}

/** Kardeş adayın (DOM-KAY-031) kayıtlı öğrencisinin velisi; iki yönde de aranır. */
function siblingParent(state: State, prospect: State['prospects'][number]) {
  for (const other of state.prospects) {
    if (other.id === prospect.id || !other.studentId) continue
    if (other.id !== prospect.siblingOfId && other.siblingOfId !== prospect.id) continue
    const sibling = state.students.find((s) => s.id === other.studentId)
    const parent = sibling && state.parents.find((p) => p.id === sibling.parentId)
    if (parent) return parent
  }
  return undefined
}

/**
 * Kesin kayıt: açık aşamadaki adayı öğrenci, veli, taksit ve sözleşmeyle birlikte kayda alır
 * (DOM-KAY-001, DOM-KAY-011, DOM-KAY-035). Yetkiyi kendisi denetlemez (`payInvoice` gibi); API
 * önce `requireAuthorized(actor, 'prospect.enroll', …)` çalıştırır.
 *
 * - 18 yaş altında (DOM-KAY-003, DOM-KAY-009) adayın telefonu ve e-postası velinindir: veliye
 *   yazılır, öğrenciye yazılmaz; veli adı adayın `guardianName`'idir. `school` öğrencisi her zaman
 *   18 yaş altıdır; `language_school`'da adayın seçimi, seçimi olmayan eski adayda doğum tarihi.
 * - Kardeş kaydında (DOM-KAY-013) yeni veli açılmaz: açıkça seçilen veli (`parentId`) ya da kardeş
 *   adayın (DOM-KAY-031) kayıtlı öğrencisinin velisi kullanılır; iletişim eşleşmesiyle otomatik
 *   birleştirilmez.
 * - Sınıf adayın kampüsünden değilse 422 `class_campus_mismatch`; `allowOtherCampus` bilinçli
 *   seçimdir.
 * - DOM-KAY-012 alanları (kimlik no, doğum tarihi, yakınlık, ödeyici) şimdilik isteğe bağlıdır.
 *
 * TODO(crm-enroll): çevrimdışı demo çağıranları (Vue `Crm.vue`, mobil `model/operations.ts`) yetki
 * denetlemez; demo kalıcılığı silinince kalkar. API ucu `POST /api/v1/prospects/:prospectId/enroll`.
 */
export function enrollProspect(
  state: State,
  input: unknown,
  makeId: MakeId,
  now = new Date().toISOString(),
  options: EnrollmentOptions = {},
) {
  const data = enrollmentSchema.parse(input)
  const institutionType = options.institutionType ?? 'school'
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
  if (cls.branchId !== prospect.branchId && data.allowOtherCampus !== true)
    throw new DomainError(
      'class_campus_mismatch',
      'Seçilen sınıf adayın kampüsünde değil; başka kampüsün sınıfı için seçimi onaylayın.',
      { path: ['classId'] },
    )
  if (state.students.filter((s) => s.classId === cls.id && s.isActive).length >= cls.capacity)
    throw new DomainError('class_capacity_full', 'Seçilen sınıfın kontenjanı dolu.')

  const age = data.birthDate === undefined ? undefined : ageOn(data.birthDate, now)
  if (age !== undefined && age < 0)
    throw new DomainError('invalid_birth_date', 'Doğum tarihi bugünden sonra olamaz.', {
      path: ['birthDate'],
    })
  const minor =
    institutionType === 'school' ? true : (prospect.minor ?? (age === undefined || age < ADULT_AGE))
  if (institutionType === 'language_school' && age !== undefined && age < ADULT_AGE !== minor)
    throw new DomainError(
      'birth_date_minor_mismatch',
      'Doğum tarihi adayın 18 yaş durumuyla uyuşmuyor; doğum tarihini kontrol edin.',
      { path: ['birthDate'] },
    )
  const payer = data.payer ?? (minor ? 'guardian' : 'student')
  if (minor && payer !== 'guardian')
    throw new DomainError(
      'payer_must_be_guardian',
      '18 yaş altı öğrencinin sözleşmesini ve ödemesini veli üstlenir.',
      { path: ['payer'] },
    )
  if (!minor && payer !== 'student')
    throw new DomainError(
      'payer_must_be_student',
      '18 yaş ve üstü kursiyer sözleşmenin tarafı ve ödeyicisidir.',
      { path: ['payer'] },
    )
  for (const field of ['parentId', 'guardianRelation'] as const)
    if (!minor && data[field] !== undefined)
      throw new DomainError(
        'guardian_not_applicable',
        '18 yaş ve üstü kursiyer için veli bilgisi alınmaz.',
        { path: [field] },
      )
  const existingParent =
    data.parentId === undefined
      ? minor
        ? siblingParent(state, prospect)
        : undefined
      : state.parents.find((p) => p.id === data.parentId)
  if (data.parentId !== undefined && !existingParent)
    throw new DomainError('parent_not_found', 'Seçilen veli bulunamadı.', {
      kind: 'not_found',
      path: ['parentId'],
    })

  const studentId = makeId('s')
  const student: State['students'][number] = {
    id: studentId,
    name: prospect.name,
    classId: cls.id,
    parentId: existingParent?.id ?? makeId('p'),
    // 18 yaş altında iletişim bilgisi velinindir; öğrenciye yazılmaz (DOM-KAY-003).
    email: minor ? '' : prospect.email,
    phone: minor ? '' : prospect.phone,
    joinedAt: now,
    isActive: true,
    progress: 0,
    ...(data.nationalId === undefined ? {} : { nationalId: data.nationalId }),
    ...(data.birthDate === undefined ? {} : { birthDate: data.birthDate }),
    ...(minor && data.guardianRelation !== undefined
      ? { guardianRelation: data.guardianRelation }
      : {}),
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
    }
  })
  const parent = existingParent ?? {
    id: student.parentId,
    name: minor && prospect.guardianName ? prospect.guardianName : `${student.name} velisi`,
    studentIds: [] as string[],
    // kvkk: K — 18 yaş altı öğrencinin velisinin iletişim bilgisi (DOM-KAY-003).
    ...(minor ? { phone: prospect.phone } : {}),
    ...(minor && prospect.email ? { email: prospect.email } : {}),
  }
  parent.studentIds = [...parent.studentIds, student.id]
  if (!existingParent) state.parents.push(parent)
  state.students.push(student)
  state.invoices.push(...invoices)
  const contract = {
    id: makeId('contract'),
    studentId: student.id,
    date: now,
    amount: data.totalCents,
    title: ENROLLMENT_CONTRACT_TITLES[institutionType],
    payer,
  }
  state.contracts.push(contract)
  prospect.studentId = student.id
  prospect.stage = 'Kayıt oldu'
  return { student, contract, parent }
}
