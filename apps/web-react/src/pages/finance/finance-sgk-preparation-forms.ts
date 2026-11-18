import { z } from 'zod'
import type {
  CreateSgkEmploymentDatesBody,
  CreateSgkMissingDayBody,
  SgkPreparationRow,
} from '@kampus/react-shared/use-finance-sgk-preparation.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  SGK_FULL_MONTH_DAYS,
  SGK_NOTE_MAX,
  SGK_SELECTABLE_REASON_CODES,
  SGK_WARNING_LABELS,
  previousSgkMonth,
  sgkReasonLabel,
  sgkMonthSchema,
  type SgkReasonCode,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'

// SGK hazırlık listesi formları ve gösterimi (DOM-FIN-107; ON-203). Form değerleri metindir;
// gövde core şemasının biçimine burada çevrilir, kural sunucuda yeniden denetlenir.

/** Varsayılan ay: bildirge bir önceki ay için hazırlanır. */
export const defaultSgkMonth = (today: string) => previousSgkMonth(today.slice(0, 7))

/** Seçilen ay geçerliyse kendisi, değilse `null` (istek atılmaz). */
export const validSgkMonth = (value: string) =>
  sgkMonthSchema.safeParse(value).success ? value : null

const NO_REASON = ''
const note = z
  .string()
  .trim()
  .max(SGK_NOTE_MAX, `En fazla ${String(SGK_NOTE_MAX)} karakter girebilirsiniz.`)

export const sgkMissingDayFormSchema = z.object({
  days: z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, 'Eksik gün sayısını 1 ile 30 arasında girin.')
    .refine((value) => {
      const days = Number(value)
      return days >= 1 && days <= SGK_FULL_MONTH_DAYS
    }, 'Eksik gün sayısını 1 ile 30 arasında girin.'),
  reasonCode: z.union([z.literal(NO_REASON), z.enum(SGK_SELECTABLE_REASON_CODES)]),
  note,
})
export type SgkMissingDayFormValues = z.infer<typeof sgkMissingDayFormSchema>
export const SGK_MISSING_DAY_DEFAULTS: SgkMissingDayFormValues = {
  days: '',
  reasonCode: NO_REASON,
  note: '',
}

export function sgkMissingDayBody(
  membershipId: string,
  month: string,
  values: SgkMissingDayFormValues,
): CreateSgkMissingDayBody {
  return {
    membershipId,
    month,
    days: Number(values.days),
    reasonCode: values.reasonCode === NO_REASON ? null : values.reasonCode,
    note: values.note.trim() === '' ? null : values.note.trim(),
  }
}

const optionalDay = z.union([z.literal(''), daySchema])

/** Giriş/çıkış formu: en az biri, ikisi de seçilen ayın içinde, çıkış girişten önce değil. */
export function sgkEmploymentDatesFormSchema(month: string) {
  return z
    .object({ entryDate: optionalDay, exitDate: optionalDay, note })
    .superRefine((value, context) => {
      if (value.entryDate === '' && value.exitDate === '') {
        context.addIssue({
          code: 'custom',
          path: ['entryDate'],
          message: 'Giriş ya da çıkış gününden en az birini girin.',
        })
        return
      }
      for (const key of ['entryDate', 'exitDate'] as const)
        if (value[key] !== '' && value[key].slice(0, 7) !== month)
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'Gün seçilen ayın içinde olmalıdır.',
          })
      if (value.entryDate !== '' && value.exitDate !== '' && value.exitDate < value.entryDate)
        context.addIssue({
          code: 'custom',
          path: ['exitDate'],
          message: 'Çıkış günü giriş gününden önce olamaz.',
        })
    })
}
export type SgkEmploymentDatesFormValues = z.infer<ReturnType<typeof sgkEmploymentDatesFormSchema>>

export function sgkEmploymentDatesBody(
  membershipId: string,
  month: string,
  values: SgkEmploymentDatesFormValues,
): CreateSgkEmploymentDatesBody {
  return {
    membershipId,
    month,
    entryDate: values.entryDate === '' ? null : values.entryDate,
    exitDate: values.exitDate === '' ? null : values.exitDate,
    note: values.note.trim() === '' ? null : values.note.trim(),
  }
}

/** Sunucu alan hatasını forma eşler. */
export function sgkFormField<T extends string>(name: string, fields: readonly T[]): T | null {
  return (fields as readonly string[]).includes(name) ? (name as T) : null
}

/** "2 gün · 21 Diğer ücretsiz izin" ya da "2 gün · neden girilmemiş". */
export function sgkMissingEntryText(entry: {
  days: number
  reasonCode: SgkReasonCode | null
}): string {
  const reason = entry.reasonCode === null ? 'neden girilmemiş' : sgkReasonLabel(entry.reasonCode)
  return `${String(entry.days)} gün · ${reason}`
}

/** Uyarı satırı tonu: matrahı etkileyen uyarı turuncu, bilgi uyarısı mor. */
export function sgkWarningTone(code: SgkPreparationRow['warnings'][number]) {
  return code === 'entry_in_month' || code === 'exit_in_month'
    ? ('purple' as const)
    : ('amber' as const)
}

export const sgkWarningText = (code: SgkPreparationRow['warnings'][number]) =>
  SGK_WARNING_LABELS[code]
