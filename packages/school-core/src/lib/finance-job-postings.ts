import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { addMonthsToDay } from './finance-maintenance-plans.ts'

/**
 * İş ilanı ve başvuru havuzu (docs/domain/finans.md DOM-FIN-128; ON-177). Kurum iş ilanını
 * (başlık, pozisyon/branş, çalışma türü, açıklama, nitelikler, yayın ve son başvuru günü) taslak →
 * yayında → kapandı akışıyla yönetir; başvuruları personel girer (kurum sitesi, e-posta, elden,
 * tavsiye kanalıyla gelen). Başvuru ilana bağlıdır, aday aydınlatma metninin gösterilen sürümü ve
 * günü zorunludur, aşamalar (yeni, ön eleme, mülakat, teklif, işe alındı, reddedildi) geçmişiyle
 * tutulur (K-439, K-440).
 *
 * Saklama (K-441): reddedilen başvuru ret gününden, kapanan ilandaki işe alınmamış başvuru ilanın
 * kapandığı günden başlayarak kurum ayarlı süre (ay) kadar saklanır; süresi dolanlar listelenir ve
 * yöneticinin komutuyla anonimleştirilir (kişisel alanlar temizlenir, özgeçmiş dosyası imhaya
 * işaretlenir; satır, aşama geçmişi ve aydınlatma kaydı kalır). Arka plan imhası yoktur. Süre ve
 * yöntem **doğrulanmalı** (H-96). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** İlan okuma ve başvuru girişi: yönetici ve ön büro (K-440). */
export const FINANCE_JOB_POSTING_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** İlan yazma, başvuru havuzu, aşama, saklama ayarı ve anonimleştirme: yalnız yönetici (K-440). */
export const FINANCE_JOB_POSTING_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const JOB_EMPLOYMENT_TYPES = ['full_time', 'part_time', 'extra_lessons'] as const
export type JobEmploymentType = (typeof JOB_EMPLOYMENT_TYPES)[number]
export const JOB_EMPLOYMENT_TYPE_LABELS = {
  full_time: 'Tam zamanlı',
  part_time: 'Yarı zamanlı',
  extra_lessons: 'Ek ders',
} as const satisfies Record<JobEmploymentType, string>

export const JOB_POSTING_STATUSES = ['draft', 'published', 'closed'] as const
export type JobPostingStatus = (typeof JOB_POSTING_STATUSES)[number]
export const JOB_POSTING_STATUS_LABELS = {
  draft: 'Taslak',
  published: 'Yayında',
  closed: 'Kapandı',
} as const satisfies Record<JobPostingStatus, string>

/** İzinli ilan geçişleri (K-439): kapanan ilan yeniden açılmaz, yeni ilan açılır. */
export const JOB_POSTING_TRANSITIONS = {
  draft: ['published', 'closed'],
  published: ['closed'],
  closed: [],
} as const satisfies Record<JobPostingStatus, readonly JobPostingStatus[]>

export const JOB_APPLICATION_CHANNELS = ['website', 'email', 'in_person', 'referral'] as const
export type JobApplicationChannel = (typeof JOB_APPLICATION_CHANNELS)[number]
export const JOB_APPLICATION_CHANNEL_LABELS = {
  website: 'Kurum sitesi',
  email: 'E-posta',
  in_person: 'Elden',
  referral: 'Tavsiye',
} as const satisfies Record<JobApplicationChannel, string>

export const JOB_APPLICATION_STAGES = [
  'new',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
] as const
export type JobApplicationStage = (typeof JOB_APPLICATION_STAGES)[number]
export const JOB_APPLICATION_STAGE_LABELS = {
  new: 'Yeni',
  screening: 'Ön eleme',
  interview: 'Mülakat',
  offer: 'Teklif',
  hired: 'İşe alındı',
  rejected: 'Reddedildi',
} as const satisfies Record<JobApplicationStage, string>

/** Süreç sırası (K-440): ileri aşamaya atlanabilir, geri dönülmez. */
const STAGE_RANK = {
  new: 0,
  screening: 1,
  interview: 2,
  offer: 3,
  hired: 4,
  rejected: 4,
} as const satisfies Record<JobApplicationStage, number>
export const isJobApplicationClosed = (stage: JobApplicationStage) =>
  stage === 'hired' || stage === 'rejected'

/** Anonimleştirme gerekçesi (K-441). */
export const JOB_APPLICATION_ANONYMIZATION_REASONS = [
  'retention_expired',
  'data_subject_request',
] as const
export type JobApplicationAnonymizationReason =
  (typeof JOB_APPLICATION_ANONYMIZATION_REASONS)[number]
export const JOB_APPLICATION_ANONYMIZATION_REASON_LABELS = {
  retention_expired: 'Saklama süresi doldu',
  data_subject_request: 'Adayın silme talebi',
} as const satisfies Record<JobApplicationAnonymizationReason, string>

/** Anonimleştirilen başvurunun ad alanına yazılan sabit metin (K-441). */
export const ANONYMIZED_CANDIDATE_NAME = 'Anonim aday'

export const JOB_POSTING_TITLE_MAX = 160
export const JOB_POSITION_MAX = 120
export const JOB_TEXT_MAX = 4000
export const CANDIDATE_NAME_MAX = 120
export const CANDIDATE_EMAIL_MAX = 254
export const PRIVACY_NOTICE_VERSION_MAX = 40
export const JOB_APPLICATION_NOTE_MAX = 1000
export const ANONYMIZATION_BATCH_MAX = 100
export const JOB_APPLICATION_RETENTION_DEFAULT_MONTHS = 12
export const JOB_APPLICATION_RETENTION_MIN_MONTHS = 1
export const JOB_APPLICATION_RETENTION_MAX_MONTHS = 60
const CANDIDATE_PHONE_PATTERN = /^0\d{10}$/

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (max: number, label: string) =>
  z
    .string(`${label} metin olmalı.`)
    .trim()
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const candidateNameSchema = z
  .string('Adayın adını yazın.')
  .trim()
  .min(2, 'Ad en az 2 karakter olmalı.')
  .max(CANDIDATE_NAME_MAX, `Ad en çok ${String(CANDIDATE_NAME_MAX)} karakter olabilir.`)
const candidateEmailSchema = z
  .string('E-postayı yazın.')
  .trim()
  .toLowerCase()
  .max(CANDIDATE_EMAIL_MAX, `E-posta en çok ${String(CANDIDATE_EMAIL_MAX)} karakter olabilir.`)
  .transform((value) => (value === '' ? null : value))
  .pipe(z.email('Geçerli bir e-posta adresi girin.').nullable())
  .nullable()
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
  .nullable()
const noteSchema = optionalText(JOB_APPLICATION_NOTE_MAX, 'Not')

export const jobPostingInputSchema = z
  .strictObject({
    title: z
      .string('İlan başlığını yazın.')
      .trim()
      .min(2, 'İlan başlığı en az 2 karakter olmalı.')
      .max(
        JOB_POSTING_TITLE_MAX,
        `İlan başlığı en çok ${String(JOB_POSTING_TITLE_MAX)} karakter olabilir.`,
      )
      .describe('İlan başlığı (2–160), ör. "2027–2028 İngilizce öğretmeni"'),
    position: z
      .string('Pozisyon ya da branşı yazın.')
      .trim()
      .min(2, 'Pozisyon en az 2 karakter olmalı.')
      .max(JOB_POSITION_MAX, `Pozisyon en çok ${String(JOB_POSITION_MAX)} karakter olabilir.`)
      .describe('Pozisyon / branş (2–120), ör. İngilizce öğretmeni'),
    employmentType: z
      .enum(JOB_EMPLOYMENT_TYPES, 'Çalışma türünü seçin.')
      .describe('`full_time` tam zamanlı, `part_time` yarı zamanlı, `extra_lessons` ek ders'),
    description: z
      .string('İlan açıklamasını yazın.')
      .trim()
      .min(10, 'Açıklama en az 10 karakter olmalı.')
      .max(JOB_TEXT_MAX, `Açıklama en çok ${String(JOB_TEXT_MAX)} karakter olabilir.`)
      .describe('İş tanımı (10–4000)'),
    requirements: optionalText(JOB_TEXT_MAX, 'Nitelikler')
      .default(null)
      .describe('Aranan nitelikler (≤ 4000, isteğe bağlı)'),
    publishOn: daySchema.describe('Yayın günü (YYYY-MM-DD)'),
    deadlineOn: daySchema.describe('Son başvuru günü (YYYY-MM-DD); yayın gününden önce olamaz'),
  })
  .superRefine((value, context) => {
    if (value.deadlineOn < value.publishOn)
      context.addIssue({
        code: 'custom',
        path: ['deadlineOn'],
        message: 'Son başvuru günü yayın gününden önce olamaz.',
      })
  })
export type JobPostingInput = z.input<typeof jobPostingInputSchema>
export type JobPostingFields = z.output<typeof jobPostingInputSchema>

export const jobPostingStatusInputSchema = z.strictObject({
  status: z
    .enum(['published', 'closed'], 'Yeni durumu seçin.')
    .describe('`published` yayımla, `closed` kapat'),
})
export type JobPostingStatusInput = z.output<typeof jobPostingStatusInputSchema>

export const jobApplicationInputSchema = z
  .strictObject({
    jobPostingId: z.uuid('İlanı seçin.').describe('Başvurulan ilan'),
    // kvkk: K (aday kimliği)
    candidateName: candidateNameSchema.describe('Adayın adı soyadı (2–120)'),
    // kvkk: K (aday iletişimi)
    email: candidateEmailSchema.default(null).describe('Adayın e-postası (isteğe bağlı)'),
    // kvkk: K (aday iletişimi)
    phone: candidatePhoneSchema
      .default(null)
      .describe(
        'Adayın telefonu (isteğe bağlı, 0XXXXXXXXXX); e-posta ya da telefondan biri zorunlu',
      ),
    channel: z
      .enum(JOB_APPLICATION_CHANNELS, 'Başvuru kanalını seçin.')
      .describe('`website` kurum sitesi, `email` e-posta, `in_person` elden, `referral` tavsiye'),
    receivedOn: daySchema.describe(
      'Başvurunun alındığı gün; yayın gününden önce, son başvuru gününden ve bugünden sonra olamaz',
    ),
    // kvkk: K (özgeçmiş)
    cvFileId: z
      .uuid('Özgeçmiş dosyası geçersiz.')
      .nullable()
      .default(null)
      .describe('Özgeçmiş (`POST /files` amaç `document`, PDF); isteğe bağlı'),
    privacyNoticeVersion: z
      .string('Aydınlatma metni sürümünü yazın.')
      .trim()
      .min(1, 'Aydınlatma metni gösterilmeden başvuru kaydedilemez; gösterilen sürümü yazın.')
      .max(
        PRIVACY_NOTICE_VERSION_MAX,
        `Sürüm en çok ${String(PRIVACY_NOTICE_VERSION_MAX)} karakter olabilir.`,
      )
      .describe('Adaya gösterilen aday aydınlatma metninin sürümü (zorunlu)'),
    privacyNoticeShownOn: daySchema.describe(
      'Aydınlatma metninin adaya gösterildiği gün (zorunlu); bugünden sonra olamaz',
    ),
    // kvkk: K (serbest metin)
    note: noteSchema.default(null).describe('İç not (≤ 1000); denetime ve loga yazılmaz'),
  })
  .superRefine((value, context) => {
    if (value.email === null && value.phone === null)
      context.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'E-posta ya da telefondan en az birini girin.',
      })
  })
export type JobApplicationInput = z.input<typeof jobApplicationInputSchema>
export type JobApplicationFields = z.output<typeof jobApplicationInputSchema>

/** Başvuru düzeltmesi: gönderilen alanlar değişir (ad, iletişim, not). */
export const jobApplicationUpdateSchema = z
  .strictObject({
    candidateName: candidateNameSchema.optional(),
    email: candidateEmailSchema.optional(),
    phone: candidatePhoneSchema.optional(),
    note: noteSchema.optional(),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((field) => field === undefined))
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type JobApplicationUpdate = z.output<typeof jobApplicationUpdateSchema>

export const jobApplicationStageInputSchema = z.strictObject({
  stage: z
    .enum(JOB_APPLICATION_STAGES, 'Aşamayı seçin.')
    .describe(
      '`new` yeni, `screening` ön eleme, `interview` mülakat, `offer` teklif, `hired` işe alındı, `rejected` reddedildi',
    ),
  changedOn: daySchema.describe('Aşamanın değiştiği gün; bugünden sonra olamaz'),
})
export type JobApplicationStageInput = z.output<typeof jobApplicationStageInputSchema>

export const jobApplicationAnonymizationInputSchema = z.strictObject({
  applicationIds: z
    .array(z.uuid('Başvuru geçersiz.'), 'Başvuruları seçin.')
    .min(1, 'En az bir başvuru seçin.')
    .max(
      ANONYMIZATION_BATCH_MAX,
      `Tek seferde en çok ${String(ANONYMIZATION_BATCH_MAX)} başvuru anonimleştirilir.`,
    )
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı başvuru iki kez seçilmiş.')
    .describe('Anonimleştirilecek başvurular (1–100)'),
  reason: z
    .enum(JOB_APPLICATION_ANONYMIZATION_REASONS, 'Gerekçeyi seçin.')
    .describe(
      '`retention_expired` saklama süresi dolanlar, `data_subject_request` adayın silme talebi (süre beklenmez)',
    ),
})
export type JobApplicationAnonymizationInput = z.output<
  typeof jobApplicationAnonymizationInputSchema
>

export const jobApplicationSettingsSchema = z
  .strictObject({
    retentionMonths: z
      .number('Saklama süresini ay olarak girin.')
      .int('Süre tam ay olmalı.')
      .min(
        JOB_APPLICATION_RETENTION_MIN_MONTHS,
        `Süre en az ${String(JOB_APPLICATION_RETENTION_MIN_MONTHS)} ay olmalı.`,
      )
      .max(
        JOB_APPLICATION_RETENTION_MAX_MONTHS,
        `Süre en çok ${String(JOB_APPLICATION_RETENTION_MAX_MONTHS)} ay olabilir.`,
      )
      .optional()
      .describe('Saklama süresi (ay, 1–60; varsayılan 12)'),
    privacyNoticeVersion: optionalText(PRIVACY_NOTICE_VERSION_MAX, 'Sürüm')
      .optional()
      .describe(
        'Geçerli aday aydınlatma metninin sürümü; başvuru formunda önerilir, boş bırakılabilir',
      ),
  })
  .superRefine((value, context) => {
    if (value.retentionMonths === undefined && value.privacyNoticeVersion === undefined)
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type JobApplicationSettingsInput = z.output<typeof jobApplicationSettingsSchema>

export interface JobApplicationSettings {
  retentionMonths: number
  privacyNoticeVersion: string | null
}
export const DEFAULT_JOB_APPLICATION_SETTINGS: JobApplicationSettings = {
  retentionMonths: JOB_APPLICATION_RETENTION_DEFAULT_MONTHS,
  privacyNoticeVersion: null,
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })

export interface StoredJobPostingState {
  status: JobPostingStatus
  title: string
  position: string
  employmentType: JobEmploymentType
  description: string
  requirements: string | null
  publishOn: string
  deadlineOn: string
}

const POSTING_FIELDS = [
  'title',
  'position',
  'employmentType',
  'description',
  'requirements',
  'publishOn',
  'deadlineOn',
] as const

/**
 * İlan düzeltmesi (K-439): taslak ve yayındaki ilan düzeltilir, kapanan değişmez. Yayındaki ilanın
 * yayın günü değişmez; son başvuru günü alınmış başvuruların en geç gününden önceye çekilemez.
 * Değişen alan adları döner.
 */
export function planJobPostingUpdate(
  current: StoredJobPostingState,
  input: JobPostingFields,
  checks: { latestReceivedOn: string | null },
): string[] {
  if (current.status === 'closed')
    throw ruleError('job_posting_closed', 'Kapanan ilan değiştirilemez.', [])
  const changed = POSTING_FIELDS.filter((field) => current[field] !== input[field])
  if (changed.length === 0) throw ruleError('job_posting_unchanged', 'İlanda değişiklik yok.', [])
  if (current.status === 'published' && input.publishOn !== current.publishOn)
    throw ruleError('job_posting_publish_locked', 'Yayındaki ilanın yayın günü değiştirilemez.', [
      'publishOn',
    ])
  if (checks.latestReceivedOn !== null && input.deadlineOn < checks.latestReceivedOn)
    throw ruleError(
      'job_posting_deadline_before_applications',
      'Son başvuru günü alınmış başvuruların gününden önceye çekilemez.',
      ['deadlineOn'],
    )
  return [...changed]
}

/**
 * İlan durumu (K-439): taslak → yayında → kapandı; taslak doğrudan kapanabilir (yayımlanmadan
 * vazgeçme). Son başvuru günü geçmiş ilan yayımlanmaz. Kapanış günü bugündür.
 */
export function planJobPostingStatus(
  current: Pick<StoredJobPostingState, 'status' | 'deadlineOn'>,
  target: JobPostingStatusInput['status'],
  today: string,
): { status: JobPostingStatus; closedOn: string | null } {
  const allowed = JOB_POSTING_TRANSITIONS[current.status] as readonly JobPostingStatus[]
  if (!allowed.includes(target))
    throw ruleError(
      'job_posting_transition',
      current.status === 'closed'
        ? 'Kapanan ilan yeniden açılmaz; yeni ilan açın.'
        : `İlan "${JOB_POSTING_STATUS_LABELS[current.status]}" durumundan "${JOB_POSTING_STATUS_LABELS[target]}" durumuna geçemez.`,
      ['status'],
    )
  if (target === 'published' && current.deadlineOn < today)
    throw ruleError(
      'job_posting_deadline_passed',
      'Son başvuru günü geçmiş ilan yayımlanamaz; önce son başvuru gününü güncelleyin.',
      ['status'],
    )
  return { status: target, closedOn: target === 'closed' ? today : null }
}

export interface JobApplicationChecks {
  posting: Pick<StoredJobPostingState, 'status' | 'publishOn' | 'deadlineOn'> | null
  duplicate: 'email' | 'phone' | null
  today: string
}

/**
 * Başvuru kaydı (K-440): ilan kurumda olmalı ve taslak olmamalı; başvuru günü yayın günü ile son
 * başvuru günü arasında ve bugünden sonra değil; aydınlatma günü bugünden sonra olamaz. Aynı ilana
 * aynı e-posta ya da telefonla ikinci (anonimleştirilmemiş) başvuru 409.
 */
export function assertJobApplication(
  input: Pick<JobApplicationFields, 'receivedOn' | 'privacyNoticeShownOn'>,
  checks: JobApplicationChecks,
): void {
  const { posting } = checks
  if (posting === null)
    throw ruleError('job_application_posting_not_found', 'İlan bulunamadı.', ['jobPostingId'])
  if (posting.status === 'draft')
    throw ruleError(
      'job_application_posting_draft',
      'Taslak ilana başvuru kaydedilmez; önce ilanı yayımlayın.',
      ['jobPostingId'],
    )
  if (input.receivedOn > checks.today)
    throw ruleError('job_application_received_in_future', 'Başvuru günü bugünden sonra olamaz.', [
      'receivedOn',
    ])
  if (input.receivedOn < posting.publishOn)
    throw ruleError(
      'job_application_before_publish',
      'Başvuru günü ilanın yayın gününden önce olamaz.',
      ['receivedOn'],
    )
  if (input.receivedOn > posting.deadlineOn)
    throw ruleError(
      'job_application_after_deadline',
      'Başvuru günü ilanın son başvuru gününden sonra olamaz.',
      ['receivedOn'],
    )
  if (input.privacyNoticeShownOn > checks.today)
    throw ruleError(
      'job_application_notice_in_future',
      'Aydınlatma metninin gösterildiği gün bugünden sonra olamaz.',
      ['privacyNoticeShownOn'],
    )
  if (checks.duplicate !== null)
    throw new DomainError(
      'job_application_duplicate',
      checks.duplicate === 'email'
        ? 'Bu ilana aynı e-postayla başvuru zaten kayıtlı.'
        : 'Bu ilana aynı telefonla başvuru zaten kayıtlı.',
      { kind: 'conflict', path: [checks.duplicate] },
    )
}

export interface StoredJobApplicationState {
  candidateName: string
  email: string | null
  phone: string | null
  note: string | null
  stage: JobApplicationStage
  stageChangedOn: string
  anonymizedAt: string | null
}

const assertNotAnonymized = (current: Pick<StoredJobApplicationState, 'anonymizedAt'>) => {
  if (current.anonymizedAt !== null)
    throw ruleError('job_application_anonymized', 'Anonimleştirilmiş başvuru değiştirilemez.', [])
}

/**
 * Başvuru düzeltmesi: ad, iletişim ve not; anonimleştirilmiş başvuru değişmez, iletişimden biri
 * kalmalı. Sonraki değerler ve değişen alan adları döner.
 */
export function planJobApplicationUpdate(
  current: StoredJobApplicationState,
  input: JobApplicationUpdate,
): {
  next: Pick<StoredJobApplicationState, 'candidateName' | 'email' | 'phone' | 'note'>
  changed: string[]
} {
  assertNotAnonymized(current)
  const next = {
    candidateName: input.candidateName ?? current.candidateName,
    email: input.email === undefined ? current.email : input.email,
    phone: input.phone === undefined ? current.phone : input.phone,
    note: input.note === undefined ? current.note : input.note,
  }
  const changed = (['candidateName', 'email', 'phone', 'note'] as const).filter(
    (field) => next[field] !== current[field],
  )
  if (changed.length === 0)
    throw ruleError('job_application_unchanged', 'Başvuruda değişiklik yok.', [])
  if (next.email === null && next.phone === null)
    throw ruleError(
      'job_application_contact_required',
      'E-posta ya da telefondan en az biri kalmalı.',
      ['email'],
    )
  return { next, changed: [...changed] }
}

/**
 * Aşama değişikliği (K-440): yalnız ileri (ara aşama atlanabilir) ya da açık her aşamadan "reddedildi";
 * işe alındı ve reddedildi sondur. Gün bugünden sonra ve önceki aşama gününden önce olamaz.
 */
export function planJobApplicationStage(
  current: Pick<StoredJobApplicationState, 'stage' | 'stageChangedOn' | 'anonymizedAt'>,
  input: JobApplicationStageInput,
  today: string,
): { stage: JobApplicationStage; changedOn: string } {
  assertNotAnonymized(current)
  if (isJobApplicationClosed(current.stage))
    throw ruleError(
      'job_application_closed',
      `"${JOB_APPLICATION_STAGE_LABELS[current.stage]}" aşamasındaki başvuru değiştirilemez.`,
      ['stage'],
    )
  if (input.stage === current.stage)
    throw ruleError('job_application_stage_unchanged', 'Başvuru zaten bu aşamada.', ['stage'])
  if (input.stage !== 'rejected' && STAGE_RANK[input.stage] <= STAGE_RANK[current.stage])
    throw ruleError(
      'job_application_stage_transition',
      'Başvuru önceki bir aşamaya geri alınamaz.',
      ['stage'],
    )
  if (input.changedOn > today)
    throw ruleError('job_application_stage_in_future', 'Aşama günü bugünden sonra olamaz.', [
      'changedOn',
    ])
  if (input.changedOn < current.stageChangedOn)
    throw ruleError(
      'job_application_stage_before_previous',
      'Aşama günü önceki aşamanın gününden önce olamaz.',
      ['changedOn'],
    )
  return { stage: input.stage, changedOn: input.changedOn }
}

/** Ayar güncellemesi: gönderilmeyen alan korunur; değişiklik yoksa 422. */
export function planJobApplicationSettings(
  current: JobApplicationSettings,
  input: JobApplicationSettingsInput,
): { next: JobApplicationSettings; changed: string[] } {
  const next: JobApplicationSettings = {
    retentionMonths: input.retentionMonths ?? current.retentionMonths,
    privacyNoticeVersion:
      input.privacyNoticeVersion === undefined
        ? current.privacyNoticeVersion
        : input.privacyNoticeVersion,
  }
  const changed = (['retentionMonths', 'privacyNoticeVersion'] as const).filter(
    (field) => next[field] !== current[field],
  )
  if (changed.length === 0)
    throw ruleError('job_application_settings_unchanged', 'Ayarda değişiklik yok.', [])
  return { next, changed: [...changed] }
}

// --- Saklama -------------------------------------------------------------------------------------

export interface RetentionInput {
  stage: JobApplicationStage
  stageChangedOn: string
  postingClosedOn: string | null
  anonymizedAt: string | null
}

/**
 * Saklama süresinin başladığı gün (K-441): reddedilen başvuruda ret günü; işe alınmamış ve
 * reddedilmemiş başvuruda ilanın kapandığı gün; işe alınan, açık ilandaki süren ve
 * anonimleştirilmiş başvuruda yok.
 */
export function retentionStartOn(input: RetentionInput): string | null {
  if (input.anonymizedAt !== null || input.stage === 'hired') return null
  if (input.stage === 'rejected') return input.stageChangedOn
  return input.postingClosedOn
}

/** Süre sonu: başlangıç + ay (hedef ayda gün yoksa ayın son günü); süre bu gün dolar. */
export function retentionDueOn(input: RetentionInput, retentionMonths: number): string | null {
  const start = retentionStartOn(input)
  return start === null ? null : addMonthsToDay(start, retentionMonths)
}

export interface AnonymizationTarget extends RetentionInput {
  id: string
}

/**
 * Anonimleştirme kuralı (K-441): her başvuru kurumda olmalı ve anonimleştirilmemiş olmalı. Süre
 * gerekçesinde süre sonu bugün ya da önce olmalı; adayın silme talebinde süre beklenmez ama işe
 * alınan adayın başvurusu özlük verisidir, buradan anonimleştirilmez (DOM-FIN-122). Hata yolu
 * başvurunun dizideki sırasıdır; biri reddedilirse hiçbiri değişmez.
 */
export function assertJobApplicationAnonymization(
  input: JobApplicationAnonymizationInput,
  found: ReadonlyMap<string, AnonymizationTarget>,
  checks: { retentionMonths: number; today: string },
): void {
  for (const [index, id] of input.applicationIds.entries()) {
    const path = ['applicationIds', String(index)]
    const target = found.get(id)
    if (target === undefined)
      throw ruleError('job_application_not_found', 'Başvuru bulunamadı.', path)
    if (target.anonymizedAt !== null)
      throw ruleError(
        'job_application_already_anonymized',
        'Başvuru zaten anonimleştirilmiş.',
        path,
      )
    if (target.stage === 'hired')
      throw ruleError(
        'job_application_hired',
        'İşe alınan adayın başvurusu personel verisidir; özlük saklama ve imha ekranından yönetilir.',
        path,
      )
    if (input.reason === 'retention_expired') {
      const due = retentionDueOn(target, checks.retentionMonths)
      if (due === null || due > checks.today)
        throw ruleError(
          'job_application_retention_not_due',
          'Başvurunun saklama süresi dolmadı.',
          path,
        )
    }
  }
}
