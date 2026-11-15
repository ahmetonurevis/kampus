// Bütçe taslağı formları (DOM-FIN-093; ON-243). Alan kuralları core şemalarındandır; tutar formda
// `1.234,56` metnidir, gönderimde kuruşa, boş gerekçe `null`'a çevrilir.
import { z } from 'zod'
import type {
  BudgetDraftDetail,
  BudgetDraftLinesBody,
  CreateBudgetDraftBody,
} from '@kampus/react-shared/use-finance-budget-drafts.ts'
import {
  BUDGET_DRAFT_LINES_MAX,
  BUDGET_DRAFT_STATUS_LABELS,
  BUDGET_DRAFT_TEXT_MAX,
  budgetDraftReasonSchema,
  type BudgetDraftStatus,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'
import { amountInputValue } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { parseBudgetAmount } from './finance-budget-forms.ts'

/** Ayrıntı paneli adres parametresi (`?taslak=`). */
export const BUDGET_DRAFT_PANEL = 'taslak'

export const BUDGET_DRAFT_STATUS_VIEW: Readonly<
  Record<BudgetDraftStatus, { label: string; tone: BadgeTone }>
> = {
  draft: { label: BUDGET_DRAFT_STATUS_LABELS.draft, tone: 'gray' },
  submitted: { label: BUDGET_DRAFT_STATUS_LABELS.submitted, tone: 'amber' },
  approved: { label: BUDGET_DRAFT_STATUS_LABELS.approved, tone: 'green' },
  revision_requested: { label: BUDGET_DRAFT_STATUS_LABELS.revision_requested, tone: 'purple' },
  rejected: { label: BUDGET_DRAFT_STATUS_LABELS.rejected, tone: 'red' },
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())
const textMax = z
  .string()
  .max(BUDGET_DRAFT_TEXT_MAX, `En fazla ${String(BUDGET_DRAFT_TEXT_MAX)} karakter girebilirsiniz.`)

// --- Yeni taslak ---------------------------------------------------------------------------------

export const createDraftFormSchema = z.object({
  periodId: z.string().min(1, 'Bütçe dönemi seçin.'),
  costCenterId: z.string().min(1, 'Birim seçin.'),
})
export type CreateDraftFormValues = z.input<typeof createDraftFormSchema>
export const createDraftBody = (values: CreateDraftFormValues): CreateBudgetDraftBody => ({
  periodId: values.periodId,
  costCenterId: values.costCenterId,
})
export const createDraftFormField = (name: string) =>
  (['periodId', 'costCenterId'] as const).find((field) => field === name)

// --- Satırlar ------------------------------------------------------------------------------------

const AMOUNT_MESSAGE = 'Tutarı 1.234,56 biçiminde girin (en fazla 10.000.000.000 ₺).'

export const linesFormSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1, 'Kalem seçin.'),
        amount: z
          .string()
          .refine((value) => parseBudgetAmount(value) !== null, { message: AMOUNT_MESSAGE }),
        justification: textMax,
      }),
    )
    .max(
      BUDGET_DRAFT_LINES_MAX,
      `Taslak en çok ${String(BUDGET_DRAFT_LINES_MAX)} kalem içerebilir.`,
    )
    .superRefine((lines, context) => {
      const seen = new Set<string>()
      lines.forEach((line, index) => {
        if (line.itemId !== '' && seen.has(line.itemId))
          context.addIssue({
            code: 'custom',
            path: [index, 'itemId'],
            message: 'Bu kalem taslakta zaten var.',
          })
        seen.add(line.itemId)
      })
    }),
})
export type LinesFormValues = z.input<typeof linesFormSchema>
export type LineFormValues = LinesFormValues['lines'][number]

export const emptyLine = (): LineFormValues => ({ itemId: '', amount: '0', justification: '' })

export const linesDefaults = (draft: Pick<BudgetDraftDetail, 'lines'>): LinesFormValues => ({
  lines: draft.lines.map((line) => ({
    itemId: line.itemId,
    amount: amountInputValue(line.amountCents),
    justification: line.justification ?? '',
  })),
})

export const linesBody = (values: LinesFormValues): BudgetDraftLinesBody => ({
  lines: values.lines.map((line) => ({
    itemId: line.itemId,
    amountCents: parseBudgetAmount(line.amount) ?? 0,
    justification: blankToNull(line.justification),
  })),
})

/**
 * Sunucu alan yolu (`lines.2.amountCents`) form alanına çevrilir; `amountCents` → `amount`.
 * Satır dışı yol `lines` kök hatasıdır, bilinmeyen yol formun kök hatası (`undefined`).
 */
export function linesFormField(
  name: string,
):
  | `lines.${number}.itemId`
  | `lines.${number}.amount`
  | `lines.${number}.justification`
  | 'lines'
  | undefined {
  const match = /^lines\.(\d+)\.(itemId|amountCents|justification)$/.exec(name)
  if (match) {
    const index = Number(match[1])
    const field = match[2] === 'amountCents' ? 'amount' : (match[2] as 'itemId' | 'justification')
    return `lines.${index}.${field}`
  }
  return name === 'lines' || name.startsWith('lines.') ? 'lines' : undefined
}

// --- Karar ve not --------------------------------------------------------------------------------

export const reasonFormSchema = z.object({ reason: budgetDraftReasonSchema.shape.reason })
export type ReasonFormValues = z.input<typeof reasonFormSchema>
export const noteFormSchema = z.object({ note: textMax })
export type NoteFormValues = z.input<typeof noteFormSchema>
export const noteBody = (values: NoteFormValues) => ({ note: blankToNull(values.note) })

// --- Görünüm -------------------------------------------------------------------------------------

/** Sorumlunun adı; atanmamışsa yönetici hazırlar (K-257). */
export const ownerText = (owner: { name: string | null } | null) =>
  owner === null ? 'Sorumlu yok (yönetici hazırlar)' : (owner.name ?? 'Personel')

/** Dosya adı için güvenli parça. */
export const fileSlug = (text: string) =>
  text
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
