import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import {
  BUDGET_AMOUNT_MAX_CENTS,
  BUDGET_ITEM_KIND_LABELS,
  BUDGET_ROLES,
  type BudgetItemKind,
  type BudgetPeriodStatus,
} from './finance-budget.ts'
import { DomainError } from './errors.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Bütçe hazırlama ve onay (docs/domain/finans.md DOM-FIN-093; ON-243). Bir bütçe dönemi
 * (DOM-FIN-062) için her maliyet merkezinin (birimin) bir taslağı olur: kalem, tutar (kuruş) ve
 * gerekçe satırları. Taslağı merkezin bütçe sorumlusu ya da yönetici hazırlar ve gönderir; yönetici
 * onaylar, gerekçeyle revizyon ister ya da reddeder (tek kademe, K-256). Durum:
 *
 * `draft` → `submitted` → `approved` | `revision_requested` (→ yeniden `submitted`) | `rejected`
 *
 * Onaylanan taslak dönemin bütçe satırlarına tek işlemde yazılır; onaylı bütçe yeni revizyonla
 * (`approved` → `draft`) değişir (K-258). Her gönderim bir sürümdür: sürüm numarası, gönderen, zaman
 * ve önceki sürüme göre değişen kalemler silinmeyen geçmişte durur. Fonksiyonlar saftır; dönem,
 * merkez, kalem, satır ve üyelik servisten gelir.
 */

/** Taslak uçlarını açan roller; yönetici dışındakiler yalnız sorumlusu oldukları merkezi görür (K-257). */
export const BUDGET_DRAFT_ROLES = ['yonetici', 'onburo', 'ogretmen'] as const
/** Onay, revizyon isteği, ret ve bütçe sorumlusu ataması yönetimdedir (K-256, K-60). */
export const BUDGET_DRAFT_APPROVER_ROLES = BUDGET_ROLES

export const BUDGET_DRAFT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'revision_requested',
  'rejected',
] as const
export type BudgetDraftStatus = (typeof BUDGET_DRAFT_STATUSES)[number]
export const BUDGET_DRAFT_STATUS_LABELS = {
  draft: 'Taslak',
  submitted: 'Onay bekliyor',
  approved: 'Onaylandı',
  revision_requested: 'Revizyon istendi',
  rejected: 'Reddedildi',
} as const satisfies Record<BudgetDraftStatus, string>

export const BUDGET_DRAFT_EVENTS = [
  'created',
  'submitted',
  'approved',
  'revision_requested',
  'rejected',
  'reopened',
] as const
export type BudgetDraftEvent = (typeof BUDGET_DRAFT_EVENTS)[number]
export const BUDGET_DRAFT_EVENT_LABELS = {
  created: 'Taslak açıldı',
  submitted: 'Onaya gönderildi',
  approved: 'Onaylandı',
  revision_requested: 'Revizyon istendi',
  rejected: 'Reddedildi',
  reopened: 'Yeni revizyon açıldı',
} as const satisfies Record<BudgetDraftEvent, string>

export const BUDGET_DRAFT_LINES_MAX = 200
export const BUDGET_DRAFT_TEXT_MAX = 1000
export const BUDGET_DRAFT_REASON_MIN = 5

// --- Şemalar -------------------------------------------------------------------------------------

const amountSchema = z
  .number('Tutarı girin.')
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .min(0, 'Tutar sıfırdan küçük olamaz.')
  .max(BUDGET_AMOUNT_MAX_CENTS, 'Tutar en fazla 10.000.000.000 ₺ olabilir.')

const optionalTextSchema = z
  .string('Metin girin.')
  .trim()
  .max(BUDGET_DRAFT_TEXT_MAX, `En fazla ${String(BUDGET_DRAFT_TEXT_MAX)} karakter girebilirsiniz.`)
  .nullable()
  .default(null)

/** Yeni taslak: dönem ve maliyet merkezi; satırlar merkezin onaylı bütçesinden doldurulur. */
export const budgetDraftSchema = z.strictObject({
  periodId: z.uuid('Bütçe dönemi seçin.'),
  costCenterId: z.uuid('Maliyet merkezi seçin.'),
})
export type BudgetDraftInput = z.input<typeof budgetDraftSchema>

/** Taslak satırı: kalem, planlanan tutar (kuruş) ve gerekçe. */
export const budgetDraftLineSchema = z.strictObject({
  itemId: z.uuid('Bütçe kalemi seçin.'),
  amountCents: amountSchema,
  justification: optionalTextSchema.describe(
    'Gerekçe; onaylı tutardan farklı ya da yeni kalemde gönderimde zorunlu (K-257)',
  ),
})
export type BudgetDraftLineInput = z.input<typeof budgetDraftLineSchema>

/** Taslağın satırlarının tamamı (yerine yazılır); bir kalem taslakta bir kez. */
export const budgetDraftLinesSchema = z
  .strictObject({
    lines: z
      .array(budgetDraftLineSchema, 'Satırlar liste olmalıdır.')
      .max(
        BUDGET_DRAFT_LINES_MAX,
        `Taslak en çok ${String(BUDGET_DRAFT_LINES_MAX)} kalem içerebilir.`,
      ),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>()
    value.lines.forEach((line, index) => {
      if (seen.has(line.itemId))
        context.addIssue({
          code: 'custom',
          path: ['lines', index, 'itemId'],
          message: 'Bu kalem taslakta zaten var.',
        })
      seen.add(line.itemId)
    })
  })
export type BudgetDraftLinesInput = z.input<typeof budgetDraftLinesSchema>

/** Revizyon isteği ve ret: gerekçe zorunlu. */
export const budgetDraftReasonSchema = z.strictObject({
  reason: z
    .string('Gerekçeyi yazın.')
    .trim()
    .min(BUDGET_DRAFT_REASON_MIN, `En az ${String(BUDGET_DRAFT_REASON_MIN)} karakter girin.`)
    .max(
      BUDGET_DRAFT_TEXT_MAX,
      `En fazla ${String(BUDGET_DRAFT_TEXT_MAX)} karakter girebilirsiniz.`,
    ),
})
export type BudgetDraftReasonInput = z.input<typeof budgetDraftReasonSchema>

/** Gönderim, onay ve yeni revizyon: isteğe bağlı not. */
export const budgetDraftNoteSchema = z.strictObject({ note: optionalTextSchema })
export type BudgetDraftNoteInput = z.input<typeof budgetDraftNoteSchema>

/** Merkezin bütçe sorumlusu: kurumun etkin personel üyeliği ya da `null` (sorumlu yok). */
export const budgetOwnerSchema = z.strictObject({
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .nullable()
    .describe('Bütçe sorumlusunun kurum üyeliği; `null` sorumluyu kaldırır'),
})
export type BudgetOwnerInput = z.input<typeof budgetOwnerSchema>

// --- Ortak tipler --------------------------------------------------------------------------------

export interface BudgetDraftLineValue {
  itemId: string
  amountCents: number
  justification: string | null
}

export interface BudgetDraftActor {
  role: string
  /** Oturumdaki üyelik merkezin bütçe sorumlusu mu (K-257). */
  isOwner: boolean
}

export interface BudgetDraftChange {
  itemId: string
  /** Önceki sürümdeki (ilk gönderimde onaylı bütçedeki) tutar; kalem yoksa `null`. */
  beforeCents: number | null
  /** Bu sürümdeki tutar; kalem çıkarıldıysa `null`. */
  afterCents: number | null
}

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path === undefined ? {} : { path: path.map(String) }),
  })

const normalizeText = (value: string | null) =>
  value === null || value.trim() === '' ? null : value.trim()

/** Taslağı hazırlayabilir mi: yönetici ya da merkezin bütçe sorumlusu (K-257). */
export const canPrepareBudgetDraft = (actor: BudgetDraftActor) =>
  actor.role === 'yonetici' || actor.isOwner

/** Onay, revizyon isteği ve ret yalnız yöneticide (K-256). */
export const canDecideBudgetDraft = (role: string) =>
  (BUDGET_DRAFT_APPROVER_ROLES as readonly string[]).includes(role)

// --- Durum geçişi --------------------------------------------------------------------------------

export type BudgetDraftAction =
  'edit' | 'submit' | 'approve' | 'requestRevision' | 'reject' | 'reopen'

const TRANSITIONS: Record<
  BudgetDraftAction,
  { from: readonly BudgetDraftStatus[]; to: BudgetDraftStatus; message: string }
> = {
  edit: {
    from: ['draft', 'revision_requested'],
    to: 'draft',
    message: 'Yalnız taslak ya da revizyonu istenen bütçe düzenlenebilir.',
  },
  submit: {
    from: ['draft', 'revision_requested'],
    to: 'submitted',
    message: 'Yalnız taslak ya da revizyonu istenen bütçe onaya gönderilebilir.',
  },
  approve: {
    from: ['submitted'],
    to: 'approved',
    message: 'Yalnız onay bekleyen taslak onaylanabilir.',
  },
  requestRevision: {
    from: ['submitted'],
    to: 'revision_requested',
    message: 'Yalnız onay bekleyen taslak için revizyon istenebilir.',
  },
  reject: {
    from: ['submitted'],
    to: 'rejected',
    message: 'Yalnız onay bekleyen taslak reddedilebilir.',
  },
  reopen: {
    from: ['approved'],
    to: 'draft',
    message: 'Yeni revizyon yalnız onaylı bütçeden açılır.',
  },
}

export const canBudgetDraft = (status: BudgetDraftStatus, action: BudgetDraftAction) =>
  TRANSITIONS[action].from.includes(status)

/** Geçişin hedef durumu; geçersiz geçiş 422 `budget_draft_status_invalid`. */
export function budgetDraftTransition(
  status: BudgetDraftStatus,
  action: BudgetDraftAction,
): BudgetDraftStatus {
  const rule = TRANSITIONS[action]
  if (!rule.from.includes(status)) throw ruleError('budget_draft_status_invalid', rule.message)
  return action === 'edit' ? status : rule.to
}

function assertPeriodOpenForDrafts(period: { status: BudgetPeriodStatus }, path?: string[]) {
  if (period.status === 'closed')
    throw ruleError(
      'budget_period_closed',
      'Kapalı bütçe döneminde taslak hazırlanamaz ve onaylanamaz.',
      path,
    )
}

// --- Oluşturma -----------------------------------------------------------------------------------

export interface BudgetDraftCreateChecks {
  /** Kurumun dönemi; yoksa `null`. */
  period: { status: BudgetPeriodStatus } | null
  /** Kurumun merkezi; yoksa `null`. */
  center: { isActive: boolean } | null
  actor: BudgetDraftActor
  /** Bu dönem ve merkez için reddedilmemiş taslak var mı. */
  exists: boolean
}

/**
 * Yeni taslak (K-257): merkez kurumda ve etkin, oturumdaki kişi yönetici ya da merkezin bütçe
 * sorumlusu, dönem kapalı değil; dönem × merkez için reddedilmemiş tek taslak (409).
 */
export function planBudgetDraftCreate(input: unknown, checks: BudgetDraftCreateChecks) {
  const data = budgetDraftSchema.parse(input)
  if (checks.center === null)
    throw ruleError('cost_center_not_found', 'Maliyet merkezi bulunamadı.', ['costCenterId'])
  if (!canPrepareBudgetDraft(checks.actor))
    throw new DomainError(
      'budget_draft_not_owner',
      'Yalnız bütçe sorumlusu olduğunuz birimin taslağını hazırlayabilirsiniz.',
      { kind: 'forbidden', path: ['costCenterId'] },
    )
  if (!checks.center.isActive)
    throw ruleError('cost_center_inactive', 'Pasif maliyet merkezine bütçe taslağı açılamaz.', [
      'costCenterId',
    ])
  if (checks.period === null)
    throw ruleError('budget_period_not_found', 'Bütçe dönemi bulunamadı.', ['periodId'])
  assertPeriodOpenForDrafts(checks.period, ['periodId'])
  if (checks.exists)
    throw new DomainError(
      'budget_draft_exists',
      'Bu dönemde bu birimin taslağı var; mevcut taslağı açın.',
      { kind: 'conflict', path: ['costCenterId'] },
    )
  return data
}

// --- Satırlar ------------------------------------------------------------------------------------

export interface BudgetDraftLinesChecks {
  status: BudgetDraftStatus
  period: { status: BudgetPeriodStatus }
  /** Kurumun kalemleri (pasifler dahil). */
  items: ReadonlyMap<string, { isActive: boolean }>
  /** Taslakta şimdi bulunan kalemler: pasifleşen kalem kalabilir, yeniden eklenemez. */
  currentItemIds: ReadonlySet<string>
}

/** Satırların yerine yazılması: kalem kurumda; yeni eklenen kalem etkin. Boş gerekçe `null`. */
export function planBudgetDraftLines(
  input: unknown,
  checks: BudgetDraftLinesChecks,
): BudgetDraftLineValue[] {
  const data = budgetDraftLinesSchema.parse(input)
  budgetDraftTransition(checks.status, 'edit')
  assertPeriodOpenForDrafts(checks.period)
  return data.lines.map((line, index) => {
    const item = checks.items.get(line.itemId)
    if (item === undefined)
      throw ruleError('budget_item_not_found', 'Bütçe kalemi bulunamadı.', [
        'lines',
        index,
        'itemId',
      ])
    if (!item.isActive && !checks.currentItemIds.has(line.itemId))
      throw ruleError('budget_item_inactive', 'Pasif bütçe kalemi taslağa eklenemez.', [
        'lines',
        index,
        'itemId',
      ])
    return {
      itemId: line.itemId,
      amountCents: line.amountCents,
      justification: normalizeText(line.justification),
    }
  })
}

/**
 * Önceki sürüme göre değişen kalemler: eklenen, tutarı değişen ve çıkarılan. Sıra yeni sürümün
 * satır sırası, ardından çıkarılanlar önceki sırayla.
 */
export function budgetDraftChanges(
  before: readonly Pick<BudgetDraftLineValue, 'itemId' | 'amountCents'>[],
  after: readonly Pick<BudgetDraftLineValue, 'itemId' | 'amountCents'>[],
): BudgetDraftChange[] {
  const previous = new Map(before.map((line) => [line.itemId, line.amountCents]))
  const next = new Set(after.map((line) => line.itemId))
  const changes: BudgetDraftChange[] = []
  for (const line of after) {
    const old = previous.get(line.itemId)
    if (old === undefined || old !== line.amountCents)
      changes.push({ itemId: line.itemId, beforeCents: old ?? null, afterCents: line.amountCents })
  }
  for (const line of before)
    if (!next.has(line.itemId))
      changes.push({ itemId: line.itemId, beforeCents: line.amountCents, afterCents: null })
  return changes
}

// --- Gönderim ------------------------------------------------------------------------------------

export interface BudgetDraftSubmitChecks {
  status: BudgetDraftStatus
  revision: number
  period: { status: BudgetPeriodStatus }
  lines: readonly BudgetDraftLineValue[]
  /** Merkezin dönemdeki onaylı bütçe satırları (kalem → tutar). */
  approved: ReadonlyMap<string, number>
}

/**
 * Onaya gönderim (K-257): en az bir satır; onaylı tutardan farklı ya da yeni kalemin (tutarı
 * sıfırdan büyükse) gerekçesi zorunlu. Sürüm numarası bir artar.
 */
export function planBudgetDraftSubmit(checks: BudgetDraftSubmitChecks): {
  status: BudgetDraftStatus
  revision: number
} {
  const status = budgetDraftTransition(checks.status, 'submit')
  assertPeriodOpenForDrafts(checks.period)
  if (checks.lines.length === 0)
    throw ruleError('budget_draft_empty', 'Onaya göndermeden önce en az bir kalem girin.', [
      'lines',
    ])
  checks.lines.forEach((line, index) => {
    const approved = checks.approved.get(line.itemId)
    const changed = approved === undefined || approved !== line.amountCents
    if (changed && line.amountCents > 0 && line.justification === null)
      throw ruleError(
        'budget_draft_justification_required',
        'Yeni ya da onaylı tutarı değişen kalemin gerekçesini yazın.',
        ['lines', index, 'justification'],
      )
  })
  return { status, revision: checks.revision + 1 }
}

// --- Onay ----------------------------------------------------------------------------------------

export interface BudgetApprovalLine {
  id: string
  itemId: string
  amountCents: number
  monthlyCents: readonly number[] | null
  version: number
}

export interface BudgetDraftApprovalChecks {
  status: BudgetDraftStatus
  period: { status: BudgetPeriodStatus }
  center: { isActive: boolean }
  items: ReadonlyMap<string, { isActive: boolean }>
  lines: readonly Pick<BudgetDraftLineValue, 'itemId' | 'amountCents'>[]
  /** Merkezin dönemdeki etkin bütçe satırları. */
  current: readonly BudgetApprovalLine[]
}

export interface BudgetDraftApprovalPlan {
  status: BudgetDraftStatus
  inserts: { itemId: string; amountCents: number }[]
  /** Tutarı değişen satır; aylık dağılım tutar değişince kaldırılır (K-258). */
  updates: { id: string; version: number; amountCents: number; monthlyCents: null }[]
  /** Taslakta olmayan kalemin satırı kaldırılır (arşiv). */
  removals: { id: string; version: number }[]
}

/**
 * Onay (K-258): merkezin dönemdeki bütçe satırları taslağa eşitlenir. Yeni satırın merkezi ve kalemi
 * etkin olmalıdır (DOM-FIN-062); tutarı aynı kalan satır ve dağılımı değişmez.
 */
export function planBudgetDraftApproval(
  checks: BudgetDraftApprovalChecks,
): BudgetDraftApprovalPlan {
  const status = budgetDraftTransition(checks.status, 'approve')
  assertPeriodOpenForDrafts(checks.period)
  const byItem = new Map(checks.current.map((line) => [line.itemId, line]))
  const wanted = new Set(checks.lines.map((line) => line.itemId))
  const plan: BudgetDraftApprovalPlan = { status, inserts: [], updates: [], removals: [] }
  checks.lines.forEach((line, index) => {
    const existing = byItem.get(line.itemId)
    if (existing === undefined) {
      if (!checks.center.isActive)
        throw ruleError(
          'cost_center_inactive',
          'Pasif maliyet merkezine bütçe satırı eklenemez; merkezi etkinleştirin ya da taslağa revizyon isteyin.',
        )
      if (checks.items.get(line.itemId)?.isActive !== true)
        throw ruleError(
          'budget_item_inactive',
          'Pasif bütçe kalemine satır eklenemez; taslağa revizyon isteyin.',
          ['lines', index, 'itemId'],
        )
      plan.inserts.push({ itemId: line.itemId, amountCents: line.amountCents })
    } else if (existing.amountCents !== line.amountCents)
      plan.updates.push({
        id: existing.id,
        version: existing.version,
        amountCents: line.amountCents,
        monthlyCents: null,
      })
  })
  for (const line of checks.current)
    if (!wanted.has(line.itemId)) plan.removals.push({ id: line.id, version: line.version })
  return plan
}

/** Yeni revizyon (K-258): onaylı taslak yeniden taslak olur; onaylı bütçe yeni onaya kadar kalır. */
export function planBudgetDraftReopen(checks: {
  status: BudgetDraftStatus
  period: { status: BudgetPeriodStatus }
}): BudgetDraftStatus {
  const status = budgetDraftTransition(checks.status, 'reopen')
  assertPeriodOpenForDrafts(checks.period)
  return status
}

/** Ekran düğmeleri; sunucu aynı kuralları yeniden denetler. */
export function budgetDraftActions(
  draft: { status: BudgetDraftStatus },
  actor: BudgetDraftActor,
  periodStatus: BudgetPeriodStatus,
): Record<BudgetDraftAction, boolean> {
  const open = periodStatus !== 'closed'
  const prepare = open && canPrepareBudgetDraft(actor)
  const decide = open && canDecideBudgetDraft(actor.role)
  return {
    edit: prepare && canBudgetDraft(draft.status, 'edit'),
    submit: prepare && canBudgetDraft(draft.status, 'submit'),
    approve: decide && canBudgetDraft(draft.status, 'approve'),
    requestRevision: decide && canBudgetDraft(draft.status, 'requestRevision'),
    reject: decide && canBudgetDraft(draft.status, 'reject'),
    reopen: prepare && canBudgetDraft(draft.status, 'reopen'),
  }
}

// --- Bütçe sorumlusu -----------------------------------------------------------------------------

/**
 * Sorumlu ataması (K-257): kurumun etkin yönetici, öğretmen ya da ön büro üyeliği. Olmayan üyelik
 * (başka kurumunki dahil) 422 `budget_owner_not_found`.
 */
export function planBudgetOwner(
  input: unknown,
  staff: { role: string; active: boolean } | null | undefined,
): string | null {
  const data = budgetOwnerSchema.parse(input)
  if (data.membershipId === null) return null
  if (staff === undefined || staff === null)
    throw ruleError('budget_owner_not_found', 'Personel bulunamadı.', ['membershipId'])
  if (!isStaffRole(staff.role))
    throw ruleError(
      'budget_owner_not_staff',
      'Bütçe sorumlusu yalnız personel (yönetici, öğretmen, ön büro) olabilir.',
      ['membershipId'],
    )
  if (!staff.active)
    throw ruleError('budget_owner_inactive', 'Pasif personel bütçe sorumlusu olamaz.', [
      'membershipId',
    ])
  return data.membershipId
}

// --- Önceki dönem ve karşılaştırma ---------------------------------------------------------------

export interface BudgetPeriodRef {
  id: string
  name: string
  startDate: string
  endDate: string
  status: BudgetPeriodStatus
}

/**
 * Karşılaştırmanın önceki dönemi (K-259): bu dönem başlamadan biten, taslak olmayan dönemlerden en
 * son biteni; yoksa `null`.
 */
export function previousBudgetPeriod<T extends BudgetPeriodRef>(
  periods: readonly T[],
  current: Pick<BudgetPeriodRef, 'id' | 'startDate'>,
): T | null {
  let found: T | null = null
  for (const period of periods) {
    if (period.id === current.id || period.status === 'draft') continue
    if (period.endDate >= current.startDate) continue
    if (
      found === null ||
      period.endDate > found.endDate ||
      (period.endDate === found.endDate && period.startDate > found.startDate)
    )
      found = period
  }
  return found
}

export interface BudgetComparisonItem {
  id: string
  code: string
  name: string
  kind: BudgetItemKind
}

export interface BudgetDraftComparisonRow {
  itemId: string
  itemCode: string
  itemName: string
  itemKind: BudgetItemKind
  /** Taslaktaki tutar; kalem taslakta yoksa `null`. */
  draftCents: number | null
  justification: string | null
  /** Bu dönemin onaylı bütçesindeki tutar; satır yoksa `null`. */
  approvedCents: number | null
  /** Önceki dönemin planı; satır yoksa `null`. */
  previousPlanCents: number | null
  /** Önceki dönemin gerçekleşeni (tahakkuk esası, DOM-FIN-066); hesaplanmıyorsa `null`. */
  previousActualCents: number | null
  /** Taslak − önceki dönem gerçekleşeni; ikisinden biri yoksa `null`. */
  changeFromPreviousCents: number | null
}

export interface BudgetDraftComparisonTotals {
  draftCents: number
  approvedCents: number
  previousPlanCents: number
  previousActualCents: number | null
}

export interface BudgetDraftComparison {
  rows: BudgetDraftComparisonRow[]
  totals: Record<BudgetItemKind, BudgetDraftComparisonTotals>
}

/**
 * Karşılaştırma satırları: taslak, bu dönemin onaylı bütçesi ve önceki dönemin planı ile
 * gerçekleşeni kalem bazında yan yana. Satır taslakta, onaylı bütçede ya da önceki dönemde bulunan
 * her kalemdir; sıra tür (gelir önce), sonra kalem kodu.
 */
export function budgetDraftComparison(input: {
  items: readonly BudgetComparisonItem[]
  draft: readonly BudgetDraftLineValue[]
  approved: ReadonlyMap<string, number>
  previous: ReadonlyMap<string, { plannedCents: number | null; actualCents: number | null }> | null
}): BudgetDraftComparison {
  const draft = new Map(input.draft.map((line) => [line.itemId, line]))
  const ids = new Set([
    ...draft.keys(),
    ...input.approved.keys(),
    ...(input.previous?.keys() ?? []),
  ])
  const rows: BudgetDraftComparisonRow[] = []
  for (const item of input.items) {
    if (!ids.has(item.id)) continue
    const line = draft.get(item.id)
    const previous = input.previous?.get(item.id)
    const draftCents = line?.amountCents ?? null
    const previousActualCents = previous?.actualCents ?? null
    rows.push({
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      itemKind: item.kind,
      draftCents,
      justification: line?.justification ?? null,
      approvedCents: input.approved.get(item.id) ?? null,
      previousPlanCents: previous?.plannedCents ?? null,
      previousActualCents,
      changeFromPreviousCents:
        draftCents === null || previousActualCents === null
          ? null
          : draftCents - previousActualCents,
    })
  }
  rows.sort((a, b) =>
    a.itemKind !== b.itemKind
      ? a.itemKind === 'income'
        ? -1
        : 1
      : a.itemCode < b.itemCode
        ? -1
        : a.itemCode > b.itemCode
          ? 1
          : 0,
  )
  const totals = {
    income: emptyTotals(input.previous !== null),
    expense: emptyTotals(input.previous !== null),
  }
  for (const row of rows) {
    const sum = totals[row.itemKind]
    sum.draftCents += row.draftCents ?? 0
    sum.approvedCents += row.approvedCents ?? 0
    sum.previousPlanCents += row.previousPlanCents ?? 0
    if (sum.previousActualCents !== null && row.previousActualCents !== null)
      sum.previousActualCents += row.previousActualCents
  }
  return { rows, totals }
}

const emptyTotals = (hasPrevious: boolean): BudgetDraftComparisonTotals => ({
  draftCents: 0,
  approvedCents: 0,
  previousPlanCents: 0,
  previousActualCents: hasPrevious ? 0 : null,
})

const optionalAmount = (cents: number | null) => (cents === null ? csvCell('') : csvAmount(cents))

/**
 * Karşılaştırma CSV'si: kalem başına taslak, onaylı bütçe, önceki dönem planı ve gerçekleşeni,
 * değişim ve gerekçe; sonunda tür toplamları. Kişi verisi taşımaz; tarayıcıda yanıttan üretilir.
 */
export function budgetDraftComparisonCsv(comparison: BudgetDraftComparison): string {
  const header = [
    'Kalem kodu',
    'Kalem',
    'Tür',
    'Önceki dönem planı (₺)',
    'Önceki dönem gerçekleşeni (₺)',
    'Onaylı bütçe (₺)',
    'Taslak (₺)',
    'Değişim (₺)',
    'Gerekçe',
  ]
  const lines: string[] = [header.map(csvCell).join(CSV_SEPARATOR)]
  for (const row of comparison.rows)
    lines.push(
      [
        csvCell(row.itemCode),
        csvCell(row.itemName),
        csvCell(BUDGET_ITEM_KIND_LABELS[row.itemKind]),
        optionalAmount(row.previousPlanCents),
        optionalAmount(row.previousActualCents),
        optionalAmount(row.approvedCents),
        optionalAmount(row.draftCents),
        optionalAmount(row.changeFromPreviousCents),
        csvCell(row.justification ?? ''),
      ].join(CSV_SEPARATOR),
    )
  for (const kind of ['income', 'expense'] as const) {
    const sum = comparison.totals[kind]
    lines.push(
      [
        csvCell(''),
        csvCell(`${BUDGET_ITEM_KIND_LABELS[kind]} toplamı`),
        csvCell(BUDGET_ITEM_KIND_LABELS[kind]),
        csvAmount(sum.previousPlanCents),
        optionalAmount(sum.previousActualCents),
        csvAmount(sum.approvedCents),
        csvAmount(sum.draftCents),
        optionalAmount(
          sum.previousActualCents === null ? null : sum.draftCents - sum.previousActualCents,
        ),
        csvCell(''),
      ].join(CSV_SEPARATOR),
    )
  }
  return lines.join('\r\n')
}

/** Taslak satırlarının tür toplamları (liste ve ayrıntı). */
export function budgetDraftTotals(
  lines: readonly { amountCents: number; itemKind: BudgetItemKind }[],
): { incomeCents: number; expenseCents: number } {
  let incomeCents = 0
  let expenseCents = 0
  for (const line of lines)
    if (line.itemKind === 'income') incomeCents += line.amountCents
    else expenseCents += line.amountCents
  return { incomeCents, expenseCents }
}
