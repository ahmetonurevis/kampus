// Kesin kayıt formunun saf mantığı: lira ↔ kuruş, form şeması, API gövdesi, sınıf seçenekleri ve
// taksit önizlemesi. Kuralların kendisi core'dadır (`enrollProspect`, DOM-KAY-001, DOM-KAY-011,
// DOM-KAY-035); burada yalnız yanlış girişi sunucuya gitmeden yakalarız. Karar yine sunucudadır
// (kontenjan, aday aşaması, ödeme tarihi).
import { z } from 'zod'
import type { EnrollProspectBody } from '@kampus/react-shared/use-prospect-commands.ts'
import { installmentAmounts } from '@kampus/school-core/lib/domain.ts'

/** Tutar sınırı tam lira ve taksit sayısı sınırı (API: 10.000–100.000.000 kuruş, 1–12 taksit). */
export const ENROLL_LIMITS = { minLira: 100, maxLira: 1_000_000, maxInstallments: 12 } as const

export const FRACTION_MESSAGE = 'Kuruşlu tutar girilemez; tutarı tam lira olarak yazın.'
export const LIRA_RANGE_MESSAGE = 'Tutar 100 ile 1.000.000 ₺ arasında olmalıdır.'

export type LiraResult = { ok: true; lira: number } | { ok: false; message: string }

/**
 * Kullanıcının yazdığı tam lirayı sayıya çevirir. `12500`, `12.500` (binlik ayraç) ve `12 500 ₺`
 * kabul edilir; virgül ya da tek/yarım ondalık (`12.5`, `12,50`) kuruş sayılır ve reddedilir.
 */
export function parseLira(input: string): LiraResult {
  const text = input.replace(/[\s₺]/g, '')
  if (text === '') return { ok: false, message: 'Eğitim bedelini girin.' }
  const digits = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll('.', '') : text
  if (!/^\d+$/.test(digits))
    return {
      ok: false,
      message: /[.,]/.test(digits) ? FRACTION_MESSAGE : 'Tutarı yalnız rakamlarla yazın.',
    }
  const lira = Number(digits)
  if (lira < ENROLL_LIMITS.minLira || lira > ENROLL_LIMITS.maxLira)
    return { ok: false, message: LIRA_RANGE_MESSAGE }
  return { ok: true, lira }
}

/** Tam lira → kuruş (`totalCents`); para her yerde tamsayı kuruştur. */
export const liraToCents = (lira: number) => lira * 100

/** `YYYY-MM-DD` gerçek bir takvim günü mü (30 Şubat gibi taşan tarihler geçersizdir). */
function isCalendarDay(value: string): boolean {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'İlk vade tarihini seçin.', abort: true })
  .refine(isCalendarDay, { message: 'Geçerli bir tarih seçin.', abort: true })

export const enrollFormSchema = z.object({
  classId: z.string().min(1, 'Sınıf seçin.'),
  total: z.string().superRefine((value, context) => {
    const result = parseLira(value)
    if (!result.ok) context.addIssue({ code: 'custom', message: result.message })
  }),
  count: z
    .string()
    .regex(/^\d+$/, { message: 'Taksit sayısını seçin.', abort: true })
    .refine((value) => Number(value) >= 1 && Number(value) <= ENROLL_LIMITS.maxInstallments, {
      message: 'Taksit sayısı 1 ile 12 arasında olmalıdır.',
    }),
  startDate: dateField,
})
export type EnrollFormValues = z.input<typeof enrollFormSchema>

export const enrollDefaults = (): EnrollFormValues => ({
  classId: '',
  total: '',
  count: '1',
  startDate: '',
})

/** Doğrulanmış form → API gövdesi; tutar yeniden ayrıştırılır, kuruşlu giriş buraya ulaşmaz. */
export function enrollBody(values: z.output<typeof enrollFormSchema>): EnrollProspectBody {
  const total = parseLira(values.total)
  if (!total.ok) throw new Error(total.message)
  return {
    classId: values.classId,
    totalCents: liraToCents(total.lira),
    count: Number(values.count),
    startDate: values.startDate,
  }
}

export const ENROLL_FIELDS = ['classId', 'total', 'count', 'startDate'] as const
export type EnrollField = (typeof ENROLL_FIELDS)[number]

/** API gövde yolu (ve form alanı adı) → form alanı (`totalCents` formda `total` lira alanıdır). */
const PATH_FIELDS: Readonly<Record<string, EnrollField>> = {
  classId: 'classId',
  total: 'total',
  totalCents: 'total',
  count: 'count',
  startDate: 'startDate',
}
/** Yolsuz gelen iş kuralı kodu → form alanı (kontenjan, ödeme tarihi). */
const CODE_FIELDS: Readonly<Record<string, EnrollField>> = {
  class_capacity_full: 'classId',
  amount_not_whole_lira: 'total',
  invalid_payment_date: 'startDate',
  invalid_installment: 'count',
}

export const enrollFieldOfPath = (path: string): EnrollField | undefined => PATH_FIELDS[path]
export const enrollFieldOfCode = (code: string): EnrollField | undefined => CODE_FIELDS[code]

// --- Sınıf seçici -------------------------------------------------------------------------

type ClassLike = {
  id: string
  name: string
  branchId: string
  capacity: number
  isActive: boolean
}
export type ClassOption = { id: string; label: string; full: boolean; branchId: string }

/**
 * Seçilebilir sınıflar: etkin sınıflar; varsayılan olarak yalnız adayın kampüsü, `allCampuses`
 * ile tüm kampüsler (kampüs eşleşmesinin sunucu kuralı D16d'dedir). Dolu sınıf listede kalır
 * ("Dolu" etiketli): seçilirse sunucu 422 `class_capacity_full` döner ve alanda gösterilir.
 */
export function classOptions(
  classes: readonly ClassLike[],
  occupancy: ReadonlyMap<string, number>,
  branchNames: ReadonlyMap<string, string>,
  prospectBranchId: string,
  allCampuses: boolean,
): ClassOption[] {
  const collator = new Intl.Collator('tr', { numeric: true })
  return classes
    .filter((item) => item.isActive && (allCampuses || item.branchId === prospectBranchId))
    .sort(
      (a, b) =>
        collator.compare(branchNames.get(a.branchId) ?? '', branchNames.get(b.branchId) ?? '') ||
        collator.compare(a.name, b.name),
    )
    .map((item) => {
      const count = occupancy.get(item.id) ?? 0
      const full = count >= item.capacity
      const branch = branchNames.get(item.branchId) ?? '—'
      return {
        id: item.id,
        branchId: item.branchId,
        full,
        label: `${item.name} · ${branch} · ${count}/${item.capacity}${full ? ' · Dolu' : ''}`,
      }
    })
}

// --- Taksit önizlemesi --------------------------------------------------------------------

export type InstallmentPreview = { count: number; first: number; last: number; total: number }

/** Taksitlerin dağılımı (kuruş farkı ilk taksitlere eklenir, core `installmentAmounts`). */
export function installmentPreview(totalCents: number, count: number): InstallmentPreview {
  const amounts = installmentAmounts(totalCents, count)
  return {
    count,
    first: amounts[0] ?? 0,
    last: amounts[amounts.length - 1] ?? 0,
    total: totalCents,
  }
}
