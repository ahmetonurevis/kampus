import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { STAFF_ROLES, type StaffRole } from './staff-accounts.ts'

/**
 * Mesleki gelişim kataloğu (docs/domain/finans.md DOM-FIN-125; ON-214). Kurum personeline açılan
 * kurs, seminer, konferans, kurum içi ve çevrim içi eğitimlerin kaydı ile personelin bu eğitimlere
 * atanması ya da katılım isteğinin kaydı. Personel kaydı ayrı tablo değildir: atama kurum
 * üyeliğine bağlanır. Katılım saati yalnız "katıldı" işaretiyle tutulur; sertifika (ON-215) ve kurum
 * içi çevrim içi eğitim içeriği (ON-216) ayrı iştir. Fonksiyonlar saftır.
 */

/** Katalog ve atamaları yalnız yönetici yazar (K-430). */
export const FINANCE_PROFESSIONAL_DEVELOPMENT_WRITE_ROLES = [
  'yonetici',
] as const satisfies readonly Role[]
/** Ön büro katalog ve katılımcı listesini okur (duyuru ve kayıt soruları için; K-430). */
export const FINANCE_PROFESSIONAL_DEVELOPMENT_READ_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]

export const PROFESSIONAL_DEVELOPMENT_KINDS = [
  'course',
  'seminar',
  'conference',
  'in_house',
  'online',
] as const
export type ProfessionalDevelopmentKind = (typeof PROFESSIONAL_DEVELOPMENT_KINDS)[number]
export const PROFESSIONAL_DEVELOPMENT_KIND_LABELS = {
  course: 'Kurs',
  seminar: 'Seminer',
  conference: 'Konferans',
  in_house: 'Kurum içi eğitim',
  online: 'Çevrim içi',
} as const satisfies Record<ProfessionalDevelopmentKind, string>

export const PROFESSIONAL_DEVELOPMENT_STATUSES = ['draft', 'published', 'archived'] as const
export type ProfessionalDevelopmentStatus = (typeof PROFESSIONAL_DEVELOPMENT_STATUSES)[number]
export const PROFESSIONAL_DEVELOPMENT_STATUS_LABELS = {
  draft: 'Taslak',
  published: 'Yayında',
  archived: 'Arşiv',
} as const satisfies Record<ProfessionalDevelopmentStatus, string>

/** İzinli durum geçişleri (K-431): arşiv son durumdur, yayından taslağa dönülmez. */
const STATUS_TRANSITIONS = {
  draft: ['published', 'archived'],
  published: ['archived'],
  archived: [],
} as const satisfies Record<ProfessionalDevelopmentStatus, readonly ProfessionalDevelopmentStatus[]>

export const PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES = [
  'assigned',
  'attended',
  'not_completed',
] as const
export type ProfessionalDevelopmentEnrollmentStatus =
  (typeof PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES)[number]
export const PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUS_LABELS = {
  assigned: 'Atandı',
  attended: 'Katıldı',
  not_completed: 'Tamamlamadı',
} as const satisfies Record<ProfessionalDevelopmentEnrollmentStatus, string>

/** Atama kaynağı: personelin katılım isteği ya da yöneticinin ataması. */
export const PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS = ['request', 'assignment'] as const
export type ProfessionalDevelopmentEnrollmentOrigin =
  (typeof PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS)[number]
export const PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGIN_LABELS = {
  request: 'Katılım isteği',
  assignment: 'Atama',
} as const satisfies Record<ProfessionalDevelopmentEnrollmentOrigin, string>

export const PROFESSIONAL_DEVELOPMENT_NAME_MIN = 2
export const PROFESSIONAL_DEVELOPMENT_NAME_MAX = 160
export const PROFESSIONAL_DEVELOPMENT_PROVIDER_MAX = 160
export const PROFESSIONAL_DEVELOPMENT_LOCATION_MAX = 200
export const PROFESSIONAL_DEVELOPMENT_URL_MAX = 500
export const PROFESSIONAL_DEVELOPMENT_BRANCH_MAX = 60
export const PROFESSIONAL_DEVELOPMENT_BRANCHES_MAX = 10
/** Süre ve katılım saati yarım saat adımlıdır; veritabanında dakika tutulur. */
export const PROFESSIONAL_DEVELOPMENT_MAX_MINUTES = 2000 * 60
export const PROFESSIONAL_DEVELOPMENT_FEE_MAX_CENTS = 100_000_000
export const PROFESSIONAL_DEVELOPMENT_CAPACITY_MAX = 10_000

const HALF_HOUR = 0.5

const hoursSchema = (label: string) =>
  z
    .number(`${label} saat olarak girin.`)
    .positive(`${label} sıfırdan büyük olmalı.`)
    .max(PROFESSIONAL_DEVELOPMENT_MAX_MINUTES / 60, `${label} en fazla 2000 saat olabilir.`)
    .multipleOf(HALF_HOUR, `${label} yarım saat adımlarıyla girilir.`)

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${String(max)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)

const urlSchema = z
  .string()
  .trim()
  .max(PROFESSIONAL_DEVELOPMENT_URL_MAX, 'Bağlantı en fazla 500 karakter olabilir.')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)
  .refine(
    (value) => value === null || /^https:\/\/[^\s]+$/.test(value),
    'Bağlantı https:// ile başlamalı.',
  )

const branchesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(2, 'Branş etiketi en az 2 karakter olmalı.')
      .max(PROFESSIONAL_DEVELOPMENT_BRANCH_MAX, 'Branş etiketi en fazla 60 karakter olabilir.'),
  )
  .max(PROFESSIONAL_DEVELOPMENT_BRANCHES_MAX, 'En fazla 10 branş etiketi girilebilir.')
  .default([])
  .transform((values) => [...new Set(values)])

export const professionalDevelopmentProgramInputSchema = z
  .strictObject({
    name: z
      .string('Eğitim adını yazın.')
      .trim()
      .min(PROFESSIONAL_DEVELOPMENT_NAME_MIN, 'Eğitim adını en az 2 karakterle yazın.')
      .max(PROFESSIONAL_DEVELOPMENT_NAME_MAX, 'Eğitim adı en fazla 160 karakter olabilir.')
      .describe('Eğitimin adı'),
    kind: z
      .enum(PROFESSIONAL_DEVELOPMENT_KINDS, 'Eğitim türünü seçin.')
      .describe(
        '`course` kurs, `seminar` seminer, `conference` konferans, `in_house` kurum içi, `online` çevrim içi',
      ),
    provider: z
      .string('Sağlayıcıyı yazın.')
      .trim()
      .min(2, 'Sağlayıcıyı en az 2 karakterle yazın.')
      .max(PROFESSIONAL_DEVELOPMENT_PROVIDER_MAX, 'Sağlayıcı en fazla 160 karakter olabilir.')
      .describe('Eğitimi veren kurum ya da kişi; kurum içi eğitimde kurumun kendisi'),
    durationHours: hoursSchema('Süre').describe('Toplam süre, saat (yarım saat adımlı)'),
    ongoing: z
      .boolean()
      .default(false)
      .describe('Sürekli açık eğitim (tarih aralığı yok); örneğin kendi hızında çevrim içi kurs'),
    startDate: daySchema.nullable().default(null).describe('Başlangıç günü (YYYY-MM-DD)'),
    endDate: daySchema.nullable().default(null).describe('Bitiş günü (YYYY-MM-DD)'),
    location: optionalText(PROFESSIONAL_DEVELOPMENT_LOCATION_MAX, 'Yer').describe(
      'Yüz yüze eğitimin yeri',
    ),
    onlineUrl: urlSchema.describe('Çevrim içi bağlantı (https://)'),
    audienceRoles: z
      .array(z.enum(STAFF_ROLES, 'Hedef rol geçersiz.'))
      .max(STAFF_ROLES.length)
      .default([])
      .transform((values) => [...new Set(values)])
      .describe('Hedef kitle rol etiketleri; boşsa tüm personel'),
    audienceBranches: branchesSchema.describe('Hedef kitle branş etiketleri (serbest metin)'),
    feeCents: z
      .number('Ücret kuruş olarak girilir.')
      .int('Ücret kuruş olarak girilir.')
      .min(0, 'Ücret eksi olamaz.')
      .max(PROFESSIONAL_DEVELOPMENT_FEE_MAX_CENTS, 'Ücret çok büyük.')
      .nullable()
      .default(null)
      .describe('Kişi başı ücret, kuruş; boşsa ücretsiz ya da bilinmiyor'),
    costCenterId: z
      .uuid('Maliyet merkezi geçersiz.')
      .nullable()
      .default(null)
      .describe('Ücretin yazılacağı maliyet merkezi (isteğe bağlı; ON-204)'),
    capacity: z
      .number('Kontenjan sayı olmalı.')
      .int('Kontenjan tam sayı olmalı.')
      .min(1, 'Kontenjan en az 1 olmalı.')
      .max(PROFESSIONAL_DEVELOPMENT_CAPACITY_MAX, 'Kontenjan çok büyük.')
      .nullable()
      .default(null)
      .describe('Kontenjan; boşsa sınırsız'),
  })
  .superRefine((value, ctx) => {
    if (value.ongoing) {
      if (value.startDate !== null || value.endDate !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['startDate'],
          message: 'Sürekli eğitimde tarih aralığı girilmez.',
        })
    } else {
      if (value.startDate === null)
        ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Başlangıç gününü seçin.' })
      if (value.endDate === null)
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş gününü seçin.' })
      if (value.startDate !== null && value.endDate !== null && value.endDate < value.startDate)
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'Bitiş günü başlangıçtan önce olamaz.',
        })
    }
    if (value.location === null && value.onlineUrl === null)
      ctx.addIssue({
        code: 'custom',
        path: ['location'],
        message: 'Yeri ya da çevrim içi bağlantıyı yazın.',
      })
    if (value.kind === 'online' && value.onlineUrl === null)
      ctx.addIssue({
        code: 'custom',
        path: ['onlineUrl'],
        message: 'Çevrim içi eğitimde bağlantı zorunludur.',
      })
    if (value.costCenterId !== null && value.feeCents === null)
      ctx.addIssue({
        code: 'custom',
        path: ['costCenterId'],
        message: 'Maliyet merkezi yalnız ücretli eğitimde seçilir.',
      })
  })
export type ProfessionalDevelopmentProgramInput = z.output<
  typeof professionalDevelopmentProgramInputSchema
>

export const professionalDevelopmentStatusInputSchema = z.strictObject({
  status: z
    .enum(PROFESSIONAL_DEVELOPMENT_STATUSES, 'Durumu seçin.')
    .describe('Yeni durum: `published` yayına al, `archived` arşivle'),
})

export const professionalDevelopmentEnrollmentInputSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Atanan personelin kurum üyeliği'),
  origin: z
    .enum(PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS, 'Kaynağı seçin.')
    .default('assignment')
    .describe('`request` personelin katılım isteği, `assignment` yönetici ataması'),
})

export const professionalDevelopmentEnrollmentUpdateSchema = z
  .strictObject({
    status: z
      .enum(PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES, 'Durumu seçin.')
      .describe('`assigned` atandı, `attended` katıldı, `not_completed` tamamlamadı'),
    attendedHours: hoursSchema('Katılım saati')
      .nullable()
      .default(null)
      .describe('Katılım saati; yalnız `attended` durumunda ve zorunlu'),
    developmentGoalId: z
      .uuid('Gelişim hedefi geçersiz.')
      .nullable()
      .optional()
      .describe(
        'Katkı verdiği gelişim hedefi (DOM-FIN-144, K-489); verilmezse bağ değişmez, `null` bağı kaldırır',
      ),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'attended' && value.attendedHours === null)
      ctx.addIssue({
        code: 'custom',
        path: ['attendedHours'],
        message: 'Katılım saatini girin.',
      })
    if (value.status !== 'attended' && value.attendedHours !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['attendedHours'],
        message: 'Katılım saati yalnız katıldı durumunda girilir.',
      })
  })

export const hoursToMinutes = (hours: number): number => Math.round(hours * 60)
export const minutesToHours = (minutes: number): number => minutes / 60

/** Saat gösterimi: `12`, `1,5`. */
export function hoursLabel(hours: number): string {
  return `${hours.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} saat`
}

// --- Kurallar -----------------------------------------------------------------------------------

const rule = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Arşivdeki eğitim düzeltilmez (K-431). */
export function assertProgramEditable(status: ProfessionalDevelopmentStatus): void {
  if (status === 'archived')
    throw conflict('professional_development_archived', 'Arşivdeki eğitim değiştirilemez.')
}

/** Durum geçişi (K-431); izinsiz geçiş 409. */
export function assertStatusTransition(
  from: ProfessionalDevelopmentStatus,
  to: ProfessionalDevelopmentStatus,
): void {
  const allowed: readonly ProfessionalDevelopmentStatus[] = STATUS_TRANSITIONS[from]
  if (!allowed.includes(to))
    throw conflict(
      'professional_development_status_transition',
      `${PROFESSIONAL_DEVELOPMENT_STATUS_LABELS[from]} durumundaki eğitim ${PROFESSIONAL_DEVELOPMENT_STATUS_LABELS[to].toLocaleLowerCase('tr-TR')} durumuna alınamaz.`,
    )
}

export interface EnrollmentStaff {
  role: string
  active: boolean
}

/**
 * Yeni atama (K-432): eğitim yayında olmalı; personel kurumun etkin yönetici, öğretmen ya da ön
 * büro üyeliği olmalı; aynı personel aynı eğitime bir kez atanır; kontenjan doluysa atanmaz.
 */
export function assertEnrollmentAllowed(input: {
  programStatus: ProfessionalDevelopmentStatus
  staff: EnrollmentStaff | null
  alreadyEnrolled: boolean
  capacity: number | null
  enrolledCount: number
}): void {
  if (input.programStatus !== 'published')
    throw rule(
      'professional_development_not_published',
      'Yalnız yayındaki eğitime personel atanır.',
    )
  if (input.staff === null)
    throw rule(
      'professional_development_staff_not_found',
      'Personel bu kurumda bulunamadı.',
      'membershipId',
    )
  if (!(STAFF_ROLES as readonly string[]).includes(input.staff.role))
    throw rule(
      'professional_development_not_staff',
      'Yalnız yönetici, öğretmen ya da ön büro personeli atanır.',
      'membershipId',
    )
  if (!input.staff.active)
    throw rule(
      'professional_development_staff_inactive',
      'Ayrılmış personel eğitime atanamaz.',
      'membershipId',
    )
  if (input.alreadyEnrolled)
    throw conflict(
      'professional_development_already_enrolled',
      'Bu personel eğitime zaten atanmış.',
    )
  if (input.capacity !== null && input.enrolledCount >= input.capacity)
    throw rule('professional_development_capacity_full', 'Eğitimin kontenjanı dolu.')
}

/**
 * Katılım durumu (K-432): arşivdeki eğitimin katılımı değişmez; katılım saati eğitim süresini
 * aşamaz.
 */
export function assertEnrollmentUpdate(input: {
  programStatus: ProfessionalDevelopmentStatus
  programMinutes: number
  attendedMinutes: number | null
}): void {
  assertProgramEditable(input.programStatus)
  if (input.attendedMinutes !== null && input.attendedMinutes > input.programMinutes)
    throw rule(
      'professional_development_hours_exceed',
      'Katılım saati eğitim süresini aşamaz.',
      'attendedHours',
    )
}

/** Hedef kitle etiketi gösterimi; boşsa "Tüm personel". */
export function audienceLabel(input: {
  audienceRoles: readonly StaffRole[]
  audienceBranches: readonly string[]
}): string {
  const roleLabels: Record<StaffRole, string> = {
    yonetici: 'Yönetici',
    ogretmen: 'Öğretmen',
    onburo: 'Ön büro',
  }
  const parts = [...input.audienceRoles.map((role) => roleLabels[role]), ...input.audienceBranches]
  return parts.length === 0 ? 'Tüm personel' : parts.join(', ')
}
