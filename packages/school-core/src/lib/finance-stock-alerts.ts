import { DomainError } from './errors.ts'
import {
  isBelowMinimum,
  STOCK_QUANTITY_MAX,
  STOCK_UNIT_LABELS,
  type StockUnit,
} from './finance-inventory.ts'
import {
  PURCHASE_ITEMS_MAX,
  PURCHASE_JUSTIFICATION_MAX,
  type PurchaseRequestStatus,
} from './finance-purchase-requests.ts'

/**
 * Kritik stok uyarısı ve satın alma talebi önerisi (docs/domain/finans.md DOM-FIN-079; ON-230).
 * Kritik seviye kartın kurum toplamına uygulanır (DOM-FIN-077, K-200): toplam miktar kritik seviyeye
 * eşit ya da altındaysa etkin kart kritik listededir; depo kırılımı bilgi içindir. Öneri miktarı
 * stoku kritik seviyenin iki katına tamamlar (K-201). Talep önerisi yalnız taslak formunu doldurur;
 * talep bugünkü satın alma talebi kurallarıyla açılır (DOM-FIN-071, K-203). Önerinin kalemleri
 * stok kartına bağlıdır; siparişe dönmemiş açık talepteki miktar uyarı olarak gösterilir (ON-339,
 * K-221, K-222).
 *
 * Fonksiyonlar saftır; girdi servisin yüklediği kart, depo ve miktar satırlarıdır.
 */

/** Kritik listeye giren kart alanları. */
export interface CriticalStockItem {
  id: string
  code: string
  unit: StockUnit
  minQuantity: number | null
  isActive: boolean
}

export interface StockBalanceLine {
  itemId: string
  warehouseId: string
  quantity: number
}

export interface CriticalStockRow<TItem extends CriticalStockItem> {
  item: TItem
  /** Kritik seviye (kritik listede hep doludur). */
  minQuantity: number
  /** Kurum toplamı: etkin ve pasif bütün depolar. */
  quantity: number
  /** Kritik seviyeye göre eksik: kritik seviye eksi toplam, en az sıfır. */
  shortage: number
  suggestedQuantity: number
  /** Etkin depolar ve miktarı olan pasif depolar, verilen depo sırasıyla. */
  warehouses: { warehouseId: string; quantity: number }[]
}

/**
 * Öneri miktarı (K-201): stoku kritik seviyenin iki katına tamamlayan miktar, en az 1. Kartta hedef
 * (azami) seviye alanı yoktur; kritik seviye yeniden sipariş noktası, bir kritik seviye de tampon
 * sayılır. Stok hareketinin üst sınırını aşmaz.
 */
export function suggestedReorderQuantity(quantity: number, minQuantity: number): number {
  return Math.min(STOCK_QUANTITY_MAX, Math.max(1, 2 * minQuantity - Math.max(0, quantity)))
}

/**
 * Aciliyet sırası (K-200): önce tükenenler, sonra kritik seviyeye oranla en az miktar (miktar ÷
 * kritik seviye, kesir karşılaştırması), eşitlikte kod. Kod kurumda tekildir; sıra deterministiktir.
 */
function compareUrgency(
  a: { quantity: number; minQuantity: number; code: string },
  b: { quantity: number; minQuantity: number; code: string },
): number {
  const emptyA = a.quantity <= 0 ? 0 : 1
  const emptyB = b.quantity <= 0 ? 0 : 1
  if (emptyA !== emptyB) return emptyA - emptyB
  const ratio = a.quantity * b.minQuantity - b.quantity * a.minQuantity
  if (ratio !== 0) return ratio
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
}

/**
 * Kritik stok listesi (DOM-FIN-079, K-200): etkin, kritik seviyesi tanımlı ve toplam miktarı
 * kritik seviyeye eşit ya da altında olan kartlar; toplam, eksik, öneri ve depo kırılımıyla,
 * aciliyet sırasında. Pasif kart listelenmez; pasif depodaki miktar toplama girer.
 */
export function criticalStockRows<TItem extends CriticalStockItem>(source: {
  items: readonly TItem[]
  warehouses: readonly { id: string; isActive: boolean }[]
  balances: readonly StockBalanceLine[]
}): CriticalStockRow<TItem>[] {
  const byItem = new Map<string, Map<string, number>>()
  for (const line of source.balances) {
    const perWarehouse = byItem.get(line.itemId) ?? new Map<string, number>()
    perWarehouse.set(line.warehouseId, (perWarehouse.get(line.warehouseId) ?? 0) + line.quantity)
    byItem.set(line.itemId, perWarehouse)
  }
  const rows: CriticalStockRow<TItem>[] = []
  for (const item of source.items) {
    if (!item.isActive || item.minQuantity === null) continue
    const perWarehouse = byItem.get(item.id) ?? new Map<string, number>()
    const quantity = [...perWarehouse.values()].reduce((total, value) => total + value, 0)
    if (!isBelowMinimum(quantity, item.minQuantity)) continue
    rows.push({
      item,
      minQuantity: item.minQuantity,
      quantity,
      shortage: Math.max(0, item.minQuantity - quantity),
      suggestedQuantity: suggestedReorderQuantity(quantity, item.minQuantity),
      warehouses: source.warehouses
        .filter((warehouse) => warehouse.isActive || (perWarehouse.get(warehouse.id) ?? 0) !== 0)
        .map((warehouse) => ({
          warehouseId: warehouse.id,
          quantity: perWarehouse.get(warehouse.id) ?? 0,
        })),
    })
  }
  return rows.sort((a, b) =>
    compareUrgency(
      { quantity: a.quantity, minQuantity: a.minQuantity, code: a.item.code },
      { quantity: b.quantity, minQuantity: b.minQuantity, code: b.item.code },
    ),
  )
}

/** Talep önerisine giren kritik kalem (ekranın seçtiği satır). */
export interface StockSuggestionLine {
  /** Stok kartı kimliği; talep kalemine bağ olarak geçer (ON-339). */
  id: string
  code: string
  name: string
  unit: StockUnit
  quantity: number
  minQuantity: number
  suggestedQuantity: number
  /** Son mal kabul girişinin sipariş birim fiyatı, KDV hariç (K-202); yoksa `null`. */
  lastUnitPriceCents: number | null
}

export interface StockPurchaseDraft {
  justification: string
  items: {
    name: string
    quantity: number
    unit: StockUnit
    /** Bilinmiyorsa `null`: kullanıcı tahmini fiyatı girer. */
    estimatedUnitPriceCents: number | null
    /** Kalemin bağlı olduğu stok kartı (ON-339, K-221). */
    stockItemId: string
  }[]
}

const JUSTIFICATION_PREFIX = 'Kritik seviyedeki stok için talep önerisi: '

/**
 * Talep gerekçesi önerisi: her kalem için kod, ad, toplam ve kritik seviye. Gerekçe üst sınırını
 * aşarsa sığmayan kalemler "ve N ürün daha" ile özetlenir.
 */
function suggestionJustification(lines: readonly StockSuggestionLine[]): string {
  const parts = lines.map(
    (line) =>
      `${line.code} ${line.name} ${String(line.quantity)} ${STOCK_UNIT_LABELS[line.unit]} (kritik seviye ${String(line.minQuantity)})`,
  )
  const full = `${JUSTIFICATION_PREFIX}${parts.join('; ')}.`
  if (full.length <= PURCHASE_JUSTIFICATION_MAX) return full
  let text = JUSTIFICATION_PREFIX
  for (const [index, part] of parts.entries()) {
    const rest = parts.length - index - 1
    const separator = index === 0 ? '' : '; '
    const suffix = rest === 0 ? '.' : `; ve ${String(rest)} ürün daha.`
    if ((text + separator + part + suffix).length > PURCHASE_JUSTIFICATION_MAX)
      return `${text}${index === 0 ? '' : '; '}ve ${String(parts.length - index)} ürün daha.`
    text += separator + part
  }
  return `${text}.`
}

/**
 * Seçilen kritik kalemlerden taslak satın alma talebi önerisi (DOM-FIN-079, K-203): kalem adı
 * "ad (kod)", miktar öneri miktarı, birim kartın birimi, tahmini birim fiyat son alış fiyatı
 * (K-202). Birim, dönem, gider kalemi ve tedarikçi kullanıcı seçer; talep `DOM-FIN-071`
 * kurallarıyla açılır. En az 1, en çok talep kalemi sınırı kadar (50) kalem seçilir.
 */
export function stockPurchaseDraft(lines: readonly StockSuggestionLine[]): StockPurchaseDraft {
  if (lines.length === 0)
    throw new DomainError('stock_suggestion_empty', 'Talep için en az bir kritik ürün seçin.', {
      kind: 'rule',
    })
  if (lines.length > PURCHASE_ITEMS_MAX)
    throw new DomainError(
      'stock_suggestion_too_many',
      `Bir talebe en çok ${String(PURCHASE_ITEMS_MAX)} ürün eklenebilir; seçimi azaltın.`,
      { kind: 'rule' },
    )
  return {
    justification: suggestionJustification(lines),
    items: lines.map((line) => ({
      name: `${line.name} (${line.code})`,
      quantity: line.suggestedQuantity,
      unit: line.unit,
      estimatedUnitPriceCents:
        line.lastUnitPriceCents !== null && line.lastUnitPriceCents > 0
          ? line.lastUnitPriceCents
          : null,
      stockItemId: line.id,
    })),
  }
}

/**
 * Açık talep (ON-339, K-222): stok kartına bağlı kalemi olan, henüz siparişe dönmemiş talep. Taslak,
 * gönderilmiş ve etkin (iptal edilmemiş) siparişi olmayan onaylanmış talepler sayılır; reddedilen
 * ve iptal edilen talep sayılmaz. Etkin siparişi olan talebin miktarı siparişe geçmiştir.
 */
export const OPEN_PURCHASE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
] as const satisfies readonly PurchaseRequestStatus[]

/** Açık talep uyarısının satırı: kritik listeden seçilen kart ve açık talepteki miktarı. */
export interface OpenRequestLine {
  code: string
  unit: StockUnit
  openRequestQuantity: number
}

/**
 * Aynı ürün için ikinci talep uyarısı (ON-339, K-222): seçilen kartlardan açık talepte miktarı
 * olanlar sayılır; uyarı engellemez, talep yine açılabilir. Açık talep yoksa `null`.
 */
export function openRequestWarning(lines: readonly OpenRequestLine[]): string | null {
  const open = lines.filter((line) => line.openRequestQuantity > 0)
  if (open.length === 0) return null
  const parts = open.map(
    (line) => `${line.code} ${String(line.openRequestQuantity)} ${STOCK_UNIT_LABELS[line.unit]}`,
  )
  return `Seçilen ${String(open.length)} ürünün siparişe dönmemiş açık talebi var (${parts.join(', ')}). Yeni talep mükerrer alıma yol açabilir; yine de açabilirsiniz.`
}
