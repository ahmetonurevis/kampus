import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel, money } from './format.ts'
import {
  PAY_RATE_AMOUNT_MAX_CENTS,
  WAGE_TYPE_LABELS,
  WAGE_TYPES,
  type WageType,
} from './finance-pay-rates.ts'
import { STAFF_DOCUMENT_TYPE_LABELS, type StaffDocumentType } from './finance-staff-documents.ts'
import type { TeacherPermitStatus } from './finance-work-permits.ts'
import { isStaffRole, STAFF_ROLE_LABELS, STAFF_ROLES, type StaffRole } from './staff-accounts.ts'

/**
 * İş teklifi ve işe başlama listesi (docs/domain/finans.md DOM-FIN-121; ON-179). Yönetici adaya
 * iş teklifi hazırlar (taslak → gönderildi → kabul, ret ya da geri çekildi); teklif mektubu PDF
 * olarak indirilir, Kampüs e-posta göndermez (K-412). Aday kurumda personel değilse yalnız adı ve
 * iletişimi tutulur; kurumda personelse üyeliğine bağlanır ve ad personel kaydından gelir.
 *
 * Teklif kabul edilince işe başlama listesi açılır (K-413): personel hesabı (IST-007 davetiyle
 * açılan üyeliğin bağlanması; burada hesap açılmaz), özlük belgesi türleri (DOM-FIN-113 zorunlu
 * türleri), öğretmende çalışma onayı (DOM-FIN-114), ücret tanımı (DOM-FIN-099), kıdem başlangıcı
 * (DOM-FIN-109), zimmet teslimi (DOM-FIN-086) ve kurum ayarındaki oryantasyon adımları. Kaynağı
 * olan adım kaynak kaydı bulunmadan işaretlenmez; liste zorunlu adımlar bitince tamamlanır
 * (K-414). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Teklif ve işe başlama listesi yalnız yöneticide: ücret ve aday verisi taşır (K-412). */
export const FINANCE_STAFF_ONBOARDING_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const JOB_OFFER_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'withdrawn'] as const
export type JobOfferStatus = (typeof JOB_OFFER_STATUSES)[number]
export const JOB_OFFER_STATUS_LABELS = {
  draft: 'Taslak',
  sent: 'Gönderildi',
  accepted: 'Kabul edildi',
  rejected: 'Reddedildi',
  withdrawn: 'Geri çekildi',
} as const satisfies Record<JobOfferStatus, string>

export const ONBOARDING_STEP_KINDS = [
  'account',
  'document',
  'work_permit',
  'pay_rate',
  'seniority',
  'asset_handover',
  'orientation',
] as const
export type OnboardingStepKind = (typeof ONBOARDING_STEP_KINDS)[number]
export const ONBOARDING_STEP_KIND_LABELS = {
  account: 'Personel hesabı',
  document: 'Özlük belgesi',
  work_permit: 'Çalışma onayı',
  pay_rate: 'Ücret tanımı',
  seniority: 'Kıdem başlangıcı',
  asset_handover: 'Zimmet teslimi',
  orientation: 'Oryantasyon',
} as const satisfies Record<OnboardingStepKind, string>

/**
 * Kaynak kaydı isteyen adımlar (K-413): kaynak bulunmadan işaretlenmez. Zimmet (teslim edilecek
 * demirbaş olmayabilir) ve oryantasyon elle işaretlenir.
 */
export const EVIDENCE_STEP_KINDS = [
  'account',
  'document',
  'work_permit',
  'pay_rate',
  'seniority',
] as const satisfies readonly OnboardingStepKind[]
export const isEvidenceStep = (kind: OnboardingStepKind) =>
  (EVIDENCE_STEP_KINDS as readonly string[]).includes(kind)

/** Liste durumu (saklanmaz): teklif kabul edilmediyse yok, açık, tamamlandı, kapandı. */
export const ONBOARDING_STATES = ['none', 'open', 'completed', 'closed'] as const
export type OnboardingState = (typeof ONBOARDING_STATES)[number]
export const ONBOARDING_STATE_LABELS = {
  none: 'Liste yok',
  open: 'Sürüyor',
  completed: 'Tamamlandı',
  closed: 'Kapandı',
} as const satisfies Record<OnboardingState, string>

export const CANDIDATE_NAME_MIN = 2
export const CANDIDATE_NAME_MAX = 120
export const CANDIDATE_EMAIL_MAX = 254
export const JOB_POSITION_MIN = 2
export const JOB_POSITION_MAX = 120
export const JOB_OFFER_NOTE_MAX = 500
export const JOB_OFFER_REASON_MAX = 500
export const ONBOARDING_STEP_LABEL_MIN = 2
export const ONBOARDING_STEP_LABEL_MAX = 120
export const ONBOARDING_STEP_NOTE_MAX = 300
export const ORIENTATION_STEPS_MAX = 20
export const CANDIDATE_PHONE_PATTERN = /^0\d{10}$/

/**
 * Kurum ayarı yazılmamışsa oryantasyon adımları (K-413). İSG eğitimi 6331/17 gereği işe başlarken
 * verilir; KVKK aydınlatması çalışana işe girişte yapılır (içerik ve süre doğrulanmalı, M-84).
 */
export const DEFAULT_ORIENTATION_STEPS = [
  { label: 'Kurum tanıtımı ve çalışma kuralları', required: true },
  { label: 'İş sağlığı ve güvenliği eğitimi', required: true },
  { label: 'Çalışan aydınlatma metninin tebliği (KVKK)', required: true },
] as const satisfies readonly OrientationStep[]

export interface OrientationStep {
  label: string
  required: boolean
}

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (max: number, maxMessage: string) =>
  z
    .string()
    .trim()
    .max(max, maxMessage)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)

const candidateNameSchema = z
  .string('Adayın adını yazın.')
  .trim()
  .min(CANDIDATE_NAME_MIN, `Ad en az ${String(CANDIDATE_NAME_MIN)} karakter olmalıdır.`)
  .max(CANDIDATE_NAME_MAX, `Ad en çok ${String(CANDIDATE_NAME_MAX)} karakter olabilir.`)
const candidateEmailSchema = z
  .string('E-postayı yazın.')
  .trim()
  .toLowerCase()
  .max(CANDIDATE_EMAIL_MAX, `E-posta en çok ${String(CANDIDATE_EMAIL_MAX)} karakter olabilir.`)
  .transform((value) => (value === '' ? null : value))
  .pipe(z.email('Geçerli bir e-posta adresi girin.').nullable())
const candidatePhoneSchema = z
  .string('Telefonu yazın.')
  .transform((value) => value.replace(/[\s()-]+/g, ''))
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .regex(CANDIDATE_PHONE_PATTERN, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.')
      .nullable(),
  )
const positionSchema = z
  .string('Pozisyonu yazın.')
  .trim()
  .min(JOB_POSITION_MIN, `Pozisyon en az ${String(JOB_POSITION_MIN)} karakter olmalıdır.`)
  .max(JOB_POSITION_MAX, `Pozisyon en çok ${String(JOB_POSITION_MAX)} karakter olabilir.`)
const amountSchema = z
  .number('Ücret önerisini girin.')
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .min(1, 'Ücret önerisi sıfırdan büyük olmalıdır.')
  .max(PAY_RATE_AMOUNT_MAX_CENTS, 'Ücret önerisi en fazla 10.000.000 ₺ olabilir.')
const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')

const offerFields = {
  // kvkk: K (aday adı; yalnız personel kaydı yoksa)
  candidateName: candidateNameSchema
    .nullable()
    .describe('Adayın adı (2–120); `membershipId` verilirse boş kalır, ad personel kaydındandır'),
  // kvkk: K (aday iletişimi)
  candidateEmail: candidateEmailSchema
    .nullable()
    .describe('Adayın e-postası (isteğe bağlı); Kampüs bu adrese e-posta göndermez'),
  // kvkk: K (aday iletişimi)
  candidatePhone: candidatePhoneSchema
    .nullable()
    .describe('Adayın telefonu (isteğe bağlı, 0XXXXXXXXXX)'),
  position: positionSchema.describe('Pozisyon / görev adı (2–120), ör. İngilizce öğretmeni'),
  staffRole: z
    .enum(STAFF_ROLES, 'Personelin rolünü seçin.')
    .describe(
      'Hesap açılınca verilecek rol: `yonetici`, `ogretmen`, `onburo`; öğretmende çalışma onayı adımı açılır',
    ),
  startDate: daySchema.describe('İşe başlama günü'),
  wageType: z
    .enum(WAGE_TYPES, 'Ücret türünü seçin.')
    .describe(
      '`monthly_gross` aylık brüt, `monthly_net` aylık net, `hourly` saatlik, `lesson_hour` ders saati',
    ),
  // kvkk: K (ücret)
  offeredAmountCents: amountSchema.describe('Ücret önerisi, kuruş (türün birimi başına)'),
  respondBy: daySchema
    .nullable()
    .describe('İsteğe bağlı son yanıt günü; geçtikten sonra teklif kabul edilmez'),
  note: optionalText(
    JOB_OFFER_NOTE_MAX,
    `Not en çok ${String(JOB_OFFER_NOTE_MAX)} karakter olabilir.`,
  ).describe('Mektupta yer alan isteğe bağlı koşullar / not (en çok 500)'),
}

/** Yeni teklif (K-412): taslak açılır. */
export const jobOfferInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: membershipSchema
      .nullable()
      .default(null)
      .describe(
        'Aday kurumda personelse üyeliği (iç aday); verilirse aday adı ve iletişimi yazılmaz',
      ),
    candidateName: offerFields.candidateName.default(null),
    candidateEmail: offerFields.candidateEmail.default(null),
    candidatePhone: offerFields.candidatePhone.default(null),
    position: offerFields.position,
    staffRole: offerFields.staffRole,
    startDate: offerFields.startDate,
    wageType: offerFields.wageType,
    offeredAmountCents: offerFields.offeredAmountCents,
    respondBy: offerFields.respondBy.default(null),
    note: offerFields.note,
  })
  .superRefine((value, context) => {
    if (value.membershipId === null && value.candidateName === null)
      context.addIssue({
        code: 'custom',
        path: ['candidateName'],
        message: 'Adayın adını yazın ya da kurumdaki personeli seçin.',
      })
    if (value.membershipId !== null)
      for (const key of ['candidateName', 'candidateEmail', 'candidatePhone'] as const)
        if (value[key] !== null)
          context.addIssue({
            code: 'custom',
            path: [key],
            message:
              'Personel seçildiğinde aday adı ve iletişimi yazılmaz; personel kaydındaki ad kullanılır.',
          })
  })
export type JobOfferInput = z.input<typeof jobOfferInputSchema>
export type JobOfferFields = z.output<typeof jobOfferInputSchema>

/** Taslak düzeltmesi (K-412): verilen alanlar değişir. */
export const jobOfferUpdateSchema = z
  .strictObject({
    candidateName: candidateNameSchema
      .optional()
      .describe('Adayın adı (2–120); personel seçilmiş teklifte yazılmaz'),
    candidateEmail: offerFields.candidateEmail.optional(),
    candidatePhone: offerFields.candidatePhone.optional(),
    position: offerFields.position.optional(),
    staffRole: offerFields.staffRole.optional(),
    startDate: offerFields.startDate.optional(),
    wageType: offerFields.wageType.optional(),
    offeredAmountCents: offerFields.offeredAmountCents.optional(),
    respondBy: offerFields.respondBy.optional(),
    note: z
      .string()
      .trim()
      .max(JOB_OFFER_NOTE_MAX, `Not en çok ${String(JOB_OFFER_NOTE_MAX)} karakter olabilir.`)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional()
      .describe('Not; boş metin ya da `null` siler'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type JobOfferUpdateFields = z.output<typeof jobOfferUpdateSchema>
export type JobOfferUpdateKey = keyof JobOfferUpdateFields

export const jobOfferSendSchema = z.strictObject({
  sentOn: daySchema.describe(
    'Teklifin adaya iletildiği gün (elden, e-posta ya da kargo; kayıt dışı)',
  ),
})
export const jobOfferAcceptSchema = z.strictObject({
  decidedOn: daySchema.describe('Adayın kabul ettiği gün'),
})
const reasonSchema = optionalText(
  JOB_OFFER_REASON_MAX,
  `Gerekçe en çok ${String(JOB_OFFER_REASON_MAX)} karakter olabilir.`,
)
export const jobOfferRejectSchema = z.strictObject({
  decidedOn: daySchema.describe('Adayın reddettiği gün'),
  reason: reasonSchema.describe(
    'İsteğe bağlı ret gerekçesi (en çok 500); denetim kaydına yazılmaz',
  ),
})
export const jobOfferWithdrawSchema = z.strictObject({
  decidedOn: daySchema.describe('Kurumun teklifi geri çektiği gün'),
  reason: reasonSchema.describe('İsteğe bağlı gerekçe (en çok 500); denetim kaydına yazılmaz'),
})
export type JobOfferDecisionFields = z.output<typeof jobOfferWithdrawSchema>

const orientationStepSchema = z.strictObject({
  label: z
    .string('Adımın adını yazın.')
    .trim()
    .min(
      ONBOARDING_STEP_LABEL_MIN,
      `Adım adı en az ${String(ONBOARDING_STEP_LABEL_MIN)} karakter olmalıdır.`,
    )
    .max(
      ONBOARDING_STEP_LABEL_MAX,
      `Adım adı en çok ${String(ONBOARDING_STEP_LABEL_MAX)} karakter olabilir.`,
    )
    .describe('Adım adı (2–120)'),
  required: z.boolean('Zorunlu olup olmadığını seçin.').describe('Liste tamamlanması için şart mı'),
})

/** Kurum ayarı (K-413): oryantasyon adımları bütünüyle yazılır; aynı ad iki kez olmaz. */
export const onboardingSettingsSchema = z.strictObject({
  orientationSteps: z
    .array(orientationStepSchema)
    .max(ORIENTATION_STEPS_MAX, `En çok ${String(ORIENTATION_STEPS_MAX)} adım tanımlanabilir.`)
    .superRefine((steps, context) => {
      const seen = new Set<string>()
      steps.forEach((step, index) => {
        const key = step.label.toLocaleLowerCase('tr-TR')
        if (seen.has(key))
          context.addIssue({
            code: 'custom',
            path: [index, 'label'],
            message: 'Aynı adı taşıyan iki adım olamaz.',
          })
        seen.add(key)
      })
    })
    .describe(
      'Yeni işe başlama listelerine kopyalanan oryantasyon adımları, sırasıyla (en çok 20)',
    ),
})
export type OnboardingSettingsFields = z.output<typeof onboardingSettingsSchema>

export const onboardingLinkSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: membershipSchema.describe(
    'Davetle (IST-007) açılmış personel üyeliği; rolü teklifteki rolle aynı olmalı',
  ),
})

export const onboardingStepUpdateSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    responsibleMembershipId: membershipSchema
      .nullable()
      .optional()
      .describe('Sorumlu personel üyeliği; `null` sorumluyu kaldırır'),
    dueDate: daySchema.nullable().optional().describe('Son gün; `null` kaldırır'),
  })
  .refine((value) => value.responsibleMembershipId !== undefined || value.dueDate !== undefined, {
    message: 'Sorumlu ya da son günü girin.',
  })
export type OnboardingStepUpdateFields = z.output<typeof onboardingStepUpdateSchema>

export const onboardingStepCompleteSchema = z.strictObject({
  completedOn: daySchema.describe('Adımın tamamlandığı gün; bugünden sonra olamaz'),
  note: optionalText(
    ONBOARDING_STEP_NOTE_MAX,
    `Not en çok ${String(ONBOARDING_STEP_NOTE_MAX)} karakter olabilir.`,
  ).describe('İsteğe bağlı not (en çok 300); denetim kaydına yazılmaz'),
})
export type OnboardingStepCompleteFields = z.output<typeof onboardingStepCompleteSchema>

// --- Teklif kuralları ----------------------------------------------------------------------------

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const longDayText = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric', month: 'long' })
const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

function assertNotFuture(day: string, today: string, path: string, what: string) {
  if (day > today)
    throw ruleError('job_offer_date_in_future', `${what} bugünden sonra olamaz.`, path)
}

/** Kurumdaki üyelik (teklifte iç aday, hesap bağlama, sorumlu). */
export interface OnboardingMember {
  role: string
  active: boolean
}

function assertStaffMember(
  member: OnboardingMember | null,
  path: string,
  prefix: 'job_offer' | 'onboarding_member' | 'onboarding_responsible',
) {
  if (member === null) throw ruleError(`${prefix}_not_found`, 'Personel bulunamadı.', path)
  if (!isStaffRole(member.role))
    throw ruleError(
      `${prefix}_not_staff`,
      'Yalnız personel (yönetici, öğretmen, ön büro) seçilebilir.',
      path,
    )
  if (!member.active)
    throw ruleError(`${prefix}_inactive`, 'Pasifleştirilmiş personel seçilemez.', path)
}

/** Yeni teklif (K-412): iç adayda üyelik kurumun etkin personeli olmalı. */
export function planJobOffer(input: JobOfferFields, member: OnboardingMember | null): void {
  if (input.membershipId !== null) assertStaffMember(member, 'membershipId', 'job_offer')
}

export interface JobOfferCurrent {
  status: JobOfferStatus
  membershipId: string | null
  candidateName: string | null
  candidateEmail: string | null
  candidatePhone: string | null
  position: string
  staffRole: StaffRole
  startDate: string
  wageType: WageType
  offeredAmountCents: number
  respondBy: string | null
  note: string | null
  sentOn: string | null
  acceptedOn: string | null
}

/** Taslak düzeltmesi (K-412): gönderilen teklif değişmez. Değişen alan adlarını döndürür. */
export function planJobOfferUpdate(
  current: JobOfferCurrent,
  changes: JobOfferUpdateFields,
): JobOfferUpdateKey[] {
  if (current.status !== 'draft')
    throw ruleError(
      'job_offer_not_draft',
      'Yalnız taslak teklif düzeltilir. Gönderilen teklifi geri çekip yenisini hazırlayın.',
      'status',
    )
  if (current.membershipId !== null)
    for (const key of ['candidateName', 'candidateEmail', 'candidatePhone'] as const)
      if (changes[key] !== undefined && changes[key] !== null)
        throw ruleError(
          'job_offer_candidate_is_staff',
          'Personel seçilmiş teklifte aday adı ve iletişimi yazılmaz.',
          key,
        )
  const changed = (Object.keys(changes) as JobOfferUpdateKey[]).filter(
    (key) => changes[key] !== undefined && changes[key] !== current[key],
  )
  if (changed.length === 0)
    throw ruleError('job_offer_unchanged', 'Teklifte değişen bir alan yok.', 'status')
  return changed
}

/** Gönderildi işareti (K-412): yalnız taslak; gün bugünden sonra olamaz. */
export function planJobOfferSend(
  current: Pick<JobOfferCurrent, 'status'>,
  input: { sentOn: string },
  today: string,
): void {
  if (current.status !== 'draft')
    throw ruleError('job_offer_not_draft', 'Yalnız taslak teklif gönderildi yapılır.', 'sentOn')
  assertNotFuture(input.sentOn, today, 'sentOn', 'Gönderim günü')
}

/**
 * Kabul ya da ret (K-412): yalnız gönderilmiş teklif; gün gönderimden önce ve bugünden sonra
 * olamaz. Kabul son yanıt günü geçtiyse yapılmaz (ret yapılabilir).
 */
export function planJobOfferDecision(
  current: Pick<JobOfferCurrent, 'status' | 'sentOn' | 'respondBy'>,
  input: { decidedOn: string },
  decision: 'accept' | 'reject',
  today: string,
): void {
  if (current.status !== 'sent')
    throw ruleError(
      'job_offer_not_sent',
      'Yalnız gönderilmiş teklif kabul ya da ret alır.',
      'decidedOn',
    )
  assertNotFuture(input.decidedOn, today, 'decidedOn', 'Yanıt günü')
  if (current.sentOn !== null && input.decidedOn < current.sentOn)
    throw ruleError(
      'job_offer_decision_before_sent',
      `Yanıt günü gönderim gününden (${dayText(current.sentOn)}) önce olamaz.`,
      'decidedOn',
    )
  if (decision === 'accept' && current.respondBy !== null && input.decidedOn > current.respondBy)
    throw ruleError(
      'job_offer_expired',
      `Teklifin son yanıt günü (${dayText(current.respondBy)}) geçti; yeni teklif hazırlayın.`,
      'decidedOn',
    )
}

/**
 * Geri çekme (K-412): taslak, gönderilmiş ya da işe başlama listesi tamamlanmamış kabul edilmiş
 * teklif. Gün son işlemden önce ve bugünden sonra olamaz.
 */
export function planJobOfferWithdraw(
  current: Pick<JobOfferCurrent, 'status' | 'sentOn' | 'acceptedOn'>,
  input: { decidedOn: string },
  onboardingCompleted: boolean,
  today: string,
): void {
  if (current.status === 'rejected' || current.status === 'withdrawn')
    throw ruleError(
      'job_offer_closed',
      'Reddedilen ya da geri çekilen teklif değişmez.',
      'decidedOn',
    )
  if (current.status === 'accepted' && onboardingCompleted)
    throw ruleError(
      'job_offer_onboarding_completed',
      'İşe başlama listesi tamamlanan teklif geri çekilmez.',
      'decidedOn',
    )
  assertNotFuture(input.decidedOn, today, 'decidedOn', 'Geri çekme günü')
  const last = current.acceptedOn ?? current.sentOn
  if (last !== null && input.decidedOn < last)
    throw ruleError(
      'job_offer_decision_before_sent',
      `Geri çekme günü son işlemden (${dayText(last)}) önce olamaz.`,
      'decidedOn',
    )
}

// --- İşe başlama listesi -------------------------------------------------------------------------

export interface OnboardingStepDraft {
  kind: OnboardingStepKind
  documentType: StaffDocumentType | null
  label: string
  required: boolean
  dueDate: string | null
  completedOn: string | null
}

export const onboardingStepLabel = (
  kind: OnboardingStepKind,
  documentType: StaffDocumentType | null,
) => {
  switch (kind) {
    case 'account':
      return 'Personel hesabı açıldı ve bağlandı'
    case 'document':
      return `Özlük belgesi: ${documentType === null ? 'Belge' : STAFF_DOCUMENT_TYPE_LABELS[documentType]}`
    case 'work_permit':
      return 'Çalışma onayı alındı'
    case 'pay_rate':
      return 'Ücret tanımı girildi'
    case 'seniority':
      return 'Kıdem başlangıcı girildi'
    case 'asset_handover':
      return 'Zimmet teslim edildi'
    case 'orientation':
      return 'Oryantasyon'
  }
}

/**
 * Kabulde açılan adımlar (K-413), sırasıyla: hesap, özlük belgesi zorunlu türleri (kabul anındaki
 * kurum ayarı), öğretmende çalışma onayı, ücret tanımı, kıdem başlangıcı, zimmet (isteğe bağlı)
 * ve oryantasyon adımları (kabul anındaki kurum ayarının kopyası). Son gün işe başlama günüdür.
 * Hesap teklifte bağlıysa (iç aday) hesap adımı kabul günüyle tamamlanmış açılır.
 */
export function buildOnboardingSteps(input: {
  staffRole: StaffRole
  startDate: string
  acceptedOn: string
  membershipLinked: boolean
  requiredDocumentTypes: readonly StaffDocumentType[]
  orientationSteps: readonly OrientationStep[]
}): OnboardingStepDraft[] {
  const step = (
    kind: OnboardingStepKind,
    required: boolean,
    documentType: StaffDocumentType | null = null,
  ): OnboardingStepDraft => ({
    kind,
    documentType,
    label: onboardingStepLabel(kind, documentType),
    required,
    dueDate: input.startDate,
    completedOn: null,
  })
  return [
    { ...step('account', true), completedOn: input.membershipLinked ? input.acceptedOn : null },
    ...input.requiredDocumentTypes.map((type) => step('document', true, type)),
    ...(input.staffRole === 'ogretmen' ? [step('work_permit', true)] : []),
    step('pay_rate', true),
    step('seniority', true),
    step('asset_handover', false),
    ...input.orientationSteps.map((item) => ({
      ...step('orientation', item.required),
      label: item.label,
    })),
  ]
}

/** Adımın kaynağından okunan olgular (servis kurum kilidi altında yükler). */
export interface OnboardingFacts {
  startDate: string
  wageType: WageType
  offeredAmountCents: number
  /** Bağlı üyelik; bağlı değilse `null`. */
  member: OnboardingMember | null
  /** Bağlı personelin yerine geçilmemiş özlük belgesi türleri. */
  documentTypes: ReadonlySet<StaffDocumentType>
  /** Çalışma onayı özeti (DOM-FIN-114); bağlı değilse `null`. */
  workPermit: TeacherPermitStatus | null
  /** İşe başlama günü ya da sonrasında yürürlükteki ilk ana ücret tanımı; yoksa `null`. */
  wage: { rateType: string; amountCents: number; startDate: string } | null
  seniorityStartDate: string | null
  openAssetCount: number
}

export const EVIDENCE_STATES = ['met', 'missing', 'manual'] as const
export type EvidenceState = (typeof EVIDENCE_STATES)[number]

export interface StepEvidence {
  state: EvidenceState
  /** Kullanıcıya gösterilen durum metni. */
  detail: string
  /** Kaynak var ama tekliften farklı (engel değildir). */
  warning: string | null
}

const NOT_LINKED = 'Önce personel hesabını bağlayın.'

/**
 * Adımın kaynak durumu (K-413). Hesap: bağlı ve etkin üyelik. Özlük belgesi: türün yerine
 * geçilmemiş belgesi. Çalışma onayı: geçerli ya da dolmak üzere onay. Ücret: işe başlama günü ya da
 * sonrasında yürürlükteki ana ücret (tutar ya da tür tekliften farklıysa uyarı). Kıdem: izin
 * profilinde kıdem başlangıcı (işe başlama gününden farklıysa uyarı). Zimmet ve oryantasyon elle.
 */
export function onboardingStepEvidence(
  step: { kind: OnboardingStepKind; documentType: StaffDocumentType | null },
  facts: OnboardingFacts,
): StepEvidence {
  const met = (detail: string, warning: string | null = null): StepEvidence => ({
    state: 'met',
    detail,
    warning,
  })
  const missing = (detail: string): StepEvidence => ({ state: 'missing', detail, warning: null })
  const member = facts.member
  if (step.kind === 'orientation')
    return { state: 'manual', detail: 'Elle işaretlenir.', warning: null }
  if (step.kind === 'account') {
    if (member === null)
      return missing(
        'Hesap bağlanmadı. Personeli Kullanıcılar sayfasından davet edin, sonra buradan bağlayın.',
      )
    return member.active ? met('Personel hesabı bağlı.') : missing('Bağlı hesap pasifleştirilmiş.')
  }
  if (step.kind === 'asset_handover')
    return {
      state: 'manual',
      detail:
        member === null
          ? 'Elle işaretlenir; teslim edilecek demirbaş yoksa da işaretlenebilir.'
          : `Açık zimmet: ${String(facts.openAssetCount)} demirbaş.`,
      warning: null,
    }
  if (member === null) return missing(NOT_LINKED)
  switch (step.kind) {
    case 'document': {
      const type = step.documentType
      if (type === null) return missing('Belge türü yok.')
      return facts.documentTypes.has(type)
        ? met(`${STAFF_DOCUMENT_TYPE_LABELS[type]} kayıtlı.`)
        : missing(`${STAFF_DOCUMENT_TYPE_LABELS[type]} kaydedilmedi (Özlük belgeleri sekmesi).`)
    }
    case 'work_permit':
      return facts.workPermit === 'valid' || facts.workPermit === 'expiring'
        ? met('Geçerli çalışma onayı kayıtlı.')
        : missing(
            facts.workPermit === 'expired'
              ? 'Çalışma onayının süresi dolmuş.'
              : 'Onaylanmış çalışma onayı yok (Çalışma onayları sekmesi).',
          )
    case 'pay_rate': {
      const wage = facts.wage
      if (wage === null)
        return missing('İşe başlama gününde ya da sonrasında yürürlükte ana ücret tanımı yok.')
      const warnings: string[] = []
      if (wage.amountCents !== facts.offeredAmountCents || wage.rateType !== facts.wageType)
        warnings.push(
          `Tanım (${wageText(wage.rateType, wage.amountCents)}) tekliften (${wageText(facts.wageType, facts.offeredAmountCents)}) farklı.`,
        )
      if (wage.startDate > facts.startDate)
        warnings.push(`Tanım işe başlama gününden sonra (${dayText(wage.startDate)}) başlıyor.`)
      return met(
        `Ana ücret tanımı ${dayText(wage.startDate)} tarihinden itibaren kayıtlı.`,
        warnings.length === 0 ? null : warnings.join(' '),
      )
    }
    case 'seniority':
      return facts.seniorityStartDate === null
        ? missing('İzin profilinde kıdem başlangıcı yok (Personel izinleri sekmesi).')
        : met(
            `Kıdem başlangıcı ${dayText(facts.seniorityStartDate)}.`,
            facts.seniorityStartDate === facts.startDate
              ? null
              : 'Kıdem başlangıcı işe başlama gününden farklı.',
          )
    default:
      return step.kind satisfies never
  }
}

export const wageText = (rateType: string, amountCents: number) =>
  `${money(amountCents)} ${(WAGE_TYPE_LABELS as Readonly<Record<string, string>>)[rateType]?.toLocaleLowerCase('tr-TR') ?? ''}`.trim()

export interface OnboardingStepCurrent {
  kind: OnboardingStepKind
  required: boolean
  completedOn: string | null
  completedAt: string | null
}

/** Listenin ilerlemesi (K-414): zorunlu adımların hepsi bitince tamamlandı; an en son işarettir. */
export function onboardingProgress(steps: readonly OnboardingStepCurrent[]): {
  total: number
  done: number
  requiredTotal: number
  requiredDone: number
  completed: boolean
  completedAt: string | null
} {
  const required = steps.filter((step) => step.required)
  const requiredDone = required.filter((step) => step.completedOn !== null)
  const completed = steps.length > 0 && requiredDone.length === required.length
  const completedAt = completed
    ? required.reduce<string | null>(
        (latest, step) =>
          step.completedAt !== null && (latest === null || step.completedAt > latest)
            ? step.completedAt
            : latest,
        null,
      )
    : null
  return {
    total: steps.length,
    done: steps.filter((step) => step.completedOn !== null).length,
    requiredTotal: required.length,
    requiredDone: requiredDone.length,
    completed,
    completedAt,
  }
}

/** Teklifin liste durumu (saklanmaz). */
export function onboardingState(
  status: JobOfferStatus,
  completed: boolean,
  accepted: boolean,
): OnboardingState {
  if (!accepted) return 'none'
  if (status === 'withdrawn') return 'closed'
  return completed ? 'completed' : 'open'
}

function assertOpenChecklist(status: JobOfferStatus) {
  if (status !== 'accepted')
    throw ruleError(
      'onboarding_not_open',
      'İşe başlama listesi yalnız kabul edilmiş ve geri çekilmemiş teklifte değişir.',
      'status',
    )
}

/**
 * Adımı tamamla (K-413, K-414): liste açık olmalı, adım işaretlenmemiş olmalı; kaynak isteyen
 * adımda kaynak bulunmalı. Gün bugünden sonra olamaz.
 */
export function planOnboardingStepComplete(
  offer: { status: JobOfferStatus },
  step: OnboardingStepCurrent & { documentType: StaffDocumentType | null },
  evidence: StepEvidence,
  input: OnboardingStepCompleteFields,
  today: string,
): void {
  assertOpenChecklist(offer.status)
  if (step.completedOn !== null)
    throw ruleError('onboarding_step_completed', 'Adım zaten tamamlandı.', 'completedOn')
  if (evidence.state === 'missing')
    throw ruleError('onboarding_step_evidence_missing', evidence.detail, 'completedOn')
  if (input.completedOn > today)
    throw ruleError(
      'onboarding_date_in_future',
      'Tamamlanma günü bugünden sonra olamaz.',
      'completedOn',
    )
}

/** İşareti geri al (K-414): liste açık, adım tamamlanmış olmalı. */
export function planOnboardingStepReopen(
  offer: { status: JobOfferStatus },
  step: Pick<OnboardingStepCurrent, 'completedOn'>,
): void {
  assertOpenChecklist(offer.status)
  if (step.completedOn === null)
    throw ruleError('onboarding_step_not_completed', 'Adım tamamlanmamış.', 'completedOn')
}

/** Sorumlu ve son gün (K-414): liste açık; sorumlu kurumun etkin personeli. */
export function planOnboardingStepUpdate(
  offer: { status: JobOfferStatus },
  input: OnboardingStepUpdateFields,
  responsible: OnboardingMember | null,
): void {
  assertOpenChecklist(offer.status)
  if (input.responsibleMembershipId !== undefined && input.responsibleMembershipId !== null)
    assertStaffMember(responsible, 'responsibleMembershipId', 'onboarding_responsible')
}

/**
 * Hesap bağlama (K-413; IST-007). Liste açık olmalı; üyelik kurumun etkin personeli ve rolü
 * teklifteki rolle aynı olmalı; başka açık listeye bağlı olmamalı. Bağlı hesap, hesaba dayanan
 * adımlardan (özlük, çalışma onayı, ücret, kıdem, zimmet) biri işaretlendiyse değiştirilmez.
 */
export function planOnboardingLink(
  offer: { status: JobOfferStatus; membershipId: string | null; staffRole: StaffRole },
  membershipId: string,
  checks: {
    member: OnboardingMember | null
    linkedElsewhere: boolean
    dependentStepCompleted: boolean
  },
): void {
  assertOpenChecklist(offer.status)
  assertStaffMember(checks.member, 'membershipId', 'onboarding_member')
  if (checks.member !== null && checks.member.role !== offer.staffRole)
    throw ruleError(
      'onboarding_member_role_mismatch',
      `Hesabın rolü teklifteki rolle (${STAFF_ROLE_LABELS[offer.staffRole]}) aynı olmalı.`,
      'membershipId',
    )
  if (offer.membershipId === membershipId)
    throw ruleError('onboarding_member_unchanged', 'Bu hesap zaten bağlı.', 'membershipId')
  if (checks.dependentStepCompleted)
    throw ruleError(
      'onboarding_member_locked',
      'Hesaba dayanan bir adım işaretlendi; önce o adımların işaretini geri alın.',
      'membershipId',
    )
  if (checks.linkedElsewhere)
    throw ruleError(
      'onboarding_member_linked',
      'Bu hesap sürmekte olan başka bir işe başlama listesine bağlı.',
      'membershipId',
    )
}

/** Hesap bağlıyken işaretli olması bağlamayı kilitleyen adımlar. */
export const MEMBER_DEPENDENT_STEP_KINDS = [
  'document',
  'work_permit',
  'pay_rate',
  'seniority',
  'asset_handover',
] as const satisfies readonly OnboardingStepKind[]

// --- Teklif mektubu ------------------------------------------------------------------------------

export interface JobOfferLetter {
  institutionName: string
  candidateName: string
  position: string
  staffRole: StaffRole
  startDate: string
  wageType: WageType
  offeredAmountCents: number
  respondBy: string | null
  note: string | null
}

/** Mektup gövdesi (K-412): bilgilendirme amaçlıdır, iş sözleşmesi yerine geçmez. */
export function jobOfferLetterParagraphs(letter: JobOfferLetter): string[] {
  return [
    `Sayın ${letter.candidateName},`,
    `${letter.institutionName} bünyesinde ${letter.position} görevinde ${longDayText(letter.startDate)} tarihinden itibaren çalışmanız için aşağıdaki koşullarla iş teklifinde bulunuyoruz.`,
    letter.respondBy === null
      ? 'Teklifimize ilişkin yanıtınızı en kısa sürede iletmenizi rica ederiz.'
      : `Teklifimize ilişkin yanıtınızı en geç ${longDayText(letter.respondBy)} tarihine kadar iletmenizi rica ederiz.`,
    'Bu mektup bilgilendirme amaçlıdır; iş sözleşmesi işe başlamadan önce ayrıca düzenlenir ve imzalanır.',
  ]
}

export const jobOfferWageText = (letter: Pick<JobOfferLetter, 'wageType' | 'offeredAmountCents'>) =>
  `${money(letter.offeredAmountCents)} (${WAGE_TYPE_LABELS[letter.wageType]})`
