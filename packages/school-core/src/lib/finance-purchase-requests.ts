import { z } from 'zod'

import { DomainError } from './errors.ts'
import { BUDGET_AMOUNT_MAX_CENTS, type BudgetItemKind } from './finance-budget.ts'
import { money } from './format.ts'

/**
 * Satın alma talebi (docs/domain/finans.md DOM-FIN-071; ON-222, K23 satın alma). Talep eden birim
 * bir maliyet merkezidir, talep bir bütçe dönemine ve gider kalemine yazılır (DOM-FIN-062).
 * Durum taslak → gönderildi → onaylandı ya da reddedildi; taslak ve gönderilmiş talep iptal edilir.
 * Onay bugün yöneticinin tek adımlı kararıdır: kademeli eşik ve iş akışı motoru (K27) yoktur,
 * ON-223 ile gelir (K-129). Gönderim ve onayda bütçe kalanını aşan ya da bütçe satırı olmayan talep
 * açık onay ister (ON-245, K-145…K-148). Fonksiyonlar saftır; servis bağlı kayıtları yükler, karar
 * burada verilir.
 */

/** Talebi açan, düzelten, gönderen ve iptal eden roller (K-128). */
export const PURCHASE_REQUEST_ROLES = ['yonetici', 'onburo'] as const
/** Onay ve ret yalnız yöneticidedir (K-129); muhasebe rolü onaylamaz (DOM-FIN-057). */
export const PURCHASE_REQUEST_DECISION_ROLES = ['yonetici'] as const
type RequestRole = (typeof PURCHASE_REQUEST_ROLES)[number]

export const PURCHASE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
] as const
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number]
export const PURCHASE_REQUEST_STATUS_LABELS = {
  draft: 'Taslak',
  submitted: 'Gönderildi',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
} as const satisfies Record<PurchaseRequestStatus, string>

/** Kalem birimi (K-130); miktar tam sayıdır, kesirli miktar küçük birimle yazılır. */
export const PURCHASE_UNITS = [
  'piece',
  'pack',
  'box',
  'kilogram',
  'liter',
  'meter',
  'hour',
  'day',
  'month',
  'service',
] as const
export type PurchaseUnit = (typeof PURCHASE_UNITS)[number]
export const PURCHASE_UNIT_LABELS = {
  piece: 'adet',
  pack: 'paket',
  box: 'koli',
  kilogram: 'kg',
  liter: 'litre',
  meter: 'metre',
  hour: 'saat',
  day: 'gün',
  month: 'ay',
  service: 'hizmet',
} as const satisfies Record<PurchaseUnit, string>

export const PURCHASE_ITEMS_MAX = 50
export const PURCHASE_ITEM_NAME_MAX = 200
export const PURCHASE_QUANTITY_MAX = 1_000_000
/** Tahmini birim fiyat üst sınırı: 1 milyar TL. Talep toplamı bütçe satırı sınırını aşamaz. */
export const PURCHASE_UNIT_PRICE_MAX_CENTS = 100_000_000_000
export const PURCHASE_JUSTIFICATION_MIN = 10
export const PURCHASE_JUSTIFICATION_MAX = 2000
export const PURCHASE_REASON_MAX = 500

// --- Şemalar -------------------------------------------------------------------------------------

export const purchaseRequestItemSchema = z.strictObject({
  name: z
    .string('Kalem adını yazın.')
    .trim()
    .min(2, 'En az 2 karakter girin.')
    .max(
      PURCHASE_ITEM_NAME_MAX,
      `En fazla ${String(PURCHASE_ITEM_NAME_MAX)} karakter girebilirsiniz.`,
    ),
  quantity: z
    .number('Miktarı girin.')
    .int('Miktar tam sayı olmalıdır.')
    .min(1, 'Miktar en az 1 olmalıdır.')
    .max(PURCHASE_QUANTITY_MAX, 'Miktar çok büyük.'),
  unit: z.enum(PURCHASE_UNITS, 'Birimi seçin.'),
  estimatedUnitPriceCents: z
    .number('Tahmini birim fiyatı girin.')
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .min(1, 'Tahmini birim fiyat sıfırdan büyük olmalıdır.')
    .max(PURCHASE_UNIT_PRICE_MAX_CENTS, 'Tahmini birim fiyat çok büyük.'),
})
export type PurchaseRequestItem = z.output<typeof purchaseRequestItemSchema>

const itemsSchema = z
  .array(purchaseRequestItemSchema, 'Kalemleri girin.')
  .min(1, 'En az bir kalem ekleyin.')
  .max(PURCHASE_ITEMS_MAX, `En fazla ${String(PURCHASE_ITEMS_MAX)} kalem eklenebilir.`)
  .superRefine((items, context) => {
    if (requestTotalCents(items) > BUDGET_AMOUNT_MAX_CENTS)
      context.addIssue({ code: 'custom', message: 'Talep toplamı çok büyük.' })
  })

const justificationSchema = z
  .string('Gerekçeyi yazın.')
  .trim()
  .min(PURCHASE_JUSTIFICATION_MIN, 'Gerekçeyi en az 10 karakterle yazın.')
  .max(
    PURCHASE_JUSTIFICATION_MAX,
    `En fazla ${String(PURCHASE_JUSTIFICATION_MAX)} karakter girebilirsiniz.`,
  )

/** Yeni satın alma talebi (DOM-FIN-071); taslak olarak açılır. */
export const purchaseRequestSchema = z.strictObject({
  costCenterId: z.uuid('Talep eden birimi seçin.'),
  periodId: z.uuid('Bütçe dönemini seçin.'),
  budgetItemId: z.uuid('Gider kalemini seçin.'),
  justification: justificationSchema,
  supplierId: z.uuid('Tedarikçi geçersiz.').nullable().default(null),
  items: itemsSchema,
})
export type PurchaseRequestInput = z.input<typeof purchaseRequestSchema>
export type PurchaseRequestFields = z.output<typeof purchaseRequestSchema>

/** Taslağın kısmi düzeltmesi; kalemler bütün olarak yazılır. */
export const updatePurchaseRequestSchema = z
  .strictObject({
    costCenterId: z.uuid('Talep eden birimi seçin.').optional(),
    periodId: z.uuid('Bütçe dönemini seçin.').optional(),
    budgetItemId: z.uuid('Gider kalemini seçin.').optional(),
    justification: justificationSchema.optional(),
    supplierId: z.uuid('Tedarikçi geçersiz.').nullable().optional(),
    items: itemsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdatePurchaseRequestInput = z.input<typeof updatePurchaseRequestSchema>
export type PurchaseRequestChanges = z.output<typeof updatePurchaseRequestSchema>

const reasonSchema = (empty: string) =>
  z
    .string(empty)
    .trim()
    .min(5, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(PURCHASE_REASON_MAX, `En fazla ${String(PURCHASE_REASON_MAX)} karakter girebilirsiniz.`)

/**
 * Bütçe uyarısının açık onayı (ON-245, K-146): kalanı aşan ya da bütçe satırı olmayan talep ancak
 * yetkili `confirmOverBudget: true` ile yeniden gönderince geçer.
 */
const confirmOverBudgetSchema = z.boolean('Bütçe onayı geçersiz.').optional()

/** Gönderim gövdesi isteğe bağlıdır; yalnız bütçe uyarısının onayını taşır. */
export const submitPurchaseRequestSchema = z.strictObject({
  confirmOverBudget: confirmOverBudgetSchema,
})
export type SubmitPurchaseRequestInput = z.input<typeof submitPurchaseRequestSchema>

/** Onay notu isteğe bağlıdır; bütçe uyarısında `confirmOverBudget` istenir. */
export const approvePurchaseRequestSchema = z.strictObject({
  confirmOverBudget: confirmOverBudgetSchema,
  note: z
    .string()
    .trim()
    .max(PURCHASE_REASON_MAX, `En fazla ${String(PURCHASE_REASON_MAX)} karakter girebilirsiniz.`)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
})
export type ApprovePurchaseRequestInput = z.input<typeof approvePurchaseRequestSchema>
export const rejectPurchaseRequestSchema = z.strictObject({
  reason: reasonSchema('Ret gerekçesini yazın.'),
})
export type RejectPurchaseRequestInput = z.input<typeof rejectPurchaseRequestSchema>
export const cancelPurchaseRequestSchema = z.strictObject({
  reason: reasonSchema('İptal gerekçesini yazın.'),
})
export type CancelPurchaseRequestInput = z.input<typeof cancelPurchaseRequestSchema>

// --- Hesap ---------------------------------------------------------------------------------------

/** Kalem tutarı: miktar × tahmini birim fiyat (kuruş). Saklanmaz, her okumada hesaplanır. */
export const itemTotalCents = (
  item: Pick<PurchaseRequestItem, 'quantity' | 'estimatedUnitPriceCents'>,
) => item.quantity * item.estimatedUnitPriceCents

export function requestTotalCents(
  items: readonly Pick<PurchaseRequestItem, 'quantity' | 'estimatedUnitPriceCents'>[],
): number {
  return items.reduce((total, item) => total + itemTotalCents(item), 0)
}

/** Talep numarası kurumda sıra numarasından türetilir (`ST-0007`); saklanan yalnız sıradır. */
export function purchaseRequestNumber(sequence: number): string {
  return `ST-${String(sequence).padStart(4, '0')}`
}

export interface PurchaseBudgetFigures {
  /** Dönem × merkez × kalem satırının planı; satır yoksa `null`. */
  plannedCents: number | null
  /** Aynı satıra yazılmış onaylanmış taleplerin toplamı (bu talep hariç). */
  approvedCents: number
  /** Aynı satıra yazılmış, kararı bekleyen (gönderilmiş) taleplerin toplamı (bu talep hariç). */
  pendingCents: number
}

export interface PurchaseBudgetInfo extends PurchaseBudgetFigures {
  /** Taahhüt: onaylanmış ve kararı bekleyen taleplerin toplamı (K-145). */
  committedCents: number
  /** Plan eksi taahhüt; plan yoksa `null`. Eksi olabilir. */
  remainingCents: number | null
  /** Bu talep kalanı aşıyor mu (K-145); kalana eşit talep aşmaz. */
  exceedsRemaining: boolean
  /** Talebin kalanı aştığı tutar; aşım ya da plan yoksa 0. */
  overrunCents: number
}

/**
 * Bütçe kalanı (DOM-FIN-071, ON-245, K-145): dönem × merkez × kalem satırının planından aynı
 * satırdaki taahhüt düşülür. Taahhüt gönderilmiş ve onaylanmış taleplerin tahmini toplamıdır; taslak,
 * reddedilen ve iptal edilen talep sayılmaz. Gider gerçekleşeni (DOM-FIN-066) ve sipariş (ON-225)
 * bugün yoktur; geldiklerinde onaylanmış talebin yerine sayılırlar. Denetim dönem toplamı
 * üzerindendir: aylık dağılım ve üst merkezin satırı hesaba girmez (K-147).
 */
export function purchaseBudgetInfo(
  figures: PurchaseBudgetFigures,
  requestCents: number,
): PurchaseBudgetInfo {
  const committedCents = figures.approvedCents + figures.pendingCents
  const remainingCents =
    figures.plannedCents === null ? null : figures.plannedCents - committedCents
  const overrunCents = remainingCents === null ? 0 : Math.max(requestCents - remainingCents, 0)
  return {
    ...figures,
    committedCents,
    remainingCents,
    exceedsRemaining: overrunCents > 0,
    overrunCents,
  }
}

/** Bütçe uyarısı: `over` kalan aşılıyor, `unplanned` dönem × merkez × kalem için satır yok. */
export type PurchaseBudgetWarning = 'over' | 'unplanned'
export const BUDGET_EXCEEDED_WARNING = 'budget_exceeded_warning'
export const BUDGET_LINE_MISSING_WARNING = 'budget_line_missing_warning'
/** İstemcinin açık onay isteyen uyarı kodları (409). */
export const PURCHASE_BUDGET_WARNING_CODES = [
  BUDGET_EXCEEDED_WARNING,
  BUDGET_LINE_MISSING_WARNING,
] as const

export function purchaseBudgetWarning(info: PurchaseBudgetInfo): PurchaseBudgetWarning | null {
  if (info.plannedCents === null) return 'unplanned'
  return info.exceedsRemaining ? 'over' : null
}

/** Uyarının kullanıcı metni; aşım tutarı ve kalan Türkçe biçimle yazılır. */
export function purchaseBudgetWarningMessage(info: PurchaseBudgetInfo): string | null {
  const warning = purchaseBudgetWarning(info)
  if (warning === 'unplanned')
    return 'Bu dönemde talep eden birim ve gider kalemi için bütçe satırı yok; talep bütçesizdir. Sürdürmek için bütçesiz olduğunu açıkça onaylayın.'
  if (warning === 'over')
    return `Bu talep bütçe kalanını ${money(info.overrunCents)} aşıyor (plan ${money(info.plannedCents)}, gönderilmiş ve onaylanmış talepler ${money(info.committedCents)}, kalan ${money(info.remainingCents)}). Sürdürmek için aşımı açıkça onaylayın.`
  return null
}

/**
 * Gönderim ve onayda bütçe denetimi (ON-245, K-146): kalanı aşan ya da satırı olmayan talep açık
 * onay olmadan 409 alır (`budget_exceeded_warning`, `budget_line_missing_warning`); onaylanırsa geçer.
 * Dönen uyarı onaylanarak geçildiğini gösterir (denetim kaydına yazılır), uyarı yoksa `null`.
 * Servis girdileri kurum kilidi altında yükler: eşzamanlı iki talep aynı kalanı ikisi birden almaz.
 */
export function confirmPurchaseBudget(
  info: PurchaseBudgetInfo,
  confirmOverBudget: boolean | undefined,
): PurchaseBudgetWarning | null {
  const warning = purchaseBudgetWarning(info)
  if (warning === null || confirmOverBudget === true) return warning
  throw new DomainError(
    warning === 'over' ? BUDGET_EXCEEDED_WARNING : BUDGET_LINE_MISSING_WARNING,
    purchaseBudgetWarningMessage(info) ?? '',
    { kind: 'conflict' },
  )
}

// --- Kurallar ------------------------------------------------------------------------------------

export interface PurchaseRequestRefs {
  period: { status: 'draft' | 'open' | 'closed' } | null
  costCenter: { isActive: boolean } | null
  budgetItem: { kind: BudgetItemKind; isActive: boolean } | null
  /** Önerilen tedarikçi; talep tedarikçisizse `undefined`. */
  supplier?: { isActive: boolean } | null
}

export interface PurchaseRequestState {
  status: PurchaseRequestStatus
  requestedByUserId: string
}

export interface PurchaseActor {
  userId: string
  role: string
}

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path ? { path: [path] } : {}) })

/** Bağlı kayıtlar: dönem kapalı değil, merkez etkin, kalem etkin gider kalemi, tedarikçi etkin. */
function assertRefs(refs: PurchaseRequestRefs): void {
  if (refs.period === null)
    throw ruleError('purchase_request_period_not_found', 'Bütçe dönemi bulunamadı.', 'periodId')
  if (refs.period.status === 'closed')
    throw ruleError(
      'purchase_request_period_closed',
      'Kapalı bütçe dönemine talep yazılamaz.',
      'periodId',
    )
  if (refs.costCenter === null)
    throw ruleError(
      'purchase_request_cost_center_not_found',
      'Talep eden birim bulunamadı.',
      'costCenterId',
    )
  if (!refs.costCenter.isActive)
    throw ruleError(
      'purchase_request_cost_center_inactive',
      'Pasif maliyet merkezi adına talep açılamaz.',
      'costCenterId',
    )
  if (refs.budgetItem === null)
    throw ruleError(
      'purchase_request_budget_item_not_found',
      'Gider kalemi bulunamadı.',
      'budgetItemId',
    )
  if (refs.budgetItem.kind !== 'expense')
    throw ruleError(
      'purchase_request_budget_item_not_expense',
      'Satın alma talebi yalnız gider kalemine yazılır.',
      'budgetItemId',
    )
  if (!refs.budgetItem.isActive)
    throw ruleError(
      'purchase_request_budget_item_inactive',
      'Pasif gider kalemine talep yazılamaz.',
      'budgetItemId',
    )
  if (refs.supplier === null)
    throw ruleError('purchase_request_supplier_not_found', 'Tedarikçi bulunamadı.', 'supplierId')
  if (refs.supplier !== undefined && !refs.supplier.isActive)
    throw ruleError(
      'purchase_request_supplier_inactive',
      'Pasif tedarikçi önerilemez.',
      'supplierId',
    )
}

/** Ön büro yalnız kendi açtığı talebi düzeltir, gönderir ve iptal eder; yönetici her talebi (K-128). */
function assertOwner(request: PurchaseRequestState, actor: PurchaseActor): void {
  if (actor.role === 'yonetici') return
  if (request.requestedByUserId !== actor.userId)
    throw new DomainError(
      'purchase_request_not_owner',
      'Yalnız kendi açtığınız talebi değiştirebilirsiniz.',
      { kind: 'forbidden' },
    )
}

function assertStatus(
  request: PurchaseRequestState,
  allowed: readonly PurchaseRequestStatus[],
  code: string,
  message: string,
): void {
  if (!allowed.includes(request.status)) throw ruleError(code, message)
}

/** Yeni taslak (DOM-FIN-071). */
export function planPurchaseRequest(
  input: unknown,
  refs: PurchaseRequestRefs,
): PurchaseRequestFields {
  const data = purchaseRequestSchema.parse(input)
  assertRefs(refs)
  return data
}

/** Taslağın düzeltmesi; gönderilmiş ya da kararı verilmiş talep değişmez. */
export function planPurchaseRequestUpdate(
  request: PurchaseRequestState,
  input: unknown,
  refs: PurchaseRequestRefs,
  actor: PurchaseActor,
): PurchaseRequestChanges {
  const changes = updatePurchaseRequestSchema.parse(input)
  assertOwner(request, actor)
  assertStatus(
    request,
    ['draft'],
    'purchase_request_not_draft',
    'Yalnız taslak talep düzeltilebilir.',
  )
  assertRefs(refs)
  return changes
}

/**
 * Gönderim: taslak, bağlı kayıtlar geçerli ve dönem açık olmalıdır (taslak dönem henüz yürürlükte
 * değil; kapalı dönem 422 `purchase_request_period_closed`). Bütçe uyarısı bu kurallardan sonra
 * `confirmPurchaseBudget` ile denetlenir; gövde yalnız onu taşır.
 */
export function planPurchaseRequestSubmit(
  request: PurchaseRequestState,
  refs: PurchaseRequestRefs,
  actor: PurchaseActor,
  input?: unknown,
): z.output<typeof submitPurchaseRequestSchema> {
  const data = submitPurchaseRequestSchema.parse(input ?? {})
  assertOwner(request, actor)
  assertStatus(
    request,
    ['draft'],
    'purchase_request_not_draft',
    'Yalnız taslak talep gönderilebilir.',
  )
  assertRefs(refs)
  if (refs.period?.status !== 'open')
    throw ruleError(
      'purchase_request_period_not_open',
      'Talep yalnız açık bütçe dönemine gönderilir; dönemi önce yönetici açar.',
      'periodId',
    )
  return data
}

/** Onay: gönderilmiş talep, dönem hâlâ açık. Yönetici kendi açtığı talebi de onaylar (K-129). */
export function planPurchaseRequestApprove(
  request: PurchaseRequestState,
  input: unknown,
  refs: Pick<PurchaseRequestRefs, 'period'>,
): z.output<typeof approvePurchaseRequestSchema> {
  const data = approvePurchaseRequestSchema.parse(input ?? {})
  assertStatus(
    request,
    ['submitted'],
    'purchase_request_not_submitted',
    'Yalnız gönderilmiş talep onaylanabilir.',
  )
  if (refs.period?.status !== 'open')
    throw ruleError(
      'purchase_request_period_not_open',
      'Bütçe dönemi açık değil; talep onaylanamaz.',
      'periodId',
    )
  return data
}

/** Ret: gönderilmiş talep, gerekçe zorunlu. */
export function planPurchaseRequestReject(
  request: PurchaseRequestState,
  input: unknown,
): z.output<typeof rejectPurchaseRequestSchema> {
  const data = rejectPurchaseRequestSchema.parse(input)
  assertStatus(
    request,
    ['submitted'],
    'purchase_request_not_submitted',
    'Yalnız gönderilmiş talep reddedilebilir.',
  )
  return data
}

/**
 * İptal: taslak ya da gönderilmiş talep, gerekçeyle. Onaylanmış talebin iptali sipariş adımıyla
 * (ON-225) gelir (K-132).
 */
export function planPurchaseRequestCancel(
  request: PurchaseRequestState,
  input: unknown,
  actor: PurchaseActor,
): z.output<typeof cancelPurchaseRequestSchema> {
  const data = cancelPurchaseRequestSchema.parse(input)
  assertOwner(request, actor)
  assertStatus(
    request,
    ['draft', 'submitted'],
    'purchase_request_not_cancellable',
    'Yalnız taslak ya da gönderilmiş talep iptal edilebilir.',
  )
  return data
}

/** Rolün talepte yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function purchaseRequestActions(
  request: PurchaseRequestState,
  actor: { userId: string; role: RequestRole | string },
): { edit: boolean; submit: boolean; cancel: boolean; decide: boolean } {
  const owner = actor.role === 'yonetici' || request.requestedByUserId === actor.userId
  const staff = actor.role === 'yonetici' || actor.role === 'onburo'
  return {
    edit: staff && owner && request.status === 'draft',
    submit: staff && owner && request.status === 'draft',
    cancel: staff && owner && (request.status === 'draft' || request.status === 'submitted'),
    decide: actor.role === 'yonetici' && request.status === 'submitted',
  }
}
