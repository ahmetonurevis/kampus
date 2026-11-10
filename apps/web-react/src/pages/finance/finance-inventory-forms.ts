// Stok formları (DOM-FIN-077, DOM-FIN-078; ON-228, ON-229). Alan kuralları core şemalarından:
// kartta kod, ad, kategori, birim ve kritik seviye; depoda ad, kampüs ve not; harekette kart, depo,
// miktar, gün, neden ve not. Formda sayılar metindir; gövdeye tam sayı gider. Miktarın depodaki
// miktarı aşmaması sunucuda kurum kilidi altında denetlenir (K-181).
import { z } from 'zod'
import type {
  CreateStockItemBody,
  CriticalStockRow,
  CreateStockWarehouseBody,
  StockEntryBody,
  StockIssueBody,
  StockItemDetail,
  StockTransferBody,
  StockWarehouseRow,
} from '@kampus/react-shared/use-finance-inventory.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { FINANCE_CODE_MAX } from '@kampus/school-core/lib/finance-cost-centers.ts'
import {
  STOCK_CATEGORIES,
  STOCK_ENTRY_REASONS,
  STOCK_ISSUE_REASONS,
  STOCK_ITEM_NAME_MAX,
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_NOTE_MAX,
  STOCK_OTHER_NOTE_MIN,
  STOCK_UNITS,
  STOCK_WAREHOUSE_NAME_MAX,
  STOCK_UNIT_LABELS,
  type StockMovementType,
} from '@kampus/school-core/lib/finance-inventory.ts'
import type { StockSuggestionLine } from '@kampus/school-core/lib/finance-stock-alerts.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const COUNT = /^\d{1,7}$/
const optionalCount = /^\d{0,7}$/

// --- Stok kartı ----------------------------------------------------------------------------------

export const stockItemFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Kodu yazın.')
    .max(FINANCE_CODE_MAX, `Kod en fazla ${String(FINANCE_CODE_MAX)} karakter olabilir.`)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      'Kod harf ya da rakamla başlar; yalnız harf, rakam, nokta, alt çizgi ve tire içerir.',
    ),
  name: z
    .string()
    .trim()
    .min(2, 'En az 2 karakter girin.')
    .max(STOCK_ITEM_NAME_MAX, `En fazla ${String(STOCK_ITEM_NAME_MAX)} karakter girebilirsiniz.`),
  category: z.enum(STOCK_CATEGORIES, 'Kategoriyi seçin.'),
  unit: z.enum(STOCK_UNITS, 'Birimi seçin.'),
  minQuantity: z.string().trim().regex(optionalCount, 'Kritik seviyeyi tam sayı girin.'),
})
export type StockItemFormValues = z.input<typeof stockItemFormSchema>

export function stockItemDefaults(item?: StockItemDetail): StockItemFormValues {
  return {
    code: item?.code ?? '',
    name: item?.name ?? '',
    category: item?.category ?? 'stationery',
    unit: item?.unit ?? 'piece',
    minQuantity: item?.minQuantity === null || item === undefined ? '' : String(item.minQuantity),
  }
}

export function stockItemBody(values: StockItemFormValues): CreateStockItemBody {
  const min = values.minQuantity.trim()
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    category: values.category,
    unit: values.unit,
    minQuantity: min === '' ? null : Number(min),
  }
}

const ITEM_FIELDS = ['code', 'name', 'category', 'unit', 'minQuantity'] as const
export const stockItemFormField = (name: string) => ITEM_FIELDS.find((field) => field === name)

// --- Depo ----------------------------------------------------------------------------------------

export const stockWarehouseFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'En az 2 karakter girin.')
    .max(
      STOCK_WAREHOUSE_NAME_MAX,
      `En fazla ${String(STOCK_WAREHOUSE_NAME_MAX)} karakter girebilirsiniz.`,
    ),
  campusId: z.string().trim().min(1, 'Kampüs seçin.'),
  note: z
    .string()
    .trim()
    .max(STOCK_NOTE_MAX, `En fazla ${String(STOCK_NOTE_MAX)} karakter girebilirsiniz.`),
})
export type StockWarehouseFormValues = z.input<typeof stockWarehouseFormSchema>

export const stockWarehouseDefaults = (
  warehouse?: StockWarehouseRow,
): StockWarehouseFormValues => ({
  name: warehouse?.name ?? '',
  campusId: warehouse?.campusId ?? '',
  note: warehouse?.note ?? '',
})

export function stockWarehouseBody(values: StockWarehouseFormValues): CreateStockWarehouseBody {
  const note = values.note.trim()
  return { name: values.name.trim(), campusId: values.campusId, note: note === '' ? null : note }
}

const WAREHOUSE_FIELDS = ['name', 'campusId', 'note'] as const
export const stockWarehouseFormField = (name: string) =>
  WAREHOUSE_FIELDS.find((field) => field === name)

// --- Hareket -------------------------------------------------------------------------------------

export type MovementKind = 'entry' | 'issue' | 'transfer'
export const MOVEMENT_KIND_LABELS = {
  entry: 'Stok girişi',
  issue: 'Stok çıkışı',
  transfer: 'Depolar arası transfer',
} as const satisfies Record<MovementKind, string>

export const stockMovementFormSchema = z
  .object({
    kind: z.enum(['entry', 'issue', 'transfer']),
    itemId: z.string().min(1, 'Stok kartını seçin.'),
    warehouseId: z.string().min(1, 'Depoyu seçin.'),
    toWarehouseId: z.string(),
    quantity: z.string().trim().regex(COUNT, 'Miktarı tam sayı girin.'),
    movementDate: daySchema,
    reason: z.string(),
    note: z
      .string()
      .trim()
      .max(STOCK_NOTE_MAX, `En fazla ${String(STOCK_NOTE_MAX)} karakter girebilirsiniz.`),
  })
  .superRefine((values, ctx) => {
    if (COUNT.test(values.quantity) && Number(values.quantity) < 1)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Miktar en az 1 olmalıdır.' })
    if (values.kind === 'transfer') {
      if (values.toWarehouseId === '')
        ctx.addIssue({ code: 'custom', path: ['toWarehouseId'], message: 'Giriş deposunu seçin.' })
      else if (values.toWarehouseId === values.warehouseId)
        ctx.addIssue({
          code: 'custom',
          path: ['toWarehouseId'],
          message: 'Giriş deposu çıkış deposundan farklı olmalıdır.',
        })
      return
    }
    if (values.reason === '')
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Nedeni seçin.' })
    if (values.reason === 'other' && values.note.trim().length < STOCK_OTHER_NOTE_MIN)
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: '"Diğer" nedeni için açıklamayı en az 3 karakterle yazın.',
      })
  })
export type StockMovementFormValues = z.input<typeof stockMovementFormSchema>

export const stockMovementDefaults = (
  kind: MovementKind,
  today: string,
  itemId = '',
): StockMovementFormValues => ({
  kind,
  itemId,
  warehouseId: '',
  toWarehouseId: '',
  quantity: '',
  movementDate: today,
  reason: kind === 'entry' ? 'opening' : kind === 'issue' ? 'usage' : '',
  note: '',
})

export type StockMovementBody =
  | { kind: 'entry'; body: StockEntryBody }
  | { kind: 'issue'; body: StockIssueBody }
  | { kind: 'transfer'; body: StockTransferBody }

const isEntryReason = (value: string): value is StockEntryBody['reason'] =>
  STOCK_ENTRY_REASONS.some((reason) => reason === value)
const isIssueReason = (value: string): value is StockIssueBody['reason'] =>
  STOCK_ISSUE_REASONS.some((reason) => reason === value)

/** Form değerinden ilgili ucun gövdesi; boş not `null`. */
export function stockMovementBody(values: StockMovementFormValues): StockMovementBody {
  const note = values.note.trim()
  const base = {
    itemId: values.itemId,
    quantity: Number(values.quantity),
    movementDate: values.movementDate,
    note: note === '' ? null : note,
  }
  if (values.kind === 'transfer')
    return {
      kind: 'transfer',
      body: { ...base, fromWarehouseId: values.warehouseId, toWarehouseId: values.toWarehouseId },
    }
  if (values.kind === 'entry')
    return {
      kind: 'entry',
      body: {
        ...base,
        warehouseId: values.warehouseId,
        reason: isEntryReason(values.reason) ? values.reason : 'other',
      },
    }
  return {
    kind: 'issue',
    body: {
      ...base,
      warehouseId: values.warehouseId,
      reason: isIssueReason(values.reason) ? values.reason : 'other',
    },
  }
}

type MovementField =
  'itemId' | 'warehouseId' | 'toWarehouseId' | 'quantity' | 'movementDate' | 'reason' | 'note'
/** Sunucu alan yolu form alanına; transferde `fromWarehouseId` çıkış deposu alanıdır. */
export function stockMovementFormField(name: string): MovementField | undefined {
  if (name === 'fromWarehouseId') return 'warehouseId'
  const fields: readonly MovementField[] = [
    'itemId',
    'warehouseId',
    'toWarehouseId',
    'quantity',
    'movementDate',
    'reason',
    'note',
  ]
  return fields.find((field) => field === name)
}

// --- Gösterim ------------------------------------------------------------------------------------

/** Hareket türü rozeti: giriş yeşil, çıkış kırmızı, transfer mor, sayım düzeltmesi gri tonlu. */
export const MOVEMENT_TYPE_VIEW: Readonly<
  Record<StockMovementType, { label: string; tone: BadgeTone; sign: 1 | -1 }>
> = {
  in: { label: STOCK_MOVEMENT_TYPE_LABELS.in, tone: 'green', sign: 1 },
  receipt: { label: STOCK_MOVEMENT_TYPE_LABELS.receipt, tone: 'green', sign: 1 },
  out: { label: STOCK_MOVEMENT_TYPE_LABELS.out, tone: 'red', sign: -1 },
  transfer_in: { label: STOCK_MOVEMENT_TYPE_LABELS.transfer_in, tone: 'purple', sign: 1 },
  transfer_out: { label: STOCK_MOVEMENT_TYPE_LABELS.transfer_out, tone: 'purple', sign: -1 },
  delivery: { label: STOCK_MOVEMENT_TYPE_LABELS.delivery, tone: 'amber', sign: -1 },
  adjustment_in: { label: STOCK_MOVEMENT_TYPE_LABELS.adjustment_in, tone: 'gray', sign: 1 },
  adjustment_out: { label: STOCK_MOVEMENT_TYPE_LABELS.adjustment_out, tone: 'gray', sign: -1 },
}

/** İşaretli miktar metni: `+20 paket`, `−5 adet`. */
export const signedQuantity = (type: StockMovementType, quantity: number, unitLabel: string) =>
  `${MOVEMENT_TYPE_VIEW[type].sign > 0 ? '+' : '−'}${String(quantity)} ${unitLabel}`

// --- Kritik stok (DOM-FIN-079) -------------------------------------------------------------------

/** Kritik satırın talep önerisine giden alanları (K-202, K-203). */
export const suggestionLine = (row: CriticalStockRow): StockSuggestionLine => ({
  code: row.code,
  name: row.name,
  unit: row.unit,
  quantity: row.quantity,
  minQuantity: row.minQuantity,
  suggestedQuantity: row.suggestedQuantity,
  lastUnitPriceCents: row.lastUnitPriceCents,
})

/** Depo kırılımı metni: "Ana depo 3 · Beşiktaş deposu 0 (pasif)"; depo yoksa tire. */
export function warehouseBreakdown(row: Pick<CriticalStockRow, 'warehouses'>): string {
  if (row.warehouses.length === 0) return '—'
  return row.warehouses
    .map(
      (warehouse) =>
        `${warehouse.warehouseName} ${String(warehouse.quantity)}${warehouse.isActive ? '' : ' (pasif)'}`,
    )
    .join(' · ')
}

/** Miktar ve birim: "2 / 10 paket" (toplam / kritik seviye). */
export const criticalQuantityText = (
  row: Pick<CriticalStockRow, 'quantity' | 'minQuantity' | 'unit'>,
) => `${String(row.quantity)} / ${String(row.minQuantity)} ${STOCK_UNIT_LABELS[row.unit]}`
