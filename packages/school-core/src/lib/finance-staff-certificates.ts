import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isValidTckn } from './finance-corporate.ts'
import { WAGE_TYPE_LABELS, type WageType } from './finance-pay-rates.ts'
import { servicePeriod, servicePeriodLabel } from './finance-severance.ts'
import { dateLabel, money } from './format.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel çalışma ve hizmet belgesi (docs/domain/finans.md DOM-FIN-106; ON-175). Yönetici kurum
 * personeline iki belge düzenler: çalışma belgesi (halen çalışan; görev, işe giriş, isteğe bağlı
 * ücret, muhatap) ve hizmet belgesi (ayrılan; giriş–çıkış günü, görev, hizmet süresi; 4857 md. 28).
 * Personel kaydı ayrı tablo değildir (Oğuzhan'ın üyelik kaydı): ad ve etkinlik üyelikten, görev ve
 * işe giriş günü elle gelir (K-340). Belge üretilirken içerik satıra kopyalanır ve sonra değişmez;
 * yalnız gerekçeyle iptal edilir (K-341). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul
 * günü) ile gelir.
 */

/** Belgeyi yalnız yönetici üretir ve okur (K-342); ücret içerebildiği için muhasebe de görmez. */
export const FINANCE_STAFF_CERTIFICATE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const STAFF_CERTIFICATE_KINDS = ['employment', 'service'] as const
export type StaffCertificateKind = (typeof STAFF_CERTIFICATE_KINDS)[number]
export const STAFF_CERTIFICATE_KIND_LABELS = {
  employment: 'Çalışma belgesi',
  service: 'Hizmet belgesi',
} as const satisfies Record<StaffCertificateKind, string>

/** Liste süzgeci: geçerli ya da iptal edilmiş belge (durum saklanmaz, iptal gününden çıkar). */
export const STAFF_CERTIFICATE_STATUSES = ['valid', 'cancelled'] as const
export type StaffCertificateStatus = (typeof STAFF_CERTIFICATE_STATUSES)[number]

/** Muhatap yazılmazsa belgenin başında bu ibare durur (K-340). */
export const STAFF_CERTIFICATE_DEFAULT_ADDRESSEE = 'İlgili makama'
export const STAFF_CERTIFICATE_NUMBER_PREFIX = 'PB'
export const STAFF_CERTIFICATE_POSITION_MIN = 2
export const STAFF_CERTIFICATE_POSITION_MAX = 120
export const STAFF_CERTIFICATE_ADDRESSEE_MAX = 200
export const STAFF_CERTIFICATE_CANCEL_REASON_MIN = 5
export const STAFF_CERTIFICATE_CANCEL_REASON_MAX = 500

/** Belge numarası: kurumda yıl bazlı ardışık sıra, iki tür ortak (`PB-2026-7`; K-341). */
export function staffCertificateLabel(certificate: {
  certificateYear: number
  certificateNumber: number
}): string {
  return `${STAFF_CERTIFICATE_NUMBER_PREFIX}-${String(certificate.certificateYear)}-${String(certificate.certificateNumber)}`
}

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${String(max)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)

const common = {
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Belgenin düzenlendiği personelin kurum üyeliği'),
  position: z
    .string('Görevi yazın.')
    .trim()
    .min(STAFF_CERTIFICATE_POSITION_MIN, 'Görevi en az 2 karakterle yazın.')
    .max(
      STAFF_CERTIFICATE_POSITION_MAX,
      `Görev en fazla ${String(STAFF_CERTIFICATE_POSITION_MAX)} karakter olabilir.`,
    )
    .describe(
      'Görev ya da unvan (ör. "İngilizce öğretmeni"); personel kaydında olmadığı için elle',
    ),
  hireDate: daySchema.describe('İşe giriş günü (elle; personel kaydında yok)'),
  // kvkk: K (T.C. kimlik no; yalnız belgede, listede dönmez)
  identityNumber: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)
    .refine((value) => value === null || isValidTckn(value), 'Geçerli bir T.C. kimlik no girin.')
    .describe('İsteğe bağlı T.C. kimlik no (11 hane, kontrol haneli); yalnız belgede yazar'),
  addressee: optionalText(STAFF_CERTIFICATE_ADDRESSEE_MAX, 'Muhatap').describe(
    'İsteğe bağlı muhatap (ör. "X Bankası Kadıköy Şubesi Müdürlüğüne"); boşsa "İlgili makama"',
  ),
}

const employmentSchema = z.strictObject({
  kind: z.literal('employment'),
  ...common,
  includeWage: z
    .boolean('Ücret seçimi geçersiz.')
    .default(false)
    .describe('`true` ise düzenleme günündeki ana ücret belgeye yazılır (K-342)'),
})

const serviceSchema = z.strictObject({
  kind: z.literal('service'),
  ...common,
  exitDate: daySchema.describe('İşten ayrılış günü (dahil)'),
})

export const staffCertificateInputSchema = z
  .discriminatedUnion('kind', [employmentSchema, serviceSchema], 'Belge türünü seçin.')
  .superRefine((value, ctx) => {
    if (value.kind === 'service' && value.exitDate < value.hireDate)
      ctx.addIssue({
        code: 'custom',
        path: ['exitDate'],
        message: 'Ayrılış günü işe giriş gününden önce olamaz.',
      })
  })
  .describe('Çalışma (`employment`) ya da hizmet (`service`) belgesi')
export type StaffCertificateInput = z.input<typeof staffCertificateInputSchema>
export type StaffCertificateFields = z.output<typeof staffCertificateInputSchema>

/** İptal (K-341): gerekçe 5–500 karakter; belge silinmez, numara yeniden kullanılmaz. */
export const staffCertificateCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(STAFF_CERTIFICATE_CANCEL_REASON_MIN, 'İptal gerekçesini en az 5 karakterle yazın.')
    .max(
      STAFF_CERTIFICATE_CANCEL_REASON_MAX,
      `En fazla ${String(STAFF_CERTIFICATE_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .describe('İptal gerekçesi; denetim kaydına yazılmaz'),
})
export type StaffCertificateCancelFields = z.output<typeof staffCertificateCancelSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Servisin kurum kilidi altında yüklediği gerçekler. */
export interface StaffCertificateChecks {
  /** Üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  staff: { name: string; role: string; active: boolean } | null
  /** Düzenleme günündeki ana ücret tanımı (DOM-FIN-099); yoksa `null`. */
  wage: { rateType: WageType; amountCents: number } | null
  today: string
}

/**
 * Dondurulan belge içeriği (K-341): satıra kopyalanır, sonradan personel, ücret ya da kurum verisi
 * değişse de belge aynı kalır. Hesaplanan hizmet süresi saklanmaz, günlerden okunur.
 */
export interface StaffCertificateContent {
  kind: StaffCertificateKind
  staffName: string
  position: string
  identityNumber: string | null
  hireDate: string
  exitDate: string | null
  addressee: string
  wageRateType: WageType | null
  wageAmountCents: number | null
}

/**
 * Yeni belge (DOM-FIN-106, K-340, K-342). Personel kurumun yönetici, öğretmen ya da ön büro
 * üyeliğidir. Çalışma belgesi yalnız etkin, hizmet belgesi yalnız pasifleştirilmiş (ayrılan)
 * personele düzenlenir. İşe giriş ve ayrılış günü bugünden sonra olamaz. Ücret yalnız çalışma
 * belgesinde ve istenirse yazılır; o gün yürürlükte ana ücret tanımı yoksa belge düzenlenmez.
 */
export function planStaffCertificate(
  input: StaffCertificateFields,
  checks: StaffCertificateChecks,
): StaffCertificateContent {
  const { staff, today } = checks
  if (staff === null)
    throw ruleError('staff_certificate_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(staff.role))
    throw ruleError(
      'staff_certificate_not_staff',
      'Personel belgesi yalnız personele (yönetici, öğretmen, ön büro) düzenlenir.',
      'membershipId',
    )
  if (input.kind === 'employment' && !staff.active)
    throw ruleError(
      'staff_certificate_staff_inactive',
      'Ayrılan (pasifleştirilmiş) personele çalışma belgesi düzenlenmez; hizmet belgesi düzenleyin.',
      'kind',
    )
  if (input.kind === 'service' && staff.active)
    throw ruleError(
      'staff_certificate_staff_active',
      'Hizmet belgesi ayrılan (pasifleştirilmiş) personele düzenlenir; çalışan personele çalışma belgesi düzenleyin.',
      'kind',
    )
  if (input.hireDate > today)
    throw ruleError(
      'staff_certificate_hire_date_future',
      'İşe giriş günü bugünden sonra olamaz.',
      'hireDate',
    )
  const exitDate = input.kind === 'service' ? input.exitDate : null
  if (exitDate !== null && exitDate > today)
    throw ruleError(
      'staff_certificate_exit_date_future',
      'Ayrılış günü bugünden sonra olamaz.',
      'exitDate',
    )
  const includeWage = input.kind === 'employment' && input.includeWage
  if (includeWage && checks.wage === null)
    throw ruleError(
      'staff_certificate_wage_missing',
      'Bugün yürürlükte ana ücret tanımı yok; ücret bilgisini belgeye eklemek için önce ücret tanımı yapın.',
      'includeWage',
    )
  const wage = includeWage ? checks.wage : null
  return {
    kind: input.kind,
    staffName: staff.name,
    position: input.position,
    identityNumber: input.identityNumber,
    hireDate: input.hireDate,
    exitDate,
    addressee: input.addressee ?? STAFF_CERTIFICATE_DEFAULT_ADDRESSEE,
    wageRateType: wage?.rateType ?? null,
    wageAmountCents: wage?.amountCents ?? null,
  }
}

/** İptal (K-341): iptal edilmiş belge yeniden iptal edilmez (409). */
export function planStaffCertificateCancel(
  certificate: { cancelledAt: string | null },
  input: unknown,
): StaffCertificateCancelFields {
  const data = staffCertificateCancelSchema.parse(input)
  if (certificate.cancelledAt !== null)
    throw new DomainError('staff_certificate_cancelled', 'Bu belge zaten iptal edildi.', {
      kind: 'conflict',
    })
  return data
}

// --- Belge metni ---------------------------------------------------------------------------------

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Ücret satırı: tür ve tutar ("Aylık brüt 45.000,00 ₺"). */
export function staffCertificateWageText(content: {
  wageRateType: WageType | null
  wageAmountCents: number | null
}): string | null {
  if (content.wageRateType === null || content.wageAmountCents === null) return null
  return `${WAGE_TYPE_LABELS[content.wageRateType]} ${money(content.wageAmountCents)}`
}

/** Hizmet süresi (yalnız hizmet belgesinde): giriş ve çıkış günü dahil, yıl/ay/gün. */
export function staffCertificateServiceText(content: {
  hireDate: string
  exitDate: string | null
}): string | null {
  if (content.exitDate === null) return null
  return servicePeriodLabel(servicePeriod(content.hireDate, content.exitDate))
}

/**
 * Belgenin gövde metni (PDF ve önizleme aynı metni kullanır). Çalışma belgesi düzenleme günü
 * itibarıyla çalıştığını, hizmet belgesi işin çeşidini ve süresini (4857 md. 28) yazar. İçerik
 * kuralı **doğrulanmalı** (H-59).
 */
export function staffCertificateParagraphs(
  content: StaffCertificateContent & { institutionName: string },
): string[] {
  const identity =
    content.identityNumber === null ? '' : ` (T.C. kimlik no ${content.identityNumber})`
  if (content.kind === 'service') {
    const exit = content.exitDate ?? content.hireDate
    return [
      `${content.staffName}${identity}, ${dayText(content.hireDate)} – ${dayText(exit)} tarihleri arasında ${content.institutionName} bünyesinde ${content.position} olarak çalışmıştır.`,
      `Hizmet süresi: ${staffCertificateServiceText(content) ?? '—'}.`,
      'İşbu belge 4857 sayılı İş Kanunu md. 28 uyarınca işin çeşidini ve süresini göstermek üzere düzenlenmiştir.',
    ]
  }
  const wage = staffCertificateWageText(content)
  return [
    `${content.staffName}${identity}, ${dayText(content.hireDate)} tarihinden bu yana ${content.institutionName} bünyesinde ${content.position} olarak çalışmaktadır.`,
    ...(wage === null ? [] : [`Düzenleme günü itibarıyla ücreti: ${wage}.`]),
    'İşbu belge ilgilinin talebi üzerine düzenlenmiştir.',
  ]
}
