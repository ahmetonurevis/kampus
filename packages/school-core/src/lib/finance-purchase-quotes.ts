import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { BUDGET_AMOUNT_MAX_CENTS } from './finance-budget.ts'
import {
  PURCHASE_ITEMS_MAX,
  PURCHASE_UNIT_PRICE_MAX_CENTS,
  type PurchaseActor,
  type PurchaseRequestStatus,
  type PurchaseUnit,
} from './finance-purchase-requests.ts'

/**
 * Satın alma teklifi ve karşılaştırması (docs/domain/finans.md DOM-FIN-072; ON-224, K23). Onaylanmış
 * talep için tedarikçilerden teklif toplanır: her teklif talebin bütün kalemlerine KDV hariç birim
 * fiyat ve KDV oranı verir, teslim süresi ve geçerlilik günü taşır (K-135). Karşılaştırma kalem ×
 * tedarikçi tablosudur; en düşük KDV dahil tutar vurgulanır. Seçimi yönetici yapar; en düşük geçerli
 * teklif seçilmezse gerekçe zorunludur (K-137). Teklifler talebin etkin siparişi (DOM-FIN-073)
 * açılınca kilitlenir. Tutarlar saklanmaz, her okumada hesaplanır. Fonksiyonlar saftır.
 */

/** Teklifi giren, düzelten ve silen roller (K-136); ön büro yalnız kendi girdiği teklifi değiştirir. */
export const PURCHASE_QUOTE_ROLES = ['yonetici', 'onburo'] as const
/** Teklif seçimi yönetim kararıdır (K-136). */
export const PURCHASE_QUOTE_SELECT_ROLES = ['yonetici'] as const

/** KDV oranları (yüzde; KDV Kanunu md. 28 ve Cumhurbaşkanı kararı, 2023 sonrası oranlar; K-138). */
export const VAT_RATES = [0, 1, 10, 20] as const
export type VatRate = (typeof VAT_RATES)[number]

export const PURCHASE_QUOTES_MAX = 10
export const QUOTE_DELIVERY_DAYS_MAX = 365
export const QUOTE_NOTE_MAX = 500
export const QUOTE_SELECTION_REASON_MIN = 10
export const QUOTE_SELECTION_REASON_MAX = 500

// --- KDV ve tutar --------------------------------------------------------------------------------

/**
 * Kalemin KDV'si (K-138): `net × oran / 100` kuruşa yuvarlanır, yarım kuruş yukarı (half-up). KDV
 * kalem bazında yuvarlanır; belge KDV'si kalem KDV'lerinin toplamıdır, toplam üzerinden yeniden
 * hesaplanmaz. Tutarlar sıfır ya da artıdır, tam sayı aritmetiğiyle hesaplanır.
 */
export function vatCents(netCents: number, rate: VatRate): number {
  return Math.floor((netCents * rate + 50) / 100)
}

export interface QuotePrice {
  requestItemId: string
  /** KDV hariç birim fiyat, kuruş. */
  unitPriceCents: number
  vatRate: VatRate
}

export interface PricedLine extends QuotePrice {
  quantity: number
  netCents: number
  vatCents: number
  grossCents: number
}

export interface AmountTotals {
  netCents: number
  vatCents: number
  grossCents: number
}

/** Kalem tutarı: net = miktar × birim fiyat, KDV kalemde yuvarlanır, brüt = net + KDV. */
export function pricedLine(price: QuotePrice, quantity: number): PricedLine {
  const netCents = quantity * price.unitPriceCents
  const vat = vatCents(netCents, price.vatRate)
  return { ...price, quantity, netCents, vatCents: vat, grossCents: netCents + vat }
}

export function amountTotals(
  lines: readonly Pick<PricedLine, 'netCents' | 'vatCents' | 'grossCents'>[],
): AmountTotals {
  return lines.reduce(
    (total, line) => ({
      netCents: total.netCents + line.netCents,
      vatCents: total.vatCents + line.vatCents,
      grossCents: total.grossCents + line.grossCents,
    }),
    { netCents: 0, vatCents: 0, grossCents: 0 },
  )
}

// --- Şemalar -------------------------------------------------------------------------------------

export const quotePriceSchema = z.strictObject({
  requestItemId: z.uuid('Kalem geçersiz.'),
  unitPriceCents: z
    .number('Birim fiyatı girin.')
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .min(1, 'Birim fiyat sıfırdan büyük olmalıdır.')
    .max(PURCHASE_UNIT_PRICE_MAX_CENTS, 'Birim fiyat çok büyük.'),
  vatRate: z.literal(VAT_RATES, { error: 'KDV oranı %0, %1, %10 ya da %20 olur.' }),
})

const pricesSchema = z
  .array(quotePriceSchema, 'Kalem fiyatlarını girin.')
  .min(1, 'Her kaleme fiyat girin.')
  .max(PURCHASE_ITEMS_MAX, `En fazla ${String(PURCHASE_ITEMS_MAX)} kalem olabilir.`)
  .superRefine((prices, context) => {
    const seen = new Set<string>()
    prices.forEach((price, index) => {
      if (seen.has(price.requestItemId))
        context.addIssue({
          code: 'custom',
          message: 'Bir kaleme yalnız bir fiyat girilir.',
          path: [index, 'requestItemId'],
        })
      seen.add(price.requestItemId)
    })
  })

const deliveryDaysSchema = z
  .number('Teslim süresini girin.')
  .int('Teslim süresi tam gün olmalıdır.')
  .min(0, 'Teslim süresi eksi olamaz.')
  .max(QUOTE_DELIVERY_DAYS_MAX, `Teslim süresi en çok ${String(QUOTE_DELIVERY_DAYS_MAX)} gündür.`)

const noteSchema = z
  .string()
  .trim()
  .max(QUOTE_NOTE_MAX, `En fazla ${String(QUOTE_NOTE_MAX)} karakter girebilirsiniz.`)
  .nullable()
  .transform((value) => (value === '' ? null : value))

/** Yeni teklif (DOM-FIN-072). */
export const purchaseQuoteSchema = z.strictObject({
  supplierId: z.uuid('Tedarikçiyi seçin.'),
  deliveryDays: deliveryDaysSchema,
  validUntil: daySchema,
  note: noteSchema.default(null),
  items: pricesSchema,
})
export type PurchaseQuoteInput = z.input<typeof purchaseQuoteSchema>
export type PurchaseQuoteFields = z.output<typeof purchaseQuoteSchema>

/** Teklifin düzeltmesi; tedarikçi değişmez (yanlış tedarikçi teklifi silinip yeniden girilir). */
export const updatePurchaseQuoteSchema = z
  .strictObject({
    deliveryDays: deliveryDaysSchema.optional(),
    validUntil: daySchema.optional(),
    note: noteSchema.optional(),
    items: pricesSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdatePurchaseQuoteInput = z.input<typeof updatePurchaseQuoteSchema>
export type PurchaseQuoteChanges = z.output<typeof updatePurchaseQuoteSchema>

/** Seçim gerekçesi; en düşük geçerli teklif seçilirse isteğe bağlıdır (K-137). */
export const selectPurchaseQuoteSchema = z.strictObject({
  reason: z
    .string('Gerekçe metin olmalıdır.')
    .trim()
    .max(
      QUOTE_SELECTION_REASON_MAX,
      `En fazla ${String(QUOTE_SELECTION_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
})
export type SelectPurchaseQuoteInput = z.input<typeof selectPurchaseQuoteSchema>

// --- Karşılaştırma -------------------------------------------------------------------------------

export interface QuoteRequestItem {
  id: string
  name: string
  quantity: number
  unit: PurchaseUnit
}

export interface ComparableQuote {
  id: string
  validUntil: string
  prices: readonly QuotePrice[]
}

export interface QuoteCell extends PricedLine {
  quoteId: string
  /** Satırın geçerli teklifler arasındaki en düşük KDV dahil tutarı mı (eşitlikte hepsi). */
  lowest: boolean
}

export interface QuoteSummary extends AmountTotals {
  quoteId: string
  /** Geçerlilik günü bugünden önce mi (Europe/Istanbul; son gün dahil geçerli). */
  expired: boolean
  /** Geçerli teklifler arasında en düşük KDV dahil toplam mı (eşitlikte hepsi). */
  lowest: boolean
}

export interface QuoteComparison {
  rows: { requestItemId: string; cells: QuoteCell[] }[]
  quotes: QuoteSummary[]
  /** Geçerli tekliflerin en düşük KDV dahil toplamı; geçerli teklif yoksa `null`. */
  lowestGrossCents: number | null
}

export const isQuoteExpired = (quote: Pick<ComparableQuote, 'validUntil'>, today: string) =>
  quote.validUntil < today

/**
 * Kalem × tedarikçi karşılaştırma tablosu (DOM-FIN-072): hücre KDV hariç birim fiyat, KDV ve KDV
 * dahil tutardır; en düşük vurgusu satırda ve toplamda yalnız geçerliliği geçmemiş teklifler
 * arasında aranır (K-137). Fiyatı olmayan hücre tabloda yer almaz.
 */
export function compareQuotes(
  items: readonly QuoteRequestItem[],
  quotes: readonly ComparableQuote[],
  today: string,
): QuoteComparison {
  const valid = new Set(quotes.filter((quote) => !isQuoteExpired(quote, today)).map((q) => q.id))
  const minOf = (values: number[]) => (values.length === 0 ? null : Math.min(...values))
  const lines = new Map(
    quotes.map((quote) => {
      const byItem = new Map(quote.prices.map((price) => [price.requestItemId, price]))
      return [
        quote.id,
        items.flatMap((item) => {
          const price = byItem.get(item.id)
          return price === undefined ? [] : [pricedLine(price, item.quantity)]
        }),
      ] as const
    }),
  )
  const rows = items.map((item) => {
    const cells = quotes.flatMap((quote) => {
      const line = lines.get(quote.id)?.find((entry) => entry.requestItemId === item.id)
      return line === undefined ? [] : [{ ...line, quoteId: quote.id }]
    })
    const lowest = minOf(
      cells.filter((cell) => valid.has(cell.quoteId)).map((cell) => cell.grossCents),
    )
    return {
      requestItemId: item.id,
      cells: cells.map((cell) => ({
        ...cell,
        lowest: valid.has(cell.quoteId) && cell.grossCents === lowest,
      })),
    }
  })
  const totals = quotes.map((quote) => ({
    quoteId: quote.id,
    expired: !valid.has(quote.id),
    ...amountTotals(lines.get(quote.id) ?? []),
  }))
  const lowestGrossCents = minOf(
    totals.filter((total) => !total.expired).map((total) => total.grossCents),
  )
  return {
    rows,
    quotes: totals.map((total) => ({
      ...total,
      lowest: !total.expired && total.grossCents === lowestGrossCents,
    })),
    lowestGrossCents,
  }
}

// --- Kurallar ------------------------------------------------------------------------------------

export interface QuoteContext {
  request: { status: PurchaseRequestStatus }
  /** Talebin etkin kalemleri. */
  items: readonly QuoteRequestItem[]
  /** Talebin iptal edilmemiş siparişi var mı; varsa teklifler kilitlidir. */
  orderActive: boolean
  /** Europe/Istanbul günü (`YYYY-MM-DD`). */
  today: string
}

export interface NewQuoteContext extends QuoteContext {
  supplier: { isActive: boolean } | null
  /** Talepteki silinmemiş teklif sayısı. */
  quoteCount: number
  /** Aynı tedarikçinin bu talepte silinmemiş teklifi var mı. */
  supplierTaken: boolean
}

export interface QuoteState {
  createdByUserId: string
}

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, { kind: 'rule', ...(path ? { path: path.map(String) } : {}) })

/** Teklif yalnız onaylanmış ve siparişi verilmemiş talebe girilir, düzeltilir, silinir. */
function assertOpen(context: QuoteContext): void {
  if (context.request.status !== 'approved')
    throw ruleError(
      'purchase_quote_request_not_approved',
      'Teklif yalnız onaylanmış talebe girilir.',
    )
  if (context.orderActive)
    throw ruleError(
      'purchase_quote_locked',
      'Bu talebin siparişi verildi; teklifler değiştirilemez.',
    )
}

/** Ön büro yalnız kendi girdiği teklifi değiştirir; yönetici her teklifi (K-136). */
function assertQuoteOwner(quote: QuoteState, actor: PurchaseActor): void {
  if (actor.role === 'yonetici' || quote.createdByUserId === actor.userId) return
  throw new DomainError(
    'purchase_quote_not_owner',
    'Yalnız kendi girdiğiniz teklifi değiştirebilirsiniz.',
    { kind: 'forbidden' },
  )
}

/** Teklif talebin bütün kalemlerine fiyat verir, başka kalem içermez (K-135); toplam sınırı aşmaz. */
function assertPrices(items: readonly QuoteRequestItem[], prices: readonly QuotePrice[]): void {
  const known = new Map(items.map((item) => [item.id, item]))
  prices.forEach((price, index) => {
    if (!known.has(price.requestItemId))
      throw ruleError('purchase_quote_item_unknown', 'Fiyat girilen kalem bu talepte yok.', [
        'items',
        index,
        'requestItemId',
      ])
  })
  const priced = new Set(prices.map((price) => price.requestItemId))
  const missing = items.find((item) => !priced.has(item.id))
  if (missing !== undefined)
    throw ruleError(
      'purchase_quote_item_missing',
      `"${missing.name}" kalemine fiyat girin; teklif talebin bütün kalemlerini kapsar.`,
      ['items'],
    )
  const total = amountTotals(
    prices.map((price) => pricedLine(price, known.get(price.requestItemId)?.quantity ?? 0)),
  )
  if (total.grossCents > BUDGET_AMOUNT_MAX_CENTS)
    throw ruleError('purchase_quote_total_too_large', 'Teklif toplamı çok büyük.', ['items'])
}

function assertValidUntil(validUntil: string, today: string): void {
  if (validUntil < today)
    throw ruleError('purchase_quote_valid_until_past', 'Geçerlilik günü bugünden önce olamaz.', [
      'validUntil',
    ])
}

/** Yeni teklif (DOM-FIN-072): onaylı ve siparişsiz talep, etkin tedarikçi, tedarikçi başına bir teklif. */
export function planPurchaseQuote(input: unknown, context: NewQuoteContext): PurchaseQuoteFields {
  const data = purchaseQuoteSchema.parse(input)
  assertOpen(context)
  if (context.supplier === null)
    throw ruleError('purchase_quote_supplier_not_found', 'Tedarikçi bulunamadı.', ['supplierId'])
  if (!context.supplier.isActive)
    throw ruleError('purchase_quote_supplier_inactive', 'Pasif tedarikçiden teklif girilemez.', [
      'supplierId',
    ])
  if (context.supplierTaken)
    throw new DomainError(
      'purchase_quote_supplier_exists',
      'Bu tedarikçinin teklifi zaten girildi; mevcut teklifi düzeltin.',
      { kind: 'conflict', path: ['supplierId'] },
    )
  if (context.quoteCount >= PURCHASE_QUOTES_MAX)
    throw ruleError(
      'purchase_quote_limit',
      `Bir talebe en çok ${String(PURCHASE_QUOTES_MAX)} teklif girilir.`,
    )
  assertValidUntil(data.validUntil, context.today)
  assertPrices(context.items, data.items)
  return data
}

/** Teklif düzeltmesi; seçilmiş teklif düzeltilirse seçim düşer (servis `selected_at`'i temizler). */
export function planPurchaseQuoteUpdate(
  quote: QuoteState,
  input: unknown,
  context: QuoteContext,
  actor: PurchaseActor,
): PurchaseQuoteChanges {
  const changes = updatePurchaseQuoteSchema.parse(input)
  assertQuoteOwner(quote, actor)
  assertOpen(context)
  if (changes.validUntil !== undefined) assertValidUntil(changes.validUntil, context.today)
  if (changes.items !== undefined) assertPrices(context.items, changes.items)
  return changes
}

/** Teklif silme (arşiv); seçilmiş teklif silinirse seçim de düşer. */
export function planPurchaseQuoteRemove(
  quote: QuoteState,
  context: QuoteContext,
  actor: PurchaseActor,
): void {
  assertQuoteOwner(quote, actor)
  assertOpen(context)
}

export interface QuoteSelectionContext extends QuoteContext {
  quote: { id: string; validUntil: string; selected: boolean }
  comparison: QuoteComparison
}

/**
 * Teklif seçimi (DOM-FIN-072, K-137): yönetici geçerli bir teklifi seçer; en düşük KDV dahil
 * toplamlı geçerli teklif seçilmezse en az 10 karakterlik gerekçe zorunludur. Talepte tek seçili
 * teklif olur; başka teklif seçilince önceki seçim düşer. Sipariş verildikten sonra seçim değişmez.
 */
export function planQuoteSelection(
  input: unknown,
  context: QuoteSelectionContext,
): { reason: string | null; lowest: boolean } {
  const { reason } = selectPurchaseQuoteSchema.parse(input ?? {})
  assertOpen(context)
  if (context.quote.selected)
    throw ruleError('purchase_quote_already_selected', 'Bu teklif zaten seçili.')
  if (isQuoteExpired(context.quote, context.today))
    throw ruleError(
      'purchase_quote_expired',
      'Teklifin geçerlilik süresi geçti; tedarikçiden güncel teklif alıp teklifi düzeltin.',
    )
  const lowest =
    context.comparison.quotes.find((summary) => summary.quoteId === context.quote.id)?.lowest ??
    false
  if (!lowest && (reason === null || reason.length < QUOTE_SELECTION_REASON_MIN))
    throw ruleError(
      'purchase_quote_reason_required',
      'En düşük teklif seçilmediği için gerekçeyi en az 10 karakterle yazın.',
      ['reason'],
    )
  return { reason, lowest }
}

/** Rolün teklifte yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function purchaseQuoteActions(
  quote: QuoteState & { validUntil: string; selected: boolean },
  context: Pick<QuoteContext, 'request' | 'orderActive' | 'today'>,
  actor: PurchaseActor,
): { edit: boolean; remove: boolean; select: boolean } {
  const open = context.request.status === 'approved' && !context.orderActive
  const staff = actor.role === 'yonetici' || actor.role === 'onburo'
  const owner = actor.role === 'yonetici' || quote.createdByUserId === actor.userId
  return {
    edit: open && staff && owner,
    remove: open && staff && owner,
    select:
      open && actor.role === 'yonetici' && !quote.selected && !isQuoteExpired(quote, context.today),
  }
}

/** Teklif listesinin işlemleri: yeni teklif ve seçili tekliften sipariş. */
export function quoteListActions(
  context: Pick<QuoteContext, 'request' | 'orderActive'> & {
    quoteCount: number
    hasSelection: boolean
  },
  actor: PurchaseActor,
): { add: boolean; order: boolean } {
  const open = context.request.status === 'approved' && !context.orderActive
  const staff = actor.role === 'yonetici' || actor.role === 'onburo'
  return {
    add: open && staff && context.quoteCount < PURCHASE_QUOTES_MAX,
    order: open && actor.role === 'yonetici' && context.hasSelection,
  }
}
