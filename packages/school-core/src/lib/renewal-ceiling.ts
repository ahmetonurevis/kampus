import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { DomainError } from './errors.ts'
import {
  TUITION_INCREASE_EXTRA_BASIS_POINTS,
  tuitionAfterDiscountLoss,
  type PriceIndexRates,
} from './fee-tariffs.ts'
import { money } from './format.ts'

/**
 * Yenilemenin artış tavanı (docs/domain/finans.md DOM-FIN-005, DOM-FIN-023; ÖÖKY md. 53/1). Baz ve
 * oranlar State ile profil satırlarından okunur; hesap `lib/fee-tariffs.ts`'tedir. İş akışı köprüsü
 * (`assertRenewalWithinTariff`) ve tarifeli plan (`lib/renewals.ts`) aynı işlevi çalıştırır.
 */

/** Bir ücret yılının tavan oranları: bir önceki yılın ÜFE ve TÜFE ortalaması (DOM-FIN-005). */
export type PriceIndexEntry = PriceIndexRates & { academicYear: number }

const lineSchema = z.object({ kind: z.string(), amountCents: z.number().int() })

/**
 * Tavan kararı. `entry_grade`: başlangıç sınıfı, tavan uygulanmaz. `no_base`: baz bulunamadı, tavan
 * hesaplanamadı. `applied`: tavan uygulandı.
 */
export const renewalCeilingSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('entry_grade') }),
  z.object({ status: z.literal('no_base') }),
  z.object({
    status: z.literal('applied'),
    baseCents: z.number().int().describe('Baz ücret, kuruş'),
    baseSource: z.enum(['contract', 'enrollment_contract', 'previous_tariff']),
    baseYear: z.number().int(),
    /** Bazdan hedef yıla sırayla uygulanan oranlar, eskiden yeniye. */
    rates: z.array(
      z.object({
        academicYear: z.number().int().describe('Oranın sınırladığı ücret yılı'),
        ppiBasisPoints: z.number().int().describe('ÜFE ortalaması, on binde birlik'),
        cpiBasisPoints: z.number().int().describe('TÜFE ortalaması, on binde birlik'),
      }),
    ),
    extraBasisPoints: z.number().int(),
    ceilingCents: z.number().int().describe('Artış tavanı, kuruş'),
    discountLoss: z
      .object({ kinds: z.array(z.string()), reason: z.string() })
      .nullable()
      .describe('İndirim koşulu kalktıysa gerekçesi (DOM-FIN-023)'),
  }),
])
export type RenewalCeiling = z.output<typeof renewalCeilingSchema>
export type DiscountLoss = NonNullable<
  Extract<RenewalCeiling, { status: 'applied' }>['discountLoss']
>

/** Plan anındaki ücret kararı; ilan, tavan ve indirim sonradan değişse de kayıtta kalır. */
export const renewalPricingSchema = z.object({
  tariffId: z.string(),
  tariffVersion: z.number().int(),
  announcedCents: z.number().int(),
  ceiling: renewalCeilingSchema,
  discounts: z.array(lineSchema),
  extras: z.array(lineSchema),
  scholarship: z.object({ programId: z.string(), amountCents: z.number().int() }).nullable(),
})
export type RenewalPricing = z.output<typeof renewalPricingSchema>

/**
 * Tavan yalnız ara sınıfta uygulanır (DOM-FIN-005): 1, 5 ve 9 kademenin başlangıç sınıfıdır, ücreti
 * ilanla sınırlıdır.
 */
const ENTRY_GRADES: ReadonlySet<number> = new Set([1, 5, 9])

type CeilingState = Pick<State, 'contracts' | 'students' | 'renewals' | 'academicYear'>
type Contract = State['contracts'][number]

/** Hedef yıldan önceki sözleşmeler, eskiden yeniye; iptal edilen yenilemenin sözleşmesi baz olmaz. */
function priorContracts(state: CeilingState, studentId: string, year: number) {
  const cancelled = new Set(
    state.renewals.filter((item) => item.status === 'İptal').map((item) => item.contractId),
  )
  return state.contracts
    .filter((item) => item.studentId === studentId && !cancelled.has(item.id))
    .map((contract) => ({ contract, year: contract.academicYear ?? state.academicYear }))
    .filter((item) => item.year < year)
    .sort((a, b) => a.year - b.year)
}

/**
 * Sözleşmedeki indirimsiz öğrenim ücreti. Köprünün yazdığı sözleşmede brüt yenileme kaydındadır;
 * eski sözleşmede (brütü olmayan) tutarın kendisi kullanılır.
 */
function contractBaseCents(state: CeilingState, contract: Contract): number {
  return (
    contract.grossCents ??
    state.renewals.find((item) => item.contractId === contract.id)?.gross ??
    contract.amount
  )
}

function hasActiveSibling(state: CeilingState, studentId: string): boolean {
  const parentId = state.students.find((item) => item.id === studentId)?.parentId
  return state.students.some(
    (item) => item.id !== studentId && item.parentId === parentId && item.isActive,
  )
}

/** Ücret yılı `fromYear`'dan sonra hedef yıla kadar her yılın oranı; eksik yıl reddedilir. */
function ratesBetween(
  fromYear: number,
  toYear: number,
  entries: readonly PriceIndexEntry[],
): PriceIndexEntry[] {
  const rates: PriceIndexEntry[] = []
  for (let year = fromYear + 1; year <= toYear; year += 1) {
    const entry = entries.find((item) => item.academicYear === year)
    if (!entry)
      throw new DomainError(
        'price_index_missing',
        `${String(year)} yılı ücret tavanı için ÜFE ve TÜFE ortalamaları girilmemiş.`,
        { path: ['academicYear'] },
      )
    // Kayıtta yalnız oranlar kalır; kaynak ve bülten profilde durur.
    rates.push({
      academicYear: entry.academicYear,
      ppiBasisPoints: entry.ppiBasisPoints,
      cpiBasisPoints: entry.cpiBasisPoints,
    })
  }
  return rates
}

/**
 * Baz (DOM-FIN-005): devam eden öğrencide son sözleşmenin indirimsiz ücreti; sözleşmesi olmayanda
 * önceki yılın ilan ücreti. Kardeşi kalmayan öğrencinin kardeş indirimi varsa baz kayıt yılındaki
 * indirimsiz ücrettir ve her yıl sırayla artırılır; cari sözleşme değişmez (DOM-FIN-023). Baz
 * bulunamazsa (ör. sisteme önceki yıl verisi girilmemiş kurum) tavan hesaplanamaz: `no_base`.
 */
export function renewalCeiling(
  state: CeilingState,
  input: {
    studentId: string
    targetGrade: number
    year: number
    previousAnnouncedCents: number | null
    priceIndexes: readonly PriceIndexEntry[]
  },
): RenewalCeiling {
  if (ENTRY_GRADES.has(input.targetGrade)) return { status: 'entry_grade' }
  const contracts = priorContracts(state, input.studentId, input.year)
  const latest = contracts.at(-1)
  const applied = (
    baseCents: number,
    baseSource: 'contract' | 'enrollment_contract' | 'previous_tariff',
    baseYear: number,
    discountLoss: DiscountLoss | null,
  ): RenewalCeiling => {
    const rates = ratesBetween(baseYear, input.year, input.priceIndexes)
    return {
      status: 'applied',
      baseCents,
      baseSource,
      baseYear,
      rates,
      extraBasisPoints: TUITION_INCREASE_EXTRA_BASIS_POINTS,
      ceilingCents: tuitionAfterDiscountLoss(baseCents, rates),
      discountLoss,
    }
  }
  if (!latest) {
    if (input.previousAnnouncedCents === null) return { status: 'no_base' }
    return applied(input.previousAnnouncedCents, 'previous_tariff', input.year - 1, null)
  }
  const lostSibling =
    latest.contract.discounts?.some((item) => item.kind === 'sibling') === true &&
    !hasActiveSibling(state, input.studentId)
  const first = contracts[0]
  if (lostSibling && first)
    return applied(contractBaseCents(state, first.contract), 'enrollment_contract', first.year, {
      kinds: ['sibling'],
      reason:
        'Kardeş indirimi koşulu kalktı. Ücret, kayıt yılındaki indirimsiz ücrete her öğrenim yılı için artış oranı uygulanarak hesaplandı; cari yıl sözleşmesi değişmez.',
    })
  return applied(contractBaseCents(state, latest.contract), 'contract', latest.year, null)
}

/** Tavanı aşan tutarla plan oluşturulamaz (DOM-FIN-005). */
export function assertWithinCeiling(
  tuitionCents: number,
  ceiling: RenewalCeiling,
  path: readonly string[],
): void {
  if (ceiling.status === 'applied' && tuitionCents > ceiling.ceilingCents)
    throw new DomainError(
      'renewal_above_ceiling',
      `Öğrenim ücreti artış tavanını (${money(ceiling.ceilingCents)}) aşamaz.`,
      { path: [...path] },
    )
}
