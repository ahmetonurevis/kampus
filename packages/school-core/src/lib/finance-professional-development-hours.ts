import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { defaultAcademicYearDates } from './academic-years.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { ProfessionalDevelopmentEnrollmentStatus } from './finance-professional-development.ts'
import { STAFF_ROLES, type StaffRole } from './staff-accounts.ts'

/**
 * Mesleki gelişim saati ve belgeleri (docs/domain/finans.md DOM-FIN-144; ON-215). Katalog ve
 * katılım saati DOM-FIN-125'tedir (ON-214); burada kurumun öğretim yılı başına hedef saati, personel
 * bazında tamamlanan/hedef özeti, katılım belgesi, sertifikanın özlük belgesine (DOM-FIN-113) bağı ve
 * gelişim hedefine (DOM-FIN-133) katkı işareti vardır. Saat ikinci kez saklanmaz: tamamlanan saat
 * "katıldı" işaretli atamaların katılım dakikalarının toplamıdır. İkinci sertifika tablosu yoktur;
 * sertifika özlük belgesidir (K-488). Fonksiyonlar saftır.
 */

/** Hedef saat ayarını ve özetini yalnız yönetici okur ve yazar (K-487). */
export const FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES = [
  'yonetici',
] as const satisfies readonly Role[]

/** Hedef tam saattir; veritabanında dakika tutulur (K-487). */
export const PROFESSIONAL_DEVELOPMENT_TARGET_MAX_HOURS = 500
/** Hedef ayarı yokken ve yeni ayarda varsayılan hedef kitle (K-487). */
export const DEFAULT_PROFESSIONAL_DEVELOPMENT_TARGET_ROLES = [
  'ogretmen',
] as const satisfies readonly StaffRole[]

/** Katılım belgesi uçta yalnız PDF ve en çok 10 MB kabul edilir (K-488). */
export const PROFESSIONAL_DEVELOPMENT_DOCUMENT_MIME_TYPES = ['application/pdf'] as const
export const PROFESSIONAL_DEVELOPMENT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

/** Gelişim hedefine yalnız açık ya da süren hedef bağlanır (K-489). */
export const LINKABLE_DEVELOPMENT_GOAL_STATUSES = ['open', 'in_progress'] as const

export const PROFESSIONAL_DEVELOPMENT_HOURS_STATUSES = ['missing', 'met'] as const
export type ProfessionalDevelopmentHoursStatus =
  (typeof PROFESSIONAL_DEVELOPMENT_HOURS_STATUSES)[number]
export const PROFESSIONAL_DEVELOPMENT_HOURS_STATUS_LABELS = {
  missing: 'Eksik saati olan',
  met: 'Hedefi tamamlayan',
} as const satisfies Record<ProfessionalDevelopmentHoursStatus, string>

export const professionalDevelopmentTargetInputSchema = z.strictObject({
  targetHours: z
    .number('Hedef saati sayı olarak girin.')
    .int('Hedef saat tam sayı olmalı.')
    .min(1, 'Hedef saat en az 1 olmalı.')
    .max(
      PROFESSIONAL_DEVELOPMENT_TARGET_MAX_HOURS,
      `Hedef saat en fazla ${String(PROFESSIONAL_DEVELOPMENT_TARGET_MAX_HOURS)} olabilir.`,
    )
    .nullable()
    .describe('Öğretim yılı hedefi, tam saat; `null` hedefi kaldırır'),
  appliesToRoles: z
    .array(z.enum(STAFF_ROLES, 'Hedef rol geçersiz.'))
    .min(1, 'Hedefin uygulanacağı en az bir rol seçin.')
    .max(STAFF_ROLES.length)
    .default([...DEFAULT_PROFESSIONAL_DEVELOPMENT_TARGET_ROLES])
    .transform((values) => [...new Set(values)])
    .describe('Hedefin uygulandığı personel rolleri; varsayılan öğretmen'),
})
export type ProfessionalDevelopmentTargetInput = z.output<
  typeof professionalDevelopmentTargetInputSchema
>

export const professionalDevelopmentDocumentInputSchema = z.strictObject({
  fileId: z
    .uuid('Dosya geçersiz.')
    .describe('Yüklenmiş `document` amaçlı PDF (`POST /files`); en çok 10 MB'),
})

export const professionalDevelopmentCertificateInputSchema = z.discriminatedUnion(
  'source',
  [
    z.strictObject({
      source: z.literal('existing').describe('Var olan sertifika özlük belgesine bağla'),
      staffDocumentId: z
        .uuid('Sertifika belgesi geçersiz.')
        .describe('Personelin yerine geçilmemiş `certificate` türü özlük belgesi'),
    }),
    z.strictObject({
      source: z.literal('upload').describe('Yüklenen dosyayla yeni sertifika özlük belgesi aç'),
      fileId: z
        .uuid('Dosya geçersiz.')
        .describe('Yüklenmiş `document` amaçlı PDF (`POST /files`); en çok 10 MB'),
      documentDate: daySchema.describe('Sertifikanın düzenlendiği gün; bugünden sonra olamaz'),
      validUntil: daySchema
        .nullable()
        .default(null)
        .describe('Geçerlilik bitişi (dahil); boşsa sertifika türünün süresi uygulanır'),
    }),
  ],
  { error: 'Sertifikanın kaynağını seçin.' },
)
export type ProfessionalDevelopmentCertificateInput = z.output<
  typeof professionalDevelopmentCertificateInputSchema
>

// --- Kurallar -----------------------------------------------------------------------------------

const rule = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Katılım belgesi ve sertifika yalnız "katıldı" işaretli atamaya eklenir (K-488). */
export function assertDocumentAllowed(status: ProfessionalDevelopmentEnrollmentStatus): void {
  if (status !== 'attended')
    throw rule(
      'professional_development_document_not_attended',
      'Belge yalnız katıldı işaretli personele eklenir.',
    )
}

/** Dosya biçimi ve boyutu (K-488): PDF, en çok 10 MB. */
export function assertDocumentFile(file: { mimeType: string; byteSize: number }): void {
  if (!(PROFESSIONAL_DEVELOPMENT_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.mimeType))
    throw rule('professional_development_document_format', 'Belge PDF olarak yüklenmeli.', 'fileId')
  if (file.byteSize > PROFESSIONAL_DEVELOPMENT_DOCUMENT_MAX_BYTES)
    throw rule(
      'professional_development_document_too_large',
      'Belge en fazla 10 MB olabilir.',
      'fileId',
    )
}

/**
 * Var olan sertifikaya bağ (K-488): belge aynı personelin, sertifika türünde ve yerine geçilmemiş
 * olmalı; bir sertifika tek atamaya bağlanır; atamanın zaten sertifikası varsa önce bağ kaldırılır.
 */
export function assertCertificateLink(input: {
  enrollmentMembershipId: string
  hasCertificate: boolean
  document: { membershipId: string; documentType: string; superseded: boolean } | null
  linkedElsewhere: boolean
}): void {
  if (input.hasCertificate)
    throw conflict(
      'professional_development_certificate_exists',
      'Bu katılımın sertifikası zaten bağlı; önce bağı kaldırın.',
    )
  if (input.document === null || input.document.membershipId !== input.enrollmentMembershipId)
    throw rule(
      'professional_development_certificate_not_found',
      'Sertifika bu personelin özlük belgeleri arasında bulunamadı.',
      'staffDocumentId',
    )
  if (input.document.documentType !== 'certificate')
    throw rule(
      'professional_development_certificate_wrong_type',
      'Yalnız sertifika/kurs belgesi türündeki özlük belgesi bağlanır.',
      'staffDocumentId',
    )
  if (input.document.superseded)
    throw rule(
      'professional_development_certificate_superseded',
      'Yerine yenisi geçmiş sertifika bağlanamaz.',
      'staffDocumentId',
    )
  if (input.linkedElsewhere)
    throw conflict(
      'professional_development_certificate_linked',
      'Bu sertifika başka bir eğitim katılımına bağlı.',
    )
}

/**
 * Gelişim hedefine katkı (K-489): hedef aynı personelin olmalı ve açık ya da sürüyor olmalı.
 * Bağ kurulduktan sonra hedef kapansa da bağ kalır.
 */
export function assertGoalLink(input: {
  enrollmentMembershipId: string
  goal: { membershipId: string; status: string } | null
}): void {
  if (input.goal === null || input.goal.membershipId !== input.enrollmentMembershipId)
    throw rule(
      'professional_development_goal_not_found',
      'Gelişim hedefi bu personelin hedefleri arasında bulunamadı.',
      'developmentGoalId',
    )
  if (!(LINKABLE_DEVELOPMENT_GOAL_STATUSES as readonly string[]).includes(input.goal.status))
    throw rule(
      'professional_development_goal_closed',
      'Kapanmış gelişim hedefine katkı işaretlenmez.',
      'developmentGoalId',
    )
}

/** Belgesi ya da sertifikası olan katılım "katıldı"dan çıkarılamaz (K-488). */
export function assertAttendanceKeepsDocuments(input: {
  nextStatus: ProfessionalDevelopmentEnrollmentStatus
  hasDocument: boolean
  hasCertificate: boolean
}): void {
  if (input.nextStatus !== 'attended' && (input.hasDocument || input.hasCertificate))
    throw conflict(
      'professional_development_attendance_has_documents',
      'Belgesi ya da sertifikası olan katılım geri alınamaz; önce belgeyi kaldırın.',
    )
}

// --- Öğretim yılı ve özet -----------------------------------------------------------------------

export interface DayRange {
  startDate: string
  endDate: string
}

/** Öğretim yılı aralığı: kurumun kayıtlı yılı, yoksa 1 Eylül – 31 Ağustos (K-487). */
export function professionalDevelopmentYearRange(
  startYear: number,
  registered: DayRange | null,
): DayRange {
  return registered ?? defaultAcademicYearDates(startYear)
}

/**
 * Günün öğretim yılı (başlangıç yılı): kayıtlı yıllardan günü içereni, yoksa Eylül'de başlayan
 * varsayılan yıl.
 */
export function professionalDevelopmentYearOf(
  day: string,
  registered: readonly (DayRange & { startYear: number })[],
): number {
  const found = registered.find((year) => year.startDate <= day && day <= year.endDate)
  if (found !== undefined) return found.startYear
  const year = Number(day.slice(0, 4))
  return Number(day.slice(5, 7)) >= 9 ? year : year - 1
}

/**
 * Katılımın sayıldığı gün (K-487): tarihli eğitimde bitiş günü, sürekli eğitimde katılım işaretinin
 * Europe/Istanbul günü.
 */
export function attendanceDay(input: {
  ongoing: boolean
  endDate: string | null
  statusChangedDay: string
}): string {
  return input.ongoing || input.endDate === null ? input.statusChangedDay : input.endDate
}

/** Hedef bu role uygulanır mı; hedef yoksa hiçbir role. */
export function targetAppliesTo(
  target: { appliesToRoles: readonly string[] } | null,
  role: string,
): boolean {
  return target !== null && target.appliesToRoles.includes(role)
}

export interface HoursProgress {
  completedHours: number
  targetHours: number | null
  missingHours: number | null
  met: boolean | null
}

/** Tamamlanan / hedef / eksik saat; hedef yoksa eksik ve tamamlandı bilgisi `null`. */
export function hoursProgress(input: {
  completedMinutes: number
  targetMinutes: number | null
}): HoursProgress {
  const completedHours = input.completedMinutes / 60
  if (input.targetMinutes === null)
    return { completedHours, targetHours: null, missingHours: null, met: null }
  const missingMinutes = Math.max(0, input.targetMinutes - input.completedMinutes)
  return {
    completedHours,
    targetHours: input.targetMinutes / 60,
    missingHours: missingMinutes / 60,
    met: missingMinutes === 0,
  }
}
