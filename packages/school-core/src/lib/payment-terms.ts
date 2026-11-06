import { z } from 'zod'

import { DomainError } from './errors.ts'
import { money } from './format.ts'

/**
 * Peşin ve süreli ödeme koşulu (docs/domain/finans.md DOM-FIN-002, DOM-FIN-013; ÖÖKY md. 54/1-a, d).
 * Koşullar tarifenin parçasıdır, yayımlanan sürümle birlikte donar. Taksit sayısı koşulu belirler:
 * aralıklar çakışmadığı için istemci koşul seçmez, sözleşme seçilen sayının koşulunu kopya taşır.
 *
 * Fiyat farkı yalnız indirim yönündedir, tutar ilan ücretinden düşer ve `DOM-FIN-021` tavanına
 * girer. Vade farkı alanı bilinçli olarak yoktur: süreli ödemede ilan ücretinin üstüne çıkılamaz.
 * Peşin indirimi ayrı alan değildir, tarifedeki `early_payment` indirim satırıdır (`DOM-FIN-020`).
 *
 * Koşulu olmayan tarife eski kayıttır: okunur ve eskisi gibi çalışır, sözleşmesine koşul yazılmaz.
 */

export const MIN_INSTALLMENTS = 1
export const MAX_INSTALLMENTS = 12

export const FEE_PAYMENT_TERM_KINDS = ['upfront', 'installment'] as const
export type FeePaymentTermKind = (typeof FEE_PAYMENT_TERM_KINDS)[number]

export const FEE_PAYMENT_TERM_KIND_LABELS: Readonly<Record<FeePaymentTermKind, string>> = {
  upfront: 'Peşin',
  installment: 'Süreli (taksitli)',
}

/** Süreli koşulun fiyat farkının sözleşmedeki indirim kalemi türü; tarifeden seçilmez. */
export const PAYMENT_TERM_DISCOUNT_KIND = 'payment_term'
export const PAYMENT_TERM_DISCOUNT_LABEL = 'Ödeme koşulu'

const installmentCount = z
  .number('Taksit sayısını girin.')
  .int('Taksit sayısı tam sayı olmalıdır.')
  .min(MIN_INSTALLMENTS, 'Taksit sayısı en az 1 olabilir.')
  .max(MAX_INSTALLMENTS, 'Taksit sayısı en fazla 12 olabilir.')

const termFields = {
  kind: z.enum(FEE_PAYMENT_TERM_KINDS, 'Ödeme koşulunu seçin.'),
  minInstallments: installmentCount,
  maxInstallments: installmentCount,
  /** Bu koşulun ilan ücretinden indirimi, on binde birlik; yoksa `null`. */
  discountPercentBasisPoints: z.number().int().min(1).max(10_000).nullable(),
  /** Bu koşulun ilan ücretinden indirimi, kuruş; yoksa `null`. */
  discountAmountCents: z.number().int().positive().max(100_000_000).nullable(),
}

export const feePaymentTermSchema = z.strictObject(termFields).superRefine((term, context) => {
  const issue = (path: string, message: string) =>
    context.addIssue({ code: 'custom', path: [path], message })
  if (term.discountPercentBasisPoints !== null && term.discountAmountCents !== null)
    issue('discountAmountCents', 'Fiyat farkı için oran veya tutardan yalnız birini girin.')
  if (term.kind === 'upfront') {
    if (term.minInstallments !== 1 || term.maxInstallments !== 1)
      issue('maxInstallments', 'Peşin koşulu tek ödemedir.')
    if (term.discountPercentBasisPoints !== null || term.discountAmountCents !== null)
      issue(
        'discountPercentBasisPoints',
        'Peşin indirimi ödeme koşulunda değil, "Peşin ödeme" indirim satırında ilan edilir.',
      )
    return
  }
  if (term.minInstallments < 2)
    issue('minInstallments', 'Süreli koşul en az 2 taksittir; tek ödeme peşin koşuludur.')
  if (term.maxInstallments < term.minInstallments)
    issue('maxInstallments', 'En çok taksit, en az taksitten küçük olamaz.')
})
export type FeePaymentTerm = z.output<typeof feePaymentTermSchema>

/** Sözleşmenin dayandığı koşulun kopyası ve seçilen taksit sayısı; tarife sonra değişse de kalır. */
export const contractPaymentTermSchema = z.strictObject({
  ...termFields,
  installmentCount,
})
export type ContractPaymentTerm = z.output<typeof contractPaymentTermSchema>

/** Aralıklar çakışmaz: aynı taksit sayısı iki koşula girerse sözleşmenin koşulu belirsiz kalır. */
export function assertPaymentTermsDistinct(terms: readonly FeePaymentTerm[]): void {
  const seen = new Set<number>()
  for (const [index, term] of terms.entries())
    for (let count = term.minInstallments; count <= term.maxInstallments; count += 1) {
      if (seen.has(count))
        throw new DomainError(
          'tariff_payment_term_overlap',
          'Ödeme koşullarının taksit aralıkları çakışamaz.',
          { path: ['paymentTerms', String(index)] },
        )
      seen.add(count)
    }
}

/**
 * Yayım denetimi (DOM-FIN-002, -013): ilan en az bir ödeme koşulu taşır; peşin indirimi ilan
 * edildiyse peşin koşulu da ilan edilmiştir.
 */
export function assertPaymentTermsPublishable(
  terms: readonly FeePaymentTerm[],
  discounts: readonly { kind: string }[],
): void {
  if (terms.length === 0)
    throw new DomainError(
      'tariff_payment_terms_required',
      'Tarifede peşin ya da süreli en az bir ödeme koşulu ilan edilmelidir.',
    )
  if (
    discounts.some((discount) => discount.kind === 'early_payment') &&
    !terms.some((term) => term.kind === 'upfront')
  )
    throw new DomainError(
      'tariff_early_payment_without_upfront',
      'Peşin ödeme indirimi için tarifede peşin koşulu da ilan edilmelidir.',
    )
}

/**
 * Taksit sayısının ilan edilen koşulu (DOM-FIN-013). Koşulsuz eski tarifede ya da sayı verilmemişse
 * `null`; ilanda olmayan sayı 422 `payment_term_not_in_tariff`.
 */
export function resolvePaymentTerm(
  terms: readonly FeePaymentTerm[] | undefined,
  count: number | undefined,
): ContractPaymentTerm | null {
  if (terms === undefined || terms.length === 0 || count === undefined) return null
  const term = terms.find((item) => count >= item.minInstallments && count <= item.maxInstallments)
  if (term === undefined)
    throw new DomainError(
      'payment_term_not_in_tariff',
      'Bu taksit sayısı tarifede ilan edilen ödeme koşullarında yok.',
      { path: ['installmentCount'] },
    )
  return { ...term, installmentCount: count }
}

/** Peşin indirimi yalnız peşin koşulunda uygulanır; koşulsuz eski tarifede kural aranmaz. */
export function assertEarlyPaymentOnUpfront(
  term: ContractPaymentTerm | null,
  discounts: readonly string[],
): void {
  if (term !== null && term.kind !== 'upfront' && discounts.includes('early_payment'))
    throw new DomainError(
      'early_payment_requires_upfront',
      'Peşin ödeme indirimi yalnız peşin koşuluyla uygulanır.',
      { path: ['discounts'] },
    )
}

/** Koşulun fiyat farkı; indirim gibi ilan ücretinden hesaplanır, zincirlenmez (DOM-FIN-020). */
export function paymentTermDiscountCents(
  term: Pick<ContractPaymentTerm, 'discountPercentBasisPoints' | 'discountAmountCents'> | null,
  grossCents: number,
): number {
  if (term === null) return 0
  return (
    term.discountAmountCents ??
    Math.floor((grossCents * (term.discountPercentBasisPoints ?? 0)) / 10_000)
  )
}

/** Forma sunulacak taksit sayıları; koşulsuz eski tarifede bütün aralık açıktır. */
export function offeredInstallmentCounts(terms: readonly FeePaymentTerm[] | undefined): number[] {
  const all = Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1)
  if (terms === undefined || terms.length === 0) return all
  return all.filter((count) =>
    terms.some((term) => count >= term.minInstallments && count <= term.maxInstallments),
  )
}

/** Formun başlangıç sayısı: tercih ilandaysa odur, değilse ilandaki en yüksek sayı. */
export function defaultInstallmentCount(
  terms: readonly FeePaymentTerm[] | undefined,
  preferred = 8,
): number {
  const offered = offeredInstallmentCounts(terms)
  return offered.includes(preferred) ? preferred : (offered.at(-1) ?? preferred)
}

function discountLabel(
  term: Pick<FeePaymentTerm, 'discountPercentBasisPoints' | 'discountAmountCents'>,
): string | null {
  if (term.discountAmountCents !== null) return `${money(term.discountAmountCents)} indirim`
  if (term.discountPercentBasisPoints === null) return null
  return `%${String(term.discountPercentBasisPoints / 100).replace('.', ',')} indirim`
}

/** Tarifede ilan edilen koşulun etiketi: "Peşin · tek ödeme", "Süreli · 2–8 taksit · %3 indirim". */
export function announcedPaymentTermLabel(term: FeePaymentTerm): string {
  if (term.kind === 'upfront') return 'Peşin · tek ödeme'
  const range =
    term.minInstallments === term.maxInstallments
      ? String(term.minInstallments)
      : `${String(term.minInstallments)}–${String(term.maxInstallments)}`
  const discount = discountLabel(term)
  return `Süreli · ${range} taksit${discount === null ? '' : ` · ${discount}`}`
}

/** Sözleşmenin koşulu: "Peşin · tek ödeme", "Süreli · 8 taksit". */
export function contractPaymentTermLabel(term: ContractPaymentTerm): string {
  if (term.kind === 'upfront') return 'Peşin · tek ödeme'
  const discount = discountLabel(term)
  return `Süreli · ${String(term.installmentCount)} taksit${discount === null ? '' : ` · ${discount}`}`
}

/** Taksit seçeneğinin etiketi; koşulsuz eski tarifede yalnız sayı yazar. */
export function installmentOptionLabel(
  count: number,
  terms: readonly FeePaymentTerm[] | undefined,
): string {
  const term = resolvePaymentTerm(terms, count)
  if (term === null) return `${String(count)} taksit`
  return contractPaymentTermLabel(term)
}
