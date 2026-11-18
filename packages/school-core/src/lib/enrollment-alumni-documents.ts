import { z } from 'zod'

import { INSTITUTION_TYPES, type InstitutionType } from '../modules/collection-modules.ts'
import { ENROLLMENT_STATUS_LABELS, type EnrollmentStatus } from './enrollment-status.ts'
import { DomainError } from './errors.ts'
import { average } from './format.ts'
import type { CustodyKind } from './guardianship.ts'

/**
 * Mezun ve ayrılan öğrenci belge talebi (docs/domain/kayit-ve-crm.md DOM-KAY-044; ON-260). Mezun
 * hesabı (ON-252) olmadığı için talep ön büroya telefon, e-posta, dilekçe ya da şahsen gelir;
 * personel kaydeder. Talep eden kişinin kendisi, velisi (reşit değilse) ya da vekilidir (K-328).
 * Belge türleri: öğrenim belgesi ve not dökümü kayıtlardan PDF olarak üretilir; diploma örneği
 * yalnız okulda ve yalnız mezun için hazırlanır, resmî diploma e-Okul'dan alındığı için dosya
 * olarak eklenir (IST-143: resmî sisteme otomatik gönderim yok).
 *
 * Durum: alındı → hazırlanıyor → hazır → teslim edildi; teslimden önce gerekçeyle reddedilir
 * (K-330). Hazır olurken yıl bazlı sıralı belge numarası (`MB-2026-0001`) verilir ve belgenin
 * içeriği dondurulur. Teslimde kimliği kontrol eden kişi (oturumdaki personel) ve kimlik
 * doğrulama notu zorunludur. Ücret kurum ayarıdır (belge türü başına, kuruş), talep açılırken
 * adetle çarpılıp dondurulur; ücretli talep ödeme yöntemi seçilmeden teslim edilmez ve ödendi
 * işareti teslimle birlikte düşer (K-329; tahsilat kaydı açılmaz, M-50, M-51).
 *
 * Fonksiyonlar saftır; zaman `today`/`now` parametresiyle gelir.
 */

z.config(z.locales.tr())

/** Talebi kaydeden, hazırlayan ve teslim eden roller (K-331). */
export const ALUMNI_DOCUMENT_ROLES = ['yonetici', 'onburo'] as const
/** Ücret ayarını değiştiren rol (K-329). */
export const ALUMNI_DOCUMENT_FEE_ROLES = ['yonetici'] as const

export const ALUMNI_DOCUMENT_TYPES = [
  'education_certificate',
  'transcript',
  'diploma_copy',
] as const
export type AlumniDocumentType = (typeof ALUMNI_DOCUMENT_TYPES)[number]
export const ALUMNI_DOCUMENT_TYPE_LABELS = {
  education_certificate: 'Öğrenim belgesi',
  transcript: 'Not dökümü (transkript)',
  diploma_copy: 'Diploma örneği',
} as const satisfies Record<AlumniDocumentType, string>
/** Kayıtlardan PDF'i üretilen türler; diploma örneği dosya olarak eklenir. */
export const ALUMNI_GENERATED_TYPES = ['education_certificate', 'transcript'] as const

export const ALUMNI_REQUESTER_KINDS = ['self', 'guardian', 'proxy'] as const
export type AlumniRequesterKind = (typeof ALUMNI_REQUESTER_KINDS)[number]
export const ALUMNI_REQUESTER_LABELS = {
  self: 'Kendisi',
  guardian: 'Velisi',
  proxy: 'Vekili',
} as const satisfies Record<AlumniRequesterKind, string>

export const ALUMNI_REQUEST_CHANNELS = ['in_person', 'phone', 'email', 'petition'] as const
export type AlumniRequestChannel = (typeof ALUMNI_REQUEST_CHANNELS)[number]
export const ALUMNI_REQUEST_CHANNEL_LABELS = {
  in_person: 'Ön büroda şahsen',
  phone: 'Telefon',
  email: 'E-posta',
  petition: 'Dilekçe',
} as const satisfies Record<AlumniRequestChannel, string>

export const ALUMNI_DELIVERY_METHODS = ['in_person', 'email', 'cargo'] as const
export type AlumniDeliveryMethod = (typeof ALUMNI_DELIVERY_METHODS)[number]
export const ALUMNI_DELIVERY_LABELS = {
  in_person: 'Elden',
  email: 'E-posta (PDF)',
  cargo: 'Kargo',
} as const satisfies Record<AlumniDeliveryMethod, string>

export const ALUMNI_REQUEST_STATUSES = [
  'received',
  'preparing',
  'ready',
  'delivered',
  'rejected',
] as const
export type AlumniRequestStatus = (typeof ALUMNI_REQUEST_STATUSES)[number]
export const ALUMNI_REQUEST_STATUS_LABELS = {
  received: 'Alındı',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  delivered: 'Teslim edildi',
  rejected: 'Reddedildi',
} as const satisfies Record<AlumniRequestStatus, string>

export const ALUMNI_FEE_PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const
export type AlumniFeePaymentMethod = (typeof ALUMNI_FEE_PAYMENT_METHODS)[number]
export const ALUMNI_FEE_PAYMENT_LABELS = {
  cash: 'Nakit',
  card: 'Kredi ya da banka kartı',
  transfer: 'Havale/EFT',
} as const satisfies Record<AlumniFeePaymentMethod, string>

export const ALUMNI_COPIES_MAX = 10
export const ALUMNI_TEXT_MIN = 5
export const ALUMNI_REASON_MAX = 500
export const ALUMNI_MANUAL_NOTE_MAX = 1000
export const ALUMNI_NAME_MAX = 120
export const ALUMNI_ADDRESS_MAX = 500
export const ALUMNI_EMAIL_MAX = 254
/** Belge başı ücretin üst sınırı (10.000,00 ₺); yanlışlıkla fazladan sıfır yazımını yakalar. */
export const ALUMNI_FEE_MAX_CENTS = 1_000_000
/** Talep eden reşit sayılır (TMK md. 11). */
export const ADULT_AGE = 18

// --- Şemalar -------------------------------------------------------------------------------------

const text = (empty: string, min: number, max: number, short: string) =>
  z
    .string(empty)
    .trim()
    .min(min, short)
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)

const optional = <T extends z.ZodType<string>>(schema: T) =>
  z
    .union([schema, z.literal(''), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value))

export const createAlumniDocumentRequestSchema = z
  .strictObject({
    studentId: z
      .string('Öğrenciyi seçin.')
      .trim()
      .min(1, 'Öğrenciyi seçin.')
      .max(200, 'Öğrenciyi seçin.'),
    documentType: z.enum(ALUMNI_DOCUMENT_TYPES, 'Belge türünü seçin.'),
    copies: z
      .number('Adedi girin.')
      .int('Adet tam sayı olmalıdır.')
      .min(1, 'Adet en az 1 olmalıdır.')
      .max(ALUMNI_COPIES_MAX, `Adet en çok ${String(ALUMNI_COPIES_MAX)} olabilir.`),
    channel: z.enum(ALUMNI_REQUEST_CHANNELS, 'Talebin nasıl geldiğini seçin.'),
    requesterKind: z.enum(ALUMNI_REQUESTER_KINDS, 'Talep edeni seçin.'),
    /** Talep eden veli kaydı (`parents`); yalnız `guardian`. */
    guardianParentId: optional(z.string().trim().max(200)),
    // kvkk: K — vekilin adı
    proxyName: optional(text('Vekilin adını yazın.', 2, ALUMNI_NAME_MAX, 'Vekilin adını yazın.')),
    /** Vekâletname ya da reşit kişinin yazılı rızası (`document` dosyası, PDF). */
    authorizationFileId: optional(z.uuid('Geçerli bir dosya seçin.')),
    deliveryMethod: z.enum(ALUMNI_DELIVERY_METHODS, 'Teslim yolunu seçin.'),
    // kvkk: K — e-posta ile teslim adresi
    deliveryEmail: optional(
      z
        .email('Geçerli bir e-posta adresi girin.')
        .max(ALUMNI_EMAIL_MAX, 'Geçerli bir e-posta adresi girin.'),
    ),
    // kvkk: K — kargo adresi
    deliveryAddress: optional(
      text('Kargo adresini yazın.', 10, ALUMNI_ADDRESS_MAX, 'Kargo adresini açık yazın.'),
    ),
  })
  .superRefine((data, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (data.requesterKind === 'guardian' && data.guardianParentId === null)
      issue('guardianParentId', 'Talep eden veliyi seçin.')
    if (data.requesterKind === 'proxy') {
      if (data.proxyName === null) issue('proxyName', 'Vekilin adını yazın.')
      if (data.authorizationFileId === null)
        issue('authorizationFileId', 'Vekâletnameyi PDF olarak yükleyin.')
    }
    if (data.deliveryMethod === 'email' && data.deliveryEmail === null)
      issue('deliveryEmail', 'Belgenin gönderileceği e-posta adresini girin.')
    if (data.deliveryMethod === 'cargo' && data.deliveryAddress === null)
      issue('deliveryAddress', 'Kargo adresini yazın.')
  })
export type CreateAlumniDocumentRequestInput = z.input<typeof createAlumniDocumentRequestSchema>

export const markAlumniDocumentReadySchema = z.strictObject({
  // kvkk: K — kayıtlarda olmayan bilgi için hazırlayanın notu; belgeye yazılır
  manualNote: optional(
    text('Notu yazın.', 1, ALUMNI_MANUAL_NOTE_MAX, 'Notu yazın.').describe(
      'Kayıtlarda olmayan bilgi (ör. eski yılların notlarının kaynağı); belgeye yazılır',
    ),
  ),
  /** Diploma örneğinin taranmış dosyası (`document`, PDF); yalnız diploma örneğinde. */
  fileId: optional(z.uuid('Geçerli bir dosya seçin.')),
})
export type MarkAlumniDocumentReadyInput = z.input<typeof markAlumniDocumentReadySchema>

export const deliverAlumniDocumentSchema = z.strictObject({
  // kvkk: K — teslimde kimliğin nasıl doğrulandığı
  identityCheckNote: text(
    'Kimliğin nasıl doğrulandığını yazın.',
    ALUMNI_TEXT_MIN,
    ALUMNI_REASON_MAX,
    'Kimlik doğrulama notunu en az 5 karakterle yazın.',
  ),
  paymentMethod: z
    .enum(ALUMNI_FEE_PAYMENT_METHODS, 'Ödeme yöntemini seçin.')
    .nullable()
    .default(null),
})
export type DeliverAlumniDocumentInput = z.input<typeof deliverAlumniDocumentSchema>

export const rejectAlumniDocumentSchema = z.strictObject({
  // kvkk: K
  reason: text(
    'Ret gerekçesini yazın.',
    ALUMNI_TEXT_MIN,
    ALUMNI_REASON_MAX,
    'Ret gerekçesini en az 5 karakterle yazın.',
  ),
})
export type RejectAlumniDocumentInput = z.input<typeof rejectAlumniDocumentSchema>

const feeCentsSchema = z
  .number('Ücreti girin.')
  .int('Ücret kuruş cinsinden tam sayı olmalıdır.')
  .min(0, 'Ücret eksi olamaz.')
  .max(ALUMNI_FEE_MAX_CENTS, 'Belge başı ücret en çok 10.000,00 ₺ olabilir.')

export const alumniDocumentFeesSchema = z.strictObject({
  education_certificate: feeCentsSchema,
  transcript: feeCentsSchema,
  diploma_copy: feeCentsSchema,
})
export type AlumniDocumentFees = z.output<typeof alumniDocumentFeesSchema>
export const updateAlumniDocumentFeesSchema = alumniDocumentFeesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'En az bir belge türünün ücretini girin.')
export type UpdateAlumniDocumentFeesInput = z.input<typeof updateAlumniDocumentFeesSchema>
export const NO_ALUMNI_FEES: AlumniDocumentFees = {
  education_certificate: 0,
  transcript: 0,
  diploma_copy: 0,
}

// --- Belge içeriği -------------------------------------------------------------------------------

const outcomeSchema = z.enum(['graduated', 'withdrawn']).describe('Mezun ya da ayrıldı')
const learnerShape = {
  institutionName: z.string(),
  institutionType: z.enum(INSTITUTION_TYPES),
  learnerName: z.string(),
  schoolNumber: z.string().nullable().describe('Okul numarası; kayıtta yoksa `null`'),
  enrolledDate: z.string().nullable().describe('Kayıt günü (`YYYY-MM-DD`); bilinmiyorsa `null`'),
  leftDate: z.string().nullable().describe('Mezuniyet ya da ayrılış günü; bilinmiyorsa `null`'),
  outcome: outcomeSchema,
  lastClassName: z.string().nullable().describe('Son sınıfı; okunamıyorsa `null`'),
}

export const alumniEducationCertificateSchema = z.strictObject({
  kind: z.literal('education_certificate'),
  ...learnerShape,
})
export type AlumniEducationCertificate = z.infer<typeof alumniEducationCertificateSchema>

export const alumniTranscriptSchema = z.strictObject({
  kind: z.literal('transcript'),
  ...learnerShape,
  terms: z
    .array(
      z.strictObject({
        className: z.string(),
        term: z.number().int(),
        subjects: z.array(
          z.strictObject({
            name: z.string(),
            average: z.number().int().describe('Dönem ortalaması (0–100, tam sayıya yuvarlanır)'),
            count: z.number().int().describe('Ortalamaya giren not sayısı'),
          }),
        ),
      }),
    )
    .describe('Okulda sınıf ve dönem başına ders ortalamaları; dil okulunda boş'),
  courses: z
    .array(
      z.strictObject({
        name: z.string(),
        level: z.string(),
        groupName: z.string(),
        startDate: z.string(),
        endDate: z.string(),
      }),
    )
    .describe('Dil okulunda katıldığı kurlar, başlangıç sırasıyla; okulda boş'),
})
export type AlumniTranscript = z.infer<typeof alumniTranscriptSchema>

export const alumniDocumentContentSchema = z.discriminatedUnion('kind', [
  alumniEducationCertificateSchema,
  alumniTranscriptSchema,
])
export type AlumniDocumentContent = z.infer<typeof alumniDocumentContentSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, path === undefined ? {} : { path: [path] })

/** `birthDate` gününde ve sonrasında `day` itibarıyla 18 yaşını doldurmuş mu; bilinmiyorsa `null`. */
export function isAdultOn(birthDate: string | null | undefined, day: string): boolean | null {
  if (birthDate === null || birthDate === undefined || !/^\d{4}-\d{2}-\d{2}/.test(birthDate))
    return null
  const born = birthDate.slice(0, 10)
  const adultFrom = `${String(Number(born.slice(0, 4)) + ADULT_AGE).padStart(4, '0')}${born.slice(4)}`
  return day >= adultFrom
}

export interface AlumniRequestFacts {
  institutionType: InstitutionType
  /** Öğrencinin kayıt durumu (`enrollmentStatus`). */
  status: EnrollmentStatus
  /** Bugün itibarıyla reşit mi; doğum tarihi bilinmiyorsa `null` (reşit sayılır, K-328). */
  adult: boolean | null
  /** Seçilen velinin öğrenciyle etkin bağı; yoksa `null`. Yalnız `guardian` talebinde okunur. */
  guardianBond: { custody: CustodyKind; contactRestricted: boolean } | null
  /** Belge türünün kurum ayarındaki belge başı ücreti (kuruş). */
  unitFeeCents: number
}

export type AlumniDocumentRequestPlan = z.output<typeof createAlumniDocumentRequestSchema> & {
  feeCents: number
}

/**
 * Talep (DOM-KAY-044, K-328): yalnız mezun ya da ayrılmış kişi için; aktif öğrencinin belgesi
 * öğrenci belgesidir (DOM-KAY-027). Diploma örneği yalnız okulda ve mezuna. Kendisi reşit değilse
 * talebi velisi yapar. Veli velayetli ve iletişim kısıtsız olmalıdır (DOM-ILT-070, DOM-ILT-074);
 * kişi reşitse ya da yaşı bilinmiyorsa velinin talebi kişinin yazılı rızasını (dosya) ister. Vekil
 * vekâletname ister. Teslim yoluna ait olmayan iletişim bilgisi saklanmaz.
 */
export function planAlumniDocumentRequest(
  input: unknown,
  facts: AlumniRequestFacts,
): AlumniDocumentRequestPlan {
  const data = createAlumniDocumentRequestSchema.parse(input)
  if (facts.status === 'active')
    throw ruleError(
      'alumni_document_student_active',
      'Kaydı aktif öğrenciye öğrenci belgesi düzenlenir; bu talep yalnız mezun ya da ayrılmış kişi içindir.',
      'studentId',
    )
  if (data.documentType === 'diploma_copy') {
    if (facts.institutionType !== 'school')
      throw ruleError(
        'alumni_document_type_unavailable',
        'Diploma örneği yalnız okullarda hazırlanır.',
        'documentType',
      )
    if (facts.status !== 'graduated')
      throw ruleError(
        'alumni_document_not_graduated',
        `Diploma örneği yalnız mezun için hazırlanır; kayıt durumu: ${ENROLLMENT_STATUS_LABELS[facts.status]}.`,
        'documentType',
      )
  }
  if (data.requesterKind === 'self' && facts.adult === false)
    throw ruleError(
      'alumni_document_requester_minor',
      'Reşit olmayan kişinin belge talebini velisi yapar.',
      'requesterKind',
    )
  if (data.requesterKind === 'guardian') {
    const bond = facts.guardianBond
    if (bond === null)
      throw ruleError(
        'alumni_document_guardian_unknown',
        'Seçilen kişi bu öğrencinin kayıtlı velisi değil.',
        'guardianParentId',
      )
    if (bond.custody === 'none' || bond.contactRestricted)
      throw ruleError(
        'alumni_document_guardian_not_authorized',
        'Velayeti olmayan ya da iletişimi kısıtlı veli belge talep edemez.',
        'guardianParentId',
      )
    if (facts.adult !== false && data.authorizationFileId === null)
      throw ruleError(
        'alumni_document_consent_required',
        'Reşit kişinin belgesini velisi ancak kişinin yazılı rızasıyla alabilir; rıza belgesini PDF olarak yükleyin.',
        'authorizationFileId',
      )
  }
  return {
    ...data,
    guardianParentId: data.requesterKind === 'guardian' ? data.guardianParentId : null,
    proxyName: data.requesterKind === 'proxy' ? data.proxyName : null,
    authorizationFileId: data.requesterKind === 'self' ? null : data.authorizationFileId,
    deliveryEmail: data.deliveryMethod === 'email' ? data.deliveryEmail : null,
    deliveryAddress: data.deliveryMethod === 'cargo' ? data.deliveryAddress : null,
    feeCents: facts.unitFeeCents * data.copies,
  }
}

export type AlumniRequestAction = 'start' | 'ready' | 'deliver' | 'reject'

/** Durum geçiş tablosu (K-330); teslim edilen ve reddedilen talep kapanmıştır. */
const ACTION_FROM: Readonly<Record<AlumniRequestAction, readonly AlumniRequestStatus[]>> = {
  start: ['received'],
  ready: ['preparing'],
  deliver: ['ready'],
  reject: ['received', 'preparing', 'ready'],
}

/** Talebin bu durumda yapılabilecek işlemleri (ekran düğmeleri). */
export function alumniRequestActions(status: AlumniRequestStatus): AlumniRequestAction[] {
  return (Object.keys(ACTION_FROM) as AlumniRequestAction[]).filter((action) =>
    ACTION_FROM[action].includes(status),
  )
}

function assertAction(status: AlumniRequestStatus, action: AlumniRequestAction): void {
  if (!ACTION_FROM[action].includes(status))
    throw ruleError(
      'alumni_document_invalid_status',
      `Talep bu işlem için uygun aşamada değil; durumu: ${ALUMNI_REQUEST_STATUS_LABELS[status]}.`,
    )
}

export interface AlumniRequestState {
  status: AlumniRequestStatus
  documentType: AlumniDocumentType
  feeCents: number
}

export function planAlumniRequestStart(request: AlumniRequestState): void {
  assertAction(request.status, 'start')
}

/** Belgede gösterilecek satır var mı; yoksa hazırlayanın açıklaması zorunludur. */
export function isAlumniContentEmpty(content: AlumniDocumentContent): boolean {
  return content.kind === 'transcript' && content.terms.length === 0 && content.courses.length === 0
}

/**
 * Hazır (K-330): üretilen türde dosya eklenmez, not dökümünde kayıt yoksa elle not zorunludur;
 * diploma örneğinde taranmış dosya zorunludur. İçerik çağıranın kayıtlardan ürettiğidir.
 */
export function planAlumniRequestReady(
  request: AlumniRequestState,
  input: unknown,
  content: AlumniDocumentContent | null,
): z.output<typeof markAlumniDocumentReadySchema> {
  assertAction(request.status, 'ready')
  const data = markAlumniDocumentReadySchema.parse(input ?? {})
  if (request.documentType === 'diploma_copy') {
    if (data.fileId === null)
      throw ruleError(
        'alumni_document_file_required',
        'Diploma örneğinin taranmış PDF dosyasını yükleyin.',
        'fileId',
      )
    return data
  }
  if (data.fileId !== null)
    throw ruleError(
      'alumni_document_file_not_allowed',
      'Bu belge kayıtlardan üretilir; dosya eklenmez.',
      'fileId',
    )
  if (content !== null && isAlumniContentEmpty(content) && data.manualNote === null)
    throw ruleError(
      'alumni_document_transcript_empty',
      'Kayıtlarda not ya da kur bulunamadı; belgeye yazılacak açıklamayı not alanına yazın.',
      'manualNote',
    )
  return data
}

/** Teslim (K-329, K-330): kimlik notu zorunlu; ücretli talepte ödeme yöntemi seçilmeden teslim yok. */
export function planAlumniRequestDeliver(
  request: AlumniRequestState,
  input: unknown,
): z.output<typeof deliverAlumniDocumentSchema> {
  assertAction(request.status, 'deliver')
  const data = deliverAlumniDocumentSchema.parse(input)
  if (request.feeCents > 0 && data.paymentMethod === null)
    throw ruleError(
      'alumni_document_payment_required',
      'Ücretli belge, ücreti alınmadan teslim edilmez; ödeme yöntemini seçin.',
      'paymentMethod',
    )
  return { ...data, paymentMethod: request.feeCents > 0 ? data.paymentMethod : null }
}

export function planAlumniRequestReject(
  request: AlumniRequestState,
  input: unknown,
): z.output<typeof rejectAlumniDocumentSchema> {
  assertAction(request.status, 'reject')
  return rejectAlumniDocumentSchema.parse(input)
}

/** Belge numarası: `MB-<yıl>-<sıra>`; sıra kurumda yıl başına 1'den başlar. */
export function alumniDocumentNumber(year: number, sequence: number): string {
  return `MB-${String(year)}-${String(sequence).padStart(4, '0')}`
}

// --- İçerik üretimi ------------------------------------------------------------------------------

export interface AlumniLearnerFacts {
  institution: { name: string; type: InstitutionType }
  student: { name: string; number?: string | null | undefined }
  outcome: 'graduated' | 'withdrawn'
  enrolledDate: string | null
  leftDate: string | null
  lastClassName: string | null
}

function learnerFields(facts: AlumniLearnerFacts) {
  const number = facts.student.number?.trim()
  return {
    institutionName: facts.institution.name,
    institutionType: facts.institution.type,
    learnerName: facts.student.name,
    schoolNumber: number ? number : null,
    enrolledDate: facts.enrolledDate,
    leftDate: facts.leftDate,
    outcome: facts.outcome,
    lastClassName: facts.lastClassName,
  }
}

/** Öğrenim belgesi: kurumda hangi tarihler arasında öğrenim gördüğü ve nasıl ayrıldığı. */
export function buildAlumniEducationCertificate(
  facts: AlumniLearnerFacts,
): AlumniEducationCertificate {
  return { kind: 'education_certificate', ...learnerFields(facts) }
}

export interface AlumniGradeFact {
  classId: string
  term: number
  subjectId: string
  subject: string
  score: number
  date: string
}

export interface AlumniCourseFact {
  name: string
  level: string
  groupName: string
  startDate: string
  endDate: string
}

/**
 * Not dökümü (DOM-KAY-044): okulda notun verildiği sınıf ve dönem başına ders ortalaması (tam
 * sayıya yuvarlanır, DOM-AKD-003; ortalama saklanmaz, notlardan hesaplanır); sınıflar ilk notun
 * gününe göre sıralıdır. Dil okulunda katıldığı kurlar başlangıç sırasıyla (aynı grup bir kez).
 */
export function buildAlumniTranscript(
  facts: AlumniLearnerFacts & {
    grades: readonly AlumniGradeFact[]
    classNames: ReadonlyMap<string, string>
    courses: readonly AlumniCourseFact[]
  },
): AlumniTranscript {
  const groups = new Map<string, { first: string; grades: AlumniGradeFact[] }>()
  for (const grade of facts.grades) {
    const key = `${grade.classId}\u0000${String(grade.term)}`
    const group = groups.get(key)
    if (group) {
      group.grades.push(grade)
      if (grade.date < group.first) group.first = grade.date
    } else groups.set(key, { first: grade.date, grades: [grade] })
  }
  const classFirst = new Map<string, string>()
  for (const grade of facts.grades) {
    const first = classFirst.get(grade.classId)
    if (first === undefined || grade.date < first) classFirst.set(grade.classId, grade.date)
  }
  const terms = [...groups.values()]
    .map(({ grades }) => {
      const sample = grades[0] as AlumniGradeFact
      const bySubject = new Map<string, { name: string; scores: number[] }>()
      for (const grade of grades) {
        const entry = bySubject.get(grade.subjectId)
        if (entry) entry.scores.push(grade.score)
        else bySubject.set(grade.subjectId, { name: grade.subject, scores: [grade.score] })
      }
      return {
        classId: sample.classId,
        className: facts.classNames.get(sample.classId) ?? '—',
        term: sample.term,
        subjects: [...bySubject.values()]
          .map(({ name, scores }) => ({ name, average: average(scores), count: scores.length }))
          .sort((left, right) => left.name.localeCompare(right.name, 'tr')),
      }
    })
    .sort(
      (left, right) =>
        (classFirst.get(left.classId) ?? '').localeCompare(classFirst.get(right.classId) ?? '') ||
        left.classId.localeCompare(right.classId) ||
        left.term - right.term,
    )
    .map(({ className, term, subjects }) => ({ className, term, subjects }))
  const seen = new Set<string>()
  const courses = [...facts.courses]
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) || left.name.localeCompare(right.name, 'tr'),
    )
    .filter((course) => {
      const key = `${course.groupName}\u0000${course.startDate}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return { kind: 'transcript', ...learnerFields(facts), terms, courses }
}
