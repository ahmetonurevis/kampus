import { z } from 'zod'

import { csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  isInbound,
  STOCK_UNIT_LABELS,
  stockPairKey,
  type StockMovementLine,
  type StockUnit,
} from './finance-inventory.ts'
import { daysBetween } from './finance-opening-watch.ts'

/**
 * Laboratuvar kimyasal envanteri (docs/domain/finans.md DOM-FIN-090; ON-234). Stok kartına
 * (`DOM-FIN-077`) isteğe bağlı kimyasal bilgisi eklenir: GHS tehlike piktogramları, sinyal
 * kelimesi, CAS numarası, depolama sınıfı ve uyumsuzluk notu, güvenlik bilgi formu (GBF) bağlantısı
 * ya da belge numarası (K-240). Kimyasal kartın elle girişi parti numarası ve son kullanma tarihi
 * taşır (K-241); çıkış partiden en yakın son kullanma önce (FEFO) düşer, parti miktarı saklanmaz,
 * hareketlerden türetilir (K-242). Son kullanma tarihi geçen ve 30 gün içinde dolan partiler uyarı
 * listesindedir (K-243).
 *
 * Fonksiyonlar saftır; zaman `today` parametresiyle gelir.
 */

/** Kimyasal bilgisini yazan roller: stok kartını yöneten yönetici (K-180, K-240). */
export const CHEMICAL_MANAGE_ROLES = ['yonetici'] as const

// --- Sabit kümeler -------------------------------------------------------------------------------

/** GHS (SEA yönetmeliği, CLP) tehlike piktogramları; kod sabittir, belgede metin olarak yazılır. */
export const GHS_PICTOGRAMS = [
  'GHS01',
  'GHS02',
  'GHS03',
  'GHS04',
  'GHS05',
  'GHS06',
  'GHS07',
  'GHS08',
  'GHS09',
] as const
export type GhsPictogram = (typeof GHS_PICTOGRAMS)[number]
export const GHS_PICTOGRAM_LABELS = {
  GHS01: 'Patlayıcı',
  GHS02: 'Alevlenir',
  GHS03: 'Oksitleyici',
  GHS04: 'Basınçlı gaz',
  GHS05: 'Aşındırıcı',
  GHS06: 'Akut toksik',
  GHS07: 'Zararlı, tahriş edici',
  GHS08: 'Ciddi sağlık tehlikesi',
  GHS09: 'Çevre için tehlikeli',
} as const satisfies Record<GhsPictogram, string>

/** Sinyal kelimesi: "Tehlike" ağır, "Dikkat" daha hafif tehlike sınıfları içindir. */
export const CHEMICAL_SIGNAL_WORDS = ['danger', 'warning'] as const
export type ChemicalSignalWord = (typeof CHEMICAL_SIGNAL_WORDS)[number]
export const CHEMICAL_SIGNAL_WORD_LABELS = {
  danger: 'Tehlike',
  warning: 'Dikkat',
} as const satisfies Record<ChemicalSignalWord, string>

export const CHEMICAL_STORAGE_CLASS_MAX = 80
export const CHEMICAL_NOTE_MAX = 500
export const CHEMICAL_SDS_URL_MAX = 500
export const CHEMICAL_SDS_NUMBER_MAX = 60
/** Son kullanmaya bu kadar gün (bugün dahil) kalan parti uyarı listesindedir (K-243). */
export const CHEMICAL_EXPIRY_WARNING_DAYS = 30

// --- CAS numarası --------------------------------------------------------------------------------

const CAS_PATTERN = /^(\d{2,7})-(\d{2})-(\d)$/

/**
 * CAS numarası denetimi: `NNNNNNN-NN-N` (ilk bölüm 2–7 hane) ve sağlama basamağı. Sağlama basamağı,
 * sağlama dışındaki rakamların sağdan 1'den başlayan sıra numarasıyla çarpımlarının toplamının 10'a
 * bölümünden kalandır (ör. su 7732-18-5).
 */
export function isValidCasNumber(value: string): boolean {
  const match = CAS_PATTERN.exec(value)
  if (match === null) return false
  const digits = `${match[1] ?? ''}${match[2] ?? ''}`
  let total = 0
  for (let index = 0; index < digits.length; index += 1)
    total += Number(digits[digits.length - 1 - index]) * (index + 1)
  return total % 10 === Number(match[3])
}

// --- Şemalar -------------------------------------------------------------------------------------

const emptyToNull = (value: string | null) => (value === '' ? null : value)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)
    .nullable()
    .transform(emptyToNull)

const casNumberSchema = z
  .string('CAS numarasını yazın.')
  .trim()
  .refine(
    (value) => value === '' || CAS_PATTERN.test(value),
    'CAS numarasını 7732-18-5 biçiminde yazın.',
  )
  .refine(
    (value) => value === '' || !CAS_PATTERN.test(value) || isValidCasNumber(value),
    'CAS numarasının sağlama basamağı tutmuyor; numarayı kontrol edin.',
  )
  .nullable()
  .transform(emptyToNull)

function isHttpsUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Ayrıştırılamayan metin adres değildir; alan hatası şemadan döner.
    return false
  }
  return url.protocol === 'https:' && url.hostname !== ''
}

const sdsUrlSchema = z
  .string('GBF bağlantısını yazın.')
  .trim()
  .max(CHEMICAL_SDS_URL_MAX, `En fazla ${String(CHEMICAL_SDS_URL_MAX)} karakter girebilirsiniz.`)
  .refine(
    (value) => value === '' || isHttpsUrl(value),
    'GBF bağlantısı https:// ile başlayan geçerli bir adres olmalıdır.',
  )
  .nullable()
  .transform(emptyToNull)

const pictogramsSchema = z
  .array(z.enum(GHS_PICTOGRAMS, 'Geçersiz GHS piktogramı.'), 'Piktogramları seçin.')
  .max(GHS_PICTOGRAMS.length, 'Piktogram en çok 9 olabilir.')
  // Sıra ve tekrar anlam taşımaz: kod sırasına göre tekilleştirilir.
  .transform((codes) => GHS_PICTOGRAMS.filter((code) => codes.includes(code)))

const profileFields = {
  hazardPictograms: pictogramsSchema,
  signalWord: z.enum(CHEMICAL_SIGNAL_WORDS, 'Sinyal kelimesini seçin.').nullable(),
  casNumber: casNumberSchema,
  storageClass: optionalText(CHEMICAL_STORAGE_CLASS_MAX),
  incompatibilityNote: optionalText(CHEMICAL_NOTE_MAX),
  sdsUrl: sdsUrlSchema,
  sdsDocumentNumber: optionalText(CHEMICAL_SDS_NUMBER_MAX),
  sdsRevisionDate: daySchema.nullable(),
}

/** Kimyasal bilgisi (DOM-FIN-090, K-240); bütün alanlar isteğe bağlıdır. */
export const chemicalProfileSchema = z.strictObject({
  hazardPictograms: profileFields.hazardPictograms.default([]),
  signalWord: profileFields.signalWord.default(null),
  casNumber: profileFields.casNumber.default(null),
  storageClass: profileFields.storageClass.default(null),
  incompatibilityNote: profileFields.incompatibilityNote.default(null),
  sdsUrl: profileFields.sdsUrl.default(null),
  sdsDocumentNumber: profileFields.sdsDocumentNumber.default(null),
  sdsRevisionDate: profileFields.sdsRevisionDate.default(null),
})
export type ChemicalProfileInput = z.input<typeof chemicalProfileSchema>
export type ChemicalProfileFields = z.output<typeof chemicalProfileSchema>

export const updateChemicalProfileSchema = z
  .strictObject(profileFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan gönderin.')
export type UpdateChemicalProfileInput = z.input<typeof updateChemicalProfileSchema>

// --- Kurallar ------------------------------------------------------------------------------------

function assertRevisionDate(day: string | null | undefined, today: string) {
  if (day !== null && day !== undefined && day > today)
    throw new DomainError('chemical_sds_date_future', 'GBF revizyon günü bugünden sonra olamaz.', {
      kind: 'rule',
      path: ['sdsRevisionDate'],
    })
}

/**
 * Stok kartını kimyasal olarak işaretler (DOM-FIN-090, K-240): kartın tek kimyasal bilgisi olur
 * (409 `stock_item_chemical_exists`); GBF revizyon günü bugünden sonra olamaz.
 */
export function planChemicalProfile(
  input: unknown,
  context: { exists: boolean; today: string },
): ChemicalProfileFields {
  const data = chemicalProfileSchema.parse(input)
  if (context.exists)
    throw new DomainError(
      'stock_item_chemical_exists',
      'Bu stok kartının kimyasal bilgisi zaten var; bilgiyi düzeltin.',
      { kind: 'conflict', path: ['itemId'] },
    )
  assertRevisionDate(data.sdsRevisionDate, context.today)
  return data
}

/** Kimyasal bilgisinin kısmi düzeltmesi (K-240). */
export function planChemicalProfileUpdate(
  input: unknown,
  context: { today: string },
): z.output<typeof updateChemicalProfileSchema> {
  const changes = updateChemicalProfileSchema.parse(input)
  assertRevisionDate(changes.sdsRevisionDate, context.today)
  return changes
}

/** GBF'ye erişim: bağlantı ya da belge numarası olan kimyasal "GBF var" sayılır. */
export const hasSafetyDataSheet = (
  profile: Pick<ChemicalProfileFields, 'sdsUrl' | 'sdsDocumentNumber'>,
) => profile.sdsUrl !== null || profile.sdsDocumentNumber !== null

/** Piktogram kodları metin olarak (`GHS02, GHS07`); yoksa tire. */
export const pictogramsText = (codes: readonly GhsPictogram[]) =>
  codes.length === 0 ? '—' : codes.join(', ')

// --- Parti miktarı (K-242) -----------------------------------------------------------------------

/** Parti hesabına giren hareket: miktar alanları, kayıt anı ve transfer kimliği. */
export interface LotMovement extends StockMovementLine {
  createdAt: string
  transferId: string | null
}

/** Girişin partisi (`stock_movement_lots`). */
export interface MovementLot {
  lotNumber: string
  expiryDate: string
}

/** Ürün × depo × parti miktarı. `lotNumber` boşsa parti bilgisi olmayan miktardır. */
export interface LotBalance {
  itemId: string
  warehouseId: string
  lotNumber: string | null
  expiryDate: string | null
  quantity: number
  /** Partinin bu depoya ilk girdiği gün. */
  firstDate: string
}

interface Bucket {
  lotNumber: string | null
  expiryDate: string | null
  quantity: number
  firstDate: string
}

const bucketKey = (lot: MovementLot | null) =>
  lot === null ? '' : `${lot.expiryDate}|${lot.lotNumber}`

/**
 * FEFO sırası (K-242): en yakın son kullanma önce, eşitlikte ilk giriş günü, sonra parti numarası;
 * parti bilgisi olmayan miktar en sonda.
 */
function compareFefo(a: Bucket, b: Bucket): number {
  if (a.expiryDate === null || b.expiryDate === null)
    return (a.expiryDate === null ? 1 : 0) - (b.expiryDate === null ? 1 : 0)
  if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
  if (a.firstDate !== b.firstDate) return a.firstDate < b.firstDate ? -1 : 1
  const lotA = a.lotNumber ?? ''
  const lotB = b.lotNumber ?? ''
  return lotA < lotB ? -1 : lotA > lotB ? 1 : 0
}

type Portion = { lot: MovementLot | null; quantity: number }

/** Bir ürünün depo başına parti kovaları ve FEFO düşümü. */
class LotLedger {
  readonly pairs = new Map<string, Map<string, Bucket>>()

  private bucketsOf(warehouseId: string) {
    let buckets = this.pairs.get(warehouseId)
    if (buckets === undefined) {
      buckets = new Map()
      this.pairs.set(warehouseId, buckets)
    }
    return buckets
  }

  add(warehouseId: string, lot: MovementLot | null, quantity: number, day: string) {
    const buckets = this.bucketsOf(warehouseId)
    const key = bucketKey(lot)
    const bucket = buckets.get(key)
    if (bucket === undefined)
      buckets.set(key, {
        lotNumber: lot?.lotNumber ?? null,
        expiryDate: lot?.expiryDate ?? null,
        quantity,
        firstDate: day,
      })
    else bucket.quantity += quantity
  }

  /**
   * FEFO ile düşer; partilerde yetmeyen kısım parti bilgisi olmayan kovadan düşer ve geçici olarak
   * eksiye inebilir (aynı gün sonra yazılmış giriş). Gün sonunda `settle` kapatır.
   */
  take(warehouseId: string, quantity: number, day: string, lotsOnly = false): Portion[] {
    const buckets = this.bucketsOf(warehouseId)
    const ordered = [...buckets.values()]
      .filter((bucket) => bucket.quantity > 0 && (!lotsOnly || bucket.lotNumber !== null))
      .sort(compareFefo)
    const portions: Portion[] = []
    let rest = quantity
    for (const bucket of ordered) {
      if (rest === 0) break
      const used = Math.min(bucket.quantity, rest)
      bucket.quantity -= used
      rest -= used
      portions.push({
        lot:
          bucket.lotNumber === null || bucket.expiryDate === null
            ? null
            : { lotNumber: bucket.lotNumber, expiryDate: bucket.expiryDate },
        quantity: used,
      })
    }
    if (rest > 0) {
      this.add(warehouseId, null, -rest, day)
      portions.push({ lot: null, quantity: rest })
    }
    return portions
  }

  /** Gün sonu: eksiye inen partisiz kova partilerden FEFO ile kapatılır (gün sonu miktarı esas). */
  settle(day: string) {
    for (const [warehouseId, buckets] of this.pairs) {
      const unlotted = buckets.get('')
      if (unlotted === undefined || unlotted.quantity >= 0) continue
      const deficit = -unlotted.quantity
      unlotted.quantity = 0
      this.take(warehouseId, deficit, day, true)
    }
  }
}

const byTime = (a: LotMovement, b: LotMovement) =>
  a.movementDate !== b.movementDate
    ? a.movementDate < b.movementDate
      ? -1
      : 1
    : a.createdAt !== b.createdAt
      ? a.createdAt < b.createdAt
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0

/**
 * Kimyasal partilerin kalan miktarı (DOM-FIN-090, K-242). Hareketler gün ve kayıt sırasıyla işlenir:
 * partili giriş partisine, partisiz giriş (mal kabul, iade) "parti bilgisi yok" kovasına eklenir;
 * çıkış FEFO ile düşer; transfer çıkışta düşen partileri aynı oranlarla giriş deposuna taşır. Aynı
 * gün sonra yazılmış girişten karşılanan çıkış gün sonunda partilerden kapatılır; iptal edilen
 * hareket sayılmaz. Miktarı sıfır olan parti dönmez.
 */
export function chemicalLotBalances(
  movements: readonly LotMovement[],
  lots: ReadonlyMap<string, MovementLot>,
): LotBalance[] {
  const byItem = new Map<string, LotMovement[]>()
  for (const movement of movements) {
    if (movement.cancelledAt !== null) continue
    const list = byItem.get(movement.itemId) ?? []
    list.push(movement)
    byItem.set(movement.itemId, list)
  }
  const result: LotBalance[] = []
  for (const [itemId, list] of byItem) {
    const ledger = new LotLedger()
    const ordered = [...list].sort(byTime)
    const handled = new Set<string>()
    let day: string | null = null
    for (const movement of ordered) {
      if (day !== null && movement.movementDate !== day) ledger.settle(day)
      day = movement.movementDate
      if (handled.has(movement.id)) continue
      handled.add(movement.id)
      const partner =
        movement.transferId === null
          ? undefined
          : ordered.find(
              (other) =>
                other.transferId === movement.transferId &&
                other.id !== movement.id &&
                !handled.has(other.id),
            )
      if (partner !== undefined) {
        handled.add(partner.id)
        const [out, into] =
          movement.type === 'transfer_out' ? [movement, partner] : [partner, movement]
        for (const portion of ledger.take(out.warehouseId, out.quantity, out.movementDate))
          ledger.add(into.warehouseId, portion.lot, portion.quantity, into.movementDate)
        continue
      }
      if (isInbound(movement.type))
        ledger.add(
          movement.warehouseId,
          lots.get(movement.id) ?? null,
          movement.quantity,
          movement.movementDate,
        )
      else ledger.take(movement.warehouseId, movement.quantity, movement.movementDate)
    }
    if (day !== null) ledger.settle(day)
    for (const [warehouseId, buckets] of ledger.pairs)
      for (const bucket of [...buckets.values()].sort(compareFefo))
        if (bucket.quantity > 0)
          result.push({
            itemId,
            warehouseId,
            lotNumber: bucket.lotNumber,
            expiryDate: bucket.expiryDate,
            quantity: bucket.quantity,
            firstDate: bucket.firstDate,
          })
  }
  return result
}

// --- Son kullanma (K-243) ------------------------------------------------------------------------

export const CHEMICAL_EXPIRY_STATUSES = ['expired', 'expiring', 'ok', 'unknown'] as const
export type ChemicalExpiryStatus = (typeof CHEMICAL_EXPIRY_STATUSES)[number]
export const CHEMICAL_EXPIRY_STATUS_LABELS = {
  expired: 'Süresi geçti',
  expiring: 'Süresi yaklaşıyor',
  ok: 'Geçerli',
  unknown: 'Parti bilgisi yok',
} as const satisfies Record<ChemicalExpiryStatus, string>

/**
 * Son kullanma durumu (K-243): son kullanma günü kullanılabilir son gündür; ondan sonraki gün
 * "süresi geçti", bugün dahil 30 gün içinde dolan "süresi yaklaşıyor". Partisiz miktar "bilinmiyor".
 */
export function chemicalExpiry(
  expiryDate: string | null,
  today: string,
): { status: ChemicalExpiryStatus; daysLeft: number | null } {
  if (expiryDate === null) return { status: 'unknown', daysLeft: null }
  const daysLeft = daysBetween(today, expiryDate)
  return {
    status: daysLeft < 0 ? 'expired' : daysLeft <= CHEMICAL_EXPIRY_WARNING_DAYS ? 'expiring' : 'ok',
    daysLeft,
  }
}

/** Uyarı listesine giren durumlar: süresi geçen ve yaklaşan partiler. */
export const isChemicalAttention = (status: ChemicalExpiryStatus) =>
  status === 'expired' || status === 'expiring'

// --- Envanter raporu -----------------------------------------------------------------------------

export interface ChemicalItem {
  id: string
  code: string
  name: string
  unit: StockUnit
  hazardPictograms: GhsPictogram[]
  signalWord: ChemicalSignalWord | null
  casNumber: string | null
  storageClass: string | null
  sdsUrl: string | null
  sdsDocumentNumber: string | null
}

export interface ChemicalWarehouse {
  id: string
  name: string
  campusName: string | null
  isActive: boolean
}

export interface ChemicalLotLine {
  lotNumber: string | null
  expiryDate: string | null
  quantity: number
  status: ChemicalExpiryStatus
  daysLeft: number | null
}

export interface ChemicalInventoryRow {
  warehouseId: string
  warehouseName: string
  campusName: string | null
  itemId: string
  code: string
  name: string
  unit: StockUnit
  casNumber: string | null
  hazardPictograms: GhsPictogram[]
  signalWord: ChemicalSignalWord | null
  storageClass: string | null
  hasSds: boolean
  quantity: number
  /** En yakın son kullanma günü (partisiz miktar sayılmaz). */
  nearestExpiryDate: string | null
  expiredQuantity: number
  expiringQuantity: number
  lots: ChemicalLotLine[]
}

const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true })

/**
 * Kimyasal envanter raporu (DOM-FIN-090): depo × kimyasal, stokta olanlar (miktar > 0); her satırda
 * piktogram, sinyal kelimesi, CAS, depolama sınıfı, GBF durumu ve FEFO sırasıyla partiler. Depo adı,
 * sonra kart koduna göre sıralı. Kartı ya da deposu bilinmeyen parti atlanır.
 */
export function chemicalInventoryRows(source: {
  items: readonly ChemicalItem[]
  warehouses: readonly ChemicalWarehouse[]
  lots: readonly LotBalance[]
  today: string
}): ChemicalInventoryRow[] {
  const items = new Map(source.items.map((item) => [item.id, item]))
  const warehouses = new Map(source.warehouses.map((warehouse) => [warehouse.id, warehouse]))
  const rows = new Map<string, ChemicalInventoryRow>()
  for (const lot of source.lots) {
    const item = items.get(lot.itemId)
    const warehouse = warehouses.get(lot.warehouseId)
    if (item === undefined || warehouse === undefined || lot.quantity <= 0) continue
    const key = stockPairKey(item.id, warehouse.id)
    let row = rows.get(key)
    if (row === undefined) {
      row = {
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        campusName: warehouse.campusName,
        itemId: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        casNumber: item.casNumber,
        hazardPictograms: item.hazardPictograms,
        signalWord: item.signalWord,
        storageClass: item.storageClass,
        hasSds: hasSafetyDataSheet(item),
        quantity: 0,
        nearestExpiryDate: null,
        expiredQuantity: 0,
        expiringQuantity: 0,
        lots: [],
      }
      rows.set(key, row)
    }
    const expiry = chemicalExpiry(lot.expiryDate, source.today)
    row.quantity += lot.quantity
    if (expiry.status === 'expired') row.expiredQuantity += lot.quantity
    if (expiry.status === 'expiring') row.expiringQuantity += lot.quantity
    if (
      lot.expiryDate !== null &&
      (row.nearestExpiryDate === null || lot.expiryDate < row.nearestExpiryDate)
    )
      row.nearestExpiryDate = lot.expiryDate
    row.lots.push({
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
      quantity: lot.quantity,
      status: expiry.status,
      daysLeft: expiry.daysLeft,
    })
  }
  return [...rows.values()].sort(
    (a, b) =>
      collator.compare(a.warehouseName, b.warehouseName) ||
      (a.warehouseId < b.warehouseId ? -1 : a.warehouseId > b.warehouseId ? 1 : 0) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  )
}

/** Parti satırı metni: parti numarası ya da "Parti bilgisi yok". */
export const lotLabel = (lot: Pick<ChemicalLotLine, 'lotNumber'>) =>
  lot.lotNumber ?? CHEMICAL_EXPIRY_STATUS_LABELS.unknown

/**
 * Envanter raporu CSV'si (`;`, formül kaçışlı): parti başına bir satır. Kişi verisi yoktur;
 * piktogramlar kod olarak yazılır.
 */
export function chemicalInventoryCsv(rows: readonly ChemicalInventoryRow[]): string {
  const header = [
    'Depo',
    'Kampüs',
    'Kod',
    'Kimyasal',
    'CAS',
    'Piktogramlar',
    'Sinyal kelimesi',
    'Depolama sınıfı',
    'GBF',
    'Parti',
    'Son kullanma',
    'Durum',
    'Miktar',
    'Birim',
  ]
  const lines = [header.map(csvCell).join(';')]
  for (const row of rows)
    for (const lot of row.lots)
      lines.push(
        [
          row.warehouseName,
          row.campusName ?? '',
          row.code,
          row.name,
          row.casNumber ?? '',
          row.hazardPictograms.join(', '),
          row.signalWord === null ? '' : CHEMICAL_SIGNAL_WORD_LABELS[row.signalWord],
          row.storageClass ?? '',
          row.hasSds ? 'Var' : 'Yok',
          lotLabel(lot),
          lot.expiryDate ?? '',
          CHEMICAL_EXPIRY_STATUS_LABELS[lot.status],
          lot.quantity,
          STOCK_UNIT_LABELS[row.unit],
        ]
          .map(csvCell)
          .join(';'),
      )
  return `${lines.join('\r\n')}\r\n`
}
