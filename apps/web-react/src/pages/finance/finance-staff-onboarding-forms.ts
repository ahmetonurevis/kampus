// İş teklifi ve işe başlama listesi formları ve gösterimi (DOM-FIN-121; ON-179). Teklif formu
// tek düz nesnedir; ücret formda `45.000,00` metni, gövdede kuruştur. Aday iletişimi yalnız aday
// personel değilse gönderilir. Sınırlar ve mesajlar core şemalarındandır (K-412…K-414).
import { z } from 'zod'
import type {
  CreateJobOfferBody,
  JobOfferDetail,
  JobOfferRow,
  OnboardingStep,
} from '@kampus/react-shared/use-finance-staff-onboarding.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { PAY_RATE_AMOUNT_MAX_CENTS, WAGE_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  CANDIDATE_NAME_MAX,
  JOB_OFFER_NOTE_MAX,
  JOB_POSITION_MAX,
  ONBOARDING_STATE_LABELS,
  ONBOARDING_STEP_LABEL_MAX,
  ORIENTATION_STEPS_MAX,
  type EvidenceState,
  type JobOfferStatus,
  type OnboardingState,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

/** Gün gösterimi: "2 Kas 2026". */
export const dayText = (day: string | null) =>
  day === null ? '—' : dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export const STATUS_TONES = {
  draft: 'purple',
  sent: 'amber',
  accepted: 'green',
  rejected: 'red',
  withdrawn: 'red',
} as const satisfies Record<JobOfferStatus, string>

export const ONBOARDING_TONES = {
  none: 'purple',
  open: 'amber',
  completed: 'green',
  closed: 'red',
} as const satisfies Record<OnboardingState, string>

export const EVIDENCE_TONES = {
  met: 'green',
  missing: 'red',
  manual: 'purple',
} as const satisfies Record<EvidenceState, string>

export const EVIDENCE_LABELS = {
  met: 'Kaynak var',
  missing: 'Kaynak yok',
  manual: 'Elle',
} as const satisfies Record<EvidenceState, string>

/** Listedeki ilerleme metni: "3/10 zorunlu adım" ya da durum adı. */
export function onboardingText(row: Pick<JobOfferRow, 'onboarding'>): string {
  const { state, requiredDone, requiredTotal } = row.onboarding
  if (state === 'open') return `${String(requiredDone)}/${String(requiredTotal)} zorunlu adım`
  return state === 'none' ? '—' : ONBOARDING_STATE_LABELS[state]
}

/** Adım ayrıntısı: zorunluluk, son gün, sorumlu, tamamlanma. */
export function stepMetaText(step: OnboardingStep): string {
  const parts = [step.required ? 'Zorunlu' : 'İsteğe bağlı']
  if (step.dueDate !== null) parts.push(`son gün ${dayText(step.dueDate)}`)
  parts.push(step.responsible === null ? 'sorumlu yok' : `sorumlu ${step.responsible.name}`)
  if (step.completedOn !== null) parts.push(`tamamlandı ${dayText(step.completedOn)}`)
  return parts.join(' · ')
}

const parseAmount = (text: string) =>
  parseAmountInput(text, { maxCents: PAY_RATE_AMOUNT_MAX_CENTS })

export const offerFormSchema = z
  .object({
    candidateKind: z.enum(['candidate', 'staff']),
    membershipId: z.string(),
    candidateName: z
      .string()
      .max(CANDIDATE_NAME_MAX, `Ad en çok ${String(CANDIDATE_NAME_MAX)} karakter olabilir.`),
    candidateEmail: z.string(),
    candidatePhone: z.string(),
    position: z
      .string()
      .trim()
      .min(2, 'Pozisyonu yazın.')
      .max(JOB_POSITION_MAX, `Pozisyon en çok ${String(JOB_POSITION_MAX)} karakter olabilir.`),
    staffRole: z.enum(STAFF_ROLES, 'Rolü seçin.'),
    startDate: daySchema,
    wageType: z.enum(WAGE_TYPES, 'Ücret türünü seçin.'),
    amount: z.string().refine((value) => parseAmount(value) !== null, {
      message: 'Tutarı 1.234,56 biçiminde, sıfırdan büyük girin (en fazla 10.000.000 ₺).',
    }),
    respondBy: z.string(),
    note: z
      .string()
      .max(JOB_OFFER_NOTE_MAX, `En fazla ${String(JOB_OFFER_NOTE_MAX)} karakter girebilirsiniz.`),
  })
  .superRefine((value, context) => {
    if (value.candidateKind === 'staff' && value.membershipId === '')
      context.addIssue({ code: 'custom', path: ['membershipId'], message: 'Personel seçin.' })
    if (value.candidateKind === 'candidate' && value.candidateName.trim().length < 2)
      context.addIssue({ code: 'custom', path: ['candidateName'], message: 'Adayın adını yazın.' })
  })
export type OfferFormValues = z.input<typeof offerFormSchema>

export function offerDefaults(today: string): OfferFormValues {
  return {
    candidateKind: 'candidate',
    membershipId: '',
    candidateName: '',
    candidateEmail: '',
    candidatePhone: '',
    position: '',
    staffRole: 'ogretmen',
    startDate: today,
    wageType: 'monthly_gross',
    amount: '',
    respondBy: '',
    note: '',
  }
}

const textOrNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Form → gövde: personel seçiliyse aday adı ve iletişimi gönderilmez. */
export function offerBody(values: OfferFormValues): CreateJobOfferBody {
  const staff = values.candidateKind === 'staff'
  return {
    membershipId: staff ? values.membershipId : null,
    candidateName: staff ? null : values.candidateName.trim(),
    candidateEmail: staff ? null : textOrNull(values.candidateEmail),
    candidatePhone: staff ? null : textOrNull(values.candidatePhone),
    position: values.position.trim(),
    staffRole: values.staffRole,
    startDate: values.startDate,
    wageType: values.wageType,
    offeredAmountCents: parseAmount(values.amount) ?? 0,
    respondBy: values.respondBy === '' ? null : values.respondBy,
    note: textOrNull(values.note),
  }
}

type OfferField = keyof OfferFormValues
const BODY_FIELDS: Readonly<Record<string, OfferField>> = {
  membershipId: 'membershipId',
  candidateName: 'candidateName',
  candidateEmail: 'candidateEmail',
  candidatePhone: 'candidatePhone',
  position: 'position',
  staffRole: 'staffRole',
  startDate: 'startDate',
  wageType: 'wageType',
  offeredAmountCents: 'amount',
  respondBy: 'respondBy',
  note: 'note',
}
/** Sunucu alanı → form alanı. */
export const offerFormField = (path: string): OfferField | undefined => BODY_FIELDS[path]

/** Taslak düzeltmesinde değişen alanlar (gövde); değişiklik yoksa boş nesne. */
export function offerChanges(offer: JobOfferDetail, values: OfferFormValues) {
  const next = offerBody({
    ...values,
    candidateKind: offer.membershipId === null ? 'candidate' : 'staff',
    membershipId: offer.membershipId ?? '',
  })
  const changes: Record<string, unknown> = {}
  const keys = [
    'candidateName',
    'candidateEmail',
    'candidatePhone',
    'position',
    'staffRole',
    'startDate',
    'wageType',
    'offeredAmountCents',
    'respondBy',
    'note',
  ] as const
  for (const key of keys) {
    if (offer.membershipId !== null && key.startsWith('candidate')) continue
    if (next[key] !== offer[key]) changes[key] = next[key]
  }
  return changes
}

/** Ayrıntıdan düzeltme formu. */
export function offerValues(offer: JobOfferDetail): OfferFormValues {
  return {
    candidateKind: offer.membershipId === null ? 'candidate' : 'staff',
    membershipId: offer.membershipId ?? '',
    candidateName: offer.candidateName ?? '',
    candidateEmail: offer.candidateEmail ?? '',
    candidatePhone: offer.candidatePhone ?? '',
    position: offer.position,
    staffRole: offer.staffRole,
    startDate: offer.startDate,
    wageType: offer.wageType,
    amount: (offer.offeredAmountCents / 100).toFixed(2).replace('.', ','),
    respondBy: offer.respondBy ?? '',
    note: offer.note ?? '',
  }
}

/** Oryantasyon ayarı satırları: boş satırlar atılır; ad sınırı core'dadır. */
export const orientationFormSchema = z.object({
  steps: z
    .array(
      z.object({
        label: z
          .string()
          .max(
            ONBOARDING_STEP_LABEL_MAX,
            `Adım adı en çok ${String(ONBOARDING_STEP_LABEL_MAX)} karakter olabilir.`,
          ),
        required: z.boolean(),
      }),
    )
    .max(ORIENTATION_STEPS_MAX, `En çok ${String(ORIENTATION_STEPS_MAX)} adım tanımlanabilir.`),
})
export type OrientationFormValues = z.input<typeof orientationFormSchema>

export function orientationBody(values: OrientationFormValues) {
  return {
    orientationSteps: values.steps
      .map((step) => ({ label: step.label.trim(), required: step.required }))
      .filter((step) => step.label !== ''),
  }
}

/**
 * Kaynak adımına hızlı işlem (K-412): ücret tanımı tekliften aktarılır, kıdem başlangıcı işe
 * başlama günü olur. Kıdem başlangıcı bugünden sonra girilemez (DOM-FIN-109).
 */
export function quickActionOf(
  step: OnboardingStep,
  offer: Pick<JobOfferDetail, 'membershipId' | 'startDate' | 'status'>,
  today: string,
): 'pay_rate' | 'seniority' | null {
  if (offer.status !== 'accepted' || offer.membershipId === null) return null
  if (step.completedOn !== null || step.evidence.state !== 'missing') return null
  if (step.kind === 'pay_rate') return 'pay_rate'
  if (step.kind === 'seniority' && offer.startDate <= today) return 'seniority'
  return null
}
