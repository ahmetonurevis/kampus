import { z } from 'zod'

import { csvAmount, csvCell, CSV_SEPARATOR } from './csv.ts'
import { DomainError } from './errors.ts'
import {
  assertItem,
  assertWarehouse,
  availableOn,
  cancelStockMovementSchema,
  isInbound,
  STOCK_NOTE_MAX,
  STOCK_QUANTITY_MAX,
  STOCK_UNIT_LABELS,
  type StockItemRef,
  type StockMovementLine,
  type StockMovementType,
  type StockUnit,
  type StockWarehouseRef,
} from './finance-inventory.ts'

/**
 * Stok sayımı ve fark raporu (docs/domain/finans.md DOM-FIN-081; ON-231). Yönetici bir depoda sayım
 * başlatır; o anki sistem miktarları (iptal edilmemiş hareketlerin toplamı, `DOM-FIN-078`) sayımın
 * satırlarına **anlık görüntü** olarak yazılır. Sayım sürerken kart kodu (barkod okuyucu klavye gibi
 * yazar, K-229) okutulur ya da miktar elle girilir. Fark raporu kart başına sistem, sayım sırasındaki
 * hareket, beklenen, sayılan ve fark miktarını, son alış fiyatı varsa fark tutarını verir; sayılmayan
 * kalemler ayrı listelenir ve değişmez (K-230). Tamamlama farkları tek işlemde `adjustment_in` /
 * `adjustment_out` düzeltme hareketleriyle yazar; iptal edilen sayım hareket yazmaz. Tamamlanan ya da
 * iptal edilen sayım değişmez.
 *
 * Sayım sürerken depoda hareket olabilir (K-231): kart için **beklenen** miktar, anlık görüntüye
 * sayım başladıktan sonra ve kartın son sayıldığı ana kadar kaydedilen (ve o ana kadar iptal
 * edilmemiş) hareketlerin eklenmesiyle bulunur. Kart sayıldıktan sonra yazılan hareket sayılan
 * miktarda yoktur ve düzeltmeye girmez; düzeltme, sayılan ile beklenen arasındaki farktır.
 *
 * Fonksiyonlar saftır; zaman `now`/`today` parametresiyle gelir.
 */

/** Sayımları ve fark raporunu okuyan roller (K-228). */
export const STOCK_COUNT_READ_ROLES = ['yonetici', 'onburo'] as const
/** Açık sayıma kart okutan ya da miktar giren roller (K-228). */
export const STOCK_COUNT_ENTRY_ROLES = ['yonetici', 'onburo'] as const
/** Sayımı başlatan, tamamlayan ve iptal eden rol (K-228). */
export const STOCK_COUNT_MANAGE_ROLES = ['yonetici'] as const

export const STOCK_COUNT_STATUSES = ['open', 'completed', 'cancelled'] as const
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number]
export const STOCK_COUNT_STATUS_LABELS = {
  open: 'Sürüyor',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<StockCountStatus, string>

export const STOCK_COUNT_CODE_MAX = 64

// --- Şemalar -------------------------------------------------------------------------------------

export const startStockCountSchema = z.strictObject({
  warehouseId: z.uuid('Sayılacak depoyu seçin.'),
  note: z
    .string()
    .trim()
    .max(STOCK_NOTE_MAX, `En fazla ${String(STOCK_NOTE_MAX)} karakter girebilirsiniz.`)
    .nullable()
    .transform((value) => (value === '' ? null : value))
    .default(null),
})
export type StartStockCountInput = z.input<typeof startStockCountSchema>

const countQuantity = z
  .number('Miktarı sayı olarak girin.')
  .int('Miktar tam sayı olmalıdır.')
  .max(STOCK_QUANTITY_MAX, 'Miktar çok büyük.')

/** Okutma: kart kodu (büyük harfe çevrilir) ve eklenecek miktar (varsayılan 1). */
export const stockCountScanSchema = z.strictObject({
  code: z
    .string('Kart kodunu okutun ya da yazın.')
    .trim()
    .min(1, 'Kart kodunu okutun ya da yazın.')
    .max(STOCK_COUNT_CODE_MAX, `Kod en fazla ${String(STOCK_COUNT_CODE_MAX)} karakter olabilir.`)
    .toUpperCase(),
  quantity: countQuantity.min(1, 'Eklenecek miktar en az 1 olmalıdır.').default(1),
})
export type StockCountScanInput = z.input<typeof stockCountScanSchema>

/** Satırın sayılan miktarını doğrudan yazar; `null` sayımı geri alır (kalem sayılmamış olur). */
export const setStockCountLineSchema = z.strictObject({
  itemId: z.uuid('Stok kartını seçin.'),
  countedQuantity: countQuantity.min(0, 'Sayılan miktar eksi olamaz.').nullable(),
})
export type SetStockCountLineInput = z.input<typeof setStockCountLineSchema>

export const cancelStockCountSchema = cancelStockMovementSchema
export type CancelStockCountInput = z.input<typeof cancelStockCountSchema>

// --- Model ---------------------------------------------------------------------------------------

export interface StockCountRef {
  id: string
  warehouseId: string
  status: StockCountStatus
  startedAt: string
}

/** Sayım satırı: anlık görüntüdeki sistem miktarı ve (sayıldıysa) sayılan miktar. */
export interface StockCountLine {
  itemId: string
  systemQuantity: number
  countedQuantity: number | null
  /** Satırın son sayıldığı an (UTC ISO); sayılmadıysa `null`. */
  countedAt: string | null
  /** Tamamlanan sayımda saklanan beklenen miktar; açık sayımda `null`. */
  expectedQuantity: number | null
  /** Tamamlanan sayımda saklanan birim maliyet (kuruş); açık sayımda `null`. */
  unitCostCents: number | null
}

/** Sayım sırasındaki hareket hesabına giren alanlar (kayıt ve iptal anı). */
export interface CountMovement {
  itemId: string
  type: StockMovementType
  quantity: number
  createdAt: string
  cancelledAt: string | null
}

export interface StockCountDifferenceRow {
  itemId: string
  systemQuantity: number
  /** Sayım başladıktan sonra, kart sayılana kadar kaydedilen hareketlerin net etkisi. */
  movementQuantity: number
  expectedQuantity: number
  countedQuantity: number
  /** Sayılan − beklenen: artı sayım fazlası, eksi sayım eksiği. */
  difference: number
  unitCostCents: number | null
  differenceCents: number | null
}

export interface StockCountReport {
  counted: StockCountDifferenceRow[]
  uncounted: { itemId: string; systemQuantity: number }[]
  totals: {
    countedItems: number
    uncountedItems: number
    differenceItems: number
    surplusCents: number
    shortageCents: number
    netCents: number
    /** Farkı olup birim maliyeti bilinmeyen kalem sayısı (tutara girmez). */
    unpricedDifferenceItems: number
  }
}

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path ? { path: path.map(String) } : {}),
  })

/** `at` anındaki miktar: o ana kadar kaydedilmiş ve o anda iptal edilmemiş hareketler. */
function balanceAt(movements: readonly CountMovement[], at: string): number {
  let total = 0
  for (const movement of movements)
    if (movement.createdAt <= at && (movement.cancelledAt === null || movement.cancelledAt > at))
      total += isInbound(movement.type) ? movement.quantity : -movement.quantity
  return total
}

/**
 * Kartın sayım sırasındaki hareketlerinin net etkisi (K-231): sayım başlangıcındaki miktar ile
 * kartın sayıldığı andaki miktar arasındaki fark. `movements` kartın bu depodaki, sayım başladıktan
 * sonra kaydedilen ya da iptal edilen hareketleridir; fazlası zarar vermez.
 */
export function movementDuringCount(
  movements: readonly CountMovement[],
  startedAt: string,
  countedAt: string,
): number {
  return balanceAt(movements, countedAt) - balanceAt(movements, startedAt)
}

const differenceCents = (difference: number, unitCostCents: number | null) =>
  unitCostCents === null ? null : difference * unitCostCents

/**
 * Fark raporu (K-230, K-231). Açık sayımda beklenen miktar ve birim maliyet o anki hareketlerden ve
 * son alış fiyatlarından hesaplanır (`live`); tamamlanan sayımda satırda saklanan değerler kullanılır
 * (`stored`), rapor sonradan değişmez. Sayılan satırlar kod sırasıyla gelir (çağıran sıralar);
 * sayılmayan ve anlık görüntüde miktarı olmayan satır listelenmez.
 */
export function stockCountReport(
  lines: readonly StockCountLine[],
  context:
    | {
        kind: 'live'
        startedAt: string
        movements: readonly CountMovement[]
        unitCosts: ReadonlyMap<string, number>
      }
    | { kind: 'stored' },
): StockCountReport {
  const counted: StockCountDifferenceRow[] = []
  const uncounted: StockCountReport['uncounted'] = []
  for (const line of lines) {
    if (line.countedQuantity === null || line.countedAt === null) {
      if (line.systemQuantity !== 0)
        uncounted.push({ itemId: line.itemId, systemQuantity: line.systemQuantity })
      continue
    }
    const countedAt = line.countedAt
    const expectedQuantity =
      context.kind === 'stored'
        ? (line.expectedQuantity ?? line.systemQuantity)
        : line.systemQuantity +
          movementDuringCount(
            context.movements.filter((movement) => movement.itemId === line.itemId),
            context.startedAt,
            countedAt,
          )
    const unitCostCents =
      context.kind === 'stored' ? line.unitCostCents : (context.unitCosts.get(line.itemId) ?? null)
    const difference = line.countedQuantity - expectedQuantity
    counted.push({
      itemId: line.itemId,
      systemQuantity: line.systemQuantity,
      movementQuantity: expectedQuantity - line.systemQuantity,
      expectedQuantity,
      countedQuantity: line.countedQuantity,
      difference,
      unitCostCents,
      differenceCents: differenceCents(difference, unitCostCents),
    })
  }
  const withDifference = counted.filter((row) => row.difference !== 0)
  const surplusCents = withDifference.reduce(
    (total, row) => total + Math.max(0, row.differenceCents ?? 0),
    0,
  )
  const shortageCents = withDifference.reduce(
    (total, row) => total + Math.max(0, -(row.differenceCents ?? 0)),
    0,
  )
  return {
    counted,
    uncounted,
    totals: {
      countedItems: counted.length,
      uncountedItems: uncounted.length,
      differenceItems: withDifference.length,
      surplusCents,
      shortageCents,
      netCents: surplusCents - shortageCents,
      unpricedDifferenceItems: withDifference.filter((row) => row.unitCostCents === null).length,
    },
  }
}

// --- Kurallar ------------------------------------------------------------------------------------

function assertOpen(count: Pick<StockCountRef, 'status'>) {
  if (count.status !== 'open')
    throw ruleError(
      'stock_count_closed',
      count.status === 'completed'
        ? 'Sayım tamamlandı; tamamlanan sayım değiştirilemez.'
        : 'Sayım iptal edildi; iptal edilen sayım değiştirilemez.',
    )
}

/**
 * Sayım başlatma (K-228): depo etkin; aynı depoda açık sayım varsa 409 `stock_count_open_exists`.
 * Anlık görüntü depodaki miktarı sıfırdan farklı her karttır (iptal edilmemiş hareketlerin toplamı).
 */
export function planStockCountStart(
  input: unknown,
  context: {
    warehouses: ReadonlyMap<string, StockWarehouseRef>
    openCountWarehouseIds: ReadonlySet<string>
    /** Depodaki kart başına miktar. */
    balances: ReadonlyMap<string, number>
  },
): {
  warehouseId: string
  note: string | null
  lines: { itemId: string; systemQuantity: number }[]
} {
  const data = startStockCountSchema.parse(input)
  const warehouse = assertWarehouse(context.warehouses.get(data.warehouseId), ['warehouseId'])
  if (context.openCountWarehouseIds.has(warehouse.id))
    throw new DomainError(
      'stock_count_open_exists',
      `${warehouse.name} deposunda süren bir sayım var; önce onu tamamlayın ya da iptal edin.`,
      { kind: 'conflict', path: ['warehouseId'] },
    )
  const lines = [...context.balances]
    .filter(([, quantity]) => quantity !== 0)
    .map(([itemId, systemQuantity]) => ({ itemId, systemQuantity }))
  return { warehouseId: warehouse.id, note: data.note, lines }
}

export interface CountedLine {
  itemId: string
  countedQuantity: number | null
  /** Anlık görüntüde olmayan kart sayılınca yeni satır açılır (sistem miktarı 0). */
  isNew: boolean
}

const itemByCode = (items: Iterable<StockItemRef>, code: string) => {
  for (const item of items) if (item.code === code) return item
  return undefined
}

/**
 * Okutma (K-229): kart kodu (barkod okuyucu kodu klavye gibi yazar; ayrı barkod alanı yok) kartı
 * bulur ve satırın sayılan miktarına `quantity` (varsayılan 1) eklenir. Kod bulunmazsa 422
 * `stock_count_item_not_found`; pasif kart sayılmaz. Toplam 1.000.000'u aşamaz.
 */
export function planStockCountScan(
  count: Pick<StockCountRef, 'status'>,
  input: unknown,
  context: {
    items: Iterable<StockItemRef>
    lines: ReadonlyMap<string, Pick<StockCountLine, 'countedQuantity'>>
  },
): CountedLine & { countedQuantity: number; item: StockItemRef } {
  const data = stockCountScanSchema.parse(input)
  assertOpen(count)
  const found = itemByCode(context.items, data.code)
  if (found === undefined)
    throw ruleError('stock_count_item_not_found', `${data.code} koduyla stok kartı bulunamadı.`, [
      'code',
    ])
  const item = assertItem(found, ['code'])
  const line = context.lines.get(item.id)
  const countedQuantity = (line?.countedQuantity ?? 0) + data.quantity
  if (countedQuantity > STOCK_QUANTITY_MAX)
    throw ruleError('stock_count_quantity_too_large', 'Sayılan miktar çok büyük.', ['quantity'])
  return { itemId: item.id, countedQuantity, isNew: line === undefined, item }
}

/**
 * Satırın sayılan miktarını doğrudan yazar ya da (`null`) sayımı geri alır (K-229). Anlık
 * görüntüde olmayan kart için yeni satır açılır; pasif kart sayılmaz.
 */
export function planStockCountLineSet(
  count: Pick<StockCountRef, 'status'>,
  input: unknown,
  context: {
    items: ReadonlyMap<string, StockItemRef>
    lines: ReadonlyMap<string, Pick<StockCountLine, 'countedQuantity'>>
  },
): CountedLine {
  const data = setStockCountLineSchema.parse(input)
  assertOpen(count)
  const line = context.lines.get(data.itemId)
  if (line === undefined) {
    const item = context.items.get(data.itemId)
    if (item === undefined)
      throw ruleError('stock_item_not_found', 'Stok kartı bulunamadı.', ['itemId'])
    if (data.countedQuantity !== null) assertItem(item, ['itemId'])
  }
  return { itemId: data.itemId, countedQuantity: data.countedQuantity, isNew: line === undefined }
}

export interface StockCountAdjustment {
  itemId: string
  type: 'adjustment_in' | 'adjustment_out'
  quantity: number
}

/**
 * Tamamlama (K-230, K-231): en az bir kalem sayılmış olmalı (422 `stock_count_empty`); depo etkin.
 * Farkı olan her kart için tek işlemde düzeltme hareketi yazılır (fazla `adjustment_in`, eksik
 * `adjustment_out`), gün tamamlama günüdür. Kartı pasif olan farkta 422 `stock_item_inactive`.
 * Eksik düzeltmesi depodaki miktarı bugün ya da sonra eksiye düşürecekse (kart sayıldıktan sonra
 * yazılan çıkışlar yüzünden) 422 `stock_count_negative`. Sayılmayan kalem değişmez.
 */
export function planStockCountComplete(
  count: Pick<StockCountRef, 'status' | 'warehouseId'>,
  report: StockCountReport,
  context: {
    items: ReadonlyMap<string, StockItemRef>
    warehouses: ReadonlyMap<string, StockWarehouseRef>
    /** Farkı olan kartların bu depodaki bütün hareketleri (iptal edilenler dahil). */
    movements: readonly StockMovementLine[]
    today: string
  },
): StockCountAdjustment[] {
  assertOpen(count)
  if (report.counted.length === 0)
    throw ruleError(
      'stock_count_empty',
      'Hiç kalem sayılmadı; tamamlamak için en az bir kartı sayın ya da sayımı iptal edin.',
    )
  const warehouse = assertWarehouse(context.warehouses.get(count.warehouseId), ['warehouseId'])
  return report.counted
    .filter((row) => row.difference !== 0)
    .map((row): StockCountAdjustment => {
      const item = assertItem(context.items.get(row.itemId), ['itemId'])
      if (row.difference < 0) {
        const pair = context.movements.filter(
          (movement) => movement.itemId === item.id && movement.warehouseId === warehouse.id,
        )
        const available = availableOn(pair, context.today)
        if (-row.difference > available)
          throw ruleError(
            'stock_count_negative',
            `${item.name} için ${String(-row.difference)} ${STOCK_UNIT_LABELS[item.unit]} eksik düzeltmesi ${warehouse.name} deposundaki miktarı eksiye düşürür (en çok ${String(available)}); kart sayıldıktan sonra çıkış yazılmış. Kartı yeniden sayın.`,
            ['itemId'],
          )
      }
      return {
        itemId: item.id,
        type: row.difference > 0 ? 'adjustment_in' : 'adjustment_out',
        quantity: Math.abs(row.difference),
      }
    })
}

/** İptal (K-230): gerekçe 5–500 karakter; yalnız açık sayım. Hareket yazılmaz. */
export function planStockCountCancel(count: Pick<StockCountRef, 'status'>, input: unknown) {
  const { reason } = cancelStockCountSchema.parse(input)
  assertOpen(count)
  return { reason }
}

/** Rolün sayımda yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları denetler). */
export function stockCountActions(role: string): {
  start: boolean
  count: boolean
  complete: boolean
  cancel: boolean
} {
  const manager = role === 'yonetici'
  return {
    start: manager,
    count: manager || role === 'onburo',
    complete: manager,
    cancel: manager,
  }
}

// --- CSV -----------------------------------------------------------------------------------------

export interface StockCountCsvItem {
  code: string
  name: string
  unit: StockUnit
}

const amountCell = (cents: number | null) => (cents === null ? csvCell('') : csvAmount(cents))

/**
 * Fark raporu CSV'si: önce sayılan kalemler (sistem, sayım sırasındaki hareket, beklenen, sayılan,
 * fark, birim maliyet, fark tutarı), sonra sayılmayan kalemler (yalnız sistem miktarı, "Sayılmadı").
 */
export function stockCountReportCsv(
  report: StockCountReport,
  items: ReadonlyMap<string, StockCountCsvItem>,
): string {
  const header = [
    'Kod',
    'Ürün',
    'Birim',
    'Sistem (anlık görüntü)',
    'Sayım sırasında hareket',
    'Beklenen',
    'Sayılan',
    'Fark',
    'Birim maliyet',
    'Fark tutarı',
    'Durum',
  ]
  const itemCells = (itemId: string) => {
    const item = items.get(itemId)
    return [
      csvCell(item?.code ?? ''),
      csvCell(item?.name ?? ''),
      csvCell(item === undefined ? '' : STOCK_UNIT_LABELS[item.unit]),
    ]
  }
  const counted = report.counted.map((row) => [
    ...itemCells(row.itemId),
    String(row.systemQuantity),
    String(row.movementQuantity),
    String(row.expectedQuantity),
    String(row.countedQuantity),
    String(row.difference),
    amountCell(row.unitCostCents),
    amountCell(row.differenceCents),
    csvCell(row.difference > 0 ? 'Fazla' : row.difference < 0 ? 'Eksik' : 'Uyumlu'),
  ])
  const uncounted = report.uncounted.map((row) => [
    ...itemCells(row.itemId),
    String(row.systemQuantity),
    '',
    '',
    '',
    '',
    '',
    '',
    csvCell('Sayılmadı'),
  ])
  return [header.map(csvCell), ...counted, ...uncounted]
    .map((row) => row.join(CSV_SEPARATOR))
    .join('\r\n')
}
