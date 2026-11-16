import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personelin maliyet merkezine atanması (docs/domain/finans.md DOM-FIN-104; ON-204, K-332). Bir
 * personel üyeliğine (yönetici, öğretmen, ön büro) ay başından yürürlüğe giren atama yazılır:
 * maliyet merkezleri ve yüzde payları (toplam %100) ile saatli ücretlerin tahmini aylık saatleri.
 * Atama, personelin sonraki atamasının başlangıç ayına kadar sürer; bitiş saklanmaz. Atama
 * düzeltilmez: yanlışı gerekçeyle iptal edilip yenisi yazılır. Ücret bilgisi taşımaz; tahmini
 * işveren maliyeti raporu (`finance-staff-cost-report.ts`) ücret tanımı (DOM-FIN-099) ve bordro
 * parametreleriyle (DOM-FIN-100) bu atamadan hesaplanır. Fonksiyonlar saftır.
 */

/** Atamayı ve raporu yalnız yönetici okur ve yazar (K-334; ücret verisi K-306 ile aynı). */
export const STAFF_COST_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Pay ölçeği: on binde bir (10.000 = %100). */
export const STAFF_COST_SHARE_SCALE = 10_000
/** Bir atamadaki en çok merkez sayısı. */
export const STAFF_COST_MAX_CENTERS = 10
/** Tahmini aylık saat üst sınırı (ayda en çok 300 saat). */
export const STAFF_COST_HOURS_MAX = 300
/** Raporun en uzun dönemi (ay). */
export const STAFF_COST_MAX_MONTHS = 12
export const STAFF_COST_MIN_YEAR = 2020
export const STAFF_COST_MAX_YEAR = 2099
export const STAFF_COST_CANCEL_REASON_MIN = 5
export const STAFF_COST_CANCEL_REASON_MAX = 500

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Ay (`YYYY-MM`, 2020–2099). */
export const staffCostMonthSchema = z
  .string('Ayı seçin.')
  .regex(MONTH_PATTERN, 'Ayı YYYY-AA biçiminde seçin.')
  .refine((value) => {
    const year = Number(value.slice(0, 4))
    return year >= STAFF_COST_MIN_YEAR && year <= STAFF_COST_MAX_YEAR
  }, 'Ay 2020 ile 2099 yılları arasında olmalıdır.')

const hoursSchema = (label: string) =>
  z
    .number(`${label} sayı olmalıdır.`)
    .int(`${label} tam sayı olmalıdır.`)
    .min(0, `${label} eksi olamaz.`)
    .max(
      STAFF_COST_HOURS_MAX,
      `${label} ayda en çok ${String(STAFF_COST_HOURS_MAX)} saat olabilir.`,
    )
    .nullable()
    .default(null)

const shareSchema = z.strictObject({
  costCenterId: z.uuid('Maliyet merkezi seçin.').describe('Maliyet merkezi'),
  shareBasisPoints: z
    .number('Payı girin.')
    .int('Pay on binde bir cinsinden tam sayı olmalıdır.')
    .min(1, 'Pay sıfırdan büyük olmalıdır.')
    .max(STAFF_COST_SHARE_SCALE, "Pay %100'ü aşamaz.")
    .describe('Pay, on binde bir (10.000 = %100)'),
})
export type StaffCostShare = z.output<typeof shareSchema>

/** Yeni atama (DOM-FIN-104, K-332). */
export const staffCostAllocationInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: z
      .string('Personel seçin.')
      .trim()
      .min(1, 'Personel seçin.')
      .max(100, 'Personel geçersiz.')
      .describe('Atanan personelin kurum üyeliği'),
    startMonth: staffCostMonthSchema.describe('Yürürlük başlangıç ayı (YYYY-MM)'),
    shares: z
      .array(shareSchema, 'Maliyet merkezi payları liste olmalıdır.')
      .min(1, 'En az bir maliyet merkezi seçin.')
      .max(
        STAFF_COST_MAX_CENTERS,
        `En çok ${String(STAFF_COST_MAX_CENTERS)} maliyet merkezi seçilebilir.`,
      )
      .describe('Merkez payları; toplam 10.000 (%100), merkez tekrarlanmaz'),
    wageHours: hoursSchema('Ana ücretin aylık saati').describe(
      'Saatlik ya da ders saati ücretli personelin tahmini aylık saati; boşsa ana ücret rapora girmez',
    ),
    extraLessonHours: hoursSchema('Aylık ek ders saati').describe(
      'Tahmini aylık ek ders saati; boşsa ek ders ücreti rapora girmez',
    ),
    dutyHours: hoursSchema('Aylık nöbet saati').describe(
      'Tahmini aylık nöbet saati; boşsa nöbet ücreti rapora girmez',
    ),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>()
    value.shares.forEach((share, index) => {
      if (seen.has(share.costCenterId))
        context.addIssue({
          code: 'custom',
          path: ['shares', index, 'costCenterId'],
          message: 'Bir maliyet merkezi atamada bir kez seçilir.',
        })
      seen.add(share.costCenterId)
    })
    const total = value.shares.reduce((sum, share) => sum + share.shareBasisPoints, 0)
    if (value.shares.length > 0 && total !== STAFF_COST_SHARE_SCALE)
      context.addIssue({
        code: 'custom',
        path: ['shares'],
        message: `Payların toplamı %100 olmalıdır (şu an ${shareLabel(total)}).`,
      })
  })
export type StaffCostAllocationInput = z.input<typeof staffCostAllocationInputSchema>
export type StaffCostAllocationFields = z.output<typeof staffCostAllocationInputSchema>

/** Atamayı iptal et (K-332): gerekçe 5–500 karakter. */
export const staffCostAllocationCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(STAFF_COST_CANCEL_REASON_MIN, 'İptal gerekçesini en az 5 karakterle yazın.')
    .max(
      STAFF_COST_CANCEL_REASON_MAX,
      `En fazla ${String(STAFF_COST_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .describe('İptal gerekçesi; denetim kaydına yazılmaz'),
})
export type StaffCostAllocationCancelFields = z.output<typeof staffCostAllocationCancelSchema>

// --- Ay ------------------------------------------------------------------------------------------

/** Ayın ilk günü (`YYYY-MM-01`); veritabanında yürürlük başlangıcı bu gündür. */
export const monthStart = (month: string) => `${month}-01`

/** Gün ya da ayın ayı (`YYYY-MM`). */
export const monthOf = (day: string) => day.slice(0, 7)

/** Ayın gün sayısı (takvim; saat dilimi yok). */
export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, index, 0)).getUTCDate()
}

/** Ayın son günü (`YYYY-MM-DD`). */
export const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`

/** Sonraki ay. */
export function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  return index === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(index + 1).padStart(2, '0')}`
}

/** `from`…`to` arasındaki aylar (ikisi dahil, artan). */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  for (let month = from; month <= to; month = nextMonth(month)) months.push(month)
  return months
}

const monthFormatter = new Intl.DateTimeFormat('tr-TR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
/** "Ekim 2026". */
export const monthLabel = (month: string) =>
  monthFormatter.format(new Date(`${month}-15T00:00:00Z`))

/** Dönem metni: tek ay ya da "Ocak 2026 – Mart 2026". */
export const monthRangeLabel = (from: string, to: string) =>
  from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`

const percent = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })
/** Pay metni: 6000 → "%60", 3333 → "%33,33". */
export const shareLabel = (basisPoints: number) => `%${percent.format(basisPoints / 100)}`

/** Rapor dönemi: `from` ≤ `to`, en çok 12 ay (400 alan yolu ve mesajı). */
export function staffCostRangeIssue(from: string, to: string): string | null {
  if (to < from) return 'Bitiş ayı başlangıç ayından önce olamaz.'
  if (monthsBetween(from, to).length > STAFF_COST_MAX_MONTHS)
    return `Dönem en çok ${String(STAFF_COST_MAX_MONTHS)} ay olabilir.`
  return null
}

// --- Yürürlük ------------------------------------------------------------------------------------

/** Yürürlük ayı olan atama (saklanan satırın ilgili alanı). */
export interface StaffCostAllocationPeriod {
  membershipId: string
  startMonth: string
}

/** `month` ayında yürürlükteki atama: başlangıcı aya eşit ya da önce olan en geç atama. */
export function allocationInMonth<T extends StaffCostAllocationPeriod>(
  allocations: readonly T[],
  month: string,
): T | null {
  let found: T | null = null
  for (const allocation of allocations)
    if (
      allocation.startMonth <= month &&
      (found === null || allocation.startMonth > found.startMonth)
    )
      found = allocation
  return found
}

/** Atamanın bitiş ayı: aynı personelin sonraki atamasından bir önceki ay; yoksa `null` (süresiz). */
export function allocationEndMonth<T extends StaffCostAllocationPeriod>(
  allocation: T,
  allocations: readonly T[],
): string | null {
  let next: string | null = null
  for (const other of allocations)
    if (
      other.membershipId === allocation.membershipId &&
      other.startMonth > allocation.startMonth &&
      (next === null || other.startMonth < next)
    )
      next = other.startMonth
  if (next === null) return null
  const year = Number(next.slice(0, 4))
  const index = Number(next.slice(5, 7))
  return index === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(index - 1).padStart(2, '0')}`
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: (string | number)[]) =>
  new DomainError(code, message, { kind: 'rule', path: path.map(String) })

/** Yeni atamanın denetimi için servis kurum kilidi altında yükler. */
export interface StaffCostAllocationChecks {
  /** Üyelik: kurumda yoksa `null`. */
  staff: { role: string } | null
  /** Kurumun arşivlenmemiş maliyet merkezleri. */
  centers: ReadonlyMap<string, { isActive: boolean }>
  /** Personelin aynı başlangıç aylı iptal edilmemiş ataması var mı. */
  monthTaken: boolean
}

/**
 * Yeni atama (DOM-FIN-104, K-332). Personel kurumun yönetici, öğretmen ya da ön büro üyeliğidir;
 * pasifleştirilmiş personele de atama yazılır (geçmiş ayların maliyeti için). Merkezler kurumun
 * etkin merkezleridir. Aynı ayda iptal edilmemiş ikinci atama yazılmaz (409): önce eski atama
 * iptal edilir. Başlangıç geçmiş ay olabilir; sonraki atamalar yerinde kalır.
 */
export function planStaffCostAllocation(
  input: StaffCostAllocationFields,
  checks: StaffCostAllocationChecks,
): void {
  if (checks.staff === null)
    throw ruleError('staff_cost_staff_not_found', 'Personel bulunamadı.', ['membershipId'])
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'staff_cost_not_staff',
      'Maliyet merkezine yalnız personel (yönetici, öğretmen, ön büro) atanır.',
      ['membershipId'],
    )
  input.shares.forEach((share, index) => {
    const center = checks.centers.get(share.costCenterId)
    if (center === undefined)
      throw ruleError('staff_cost_center_not_found', 'Maliyet merkezi bulunamadı.', [
        'shares',
        index,
        'costCenterId',
      ])
    if (!center.isActive)
      throw ruleError('staff_cost_center_inactive', 'Pasif maliyet merkezine atama yapılmaz.', [
        'shares',
        index,
        'costCenterId',
      ])
  })
  if (checks.monthTaken)
    throw new DomainError(
      'staff_cost_allocation_exists',
      'Bu personelin bu aydan başlayan bir ataması var. Değiştirmek için önce onu iptal edin.',
      { kind: 'conflict', path: ['startMonth'] },
    )
}
