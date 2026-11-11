import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { financeCodeSchema, financeNameSchema } from './finance-cost-centers.ts'
import {
  PURCHASE_QUANTITY_MAX,
  PURCHASE_UNIT_LABELS,
  type PurchaseUnit,
} from './finance-purchase-requests.ts'
import { SUPPLIER_CATEGORIES } from './finance-suppliers.ts'

/**
 * Stok kartı, depo ve stok hareketi (docs/domain/finans.md DOM-FIN-077, DOM-FIN-078; ON-228,
 * ON-229). Stok kartı ürünü, birimini ve kritik seviyesini tanımlar; depo kurumun bir kampüsüne
 * bağlıdır. Stok miktarı saklanmaz, iptal edilmemiş hareketlerden türetilir: giriş, mal kabul girişi
 * ve transfer girişi artırır; çıkış ve transfer çıkışı azaltır. Bir ürünün bir depodaki miktarı
 * hiçbir günün sonunda eksiye düşemez (K-181): geriye tarihli çıkış sonraki günleri de eksiye
 * düşürmemelidir. Transfer tek işlemde iki harekettir. Hareket silinmez, yönetici gerekçeyle iptal
 * eder; mal kabulden gelen giriş yalnız kabul iptaliyle geri alınır (DOM-FIN-074). Materyal seti
 * teslimi (DOM-FIN-080) setin kalemleri kadar `delivery` çıkışı yazar; bu çıkışlar yalnız teslim
 * iptaliyle geri alınır. Tamamlanan stok sayımı (DOM-FIN-081) farkları `adjustment_in` ve
 * `adjustment_out` düzeltmeleriyle yazar; bunlar iptal edilmez (tamamlanan sayım değişmez).
 * Sarf talebinin karşılanması (DOM-FIN-091) `supply` çıkışı yazar; bu çıkış
 * hareket listesinden iptal edilmez, iade elle giriştir (`returned`, K-245).
 *
 * Fonksiyonlar saftır; zaman `today` parametresiyle gelir.
 */

/** Stok kartı, depo ve hareket listesini okuyan roller (K-180). */
export const STOCK_READ_ROLES = ['yonetici', 'onburo'] as const
/** Kart, depo, elle giriş, transfer ve hareket iptali yönetimdedir (K-180). */
export const STOCK_MANAGE_ROLES = ['yonetici'] as const
/** Stok çıkışını yönetici ve ön büro yazar (K-180). */
export const STOCK_ISSUE_ROLES = ['yonetici', 'onburo'] as const

/** Stoklanan birimler: satın alma birimlerinin sayılabilen ve ölçülebilen kısmı (K-182). */
export const STOCK_UNITS = [
  'piece',
  'pack',
  'box',
  'kilogram',
  'liter',
  'meter',
] as const satisfies readonly PurchaseUnit[]
export type StockUnit = (typeof STOCK_UNITS)[number]
export const STOCK_UNIT_LABELS = Object.fromEntries(
  STOCK_UNITS.map((unit) => [unit, PURCHASE_UNIT_LABELS[unit]]),
) as Record<StockUnit, string>
export const isStockUnit = (unit: string): unit is StockUnit =>
  STOCK_UNITS.some((value) => value === unit)

/** Stok kartı kategorisi tedarikçi kategorileriyle aynı sabit kümedir (DOM-FIN-070, K-125). */
export const STOCK_CATEGORIES = SUPPLIER_CATEGORIES
export type StockCategory = (typeof STOCK_CATEGORIES)[number]

export const STOCK_MOVEMENT_TYPES = [
  'in',
  'out',
  'transfer_in',
  'transfer_out',
  'receipt',
  'delivery',
  'adjustment_in',
  'adjustment_out',
  'supply',
] as const
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]
export const STOCK_MOVEMENT_TYPE_LABELS = {
  in: 'Giriş',
  out: 'Çıkış',
  transfer_in: 'Transfer girişi',
  transfer_out: 'Transfer çıkışı',
  receipt: 'Mal kabul girişi',
  delivery: 'Materyal seti teslimi',
  adjustment_in: 'Sayım fazlası düzeltmesi',
  adjustment_out: 'Sayım eksiği düzeltmesi',
  supply: 'Sarf talebi karşılama',
} as const satisfies Record<StockMovementType, string>
/** Miktarı artıran hareket türleri; veritabanı toplamı da bu kümeyi kullanır. */
export const STOCK_INBOUND_TYPES = [
  'in',
  'transfer_in',
  'receipt',
  'adjustment_in',
] as const satisfies readonly StockMovementType[]
const INBOUND: ReadonlySet<StockMovementType> = new Set(STOCK_INBOUND_TYPES)
export const isInbound = (type: StockMovementType) => INBOUND.has(type)
/** Stok sayımının tamamlanınca yazdığı düzeltme hareketleri (DOM-FIN-081). */
export const isCountAdjustment = (type: StockMovementType) =>
  type === 'adjustment_in' || type === 'adjustment_out'

export const STOCK_ENTRY_REASONS = [
  'opening',
  'donation',
  'count_surplus',
  'returned',
  'other',
] as const
export type StockEntryReason = (typeof STOCK_ENTRY_REASONS)[number]
export const STOCK_ENTRY_REASON_LABELS = {
  opening: 'Açılış stoku',
  donation: 'Bağış',
  count_surplus: 'Sayım fazlası',
  returned: 'Kullanımdan iade',
  other: 'Diğer',
} as const satisfies Record<StockEntryReason, string>

export const STOCK_ISSUE_REASONS = ['usage', 'damage', 'loss', 'count_shortage', 'other'] as const
export type StockIssueReason = (typeof STOCK_ISSUE_REASONS)[number]
export const STOCK_ISSUE_REASON_LABELS = {
  usage: 'Kullanım',
  damage: 'Hasar ve fire',
  loss: 'Kayıp',
  count_shortage: 'Sayım eksiği',
  other: 'Diğer',
} as const satisfies Record<StockIssueReason, string>

export const STOCK_QUANTITY_MAX = PURCHASE_QUANTITY_MAX
export const STOCK_ITEM_NAME_MAX = 120
export const STOCK_WAREHOUSE_NAME_MAX = 80
export const STOCK_NOTE_MAX = 500
export const STOCK_OTHER_NOTE_MIN = 3
export const STOCK_CANCEL_REASON_MIN = 5
export const STOCK_CANCEL_REASON_MAX = 500
/** Kimyasal partinin numarası (DOM-FIN-090, K-241). */
export const STOCK_LOT_NUMBER_MAX = 40

// --- Şemalar -------------------------------------------------------------------------------------

const noteText = z
  .string()
  .trim()
  .max(STOCK_NOTE_MAX, `En fazla ${String(STOCK_NOTE_MAX)} karakter girebilirsiniz.`)
  .nullable()
  .transform((value) => (value === '' ? null : value))
const optionalNote = noteText.default(null)

const minQuantitySchema = z
  .number('Kritik seviyeyi sayı olarak girin.')
  .int('Kritik seviye tam sayı olmalıdır.')
  .min(0, 'Kritik seviye eksi olamaz.')
  .max(STOCK_QUANTITY_MAX, 'Kritik seviye çok büyük.')
  .nullable()

export const stockItemSchema = z.strictObject({
  code: financeCodeSchema,
  name: financeNameSchema.max(
    STOCK_ITEM_NAME_MAX,
    `En fazla ${String(STOCK_ITEM_NAME_MAX)} karakter girebilirsiniz.`,
  ),
  category: z.enum(STOCK_CATEGORIES, 'Kategoriyi seçin.'),
  unit: z.enum(STOCK_UNITS, 'Birimi seçin.'),
  minQuantity: minQuantitySchema.default(null),
})
export type StockItemInput = z.input<typeof stockItemSchema>
export type StockItemFields = z.output<typeof stockItemSchema>

export const updateStockItemSchema = z
  .strictObject({
    ...stockItemSchema.shape,
    minQuantity: minQuantitySchema,
    isActive: z.boolean('Durumu seçin.'),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan gönderin.')
export type UpdateStockItemInput = z.input<typeof updateStockItemSchema>

const campusIdSchema = z.string('Kampüs seçin.').trim().min(1, 'Kampüs seçin.').max(100)

export const stockWarehouseSchema = z.strictObject({
  name: financeNameSchema.max(
    STOCK_WAREHOUSE_NAME_MAX,
    `En fazla ${String(STOCK_WAREHOUSE_NAME_MAX)} karakter girebilirsiniz.`,
  ),
  campusId: campusIdSchema,
  note: optionalNote,
})
export type StockWarehouseInput = z.input<typeof stockWarehouseSchema>
export type StockWarehouseFields = z.output<typeof stockWarehouseSchema>

export const updateStockWarehouseSchema = z
  .strictObject({
    ...stockWarehouseSchema.shape,
    note: noteText,
    isActive: z.boolean('Durumu seçin.'),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan gönderin.')
export type UpdateStockWarehouseInput = z.input<typeof updateStockWarehouseSchema>

const quantitySchema = z
  .number('Miktarı girin.')
  .int('Miktar tam sayı olmalıdır.')
  .min(1, 'Miktar en az 1 olmalıdır.')
  .max(STOCK_QUANTITY_MAX, 'Miktar çok büyük.')

const otherNeedsNote = (
  value: { reason: string; note: string | null },
  ctx: z.RefinementCtx,
): void => {
  if (value.reason === 'other' && (value.note === null || value.note.length < STOCK_OTHER_NOTE_MIN))
    ctx.addIssue({
      code: 'custom',
      path: ['note'],
      message: '"Diğer" nedeni için açıklamayı en az 3 karakterle yazın.',
    })
}

const movementBase = {
  itemId: z.uuid('Stok kartını seçin.'),
  quantity: quantitySchema,
  movementDate: daySchema,
  note: optionalNote,
}

// Kimyasal kartın elle girişinde parti numarası ve son kullanma tarihi birlikte gelir (DOM-FIN-090,
// K-241); kartın kimyasal olup olmadığı `planStockEntry`'de denetlenir.
const lotNumberSchema = z
  .string('Parti numarasını yazın.')
  .trim()
  .max(STOCK_LOT_NUMBER_MAX, `En fazla ${String(STOCK_LOT_NUMBER_MAX)} karakter girebilirsiniz.`)
  .regex(/^[^\p{Cc}]*$/u, 'Parti numarasında kontrol karakteri olamaz.')
  .nullable()
  .transform((value) => (value === '' ? null : value))

const lotPairNeedsBoth = (
  value: { lotNumber: string | null; expiryDate: string | null },
  ctx: z.RefinementCtx,
): void => {
  if (value.lotNumber !== null && value.expiryDate === null)
    ctx.addIssue({
      code: 'custom',
      path: ['expiryDate'],
      message: 'Partinin son kullanma tarihini girin.',
    })
  if (value.lotNumber === null && value.expiryDate !== null)
    ctx.addIssue({ code: 'custom', path: ['lotNumber'], message: 'Parti numarasını yazın.' })
}

export const stockEntrySchema = z
  .strictObject({
    ...movementBase,
    warehouseId: z.uuid('Depoyu seçin.'),
    reason: z.enum(STOCK_ENTRY_REASONS, 'Giriş nedenini seçin.'),
    lotNumber: lotNumberSchema.default(null),
    expiryDate: daySchema.nullable().default(null),
  })
  .superRefine(otherNeedsNote)
  .superRefine(lotPairNeedsBoth)
export type StockEntryInput = z.input<typeof stockEntrySchema>

export const stockIssueSchema = z
  .strictObject({
    ...movementBase,
    warehouseId: z.uuid('Depoyu seçin.'),
    reason: z.enum(STOCK_ISSUE_REASONS, 'Çıkış nedenini seçin.'),
  })
  .superRefine(otherNeedsNote)
export type StockIssueInput = z.input<typeof stockIssueSchema>

export const stockTransferSchema = z
  .strictObject({
    ...movementBase,
    fromWarehouseId: z.uuid('Çıkış deposunu seçin.'),
    toWarehouseId: z.uuid('Giriş deposunu seçin.'),
  })
  .superRefine((value, ctx) => {
    if (value.fromWarehouseId === value.toWarehouseId)
      ctx.addIssue({
        code: 'custom',
        path: ['toWarehouseId'],
        message: 'Giriş deposu çıkış deposundan farklı olmalıdır.',
      })
  })
export type StockTransferInput = z.input<typeof stockTransferSchema>

export const cancelStockMovementSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(STOCK_CANCEL_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      STOCK_CANCEL_REASON_MAX,
      `En fazla ${String(STOCK_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    ),
})
export type CancelStockMovementInput = z.input<typeof cancelStockMovementSchema>

// --- Miktar --------------------------------------------------------------------------------------

/** Miktar hesabına giren hareket alanları. */
export interface StockMovementLine {
  id: string
  itemId: string
  warehouseId: string
  type: StockMovementType
  quantity: number
  movementDate: string
  cancelledAt: string | null
}

export const stockPairKey = (itemId: string, warehouseId: string) => `${itemId}|${warehouseId}`
const signed = (movement: Pick<StockMovementLine, 'type' | 'quantity'>) =>
  isInbound(movement.type) ? movement.quantity : -movement.quantity
const live = <T extends Pick<StockMovementLine, 'cancelledAt'>>(movements: readonly T[]) =>
  movements.filter((movement) => movement.cancelledAt === null)

/** Ürün × depo miktarları; iptal edilen hareket sayılmaz, sıfır miktar listelenir. */
export function stockBalances(
  movements: readonly Omit<StockMovementLine, 'id' | 'movementDate'>[],
): Map<string, number> {
  const balances = new Map<string, number>()
  for (const movement of live(movements)) {
    const key = stockPairKey(movement.itemId, movement.warehouseId)
    balances.set(key, (balances.get(key) ?? 0) + signed(movement))
  }
  return balances
}

/** Bir ürünün bir depodaki gün sonu miktarları, artan gün sırasıyla (iptal edilen sayılmaz). */
function dailyClosings(
  movements: readonly Pick<
    StockMovementLine,
    'type' | 'quantity' | 'movementDate' | 'cancelledAt'
  >[],
): { day: string; balance: number }[] {
  const byDay = new Map<string, number>()
  for (const movement of live(movements))
    byDay.set(movement.movementDate, (byDay.get(movement.movementDate) ?? 0) + signed(movement))
  let balance = 0
  return [...byDay.keys()].sort().map((day) => {
    balance += byDay.get(day) ?? 0
    return { day, balance }
  })
}

/** Gün sonu miktarı ilk kez eksiye düşen gün; yoksa `null`. */
export function firstNegativeDay(
  movements: readonly Pick<
    StockMovementLine,
    'type' | 'quantity' | 'movementDate' | 'cancelledAt'
  >[],
): { day: string; balance: number } | null {
  return dailyClosings(movements).find((closing) => closing.balance < 0) ?? null
}

/**
 * `day` gününde çıkılabilecek en çok miktar (K-181): o günün ve sonraki her günün gün sonu
 * miktarının en küçüğü. Geriye tarihli çıkış sonraki günlerdeki çıkışları eksiye düşüremez.
 */
export function availableOn(
  movements: readonly Pick<
    StockMovementLine,
    'type' | 'quantity' | 'movementDate' | 'cancelledAt'
  >[],
  day: string,
): number {
  const closings = dailyClosings(movements)
  let atDay = 0
  for (const closing of closings) if (closing.day <= day) atDay = closing.balance
  const later = closings.filter((closing) => closing.day > day).map((closing) => closing.balance)
  return Math.max(0, Math.min(atDay, ...later))
}

/** Kritik seviye (K-182): kritik seviye tanımlı ve toplam miktar ona eşit ya da altında. */
export const isBelowMinimum = (quantity: number, minQuantity: number | null) =>
  minQuantity !== null && quantity <= minQuantity

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path ? { path: path.map(String) } : {}),
  })
const conflictError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'conflict', path: [path] })

/** Türkçe harf ve büyük/küçük harf duyarsız ad karşılaştırması (depo adı tekilliği). */
const FOLD = new Map([...'ıİğĞüÜşŞöÖçÇ'].map((char, index) => [char, 'iigguussoocc'[index]]))
export const foldName = (value: string) =>
  [...value.trim()]
    .map((char) => FOLD.get(char) ?? char)
    .join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')

export interface StockItemRef {
  id: string
  code: string
  name: string
  unit: StockUnit
  isActive: boolean
}

export interface StockWarehouseRef {
  id: string
  name: string
  campusId: string
  isActive: boolean
}

/** Yeni stok kartı: kod kurumda tekil (pasif kartlar dahil; 409 `stock_item_code_exists`). */
export function planStockItem(
  input: unknown,
  context: { items: readonly Pick<StockItemRef, 'id' | 'code'>[] },
): StockItemFields {
  const data = stockItemSchema.parse(input)
  if (context.items.some((item) => item.code === data.code))
    throw conflictError('stock_item_code_exists', 'Bu kodla kayıtlı bir stok kartı var.', 'code')
  return data
}

/**
 * Stok kartı düzeltmesi (K-182): kod tekil; hareketi olan kartın birimi değişmez; miktarı olan
 * kart pasifleşmez (önce çıkış ya da transferle sıfırlanır).
 */
export function planStockItemUpdate(
  current: Pick<StockItemRef, 'id' | 'unit'>,
  input: unknown,
  context: {
    items: readonly Pick<StockItemRef, 'id' | 'code'>[]
    hasMovements: boolean
    quantity: number
  },
): z.output<typeof updateStockItemSchema> {
  const changes = updateStockItemSchema.parse(input)
  if (
    changes.code !== undefined &&
    context.items.some((item) => item.id !== current.id && item.code === changes.code)
  )
    throw conflictError('stock_item_code_exists', 'Bu kodla kayıtlı bir stok kartı var.', 'code')
  if (changes.unit !== undefined && changes.unit !== current.unit && context.hasMovements)
    throw ruleError(
      'stock_item_unit_locked',
      'Hareketi olan stok kartının birimi değiştirilemez; yeni birim için yeni kart açın.',
      ['unit'],
    )
  if (changes.isActive === false && context.quantity !== 0)
    throw ruleError(
      'stock_item_has_stock',
      `Stokta ${String(context.quantity)} bulunan kart pasifleştirilemez; önce miktarı sıfırlayın.`,
      ['isActive'],
    )
  return changes
}

export interface WarehouseContext {
  /** Kurumun etkin, arşivlenmemiş kampüsleri. */
  activeCampusIds: ReadonlySet<string>
  warehouses: readonly Pick<StockWarehouseRef, 'id' | 'name'>[]
}

function assertWarehouseName(name: string, id: string | null, context: WarehouseContext) {
  const folded = foldName(name)
  if (context.warehouses.some((item) => item.id !== id && foldName(item.name) === folded))
    throw conflictError('stock_warehouse_name_exists', 'Bu adla kayıtlı bir depo var.', 'name')
}

function assertCampus(campusId: string, context: WarehouseContext) {
  if (!context.activeCampusIds.has(campusId))
    throw ruleError('stock_warehouse_campus_not_found', 'Etkin bir kampüs seçin.', ['campusId'])
}

/** Yeni depo (K-180): etkin kampüse bağlı; ad kurumda tekil (Türkçe harf ve büyük/küçük duyarsız). */
export function planStockWarehouse(
  input: unknown,
  context: WarehouseContext,
): StockWarehouseFields {
  const data = stockWarehouseSchema.parse(input)
  assertCampus(data.campusId, context)
  assertWarehouseName(data.name, null, context)
  return data
}

/** Depo düzeltmesi: stoku olan depo başka kampüse taşınmaz ve pasifleşmez (K-180). */
export function planStockWarehouseUpdate(
  current: Pick<StockWarehouseRef, 'id' | 'campusId'>,
  input: unknown,
  context: WarehouseContext & { quantity: number },
): z.output<typeof updateStockWarehouseSchema> {
  const changes = updateStockWarehouseSchema.parse(input)
  if (changes.campusId !== undefined && changes.campusId !== current.campusId) {
    assertCampus(changes.campusId, context)
    if (context.quantity !== 0)
      throw ruleError(
        'stock_warehouse_has_stock',
        'Stoku olan depo başka kampüse bağlanamaz; önce stoku transfer edin.',
        ['campusId'],
      )
  }
  if (changes.name !== undefined) assertWarehouseName(changes.name, current.id, context)
  if (changes.isActive === false && context.quantity !== 0)
    throw ruleError(
      'stock_warehouse_has_stock',
      'Stoku olan depo pasifleştirilemez; önce stoku transfer edin ya da çıkış yazın.',
      ['isActive'],
    )
  return changes
}

export function assertItem(
  item: StockItemRef | undefined,
  path: (string | number)[],
): StockItemRef {
  if (item === undefined) throw ruleError('stock_item_not_found', 'Stok kartı bulunamadı.', path)
  if (!item.isActive)
    throw ruleError('stock_item_inactive', `${item.name} pasif; hareket yazılmaz.`, path)
  return item
}

export function assertWarehouse(
  warehouse: StockWarehouseRef | undefined,
  path: (string | number)[],
): StockWarehouseRef {
  if (warehouse === undefined)
    throw ruleError('stock_warehouse_not_found', 'Depo bulunamadı.', path)
  if (!warehouse.isActive)
    throw ruleError('stock_warehouse_inactive', `${warehouse.name} pasif; hareket yazılmaz.`, path)
  return warehouse
}

function assertDate(day: string, today: string) {
  if (day > today)
    throw ruleError('stock_movement_date_future', 'Hareket günü bugünden sonra olamaz.', [
      'movementDate',
    ])
}

function assertAvailable(
  item: StockItemRef,
  warehouse: StockWarehouseRef,
  pair: readonly StockMovementLine[],
  quantity: number,
  day: string,
  path: (string | number)[] = ['quantity'],
) {
  const available = availableOn(pair, day)
  if (quantity > available)
    throw ruleError(
      'stock_insufficient',
      `${warehouse.name} deposunda yeterli ${item.name} yok (çıkılabilecek en çok ${String(available)} ${STOCK_UNIT_LABELS[item.unit]}).`,
      path,
    )
}

export interface StockMovementContext {
  items: ReadonlyMap<string, StockItemRef>
  warehouses: ReadonlyMap<string, StockWarehouseRef>
  /** İlgili ürün × depo çiftlerinin bütün hareketleri (iptal edilenler dahil). */
  movements: readonly StockMovementLine[]
  /** Europe/Istanbul günü. */
  today: string
  /** Kimyasal bilgisi olan kartlar (DOM-FIN-090); elle girişte parti ister. */
  chemicalItemIds?: ReadonlySet<string>
}

const pairOf = (movements: readonly StockMovementLine[], itemId: string, warehouseId: string) =>
  movements.filter((movement) => movement.itemId === itemId && movement.warehouseId === warehouseId)

/**
 * Elle giriş (DOM-FIN-078): etkin kart ve depo, gün bugünden sonra olamaz. Kimyasal kartın girişi
 * parti numarası ve son kullanma tarihi ister; kimyasal olmayan kartın girişinde parti yazılmaz
 * (DOM-FIN-090, K-241).
 */
export function planStockEntry(input: unknown, context: StockMovementContext) {
  const data = stockEntrySchema.parse(input)
  const item = assertItem(context.items.get(data.itemId), ['itemId'])
  assertWarehouse(context.warehouses.get(data.warehouseId), ['warehouseId'])
  assertDate(data.movementDate, context.today)
  const chemical = context.chemicalItemIds?.has(item.id) === true
  if (chemical && data.lotNumber === null)
    throw ruleError(
      'stock_lot_required',
      `${item.name} kimyasal; girişte parti numarası ve son kullanma tarihi zorunludur.`,
      ['lotNumber'],
    )
  if (!chemical && data.lotNumber !== null)
    throw ruleError(
      'stock_lot_not_allowed',
      'Parti ve son kullanma tarihi yalnız kimyasal kartların girişinde yazılır.',
      ['lotNumber'],
    )
  return data
}

/** Çıkış (DOM-FIN-078, K-181): o gün ve sonrasında depodaki miktarı aşamaz. */
export function planStockIssue(input: unknown, context: StockMovementContext) {
  const data = stockIssueSchema.parse(input)
  const item = assertItem(context.items.get(data.itemId), ['itemId'])
  const warehouse = assertWarehouse(context.warehouses.get(data.warehouseId), ['warehouseId'])
  assertDate(data.movementDate, context.today)
  assertAvailable(
    item,
    warehouse,
    pairOf(context.movements, item.id, warehouse.id),
    data.quantity,
    data.movementDate,
  )
  return data
}

/**
 * Depolar arası transfer (DOM-FIN-078): aynı gün çıkış deposundan çıkış, giriş deposuna giriş; iki
 * depo farklı ve etkin, kampüsleri farklı olabilir. Çıkış deposunun miktarı aşılamaz.
 */
export function planStockTransfer(input: unknown, context: StockMovementContext) {
  const data = stockTransferSchema.parse(input)
  const item = assertItem(context.items.get(data.itemId), ['itemId'])
  const from = assertWarehouse(context.warehouses.get(data.fromWarehouseId), ['fromWarehouseId'])
  assertWarehouse(context.warehouses.get(data.toWarehouseId), ['toWarehouseId'])
  assertDate(data.movementDate, context.today)
  assertAvailable(
    item,
    from,
    pairOf(context.movements, item.id, from.id),
    data.quantity,
    data.movementDate,
  )
  return data
}

export interface StockIssueLine {
  itemId: string
  quantity: number
  /** Hata yolu (ör. `['items', 0, 'stockItemId']`). */
  path: (string | number)[]
}

/**
 * Birden çok kalemin aynı depodan aynı gün çıkışı (DOM-FIN-080 materyal seti teslimi): her kart ve
 * depo etkin, gün bugünden sonra olamaz, her kalem o gün ve sonrasında depodaki miktarı aşamaz
 * (K-181). Aynı kart iki kez gelirse miktarları birlikte denetlenir.
 */
export function planStockIssueLines(
  data: { warehouseId: string; day: string; lines: readonly StockIssueLine[] },
  context: StockMovementContext,
  paths: { warehouse: (string | number)[]; day: (string | number)[] },
): void {
  const warehouse = assertWarehouse(context.warehouses.get(data.warehouseId), paths.warehouse)
  if (data.day > context.today)
    throw ruleError('stock_movement_date_future', 'Hareket günü bugünden sonra olamaz.', paths.day)
  const totals = new Map<
    string,
    { item: StockItemRef; quantity: number; path: (string | number)[] }
  >()
  for (const line of data.lines) {
    const item = assertItem(context.items.get(line.itemId), line.path)
    const total = totals.get(item.id)
    totals.set(item.id, {
      item,
      quantity: (total?.quantity ?? 0) + line.quantity,
      path: total?.path ?? line.path,
    })
  }
  for (const { item, quantity, path } of totals.values())
    assertAvailable(
      item,
      warehouse,
      pairOf(context.movements, item.id, warehouse.id),
      quantity,
      data.day,
      path,
    )
}

export interface CancellableMovement extends StockMovementLine {
  transferId: string | null
  receiptId: string | null
}

/** İptal edilecek hareketler çıkarıldıktan sonra her çift için hiçbir gün eksiye düşmemeli. */
function assertCancelKeepsStock(
  cancelIds: ReadonlySet<string>,
  movements: readonly StockMovementLine[],
  names: {
    items: ReadonlyMap<string, StockItemRef>
    warehouses: ReadonlyMap<string, StockWarehouseRef>
  },
  message: (item: string, warehouse: string, day: string) => string,
) {
  const remaining = movements.filter((movement) => !cancelIds.has(movement.id))
  const pairs = new Set(
    movements
      .filter((movement) => cancelIds.has(movement.id) && isInbound(movement.type))
      .map((movement) => stockPairKey(movement.itemId, movement.warehouseId)),
  )
  for (const key of pairs) {
    const [itemId = '', warehouseId = ''] = key.split('|')
    const negative = firstNegativeDay(pairOf(remaining, itemId, warehouseId))
    if (negative !== null)
      throw ruleError(
        'stock_cancel_negative',
        message(
          names.items.get(itemId)?.name ?? 'ürün',
          names.warehouses.get(warehouseId)?.name ?? 'depo',
          negative.day,
        ),
      )
  }
}

/**
 * Hareket iptali (DOM-FIN-078, K-183): gerekçeyle, silinmez. Transferin iki hareketi birlikte iptal
 * edilir; mal kabul girişi yalnız kabul iptaliyle geri alınır. Giriş iptali stoku hiçbir gün eksiye
 * düşürmemelidir. İptal edilecek hareket kimlikleri döner.
 */
export function planStockMovementCancel(
  movement: CancellableMovement,
  input: unknown,
  context: Omit<StockMovementContext, 'today' | 'movements'> & {
    movements: readonly CancellableMovement[]
  },
): { reason: string; ids: string[] } {
  const { reason } = cancelStockMovementSchema.parse(input)
  if (movement.cancelledAt !== null)
    throw ruleError('stock_movement_already_cancelled', 'Bu hareket zaten iptal edildi.')
  if (movement.type === 'receipt' || movement.receiptId !== null)
    throw ruleError(
      'stock_movement_from_receipt',
      'Mal kabulden gelen giriş buradan iptal edilmez; kabulü iptal edin.',
    )
  if (movement.type === 'delivery')
    throw ruleError(
      'stock_movement_from_delivery',
      'Materyal seti teslimindeki çıkış buradan iptal edilmez; teslimi iptal edin.',
    )
  if (movement.type === 'supply')
    throw ruleError(
      'stock_movement_from_supply',
      'Sarf talebi karşılamasındaki çıkış iptal edilmez; geri gelen malzemeyi "Kullanımdan iade" girişiyle yazın.',
    )
  if (isCountAdjustment(movement.type))
    throw ruleError(
      'stock_movement_from_count',
      'Sayım düzeltmesi iptal edilmez; tamamlanan sayım değiştirilemez. Fark varsa yeni sayım yapın.',
    )
  const ids =
    movement.transferId === null
      ? [movement.id]
      : context.movements
          .filter((item) => item.transferId === movement.transferId && item.cancelledAt === null)
          .map((item) => item.id)
  assertCancelKeepsStock(
    new Set(ids),
    context.movements,
    context,
    (item, warehouse, day) =>
      `İptal ${warehouse} deposundaki ${item} miktarını ${day} günü eksiye düşürür; önce sonraki çıkışları iptal edin.`,
  )
  return { reason, ids }
}

export interface ReceiptStockLine {
  orderItemId: string
  acceptedQuantity: number
  stockItemId: string | null
}

export interface ReceiptStockEntry {
  orderItemId: string
  itemId: string
  warehouseId: string
  quantity: number
}

/**
 * Mal kabulden depoya giriş (DOM-FIN-078, K-184): stok kartı seçilen ve kabul edilen miktarı olan
 * her kalem seçilen depoya kabul gününde giriş yazar; reddedilen miktar girmez. Kart ve depo etkin,
 * kartın birimi sipariş kalemininkiyle aynı olmalıdır (birim çevirisi yok). Kart seçilmezse giriş
 * yoktur.
 */
export function planReceiptStockEntries(
  data: { warehouseId: string | null; lines: readonly ReceiptStockLine[] },
  context: {
    items: ReadonlyMap<string, StockItemRef>
    warehouses: ReadonlyMap<string, StockWarehouseRef>
    orderUnits: ReadonlyMap<string, string>
  },
): ReceiptStockEntry[] {
  const linked = data.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.stockItemId !== null)
  if (linked.length === 0) return []
  if (data.warehouseId === null)
    throw ruleError('stock_warehouse_required', 'Stok girişi için depoyu seçin.', ['warehouseId'])
  const warehouse = assertWarehouse(context.warehouses.get(data.warehouseId), ['warehouseId'])
  return linked.flatMap(({ line, index }) => {
    const item = assertItem(context.items.get(line.stockItemId ?? ''), [
      'lines',
      index,
      'stockItemId',
    ])
    const unit = context.orderUnits.get(line.orderItemId)
    if (unit !== undefined && unit !== item.unit)
      throw ruleError(
        'stock_unit_mismatch',
        `${item.name} kartının birimi (${STOCK_UNIT_LABELS[item.unit]}) sipariş kaleminin birimiyle aynı olmalıdır.`,
        ['lines', index, 'stockItemId'],
      )
    return line.acceptedQuantity > 0
      ? [
          {
            orderItemId: line.orderItemId,
            itemId: item.id,
            warehouseId: warehouse.id,
            quantity: line.acceptedQuantity,
          },
        ]
      : []
  })
}

/**
 * Mal kabul iptalinin stok etkisi (K-184): kabulün girişleri birlikte iptal edilir; giriş sonraki
 * çıkışlarla kullanıldıysa ve iptal stoku eksiye düşürecekse kabul iptal edilmez.
 */
export function planReceiptStockCancel(
  receiptMovementIds: readonly string[],
  context: Omit<StockMovementContext, 'today'>,
): string[] {
  const ids = context.movements
    .filter((movement) => receiptMovementIds.includes(movement.id) && movement.cancelledAt === null)
    .map((movement) => movement.id)
  assertCancelKeepsStock(
    new Set(ids),
    context.movements,
    context,
    (item, warehouse, day) =>
      `Kabulün ${warehouse} deposuna girdiği ${item} çıkışlarda kullanıldı; iptal ${day} günü stoku eksiye düşürür. Önce ilgili çıkışları iptal edin.`,
  )
  return ids
}

/** Rolün stokta yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function stockActions(role: string): {
  manage: boolean
  entry: boolean
  issue: boolean
  transfer: boolean
  cancel: boolean
} {
  const manager = role === 'yonetici'
  return {
    manage: manager,
    entry: manager,
    issue: manager || role === 'onburo',
    transfer: manager,
    cancel: manager,
  }
}
