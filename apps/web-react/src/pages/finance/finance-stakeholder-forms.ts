// Paydaş ve sponsorluk anlaşması formları (DOM-FIN-102; ON-262). Alan kuralları core
// şemalarındandır; boş bırakılabilen alan formda boş metin, gövdede `null` olur. Tutar formda
// `1.234,56` metnidir, gövdede kuruş. Etiketler formda virgülle ayrılmış tek metindir.
import { z } from 'zod'
import type {
  AgreementDetail,
  AgreementRow,
  CreateAgreementBody,
  CreateStakeholderBody,
  StakeholderDetail,
  UpdateAgreementBody,
  UpdateStakeholderBody,
} from '@kampus/react-shared/use-finance-stakeholders.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  AGREEMENT_AMOUNT_MAX_CENTS,
  AGREEMENT_BENEFITS,
  AGREEMENT_DESCRIPTION_MIN,
  AGREEMENT_NOTICE_DAYS_DEFAULT,
  AGREEMENT_NOTICE_DAYS_MAX,
  AGREEMENT_VIEW_STATUS_LABELS,
  CONTRIBUTION_TYPES,
  STAKEHOLDER_TAGS_MAX,
  STAKEHOLDER_TYPES,
  contributionSummary,
  normalizeStakeholderTag,
  stakeholderAgreementSchema,
  stakeholderSchema,
  terminateStakeholderAgreementSchema,
  type AgreementViewStatus,
} from '@kampus/school-core/lib/finance-stakeholders.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Boşsa geçerli, doluysa core alan şemasıyla denetlenen isteğe bağlı metin. */
const optionalText = (schema: z.ZodType) =>
  z.string().superRefine((value, context) => {
    const text = value.trim()
    if (text === '') return
    const parsed = schema.safeParse(text)
    if (!parsed.success)
      context.addIssue({
        code: 'custom',
        message: parsed.error.issues[0]?.message ?? 'Geçerli bir değer girin.',
      })
  })

/** Virgülle ayrılmış etiketler; boş parçalar atılır, yinelenen tek sayılır. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map(normalizeStakeholderTag)
        .filter((tag) => tag !== ''),
    ),
  ]
}

// --- Paydaş --------------------------------------------------------------------------------------

const shape = stakeholderSchema.shape

export const stakeholderFormSchema = z.object({
  name: shape.name,
  type: z.enum(STAKEHOLDER_TYPES, 'Paydaş türünü seçin.'),
  taxNumber: optionalText(shape.taxNumber),
  contactName: optionalText(shape.contactName),
  contactEmail: optionalText(shape.contactEmail),
  contactPhone: optionalText(shape.contactPhone),
  tags: z.string().superRefine((value, context) => {
    const tags = parseTags(value)
    if (tags.length > STAKEHOLDER_TAGS_MAX)
      context.addIssue({
        code: 'custom',
        message: `En fazla ${String(STAKEHOLDER_TAGS_MAX)} etiket eklenebilir.`,
      })
    const parsed = shape.tags.safeParse(tags)
    if (tags.length <= STAKEHOLDER_TAGS_MAX && !parsed.success)
      context.addIssue({
        code: 'custom',
        message: parsed.error.issues[0]?.message ?? 'Etiket geçersiz.',
      })
  }),
})
export type StakeholderFormValues = z.input<typeof stakeholderFormSchema>

export function stakeholderDefaults(stakeholder?: StakeholderDetail): StakeholderFormValues {
  return {
    name: stakeholder?.name ?? '',
    type: stakeholder?.type ?? 'sponsor',
    taxNumber: stakeholder?.taxNumber ?? '',
    contactName: stakeholder?.contactName ?? '',
    contactEmail: stakeholder?.contactEmail ?? '',
    contactPhone: stakeholder?.contactPhone ?? '',
    tags: (stakeholder?.tags ?? []).join(', '),
  }
}

export function stakeholderBody(values: StakeholderFormValues): CreateStakeholderBody {
  return {
    name: values.name.trim(),
    type: values.type,
    taxNumber: blankToNull(values.taxNumber),
    contactName: blankToNull(values.contactName),
    contactEmail: blankToNull(values.contactEmail),
    contactPhone: blankToNull(values.contactPhone),
    tags: parseTags(values.tags),
  }
}

/** Düzeltmede yalnız değişen alanlar gider; değişiklik yoksa boş nesne. */
export function stakeholderChanges(
  values: StakeholderFormValues,
  stakeholder: StakeholderDetail,
): UpdateStakeholderBody {
  const next = stakeholderBody(values)
  const before = stakeholderBody(stakeholderDefaults(stakeholder))
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof CreateStakeholderBody)[])
    if (JSON.stringify(next[key]) !== JSON.stringify(before[key])) changes[key] = next[key]
  return changes as UpdateStakeholderBody
}

export const stakeholderFormField = (name: string): keyof StakeholderFormValues | undefined => {
  const first = name.split('.')[0] ?? name
  return (Object.keys(stakeholderFormSchema.shape) as (keyof StakeholderFormValues)[]).find(
    (field) => field === first,
  )
}

// --- Anlaşma -------------------------------------------------------------------------------------

const agreementShape = stakeholderAgreementSchema.shape
const AMOUNT_MESSAGE = 'Tutarı 1.234,56 biçiminde, sıfırdan büyük girin.'
const parseAmount = (text: string) =>
  parseAmountInput(text, { maxCents: AGREEMENT_AMOUNT_MAX_CENTS })

/** Bildirim günü metni: 0–365 tam sayı; geçersizse `null`. */
export function parseNoticeDays(text: string): number | null {
  const value = text.trim()
  if (!/^\d{1,3}$/.test(value)) return null
  const days = Number(value)
  return days <= AGREEMENT_NOTICE_DAYS_MAX ? days : null
}

export const agreementFormSchema = z
  .object({
    subject: agreementShape.subject,
    startDate: daySchema,
    endDate: daySchema,
    renewalNoticeDays: z
      .string()
      .refine((value) => parseNoticeDays(value) !== null, 'Bildirim gününü 0–365 arası girin.'),
    contributionType: z.enum(CONTRIBUTION_TYPES, 'Katkı türünü seçin.'),
    amount: z
      .string()
      .refine((value) => value.trim() === '' || parseAmount(value) !== null, AMOUNT_MESSAGE),
    contributionDescription: z.string().max(500, 'En fazla 500 karakter girebilirsiniz.'),
    benefits: z.array(z.enum(AGREEMENT_BENEFITS)),
    benefitNote: z.string().max(300, 'En fazla 300 karakter girebilirsiniz.'),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
    if (value.contributionType === 'cash' && value.amount.trim() === '')
      context.addIssue({ code: 'custom', path: ['amount'], message: 'Nakdi katkıda tutarı girin.' })
    if (
      value.contributionType !== 'cash' &&
      value.contributionDescription.trim().length < AGREEMENT_DESCRIPTION_MIN
    )
      context.addIssue({
        code: 'custom',
        path: ['contributionDescription'],
        message: 'Ayni ya da hizmet katkısını en az 3 karakterle açıklayın.',
      })
  })
export type AgreementFormValues = z.input<typeof agreementFormSchema>

/** Yeni anlaşmada bugün başlar, bir yıl sürer; düzeltmede anlaşmanın değerleri. */
export function agreementDefaults(today: string, agreement?: AgreementDetail): AgreementFormValues {
  if (!agreement) {
    const year = Number(today.slice(0, 4))
    return {
      subject: '',
      startDate: today,
      endDate: `${String(year + 1)}${today.slice(4)}`,
      renewalNoticeDays: String(AGREEMENT_NOTICE_DAYS_DEFAULT),
      contributionType: 'cash',
      amount: '',
      contributionDescription: '',
      benefits: [],
      benefitNote: '',
    }
  }
  return {
    subject: agreement.subject,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    renewalNoticeDays: String(agreement.renewalNoticeDays),
    contributionType: agreement.contributionType,
    amount:
      agreement.contributionAmountCents === null
        ? ''
        : amountInputValue(agreement.contributionAmountCents),
    contributionDescription: agreement.contributionDescription ?? '',
    benefits: agreement.benefits,
    benefitNote: agreement.benefitNote ?? '',
  }
}

/** Dosya alanı formun dışındadır (yükleme alanı); kimliği ayrıca verilir. */
export function agreementBody(
  values: AgreementFormValues,
  contractFileId: string | null,
): CreateAgreementBody {
  return {
    subject: values.subject.trim(),
    startDate: values.startDate,
    endDate: values.endDate,
    renewalNoticeDays: parseNoticeDays(values.renewalNoticeDays) ?? AGREEMENT_NOTICE_DAYS_DEFAULT,
    contributionType: values.contributionType,
    contributionAmountCents: values.amount.trim() === '' ? null : parseAmount(values.amount),
    contributionDescription: blankToNull(values.contributionDescription),
    benefits: values.benefits,
    benefitNote: blankToNull(values.benefitNote),
    contractFileId,
  }
}

export function agreementChanges(
  values: AgreementFormValues,
  contractFileId: string | null,
  agreement: AgreementDetail,
  today: string,
): UpdateAgreementBody {
  const next = agreementBody(values, contractFileId)
  const before = agreementBody(agreementDefaults(today, agreement), agreement.contractFileId)
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof CreateAgreementBody)[])
    if (JSON.stringify(next[key]) !== JSON.stringify(before[key])) changes[key] = next[key]
  return changes as UpdateAgreementBody
}

/** Sunucu alan yolu form alanına (`contributionAmountCents` → `amount`). */
export function agreementFormField(name: string): keyof AgreementFormValues | undefined {
  if (name === 'contributionAmountCents') return 'amount'
  return (Object.keys(agreementFormSchema.shape) as (keyof AgreementFormValues)[]).find(
    (field) => field === name,
  )
}

export const terminateFormSchema = z.object({
  terminationDate: daySchema,
  reason: terminateStakeholderAgreementSchema.shape.reason,
})
export type TerminateFormValues = z.input<typeof terminateFormSchema>

// --- Gösterim ------------------------------------------------------------------------------------

export const AGREEMENT_STATUS_VIEW: Readonly<
  Record<AgreementViewStatus, { label: string; tone: BadgeTone }>
> = {
  draft: { label: AGREEMENT_VIEW_STATUS_LABELS.draft, tone: 'gray' },
  active: { label: AGREEMENT_VIEW_STATUS_LABELS.active, tone: 'green' },
  ended: { label: AGREEMENT_VIEW_STATUS_LABELS.ended, tone: 'purple' },
  terminated: { label: AGREEMENT_VIEW_STATUS_LABELS.terminated, tone: 'red' },
}

/** Bitişe kalan gün metni; yalnız yürürlükteki anlaşmada. */
export function remainingText(agreement: Pick<AgreementRow, 'daysLeft'>): string {
  if (agreement.daysLeft === null) return ''
  if (agreement.daysLeft === 0) return 'Bugün bitiyor'
  return `${String(agreement.daysLeft)} gün kaldı`
}

export const contributionText = (
  agreement: Pick<
    AgreementRow,
    'contributionType' | 'contributionAmountCents' | 'contributionDescription'
  >,
) => contributionSummary(agreement, money)
