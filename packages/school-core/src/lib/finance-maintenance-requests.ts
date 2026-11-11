import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  FIXED_ASSET_LOCATION_MAX,
  FIXED_ASSET_TAG_MAX,
  FIXED_ASSET_TAG_PATTERN,
  normalizeFixedAssetTag,
  type FixedAssetStatus,
} from './finance-fixed-assets.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Arıza ve bakım talebi, iş emri (docs/domain/finans.md DOM-FIN-089; ON-239). Kurum üyesi (yönetici,
 * ön büro, öğretmen) arızayı başlık, açıklama, yer ve isteğe bağlı demirbaş etiketiyle bildirir
 * (K-236). Yönetici talebi bir personele ya da dış tedarikçiye atar, işe başlatır, çözüm notu,
 * günü, isteğe bağlı maliyet ve tedarikçiyle çözer ve kapatır; açık talep gerekçeyle iptal edilir
 * (K-237). Her geçiş silinmeyen bir geçmiş satırı bırakır. Maliyeti yalnız yönetici görür, öğretmen
 * yalnız kendi bildirimlerini görür (K-238). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü)
 * ile gelir.
 */

/** Bildiren ve okuyan roller: öğretmen yalnız kendi bildirimlerini görür (K-238). */
export const MAINTENANCE_REPORT_ROLES = ['yonetici', 'onburo', 'ogretmen'] as const
/** Atama, başlatma, çözüm ve kapatma yalnız yöneticidedir (K-237). */
export const MAINTENANCE_MANAGE_ROLES = ['yonetici'] as const

export const MAINTENANCE_PRIORITIES = ['low', 'normal', 'urgent'] as const
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number]
export const MAINTENANCE_PRIORITY_LABELS = {
  low: 'Düşük',
  normal: 'Normal',
  urgent: 'Acil',
} as const satisfies Record<MaintenancePriority, string>

export const MAINTENANCE_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
] as const
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]
export const MAINTENANCE_STATUS_LABELS = {
  open: 'Açık',
  assigned: 'Atandı',
  in_progress: 'Çalışılıyor',
  resolved: 'Çözüldü',
  closed: 'Kapatıldı',
  cancelled: 'İptal edildi',
} as const satisfies Record<MaintenanceStatus, string>
/** Arızası sürüyor: demirbaş listesinde "açık arıza" işareti bu durumları sayar (K-239). */
export const MAINTENANCE_UNRESOLVED_STATUSES = ['open', 'assigned', 'in_progress'] as const
/** Liste süzgeci: `active` kapatılmamış ve iptal edilmemiş, `done` kapatılmış ya da iptal edilmiş. */
export const MAINTENANCE_STATES = ['active', 'done'] as const
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number]
export const MAINTENANCE_DONE_STATUSES = ['closed', 'cancelled'] as const

export const MAINTENANCE_ASSIGNEE_TYPES = ['staff', 'supplier'] as const
export type MaintenanceAssigneeType = (typeof MAINTENANCE_ASSIGNEE_TYPES)[number]
export const MAINTENANCE_ASSIGNEE_TYPE_LABELS = {
  staff: 'Personel',
  supplier: 'Tedarikçi (dış servis)',
} as const satisfies Record<MaintenanceAssigneeType, string>

export const MAINTENANCE_EVENTS = [
  'reported',
  'assigned',
  'started',
  'resolved',
  'closed',
  'cancelled',
] as const
export type MaintenanceEvent = (typeof MAINTENANCE_EVENTS)[number]
export const MAINTENANCE_EVENT_LABELS = {
  reported: 'Bildirildi',
  assigned: 'Atandı',
  started: 'İşe başlandı',
  resolved: 'Çözüldü',
  closed: 'Kapatıldı',
  cancelled: 'İptal edildi',
} as const satisfies Record<MaintenanceEvent, string>

export const MAINTENANCE_TITLE_MIN = 3
export const MAINTENANCE_TITLE_MAX = 120
export const MAINTENANCE_DESCRIPTION_MIN = 5
export const MAINTENANCE_DESCRIPTION_MAX = 2000
export const MAINTENANCE_NOTE_MAX = 500
export const MAINTENANCE_REASON_MIN = 5
export const MAINTENANCE_RESOLUTION_MIN = 5
export const MAINTENANCE_RESOLUTION_MAX = 1000
/** Tek iş emrinin maliyet üst sınırı: 10 milyon TL (kuruş). */
export const MAINTENANCE_COST_MAX_CENTS = 1_000_000_000

/** Talep numarası kurumda sıra numarasından türetilir (`AT-0007`); saklanan yalnız sıradır. */
export function maintenanceRequestNumber(sequence: number): string {
  return `AT-${String(sequence).padStart(4, '0')}`
}

// --- Şemalar -------------------------------------------------------------------------------------

const maxMessage = (max: number) => `En fazla ${String(max)} karakter girebilirsiniz.`
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, maxMessage(max))
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)
const noteSchema = optionalText(MAINTENANCE_NOTE_MAX).describe(
  'İsteğe bağlı not, en çok 500 karakter',
)

const tagSchema = z
  .string('Etiket numarasını yazın.')
  .transform(normalizeFixedAssetTag)
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .max(FIXED_ASSET_TAG_MAX, maxMessage(FIXED_ASSET_TAG_MAX))
      .regex(FIXED_ASSET_TAG_PATTERN, 'Etiket numarası geçersiz (ör. DB-2026-0001).')
      .nullable(),
  )

/** Arıza bildirimi (DOM-FIN-089, K-236). Demirbaş etiketle bağlanır (etiketin üzerindeki numara). */
export const maintenanceRequestSchema = z.strictObject({
  title: z
    .string('Arızayı kısaca adlandırın.')
    .trim()
    .min(MAINTENANCE_TITLE_MIN, 'Başlığı en az 3 karakterle yazın (ör. Projektör açılmıyor).')
    .max(MAINTENANCE_TITLE_MAX, maxMessage(MAINTENANCE_TITLE_MAX)),
  description: z
    .string('Arızayı açıklayın.')
    .trim()
    .min(MAINTENANCE_DESCRIPTION_MIN, 'Arızayı en az 5 karakterle açıklayın.')
    .max(MAINTENANCE_DESCRIPTION_MAX, maxMessage(MAINTENANCE_DESCRIPTION_MAX)),
  campusId: z
    .string()
    .trim()
    .min(1, 'Kampüs seçin.')
    .max(100)
    .nullable()
    .default(null)
    .describe('Kampüs (branches kaydı); tek kampüslü kurumda boş'),
  location: z
    .string('Arızanın yerini yazın.')
    .trim()
    .min(2, 'Yeri en az 2 karakterle yazın (ör. 2. kat 5-A sınıfı).')
    .max(FIXED_ASSET_LOCATION_MAX, maxMessage(FIXED_ASSET_LOCATION_MAX))
    .describe('Oda ya da yer, serbest metin'),
  assetTagNumber: tagSchema
    .nullable()
    .default(null)
    .describe('İsteğe bağlı demirbaş etiketi; kurumun hurdaya ayrılmamış demirbaşı olmalıdır'),
  priority: z
    .enum(MAINTENANCE_PRIORITIES, 'Önceliği seçin.')
    .default('normal')
    .describe('`low` düşük, `normal`, `urgent` acil'),
})
export type MaintenanceRequestInput = z.input<typeof maintenanceRequestSchema>
export type MaintenanceRequestFields = z.output<typeof maintenanceRequestSchema>

const staffAssigneeSchema = z.strictObject({
  assigneeType: z.literal('staff'),
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Sorumlu personelin kurum üyeliği'),
  note: noteSchema,
})
const supplierAssigneeSchema = z.strictObject({
  assigneeType: z.literal('supplier'),
  supplierId: z.uuid('Tedarikçi seçin.').describe('İşi yapacak dış tedarikçi (DOM-FIN-070)'),
  note: noteSchema,
})
/** Atama (K-237): kurum personeli ya da dış tedarikçi; yeniden atama geçmişe yeni satır yazar. */
export const maintenanceAssignSchema = z.discriminatedUnion(
  'assigneeType',
  [staffAssigneeSchema, supplierAssigneeSchema],
  'Sorumlunun personel mi tedarikçi mi olduğunu seçin.',
)
export type MaintenanceAssignInput = z.input<typeof maintenanceAssignSchema>
export type MaintenanceAssignFields = z.output<typeof maintenanceAssignSchema>

/** Başlatma ve kapatma: yalnız isteğe bağlı not. */
export const maintenanceNoteSchema = z.strictObject({ note: noteSchema })
export type MaintenanceNoteInput = z.input<typeof maintenanceNoteSchema>

/** Çözüm (K-237): gün, çözüm notu, isteğe bağlı maliyet (kuruş) ve tedarikçi. */
export const maintenanceResolveSchema = z.strictObject({
  resolvedDate: daySchema.describe('Çözüm günü; bildirim gününden önce, bugünden sonra olamaz'),
  resolution: z
    .string('Yapılan işi yazın.')
    .trim()
    .min(MAINTENANCE_RESOLUTION_MIN, 'Yapılan işi en az 5 karakterle yazın.')
    .max(MAINTENANCE_RESOLUTION_MAX, maxMessage(MAINTENANCE_RESOLUTION_MAX)),
  costCents: z
    .number('Maliyeti girin.')
    .int('Maliyet kuruş cinsinden tam sayı olmalıdır.')
    .min(1, 'Maliyet sıfırdan büyük olmalıdır.')
    .max(MAINTENANCE_COST_MAX_CENTS, 'Maliyet çok büyük.')
    .nullable()
    .default(null)
    .describe('İsteğe bağlı onarım maliyeti, KDV dahil, kuruş; yalnız yönetici görür'),
  supplierId: z
    .uuid('Tedarikçi geçersiz.')
    .nullable()
    .default(null)
    .describe('İşi yapan tedarikçi (pasif tedarikçi dahil)'),
})
export type MaintenanceResolveInput = z.input<typeof maintenanceResolveSchema>
export type MaintenanceResolveFields = z.output<typeof maintenanceResolveSchema>

/** İptal (K-237): gerekçe zorunlu. */
export const maintenanceCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(MAINTENANCE_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(MAINTENANCE_NOTE_MAX, maxMessage(MAINTENANCE_NOTE_MAX)),
})
export type MaintenanceCancelInput = z.input<typeof maintenanceCancelSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })

export type MaintenanceAction = 'assign' | 'start' | 'resolve' | 'close' | 'cancel'

/** Geçiş tablosu: her işlemin izinli başlangıç durumları (K-237). */
const ALLOWED_FROM = {
  assign: ['open', 'assigned', 'in_progress'],
  start: ['assigned'],
  resolve: ['assigned', 'in_progress'],
  close: ['resolved'],
  cancel: ['open', 'assigned', 'in_progress'],
} as const satisfies Record<MaintenanceAction, readonly MaintenanceStatus[]>

const NOT_ALLOWED = {
  assign: 'Kapatılmış, çözülmüş ya da iptal edilmiş talep atanamaz.',
  start: 'Yalnız atanmış talepte işe başlanır.',
  resolve: 'Yalnız atanmış ya da üzerinde çalışılan talep çözülür.',
  close: 'Yalnız çözülmüş talep kapatılır.',
  cancel: 'Çözülmüş, kapatılmış ya da iptal edilmiş talep iptal edilemez.',
} as const satisfies Record<MaintenanceAction, string>

/** İşlemin talebin şimdiki durumunda yapılıp yapılamayacağı. */
export function canTransition(status: MaintenanceStatus, action: MaintenanceAction): boolean {
  return (ALLOWED_FROM[action] as readonly MaintenanceStatus[]).includes(status)
}

/**
 * Geçişin varacağı durum (K-237). Atama açık talebi `assigned` yapar; atanmış ya da üzerinde
 * çalışılan talepte yalnız sorumlu değişir. Geçersiz geçiş 422 `maintenance_status_invalid`.
 */
export function maintenanceTransition(
  status: MaintenanceStatus,
  action: MaintenanceAction,
): MaintenanceStatus {
  if (!canTransition(status, action))
    throw ruleError('maintenance_status_invalid', NOT_ALLOWED[action])
  switch (action) {
    case 'assign':
      return status === 'open' ? 'assigned' : status
    case 'start':
      return 'in_progress'
    case 'resolve':
      return 'resolved'
    case 'close':
      return 'closed'
    case 'cancel':
      return 'cancelled'
    default:
      return action satisfies never
  }
}

/** Bildirimin denetim girdileri (servis kurum kilidi altında yükler). */
export interface MaintenanceRequestChecks {
  /** Etiketle bulunan demirbaş; etiket verilmediyse `undefined`, kurumda yoksa `null`. */
  asset?: { status: FixedAssetStatus } | null
  /** Seçilen kampüs kurumda etkin mi (kampüs boşsa denetlenmez). */
  campusFound?: boolean
}

/**
 * Bildirim kuralları (DOM-FIN-089, K-236). Etiket kurumun demirbaşı değilse (başka kurumun etiketi
 * dahil, ayrım yapılmaz) 422 `maintenance_asset_not_found`; hurdaya ayrılmış demirbaşa arıza
 * bildirilmez (422 `maintenance_asset_scrapped`). Kampüs kurumun etkin kampüsü olmalıdır.
 */
export function planMaintenanceRequest(
  input: MaintenanceRequestFields,
  checks: MaintenanceRequestChecks,
): MaintenanceRequestFields {
  if (input.assetTagNumber !== null) {
    if (checks.asset === undefined || checks.asset === null)
      throw ruleError(
        'maintenance_asset_not_found',
        'Bu etiketle bir demirbaş bulunamadı.',
        'assetTagNumber',
      )
    if (checks.asset.status === 'scrapped')
      throw ruleError(
        'maintenance_asset_scrapped',
        'Hurdaya ayrılmış demirbaşa arıza bildirilemez.',
        'assetTagNumber',
      )
  }
  if (input.campusId !== null && checks.campusFound === false)
    throw ruleError('maintenance_campus_not_found', 'Kampüs bulunamadı.', 'campusId')
  return input
}

/** Talebin şimdiki sorumlusu (yeniden atamada aynı sorumlu reddedilir). */
export interface MaintenanceAssignee {
  assigneeType: MaintenanceAssigneeType
  membershipId: string | null
  supplierId: string | null
}

export interface MaintenanceAssignChecks {
  current: MaintenanceAssignee | null
  /** Personel atamasında üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  staff?: { role: string; active: boolean } | null
  /** Tedarikçi atamasında tedarikçi: kurumda yoksa `null`. */
  supplier?: { isActive: boolean } | null
}

export interface MaintenanceAssignPlan extends MaintenanceAssignee {
  status: MaintenanceStatus
  note: string | null
}

/**
 * Atama (K-237): personel kurumun etkin yönetici, öğretmen ya da ön büro üyeliğidir; tedarikçi
 * kurumun etkin tedarikçisidir. Aynı sorumluya yeniden atama 422 `maintenance_same_assignee`.
 */
export function planMaintenanceAssign(
  status: MaintenanceStatus,
  input: MaintenanceAssignFields,
  checks: MaintenanceAssignChecks,
): MaintenanceAssignPlan {
  const next = maintenanceTransition(status, 'assign')
  const assignee: MaintenanceAssignee =
    input.assigneeType === 'staff'
      ? { assigneeType: 'staff', membershipId: input.membershipId, supplierId: null }
      : { assigneeType: 'supplier', membershipId: null, supplierId: input.supplierId }
  const field = input.assigneeType === 'staff' ? 'membershipId' : 'supplierId'
  if (input.assigneeType === 'staff') {
    if (checks.staff === undefined || checks.staff === null)
      throw ruleError('maintenance_assignee_not_found', 'Personel bulunamadı.', field)
    if (!isStaffRole(checks.staff.role))
      throw ruleError(
        'maintenance_assignee_not_staff',
        'İş emri yalnız personele (yönetici, öğretmen, ön büro) atanır.',
        field,
      )
    if (!checks.staff.active)
      throw ruleError('maintenance_assignee_inactive', 'Pasif personele iş atanamaz.', field)
  } else {
    if (checks.supplier === undefined || checks.supplier === null)
      throw ruleError('maintenance_supplier_not_found', 'Tedarikçi bulunamadı.', field)
    if (!checks.supplier.isActive)
      throw ruleError('maintenance_supplier_inactive', 'Pasif tedarikçiye iş atanamaz.', field)
  }
  const current = checks.current
  if (
    current !== null &&
    current.assigneeType === assignee.assigneeType &&
    current.membershipId === assignee.membershipId &&
    current.supplierId === assignee.supplierId
  )
    throw ruleError('maintenance_same_assignee', 'Talep zaten bu sorumluya atanmış.', field)
  return { ...assignee, status: next, note: input.note }
}

export interface MaintenanceResolveChecks {
  today: string
  /** Bildirim günü (Europe/Istanbul); çözüm bundan önceye yazılmaz. */
  reportedDate: string
  /** Çözümdeki tedarikçi: verilmediyse `undefined`, kurumda yoksa `null`. */
  supplier?: { isActive: boolean } | null
}

/**
 * Çözüm (K-237): gün bildirim gününden önce ve bugünden sonra olamaz; maliyet ve tedarikçi isteğe
 * bağlıdır, tedarikçi pasif olabilir (iş pasifleştirmeden önce yapılmış olabilir).
 */
export function planMaintenanceResolve(
  status: MaintenanceStatus,
  input: MaintenanceResolveFields,
  checks: MaintenanceResolveChecks,
): MaintenanceStatus {
  const next = maintenanceTransition(status, 'resolve')
  if (input.resolvedDate > checks.today)
    throw ruleError(
      'maintenance_date_in_future',
      'Çözüm günü bugünden sonra olamaz.',
      'resolvedDate',
    )
  if (input.resolvedDate < checks.reportedDate)
    throw ruleError(
      'maintenance_resolved_before_report',
      'Çözüm günü bildirim gününden önce olamaz.',
      'resolvedDate',
    )
  if (input.supplierId !== null && (checks.supplier === undefined || checks.supplier === null))
    throw ruleError('maintenance_supplier_not_found', 'Tedarikçi bulunamadı.', 'supplierId')
  return next
}

export interface MaintenanceActor {
  userId: string
  role: string
}

/**
 * İptal (K-237): yönetici açık, atanmış ya da üzerinde çalışılan talebi iptal eder; bildiren
 * (ön büro, öğretmen) yalnız kendi bildirimini ve henüz atanmamışken iptal eder.
 */
export function planMaintenanceCancel(
  request: { status: MaintenanceStatus; reportedByUserId: string },
  actor: MaintenanceActor,
): MaintenanceStatus {
  const next = maintenanceTransition(request.status, 'cancel')
  if (actor.role === 'yonetici') return next
  if (request.reportedByUserId !== actor.userId)
    throw new DomainError(
      'maintenance_not_owner',
      'Yalnız kendi bildiriminizi iptal edebilirsiniz.',
      { kind: 'forbidden' },
    )
  if (request.status !== 'open')
    throw ruleError('maintenance_not_cancellable', 'Atanmış talebi yalnız yönetici iptal edebilir.')
  return next
}

/** Rolün talebi görme kapsamı: öğretmen yalnız kendi bildirimini görür (K-238). */
export function maintenanceVisibility(role: string): 'all' | 'own' {
  return role === 'yonetici' || role === 'onburo' ? 'all' : 'own'
}

/** Maliyet ve tutar bilgisi yalnız yöneticiye döner (K-238). */
export const canSeeMaintenanceCost = (role: string) => role === 'yonetici'

/** Rolün talepte yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function maintenanceRequestActions(
  request: { status: MaintenanceStatus; reportedByUserId: string },
  actor: MaintenanceActor,
): Record<MaintenanceAction, boolean> {
  const manager = actor.role === 'yonetici'
  const ownOpen = request.reportedByUserId === actor.userId && request.status === 'open'
  return {
    assign: manager && canTransition(request.status, 'assign'),
    start: manager && canTransition(request.status, 'start'),
    resolve: manager && canTransition(request.status, 'resolve'),
    close: manager && canTransition(request.status, 'close'),
    cancel: canTransition(request.status, 'cancel') && (manager || ownOpen),
  }
}

/** Sorumluyu tek satırda yazar: personel adı ya da tedarikçi unvanı. */
export function maintenanceAssigneeLabel(assignee: {
  assigneeType: MaintenanceAssigneeType
  name: string | null
}): string {
  if (assignee.assigneeType === 'staff') return assignee.name ?? 'Personel'
  return assignee.name ? `${assignee.name} (tedarikçi)` : 'Tedarikçi'
}
