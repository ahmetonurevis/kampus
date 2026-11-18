// Personel maliyet ataması formu ve gösterimi (DOM-FIN-104; ON-204, K-332). Form düz metindir: pay
// yüzde ("60", "33,33"), saat tam sayı ya da boş; gövdede pay on binde bir, saat sayı ya da `null`.
// Toplam %100 ve tekil merkez kuralı core `staffCostAllocationInputSchema` ile aynı mesajdır.
import { z } from 'zod'
import type {
  CreateStaffCostAllocationBody,
  StaffCostAllocation,
} from '@kampus/react-shared/use-finance-staff-costs.ts'
import {
  monthLabel,
  shareLabel,
  STAFF_COST_HOURS_MAX,
  STAFF_COST_MAX_CENTERS,
  STAFF_COST_SHARE_SCALE,
  staffCostMonthSchema,
} from '@kampus/school-core/lib/finance-staff-costs.ts'

const PERCENT = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*$/

/** "60" → 6000, "33,33" → 3333; geçersizse `null`. */
export function percentToBasisPoints(text: string): number | null {
  const match = PERCENT.exec(text)
  if (match === null) return null
  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  const value = whole * 100 + fraction
  return value >= 1 && value <= STAFF_COST_SHARE_SCALE ? value : null
}

/** 6000 → "60", 3333 → "33,33". */
export const basisPointsToPercent = (basisPoints: number) =>
  shareLabel(basisPoints).replace('%', '')

const HOURS = /^\s*\d{1,3}\s*$/
const hoursText = (label: string) =>
  z
    .string()
    .refine(
      (value) =>
        value.trim() === '' || (HOURS.test(value) && Number(value) <= STAFF_COST_HOURS_MAX),
      `${label} 0 ile ${String(STAFF_COST_HOURS_MAX)} arasında tam sayı olmalıdır.`,
    )
const hoursOf = (value: string) => (value.trim() === '' ? null : Number(value))

export const staffCostAllocationFormSchema = z
  .object({
    startMonth: staffCostMonthSchema,
    shares: z
      .array(
        z.object({
          costCenterId: z.string().min(1, 'Maliyet merkezi seçin.'),
          percent: z
            .string()
            .refine(
              (value) => percentToBasisPoints(value) !== null,
              'Payı 60 ya da 33,33 biçiminde, 0 ile 100 arasında girin.',
            ),
        }),
      )
      .min(1, 'En az bir maliyet merkezi seçin.')
      .max(
        STAFF_COST_MAX_CENTERS,
        `En çok ${String(STAFF_COST_MAX_CENTERS)} maliyet merkezi seçilebilir.`,
      ),
    wageHours: hoursText('Ana ücretin aylık saati'),
    extraLessonHours: hoursText('Aylık ek ders saati'),
    dutyHours: hoursText('Aylık nöbet saati'),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>()
    value.shares.forEach((share, index) => {
      if (share.costCenterId !== '' && seen.has(share.costCenterId))
        context.addIssue({
          code: 'custom',
          path: ['shares', index, 'costCenterId'],
          message: 'Bir maliyet merkezi atamada bir kez seçilir.',
        })
      seen.add(share.costCenterId)
    })
    const points = value.shares.map((share) => percentToBasisPoints(share.percent))
    if (points.some((point) => point === null)) return
    const total = points.reduce<number>((sum, point) => sum + (point ?? 0), 0)
    if (total !== STAFF_COST_SHARE_SCALE)
      context.addIssue({
        code: 'custom',
        path: ['root', 'server'],
        message: `Payların toplamı %100 olmalıdır (şu an ${shareLabel(total)}).`,
      })
  })
export type StaffCostAllocationFormValues = z.input<typeof staffCostAllocationFormSchema>

export function staffCostAllocationDefaults(
  month: string,
  current: StaffCostAllocation | null,
): StaffCostAllocationFormValues {
  const hours = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value)
  return {
    startMonth: month,
    shares:
      current === null || current.shares.length === 0
        ? [{ costCenterId: '', percent: '100' }]
        : current.shares.map((share) => ({
            costCenterId: share.costCenterId,
            percent: basisPointsToPercent(share.shareBasisPoints),
          })),
    wageHours: hours(current?.wageHours),
    extraLessonHours: hours(current?.extraLessonHours),
    dutyHours: hours(current?.dutyHours),
  }
}

export function staffCostAllocationBody(
  membershipId: string,
  values: StaffCostAllocationFormValues,
): CreateStaffCostAllocationBody {
  return {
    membershipId,
    startMonth: values.startMonth,
    shares: values.shares.map((share) => ({
      costCenterId: share.costCenterId,
      shareBasisPoints: percentToBasisPoints(share.percent) ?? 0,
    })),
    wageHours: hoursOf(values.wageHours),
    extraLessonHours: hoursOf(values.extraLessonHours),
    dutyHours: hoursOf(values.dutyHours),
  }
}

type FormPath =
  | 'startMonth'
  | 'wageHours'
  | 'extraLessonHours'
  | 'dutyHours'
  | `shares.${number}.costCenterId`
  | `shares.${number}.percent`

/** Sunucu alan yolu → form alanı; eşleşmeyen yol formun genel hatasıdır. */
export function staffCostFormField(path: string): FormPath | null {
  if (
    path === 'startMonth' ||
    path === 'wageHours' ||
    path === 'extraLessonHours' ||
    path === 'dutyHours'
  )
    return path
  const share = /^shares\.(\d+)\.(costCenterId|shareBasisPoints)$/.exec(path)
  if (share === null) return null
  const index = Number(share[1])
  return share[2] === 'costCenterId' ? `shares.${index}.costCenterId` : `shares.${index}.percent`
}

/** "LISE %60 · ORTA %40". */
export const sharesText = (allocation: Pick<StaffCostAllocation, 'shares'>) =>
  allocation.shares
    .map((share) => `${share.code} ${shareLabel(share.shareBasisPoints)}`)
    .join(' · ')

/** "Eylül 2026 – Ekim 2026" ya da "Eylül 2026 itibarıyla, süresiz". */
export const allocationPeriodText = (
  allocation: Pick<StaffCostAllocation, 'startMonth' | 'endMonth'>,
) =>
  allocation.endMonth === null
    ? `${monthLabel(allocation.startMonth)} itibarıyla, süresiz`
    : allocation.endMonth === allocation.startMonth
      ? monthLabel(allocation.startMonth)
      : `${monthLabel(allocation.startMonth)} – ${monthLabel(allocation.endMonth)}`

/** "Ek ders 12 sa · Nöbet 4 sa"; saat yoksa boş. */
export function allocationHoursText(
  allocation: Pick<StaffCostAllocation, 'wageHours' | 'extraLessonHours' | 'dutyHours'>,
): string {
  return [
    allocation.wageHours === null ? null : `Ana ücret ${String(allocation.wageHours)} sa`,
    allocation.extraLessonHours === null
      ? null
      : `Ek ders ${String(allocation.extraLessonHours)} sa`,
    allocation.dutyHours === null ? null : `Nöbet ${String(allocation.dutyHours)} sa`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}
