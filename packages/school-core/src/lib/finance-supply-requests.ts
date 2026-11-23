import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  availableOn,
  planStockIssueLines,
  STOCK_UNIT_LABELS,
  type StockMovementContext,
  type StockUnit,
} from './finance-inventory.ts'
import {
  PURCHASE_JUSTIFICATION_MAX,
  PURCHASE_UNIT_PRICE_MAX_CENTS,
  type PurchaseRequestInput,
  type PurchaseRequestStatus,
} from './finance-purchase-requests.ts'

/**
 * Sarf malzeme talebi (docs/domain/finans.md DOM-FIN-091; ON-233). Kurum personeli (öğretmen dahil)
 * kırtasiye, laboratuvar ya da temizlik malzemesini stok kartından seçerek, miktar, gerekçe ve
 * istenen günle ister. Durum: gönderildi → onaylandı ya da reddedildi; onaylanan talep depodan
 * karşılanınca karşılandı. Talep eden onaydan önce iptal eder.
 *
 * Karşılama seçilen depodan talebe bağlı `supply` türünde stok çıkışı yazar (DOM-FIN-078); stok
 * yetmezse karşılanabilen miktar çıkar, kalan için talep onaylı kalır ya da kısmi olarak kapatılır.
 * Stokta olmayan kalan tek adımda satın alma talebine (DOM-FIN-071) dönüştürülür: kalemler stok
 * kartı bağıyla taşınır, iki talep birbirine bağlanır (K-246). Karşılanan miktar saklanmaz,
 * talebe bağlı iptal edilmemiş çıkışlardan hesaplanır.
 *
 * Fonksiyonlar saftır; zaman `today` parametresiyle gelir.
 */

/** Talep açan ve kendi talebini gören roller (K-244). */
export const SUPPLY_REQUEST_ROLES = ['yonetici', 'onburo', 'ogretmen'] as const
/** Bütün talepleri gören, karşılayan ve satın almaya dönüştüren roller (depo sorumlusu; K-244). */
export const SUPPLY_REQUEST_MANAGE_ROLES = ['yonetici', 'onburo'] as const
/** Onay ve ret yalnız yöneticidedir (K-244). */
export const SUPPLY_REQUEST_DECISION_ROLES = ['yonetici'] as const

export const SUPPLY_REQUEST_STATUSES = [
  'submitted',
  'approved',
  'rejected',
  'fulfilled',
  'cancelled',
] as const
export type SupplyRequestStatus = (typeof SUPPLY_REQUEST_STATUSES)[number]
export const SUPPLY_REQUEST_STATUS_LABELS = {
  submitted: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  fulfilled: 'Karşılandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<SupplyRequestStatus, string>

export const SUPPLY_ITEMS_MAX = 30
export const SUPPLY_QUANTITY_MAX = 10_000
export const SUPPLY_JUSTIFICATION_MIN = 5
export const SUPPLY_JUSTIFICATION_MAX = 1000
export const SUPPLY_REASON_MIN = 5
export const SUPPLY_REASON_MAX = 500
/** İstenen gün bugünden en çok bu kadar gün sonra olabilir. */
export const SUPPLY_NEEDED_DAYS_MAX = 365

/** Satın alma talebine dönüşmüş sayılan durumlar: reddedilen ya da iptal edilen bağ yeniden açılır. */
const LIVE_PURCHASE_STATUSES: readonly PurchaseRequestStatus[] = ['draft', 'submitted', 'approved']
export const isLivePurchaseLink = (status: PurchaseRequestStatus) =>
  LIVE_PURCHASE_STATUSES.includes(status)

// --- Şemalar -------------------------------------------------------------------------------------

const quantitySchema = z
  .number('Miktarı girin.')
  .int('Miktar tam sayı olmalıdır.')
  .min(1, 'Miktar en az 1 olmalıdır.')
  .max(SUPPLY_QUANTITY_MAX, `Miktar en çok ${String(SUPPLY_QUANTITY_MAX)} olabilir.`)

/** Aynı kimlik listede iki kez geçmez (`key` alanı; hata ikinci satırda). */
const uniqueBy =
  <T>(key: (value: T) => string, field: string, message: string) =>
  (values: readonly T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>()
    values.forEach((value, index) => {
      const id = key(value)
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [index, field], message })
      seen.add(id)
    })
  }

export const supplyRequestItemSchema = z.strictObject({
  stockItemId: z.uuid('Stok kartını seçin.'),
  quantity: quantitySchema,
})

export const supplyRequestSchema = z.strictObject({
  neededDate: daySchema,
  justification: z
    .string('Gerekçeyi yazın.')
    .trim()
    .min(SUPPLY_JUSTIFICATION_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      SUPPLY_JUSTIFICATION_MAX,
      `En fazla ${String(SUPPLY_JUSTIFICATION_MAX)} karakter girebilirsiniz.`,
    ),
  items: z
    .array(supplyRequestItemSchema, 'Kalemleri girin.')
    .min(1, 'En az bir kalem ekleyin.')
    .max(SUPPLY_ITEMS_MAX, `En fazla ${String(SUPPLY_ITEMS_MAX)} kalem eklenebilir.`)
    .superRefine(
      uniqueBy(
        (item) => item.stockItemId,
        'stockItemId',
        'Aynı stok kartı talepte bir kez yer alır; miktarı artırın.',
      ),
    ),
})
export type SupplyRequestInput = z.input<typeof supplyRequestSchema>
export type SupplyRequestFields = z.output<typeof supplyRequestSchema>

const reasonSchema = (empty: string) =>
  z
    .string(empty)
    .trim()
    .min(SUPPLY_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(SUPPLY_REASON_MAX, `En fazla ${String(SUPPLY_REASON_MAX)} karakter girebilirsiniz.`)

const optionalNote = z
  .string()
  .trim()
  .max(SUPPLY_REASON_MAX, `En fazla ${String(SUPPLY_REASON_MAX)} karakter girebilirsiniz.`)
  .nullable()
  .default(null)
  .transform((value) => (value === '' ? null : value))

export const approveSupplyRequestSchema = z.strictObject({ note: optionalNote })
export type ApproveSupplyRequestInput = z.input<typeof approveSupplyRequestSchema>
export const rejectSupplyRequestSchema = z.strictObject({
  reason: reasonSchema('Ret gerekçesini yazın.'),
})
export type RejectSupplyRequestInput = z.input<typeof rejectSupplyRequestSchema>
export const cancelSupplyRequestSchema = z.strictObject({
  reason: reasonSchema('İptal gerekçesini yazın.'),
})
export type CancelSupplyRequestInput = z.input<typeof cancelSupplyRequestSchema>

/**
 * Karşılama (K-245): depo, çıkış günü ve isteğe bağlı kalem miktarları. `lines` verilmezse her kalem
 * için kalan ile depoda çıkılabilecek miktarın küçüğü çıkar. `close` kalanı olan talebi kısmi
 * karşılanmış olarak kapatır; o zaman `closeNote` (5–500 karakter) zorunludur.
 */
export const fulfillSupplyRequestSchema = z.strictObject({
  warehouseId: z.uuid('Depoyu seçin.'),
  movementDate: daySchema,
  lines: z
    .array(
      z.strictObject({ itemId: z.uuid('Talep kalemi geçersiz.'), quantity: quantitySchema }),
      'Kalemleri girin.',
    )
    .min(1, 'En az bir kalem girin.')
    .max(SUPPLY_ITEMS_MAX, `En fazla ${String(SUPPLY_ITEMS_MAX)} kalem girilebilir.`)
    .superRefine(uniqueBy((line) => line.itemId, 'itemId', 'Kalem bir kez girilir.'))
    .optional(),
  close: z.boolean('Kapatma seçimi geçersiz.').default(false),
  closeNote: optionalNote,
})
export type FulfillSupplyRequestInput = z.input<typeof fulfillSupplyRequestSchema>

/**
 * Satın alma talebine dönüştürme (K-246): talep eden birim, bütçe dönemi, gider kalemi, isteğe bağlı
 * tedarikçi ve kalanı olan her kalemin tahmini birim fiyatı. Kalem adı, miktar (kalan), birim ve
 * stok kartı bağı sarf talebinden gelir.
 */
export const convertSupplyRequestSchema = z.strictObject({
  costCenterId: z.uuid('Talep eden birimi seçin.'),
  periodId: z.uuid('Bütçe dönemini seçin.'),
  budgetItemId: z.uuid('Gider kalemini seçin.'),
  supplierId: z.uuid('Tedarikçi geçersiz.').nullable().default(null),
  prices: z
    .array(
      z.strictObject({
        itemId: z.uuid('Talep kalemi geçersiz.'),
        estimatedUnitPriceCents: z
          .number('Tahmini birim fiyatı girin.')
          .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
          .min(1, 'Tahmini birim fiyat sıfırdan büyük olmalıdır.')
          .max(PURCHASE_UNIT_PRICE_MAX_CENTS, 'Tahmini birim fiyat çok büyük.'),
      }),
      'Tahmini birim fiyatları girin.',
    )
    .min(1, 'Tahmini birim fiyatları girin.')
    .max(SUPPLY_ITEMS_MAX, `En fazla ${String(SUPPLY_ITEMS_MAX)} kalem girilebilir.`)
    .superRefine(uniqueBy((price) => price.itemId, 'itemId', 'Kalem bir kez girilir.')),
})
export type ConvertSupplyRequestInput = z.input<typeof convertSupplyRequestSchema>

// --- Hesap ---------------------------------------------------------------------------------------

/** Talep numarası kurumda sıradan türetilir (`SM-0007`); saklanan yalnız sıradır. */
export function supplyRequestNumber(sequence: number): string {
  return `SM-${String(sequence).padStart(4, '0')}`
}

/** Talep kalemi: istenen miktar ve talebe bağlı iptal edilmemiş çıkışların toplamı. */
export interface SupplyLine {
  id: string
  stockItemId: string
  quantity: number
  fulfilledQuantity: number
}

export const remainingOf = (line: Pick<SupplyLine, 'quantity' | 'fulfilledQuantity'>) =>
  Math.max(line.quantity - line.fulfilledQuantity, 0)

/** Talebin kalan toplamı (birimler farklı olabilir; yalnız sıfır mı diye bakılır). */
export const supplyRemaining = (
  lines: readonly Pick<SupplyLine, 'quantity' | 'fulfilledQuantity'>[],
) => lines.reduce((total, line) => total + remainingOf(line), 0)

// --- Kurallar ------------------------------------------------------------------------------------

export interface SupplyStockCard {
  id: string
  code: string
  name: string
  unit: StockUnit
  isActive: boolean
}

export interface SupplyRequestState {
  status: SupplyRequestStatus
  requestedByUserId: string
}

export interface SupplyActor {
  userId: string
  role: string
}

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path === undefined ? {} : { path: path.map(String) }),
  })

/**
 * Alan hatası olarak 400 (Zod): bilinmeyen ya da başka kurumun kimliği var olmayanla aynı yanıtı
 * alır, sızıntı yok.
 */
function fieldIssues(issues: readonly { path: (string | number)[]; message: string }[]): void {
  if (issues.length === 0) return
  z.unknown()
    .superRefine((_value, ctx) => {
      for (const issue of issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
    })
    .parse(null)
}

/** Gün aritmetiği (`YYYY-MM-DD`, takvim günü). */
function addDays(day: string, days: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

/** Bütün talepleri gören rol mü (K-244); değilse yalnız kendi talepleri. */
export const canSeeAllSupplyRequests = (role: string) =>
  SUPPLY_REQUEST_MANAGE_ROLES.some((value) => value === role)

/** Talebi görebilir mi: yönetici ve ön büro hepsini, diğer personel kendi açtığını. */
export const canViewSupplyRequest = (request: SupplyRequestState, actor: SupplyActor) =>
  canSeeAllSupplyRequests(actor.role) || request.requestedByUserId === actor.userId

/**
 * Yeni talep (DOM-FIN-091): kalemler kurumun etkin stok kartlarıdır; istenen gün bugünden önce ve
 * bir yıldan sonra olamaz. Bilinmeyen kart 400 (`items.<n>.stockItemId`), pasif kart 422.
 */
export function planSupplyRequest(
  input: unknown,
  context: { cards: ReadonlyMap<string, SupplyStockCard>; today: string },
): SupplyRequestFields {
  const data = supplyRequestSchema.parse(input)
  fieldIssues(
    data.items.flatMap((item, index) =>
      context.cards.has(item.stockItemId)
        ? []
        : [{ path: ['items', index, 'stockItemId'], message: 'Stok kartı bulunamadı.' }],
    ),
  )
  for (const [index, item] of data.items.entries()) {
    const card = context.cards.get(item.stockItemId)
    if (card !== undefined && !card.isActive)
      throw ruleError(
        'supply_request_stock_item_inactive',
        `${card.name} stok kartı pasif; talep edilemez.`,
        ['items', index, 'stockItemId'],
      )
  }
  if (data.neededDate < context.today)
    throw ruleError('supply_request_needed_date_past', 'İstenen gün bugünden önce olamaz.', [
      'neededDate',
    ])
  if (data.neededDate > addDays(context.today, SUPPLY_NEEDED_DAYS_MAX))
    throw ruleError(
      'supply_request_needed_date_too_far',
      'İstenen gün en çok bir yıl sonrası olabilir.',
      ['neededDate'],
    )
  return data
}

function assertStatus(
  request: SupplyRequestState,
  allowed: readonly SupplyRequestStatus[],
  code: string,
  message: string,
): void {
  if (!allowed.includes(request.status)) throw ruleError(code, message)
}

/** Onay: yalnız onay bekleyen talep; not isteğe bağlı. */
export function planSupplyRequestApprove(
  request: SupplyRequestState,
  input: unknown,
): z.output<typeof approveSupplyRequestSchema> {
  const data = approveSupplyRequestSchema.parse(input ?? {})
  assertStatus(
    request,
    ['submitted'],
    'supply_request_not_submitted',
    'Yalnız onay bekleyen talep onaylanabilir.',
  )
  return data
}

/** Ret: yalnız onay bekleyen talep; gerekçe zorunlu. */
export function planSupplyRequestReject(
  request: SupplyRequestState,
  input: unknown,
): z.output<typeof rejectSupplyRequestSchema> {
  const data = rejectSupplyRequestSchema.parse(input)
  assertStatus(
    request,
    ['submitted'],
    'supply_request_not_submitted',
    'Yalnız onay bekleyen talep reddedilebilir.',
  )
  return data
}

/**
 * İptal (K-244): yalnız talebi açan, onaydan önce ve gerekçeyle. Yönetici başkasının talebini iptal
 * etmez, reddeder.
 */
export function planSupplyRequestCancel(
  request: SupplyRequestState,
  input: unknown,
  actor: SupplyActor,
): z.output<typeof cancelSupplyRequestSchema> {
  const data = cancelSupplyRequestSchema.parse(input)
  if (request.requestedByUserId !== actor.userId)
    throw new DomainError(
      'supply_request_not_owner',
      'Yalnız kendi açtığınız talebi iptal edebilirsiniz; başkasının talebini reddedin.',
      { kind: 'forbidden' },
    )
  assertStatus(
    request,
    ['submitted'],
    'supply_request_not_cancellable',
    'Yalnız onay bekleyen talep iptal edilebilir.',
  )
  return data
}

export interface SupplyIssue {
  requestItemId: string
  stockItemId: string
  quantity: number
}

export interface SupplyFulfillmentPlan {
  warehouseId: string
  movementDate: string
  issues: SupplyIssue[]
  /** Karşılamadan sonraki durum: kalan yoksa ya da kısmi kapatıldıysa `fulfilled`. */
  status: 'approved' | 'fulfilled'
  /** Kalan varken kapatıldıysa `true` (kısmi karşılama). */
  partial: boolean
  closeNote: string | null
}

/**
 * Karşılama (DOM-FIN-091, K-245): onaylı talebin kalemleri seçilen depodan çıkış gününde `supply`
 * çıkışıyla karşılanır. Kalem miktarı verilmezse kalan ile o gün ve sonrasında çıkılabilecek
 * miktarın küçüğü çıkar (stok yetmezse karşılanabilen miktar; pasif kart atlanır); verilirse kalanı
 * aşamaz ve depodaki miktarı aşarsa 422 `stock_insufficient` (K-181). Hiçbir şey çıkmıyorsa ve
 * kapatılmıyorsa 422 `supply_request_nothing_available`. Kalan sıfırlanınca ya da kısmi kapatılınca
 * talep karşılanır.
 */
export function planSupplyFulfillment(
  request: SupplyRequestState & { lines: readonly SupplyLine[] },
  input: unknown,
  stock: StockMovementContext,
): SupplyFulfillmentPlan {
  const data = fulfillSupplyRequestSchema.parse(input)
  assertStatus(
    request,
    ['approved'],
    'supply_request_not_approved',
    'Yalnız onaylanmış talep karşılanabilir.',
  )
  const byId = new Map(request.lines.map((line) => [line.id, line]))
  let issues: (SupplyIssue & { path: (string | number)[] })[]
  if (data.lines === undefined) {
    issues = request.lines.flatMap((line) => {
      const remaining = remainingOf(line)
      if (remaining === 0 || stock.items.get(line.stockItemId)?.isActive !== true) return []
      const available = availableOn(
        stock.movements.filter(
          (movement) =>
            movement.itemId === line.stockItemId && movement.warehouseId === data.warehouseId,
        ),
        data.movementDate,
      )
      const quantity = Math.min(remaining, available)
      return quantity > 0
        ? [
            {
              requestItemId: line.id,
              stockItemId: line.stockItemId,
              quantity,
              path: ['warehouseId'],
            },
          ]
        : []
    })
  } else {
    const lines = data.lines
    fieldIssues(
      lines.flatMap((line, index) =>
        byId.has(line.itemId)
          ? []
          : [{ path: ['lines', index, 'itemId'], message: 'Talep kalemi bulunamadı.' }],
      ),
    )
    issues = lines.map((line, index) => {
      const target = byId.get(line.itemId) as SupplyLine
      const remaining = remainingOf(target)
      if (line.quantity > remaining) {
        const card = stock.items.get(target.stockItemId)
        throw ruleError(
          'supply_request_quantity_exceeds_remaining',
          `${card?.name ?? 'Kalem'} için en çok ${String(remaining)}${card ? ` ${STOCK_UNIT_LABELS[card.unit]}` : ''} karşılanabilir.`,
          ['lines', index, 'quantity'],
        )
      }
      return {
        requestItemId: target.id,
        stockItemId: target.stockItemId,
        quantity: line.quantity,
        path: ['lines', index, 'quantity'],
      }
    })
  }
  planStockIssueLines(
    {
      warehouseId: data.warehouseId,
      day: data.movementDate,
      lines: issues.map((issue) => ({
        itemId: issue.stockItemId,
        quantity: issue.quantity,
        path: issue.path,
      })),
    },
    stock,
    { warehouse: ['warehouseId'], day: ['movementDate'] },
  )
  if (issues.length === 0 && !data.close)
    throw ruleError(
      'supply_request_nothing_available',
      'Seçilen depoda bu talebin kalemlerinden çıkılabilecek stok yok. Başka depo seçin, kalanı satın alma talebine dönüştürün ya da talebi kısmi karşılanmış olarak kapatın.',
      ['warehouseId'],
    )
  const issued = issues.reduce((total, issue) => total + issue.quantity, 0)
  const remainingAfter = supplyRemaining(request.lines) - issued
  if (data.close && remainingAfter > 0 && data.closeNote === null)
    throw ruleError(
      'supply_request_close_note_required',
      'Kalanı olan talebi kapatmak için açıklama yazın.',
      ['closeNote'],
    )
  if (data.closeNote !== null && data.closeNote.length < SUPPLY_REASON_MIN)
    throw ruleError('supply_request_close_note_short', 'Açıklamayı en az 5 karakterle yazın.', [
      'closeNote',
    ])
  return {
    warehouseId: data.warehouseId,
    movementDate: data.movementDate,
    issues: issues.map(({ requestItemId, stockItemId, quantity }) => ({
      requestItemId,
      stockItemId,
      quantity,
    })),
    status: remainingAfter === 0 || data.close ? 'fulfilled' : 'approved',
    partial: remainingAfter > 0 && data.close,
    closeNote: data.closeNote,
  }
}

/**
 * Satın alma talebine dönüştürme (DOM-FIN-091, K-246): onaylı talebin kalanı olan kalemleri taslak
 * satın alma talebinin kalemleri olur (ad "ad (kod)", miktar kalan, birim kartın birimi, stok kartı
 * bağı; ON-339). Talebin canlı (taslak, gönderilmiş, onaylı) satın alma bağı varsa 409
 * `supply_request_already_converted`; reddedilen ya da iptal edilen bağ yeniden dönüştürülebilir.
 * Kalanı olan her kalemin fiyatı girilmelidir. Dönen gövde satın alma talebi kurallarından
 * (`planPurchaseRequest`) geçer: birim, dönem, gider kalemi ve tedarikçi orada denetlenir.
 */
export function planSupplyPurchaseConversion(
  request: SupplyRequestState & {
    sequence: number
    justification: string
    lines: readonly SupplyLine[]
    purchaseRequestStatus: PurchaseRequestStatus | null
  },
  input: unknown,
  cards: ReadonlyMap<string, SupplyStockCard>,
): PurchaseRequestInput {
  const data = convertSupplyRequestSchema.parse(input)
  assertStatus(
    request,
    ['approved'],
    'supply_request_not_approved',
    'Yalnız onaylanmış talep satın alma talebine dönüştürülür.',
  )
  if (request.purchaseRequestStatus !== null && isLivePurchaseLink(request.purchaseRequestStatus))
    throw new DomainError(
      'supply_request_already_converted',
      'Bu talebin açık bir satın alma talebi var; önce o talebi sonuçlandırın.',
      { kind: 'conflict' },
    )
  const open = request.lines.filter((line) => remainingOf(line) > 0)
  if (open.length === 0)
    throw ruleError(
      'supply_request_nothing_remaining',
      'Talebin karşılanmamış kalemi yok; satın almaya gerek yok.',
    )
  const prices = new Map(data.prices.map((price) => [price.itemId, price.estimatedUnitPriceCents]))
  const openIds = new Set(open.map((line) => line.id))
  fieldIssues([
    ...data.prices.flatMap((price, index) =>
      openIds.has(price.itemId)
        ? []
        : [
            {
              path: ['prices', index, 'itemId'],
              message: 'Kalem bulunamadı ya da karşılanacak miktarı yok.',
            },
          ],
    ),
    ...open.flatMap((line) =>
      prices.has(line.id)
        ? []
        : [
            {
              path: ['prices'],
              message: `${cards.get(line.stockItemId)?.name ?? 'Kalem'} için tahmini birim fiyatı girin.`,
            },
          ],
    ),
  ])
  const prefix = `Sarf talebi ${supplyRequestNumber(request.sequence)}: `
  return {
    costCenterId: data.costCenterId,
    periodId: data.periodId,
    budgetItemId: data.budgetItemId,
    supplierId: data.supplierId,
    justification: `${prefix}${request.justification}`.slice(0, PURCHASE_JUSTIFICATION_MAX),
    items: open.map((line) => {
      const card = cards.get(line.stockItemId)
      return {
        name: card === undefined ? 'Stok kartı' : `${card.name} (${card.code})`,
        quantity: remainingOf(line),
        unit: card?.unit ?? 'piece',
        estimatedUnitPriceCents: prices.get(line.id) ?? 0,
        stockItemId: line.stockItemId,
      }
    }),
  }
}

/** Rolün talepte yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function supplyRequestActions(
  request: SupplyRequestState & {
    lines: readonly Pick<SupplyLine, 'quantity' | 'fulfilledQuantity'>[]
    purchaseRequestStatus: PurchaseRequestStatus | null
  },
  actor: SupplyActor,
): { cancel: boolean; decide: boolean; fulfill: boolean; convert: boolean } {
  const manager = canSeeAllSupplyRequests(actor.role)
  const approved = request.status === 'approved'
  const live =
    request.purchaseRequestStatus !== null && isLivePurchaseLink(request.purchaseRequestStatus)
  return {
    cancel: request.status === 'submitted' && request.requestedByUserId === actor.userId,
    decide: actor.role === 'yonetici' && request.status === 'submitted',
    fulfill: manager && approved,
    convert: manager && approved && !live && supplyRemaining(request.lines) > 0,
  }
}
