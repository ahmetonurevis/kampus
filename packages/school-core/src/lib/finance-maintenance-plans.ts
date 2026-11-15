import { z } from 'zod'

import { CSV_SEPARATOR, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { daysBetween } from './finance-opening-watch.ts'
import {
  FIXED_ASSET_LOCATION_MAX,
  FIXED_ASSET_TAG_MAX,
  FIXED_ASSET_TAG_PATTERN,
  normalizeFixedAssetTag,
  type FixedAssetStatus,
} from './finance-fixed-assets.ts'
import {
  MAINTENANCE_DESCRIPTION_MAX,
  MAINTENANCE_TITLE_MAX,
  type MaintenancePriority,
} from './finance-maintenance-requests.ts'
import { dayKey } from './format.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Periyodik bakım planı ve denetim kaydı (docs/domain/finans.md DOM-FIN-092; ON-240). Yönetici
 * asansör, yangın söndürücü, jeneratör, oyun alanı, kazan, elektrik tesisatı gibi düzenli
 * denetlenmesi gereken donanım için plan açar: ad, tür, yer, isteğe bağlı kampüs ve demirbaş,
 * periyot (ay), sistemden önceki son denetim günü, sorumlu (personel ya da tedarikçi) ve yasal
 * zorunluluk (K-252). Sonraki denetim günü saklanmaz; son denetimden periyotla hesaplanır, 30 gün
 * kala "yaklaşıyor", günü geçince "gecikti" olur (K-253). Denetim kaydı gün, yapan, sonuç, belge no
 * ve not taşır; uygunsuz ya da kısmen uygun sonuç tek adımda arıza talebi (DOM-FIN-089) açar
 * (K-254). Fonksiyonlar saftır; zaman `now` ya da `today` (Europe/Istanbul günü) ile gelir.
 */

/** Planları ve denetimleri okuyan roller (K-255). */
export const MAINTENANCE_PLAN_READ_ROLES = ['yonetici', 'onburo'] as const
/** Plan, denetim kaydı ve denetimden arıza talebi yalnız yöneticidedir (K-255). */
export const MAINTENANCE_PLAN_MANAGE_ROLES = ['yonetici'] as const
export const canManageMaintenancePlans = (role: string) => role === 'yonetici'

export const MAINTENANCE_PLAN_TYPES = [
  'elevator',
  'fire_extinguisher',
  'generator',
  'playground',
  'boiler',
  'electrical',
  'other',
] as const
export type MaintenancePlanType = (typeof MAINTENANCE_PLAN_TYPES)[number]
export const MAINTENANCE_PLAN_TYPE_LABELS = {
  elevator: 'Asansör',
  fire_extinguisher: 'Yangın söndürücü',
  generator: 'Jeneratör',
  playground: 'Oyun alanı',
  boiler: 'Kazan ve kalorifer',
  electrical: 'Elektrik tesisatı',
  other: 'Diğer',
} as const satisfies Record<MaintenancePlanType, string>

export interface MaintenancePlanTypeDefault {
  /** Önerilen periyot (ay). */
  periodMonths: number
  /** Önerilen yasal zorunluluk işareti. */
  isLegal: boolean
  /** Formda gösterilen kısa açıklama; mevzuat varsayımı **doğrulanmalı** (H-31). */
  hint: string
}

/**
 * Türe göre önerilen periyot ve yasal işaret (K-252). Değerler mevzuat varsayımıdır ve
 * **doğrulanmalı** (docs/domain/finance-dogrulanacak-sorular.md H-31); kullanıcı her planda değiştirir.
 */
export const MAINTENANCE_PLAN_TYPE_DEFAULTS = {
  elevator: {
    periodMonths: 12,
    isLegal: true,
    hint: 'Yılda bir yetkili muayene kuruluşunca periyodik kontrol; aylık servis bakımı ayrı plan olarak açılabilir.',
  },
  fire_extinguisher: {
    periodMonths: 6,
    isLegal: true,
    hint: 'Altı ayda bir iç kontrol; yılda bir yetkili servis bakımı ayrı plan olarak (12 ay) açılabilir.',
  },
  generator: {
    periodMonths: 12,
    isLegal: true,
    hint: 'Yılda bir yetkili kişi ya da kuruluşça periyodik kontrol.',
  },
  playground: {
    periodMonths: 12,
    isLegal: true,
    hint: 'Yılda bir ana denetim; sık görsel kontroller ayrı plan olarak açılabilir.',
  },
  boiler: {
    periodMonths: 12,
    isLegal: true,
    hint: 'Isıtma döneminden önce yılda bir bakım ve basınçlı kap periyodik kontrolü.',
  },
  electrical: {
    periodMonths: 12,
    isLegal: true,
    hint: 'Yılda bir iç tesisat, topraklama ve kaçak akım ölçümü.',
  },
  other: {
    periodMonths: 12,
    isLegal: false,
    hint: 'Periyodu donanımın bakım talimatına göre girin.',
  },
} as const satisfies Record<MaintenancePlanType, MaintenancePlanTypeDefault>

export const MAINTENANCE_PLAN_NAME_MIN = 3
export const MAINTENANCE_PLAN_NAME_MAX = 120
export const MAINTENANCE_PLAN_LOCATION_MIN = 2
export const MAINTENANCE_PLAN_PERIOD_MIN = 1
export const MAINTENANCE_PLAN_PERIOD_MAX = 60
/** Yaklaşan denetim uyarısı: sonraki gün bugün dahil 30 gün içindeyse (K-253). */
export const MAINTENANCE_PLAN_WARNING_DAYS = 30

export const MAINTENANCE_PLAN_RESPONSIBLE_TYPES = ['staff', 'supplier'] as const
export type MaintenancePlanResponsibleType = (typeof MAINTENANCE_PLAN_RESPONSIBLE_TYPES)[number]
export const MAINTENANCE_PLAN_RESPONSIBLE_TYPE_LABELS = {
  staff: 'Personel',
  supplier: 'Tedarikçi (dış servis)',
} as const satisfies Record<MaintenancePlanResponsibleType, string>

export const MAINTENANCE_PLAN_DUE_STATUSES = ['overdue', 'due_soon', 'ok', 'never'] as const
export type MaintenancePlanDueStatus = (typeof MAINTENANCE_PLAN_DUE_STATUSES)[number]
export const MAINTENANCE_PLAN_DUE_STATUS_LABELS = {
  overdue: 'Gecikti',
  due_soon: 'Yaklaşıyor',
  ok: 'Zamanında',
  never: 'Denetim kaydı yok',
} as const satisfies Record<MaintenancePlanDueStatus, string>
/** Liste süzgeci: `attention` gecikmiş, yaklaşan ve hiç denetlenmemiş planlardır (rozet sayısı). */
export const MAINTENANCE_PLAN_DUE_FILTERS = ['attention', ...MAINTENANCE_PLAN_DUE_STATUSES] as const
export type MaintenancePlanDueFilter = (typeof MAINTENANCE_PLAN_DUE_FILTERS)[number]
export const isMaintenancePlanAttention = (status: MaintenancePlanDueStatus) => status !== 'ok'

export const MAINTENANCE_INSPECTION_RESULTS = ['pass', 'fail', 'partial'] as const
export type MaintenanceInspectionResult = (typeof MAINTENANCE_INSPECTION_RESULTS)[number]
export const MAINTENANCE_INSPECTION_RESULT_LABELS = {
  pass: 'Uygun',
  fail: 'Uygunsuz',
  partial: 'Kısmen uygun',
} as const satisfies Record<MaintenanceInspectionResult, string>

export const MAINTENANCE_INSPECTOR_MIN = 2
export const MAINTENANCE_INSPECTOR_MAX = 120
export const MAINTENANCE_DOCUMENT_NUMBER_MAX = 60
export const MAINTENANCE_INSPECTION_NOTE_MIN = 5
export const MAINTENANCE_INSPECTION_NOTE_MAX = 1000
export const MAINTENANCE_INSPECTION_REASON_MIN = 5
export const MAINTENANCE_INSPECTION_REASON_MAX = 500

// --- Tarih ---------------------------------------------------------------------------------------

/**
 * Güne ay ekler; ayın son gününü aşan gün ayın son gününe çekilir (31 Ocak + 1 ay = 28/29 Şubat).
 * PostgreSQL `date + make_interval(months => n)` ile aynı sonucu verir; liste süzgeci SQL'de
 * hesaplar.
 */
export function addMonthsToDay(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = index - nextYear * 12 + 1
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(nextYear).padStart(4, '0')}-${pad(nextMonth)}-${pad(Math.min(date, lastDay))}`
}

export interface MaintenancePlanSchedule {
  /** Etkin son denetim: sistemden önceki gün ile iptal edilmemiş denetimlerin en geç günü. */
  lastDoneDate: string | null
  /** Sonraki denetim günü; hiç denetim yoksa boş. */
  nextDueDate: string | null
  status: MaintenancePlanDueStatus
  /** Sonraki güne kalan gün (geçtiyse eksi); hiç denetim yoksa boş. */
  daysLeft: number | null
}

/**
 * Planın takvimi (K-253): son denetim günü sistemden önceki son gün ile iptal edilmemiş denetim
 * kayıtlarının en geç günüdür (sonucu ne olursa olsun denetim yapılmıştır); sonraki gün son
 * denetim + periyottur. Sonraki gün bugünden önceyse "gecikti", bugün dahil 30 gün içindeyse
 * "yaklaşıyor"; hiç denetim yoksa "denetim kaydı yok" (uyarıda sayılır).
 */
export function maintenancePlanSchedule(
  plan: {
    periodMonths: number
    previousDoneDate: string | null
    inspectionDates?: readonly string[]
  },
  now: Date,
): MaintenancePlanSchedule {
  const today = dayKey(now)
  const lastDoneDate = [plan.previousDoneDate, ...(plan.inspectionDates ?? [])].reduce<
    string | null
  >((latest, day) => (day !== null && (latest === null || day > latest) ? day : latest), null)
  if (lastDoneDate === null)
    return { lastDoneDate: null, nextDueDate: null, status: 'never', daysLeft: null }
  const nextDueDate = addMonthsToDay(lastDoneDate, plan.periodMonths)
  const daysLeft = daysBetween(today, nextDueDate)
  return {
    lastDoneDate,
    nextDueDate,
    status:
      daysLeft < 0 ? 'overdue' : daysLeft <= MAINTENANCE_PLAN_WARNING_DAYS ? 'due_soon' : 'ok',
    daysLeft,
  }
}

// --- Şemalar -------------------------------------------------------------------------------------

const maxMessage = (max: number) => `En fazla ${String(max)} karakter girebilirsiniz.`

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

const nameSchema = z
  .string('Planı adlandırın.')
  .trim()
  .min(MAINTENANCE_PLAN_NAME_MIN, 'Adı en az 3 karakterle yazın (ör. A blok asansörü).')
  .max(MAINTENANCE_PLAN_NAME_MAX, maxMessage(MAINTENANCE_PLAN_NAME_MAX))
const typeSchema = z
  .enum(MAINTENANCE_PLAN_TYPES, 'Türü seçin.')
  .describe(
    '`elevator` asansör, `fire_extinguisher` yangın söndürücü, `generator` jeneratör, `playground` oyun alanı, `boiler` kazan ve kalorifer, `electrical` elektrik tesisatı, `other` diğer',
  )
const campusSchema = z
  .string()
  .trim()
  .min(1, 'Kampüs seçin.')
  .max(100)
  .nullable()
  .describe('Kampüs (branches kaydı); tek kampüslü kurumda boş')
const locationSchema = z
  .string('Yeri yazın.')
  .trim()
  .min(
    MAINTENANCE_PLAN_LOCATION_MIN,
    'Yeri en az 2 karakterle yazın (ör. Bodrum kat kazan dairesi).',
  )
  .max(FIXED_ASSET_LOCATION_MAX, maxMessage(FIXED_ASSET_LOCATION_MAX))
  .describe('Donanımın yeri, serbest metin')
const periodSchema = z
  .number('Periyodu ay olarak girin.')
  .int('Periyot tam ay olmalıdır.')
  .min(MAINTENANCE_PLAN_PERIOD_MIN, 'Periyot en az 1 ay olmalıdır.')
  .max(MAINTENANCE_PLAN_PERIOD_MAX, 'Periyot en çok 60 ay olabilir.')
const lastDoneSchema = daySchema
  .nullable()
  .describe('Sistemden önceki son denetim günü; bugünden sonra olamaz, bilinmiyorsa boş')

const staffResponsibleSchema = z.strictObject({
  type: z.literal('staff'),
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Sorumlu personelin kurum üyeliği'),
})
const supplierResponsibleSchema = z.strictObject({
  type: z.literal('supplier'),
  supplierId: z.uuid('Tedarikçi seçin.').describe('Denetimi yapan dış tedarikçi (DOM-FIN-070)'),
})
const responsibleSchema = z
  .discriminatedUnion(
    'type',
    [staffResponsibleSchema, supplierResponsibleSchema],
    'Sorumlunun personel mi tedarikçi mi olduğunu seçin.',
  )
  .nullable()
  .describe('Sorumlu: kurum personeli ya da tedarikçi; boş olabilir')
export type MaintenancePlanResponsibleInput = z.output<typeof responsibleSchema>

/** Plan (DOM-FIN-092, K-252). Periyot ve yasal işaret boşsa türün önerisi yazılır. */
export const maintenancePlanSchema = z.strictObject({
  name: nameSchema,
  type: typeSchema,
  campusId: campusSchema.default(null),
  location: locationSchema,
  assetTagNumber: tagSchema
    .nullable()
    .default(null)
    .describe('İsteğe bağlı demirbaş etiketi; kurumun hurdaya ayrılmamış demirbaşı olmalıdır'),
  periodMonths: periodSchema
    .nullable()
    .default(null)
    .describe('Periyot (ay, 1–60); boşsa türün önerisi'),
  isLegal: z
    .boolean('Yasal zorunluluğu seçin.')
    .nullable()
    .default(null)
    .describe('Yasal zorunlu denetim mi; boşsa türün önerisi'),
  lastDoneDate: lastDoneSchema.default(null),
  responsible: responsibleSchema.default(null),
})
export type MaintenancePlanInput = z.input<typeof maintenancePlanSchema>
export type MaintenancePlanFields = z.output<typeof maintenancePlanSchema>

/** Düzeltme (K-252): verilen alan değişir; en az bir alan. Periyot ve yasal işaret açık değerdir. */
export const updateMaintenancePlanSchema = z
  .strictObject({
    name: nameSchema.optional(),
    type: typeSchema.optional(),
    campusId: campusSchema.optional(),
    location: locationSchema.optional(),
    assetTagNumber: tagSchema.nullable().optional().describe('Demirbaş etiketi; boş bağı kaldırır'),
    periodMonths: periodSchema.optional().describe('Periyot (ay, 1–60)'),
    isLegal: z.boolean('Yasal zorunluluğu seçin.').optional(),
    lastDoneDate: lastDoneSchema.optional(),
    responsible: responsibleSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type UpdateMaintenancePlanInput = z.input<typeof updateMaintenancePlanSchema>
export type UpdateMaintenancePlanFields = z.output<typeof updateMaintenancePlanSchema>

/** Denetim kaydı (K-254): uygunsuz ve kısmen uygun sonuçta not zorunludur. */
export const maintenanceInspectionSchema = z
  .strictObject({
    doneDate: daySchema.describe('Denetim günü; bugünden sonra olamaz'),
    performedBy: z
      .string('Denetimi yapanı yazın.')
      .trim()
      .min(MAINTENANCE_INSPECTOR_MIN, 'Denetimi yapanı en az 2 karakterle yazın.')
      .max(MAINTENANCE_INSPECTOR_MAX, maxMessage(MAINTENANCE_INSPECTOR_MAX))
      .describe('Denetimi yapan kişi ya da kuruluş, serbest metin'),
    result: z
      .enum(MAINTENANCE_INSPECTION_RESULTS, 'Sonucu seçin.')
      .describe('`pass` uygun, `fail` uygunsuz, `partial` kısmen uygun'),
    documentNumber: z
      .string()
      .trim()
      .max(MAINTENANCE_DOCUMENT_NUMBER_MAX, maxMessage(MAINTENANCE_DOCUMENT_NUMBER_MAX))
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .default(null)
      .describe('Muayene raporu ya da belge numarası'),
    note: z
      .string()
      .trim()
      .max(MAINTENANCE_INSPECTION_NOTE_MAX, maxMessage(MAINTENANCE_INSPECTION_NOTE_MAX))
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .default(null)
      .describe('Not; uygunsuz ve kısmen uygun sonuçta en az 5 karakter zorunlu'),
  })
  .superRefine((value, context) => {
    if (
      value.result !== 'pass' &&
      (value.note === null || value.note.length < MAINTENANCE_INSPECTION_NOTE_MIN)
    )
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Uygunsuzluğu en az 5 karakterle açıklayın.',
      })
  })
export type MaintenanceInspectionInput = z.input<typeof maintenanceInspectionSchema>
export type MaintenanceInspectionFields = z.output<typeof maintenanceInspectionSchema>

/** Denetim kaydının iptali (yanlış giriş): gerekçe zorunlu. */
export const maintenanceInspectionCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(MAINTENANCE_INSPECTION_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(MAINTENANCE_INSPECTION_REASON_MAX, maxMessage(MAINTENANCE_INSPECTION_REASON_MAX)),
})
export type MaintenanceInspectionCancelInput = z.input<typeof maintenanceInspectionCancelSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })

/** Planın bağlantı denetimleri; verilmeyen alan denetlenmez (servis kurum kilidi altında yükler). */
export interface MaintenancePlanChecks {
  today: string
  /** Etiketle bulunan demirbaş; etiket verilmediyse `undefined`, kurumda yoksa `null`. */
  asset?: { status: FixedAssetStatus } | null
  /** Seçilen kampüs kurumda etkin mi. */
  campusFound?: boolean
  /** Personel sorumlunun üyeliği: kurumda yoksa `null`. */
  staff?: { role: string; active: boolean } | null
  /** Tedarikçi sorumlu: kurumda yoksa `null`. */
  supplier?: { isActive: boolean } | null
}

type PlanRefs = Partial<
  Pick<MaintenancePlanFields, 'assetTagNumber' | 'campusId' | 'lastDoneDate' | 'responsible'>
>

function checkPlanRefs(input: PlanRefs, checks: MaintenancePlanChecks) {
  if (input.assetTagNumber !== undefined && input.assetTagNumber !== null) {
    if (checks.asset === undefined || checks.asset === null)
      throw ruleError(
        'maintenance_plan_asset_not_found',
        'Bu etiketle bir demirbaş bulunamadı.',
        'assetTagNumber',
      )
    if (checks.asset.status === 'scrapped')
      throw ruleError(
        'maintenance_plan_asset_scrapped',
        'Hurdaya ayrılmış demirbaşa bakım planı bağlanamaz.',
        'assetTagNumber',
      )
  }
  if (input.campusId !== undefined && input.campusId !== null && checks.campusFound !== true)
    throw ruleError('maintenance_plan_campus_not_found', 'Kampüs bulunamadı.', 'campusId')
  if (
    input.lastDoneDate !== undefined &&
    input.lastDoneDate !== null &&
    input.lastDoneDate > checks.today
  )
    throw ruleError(
      'maintenance_plan_date_in_future',
      'Son denetim günü bugünden sonra olamaz.',
      'lastDoneDate',
    )
  const responsible = input.responsible
  if (responsible === undefined || responsible === null) return
  if (responsible.type === 'staff') {
    if (checks.staff === undefined || checks.staff === null)
      throw ruleError(
        'maintenance_plan_responsible_not_found',
        'Personel bulunamadı.',
        'membershipId',
      )
    if (!isStaffRole(checks.staff.role))
      throw ruleError(
        'maintenance_plan_responsible_not_staff',
        'Sorumlu yalnız personel (yönetici, öğretmen, ön büro) olabilir.',
        'membershipId',
      )
    if (!checks.staff.active)
      throw ruleError(
        'maintenance_plan_responsible_inactive',
        'Pasif personel sorumlu yapılamaz.',
        'membershipId',
      )
    return
  }
  if (checks.supplier === undefined || checks.supplier === null)
    throw ruleError('maintenance_plan_supplier_not_found', 'Tedarikçi bulunamadı.', 'supplierId')
  if (!checks.supplier.isActive)
    throw ruleError(
      'maintenance_plan_supplier_inactive',
      'Pasif tedarikçi sorumlu yapılamaz.',
      'supplierId',
    )
}

export interface MaintenancePlanDraft extends Omit<
  MaintenancePlanFields,
  'periodMonths' | 'isLegal'
> {
  periodMonths: number
  isLegal: boolean
}

/**
 * Plan açılışı (K-252): bağlantılar denetlenir; periyot ve yasal işaret boşsa türün önerisi
 * (`MAINTENANCE_PLAN_TYPE_DEFAULTS`) yazılır.
 */
export function planMaintenancePlan(
  input: MaintenancePlanFields,
  checks: MaintenancePlanChecks,
): MaintenancePlanDraft {
  checkPlanRefs(input, checks)
  const suggested = MAINTENANCE_PLAN_TYPE_DEFAULTS[input.type]
  return {
    ...input,
    periodMonths: input.periodMonths ?? suggested.periodMonths,
    isLegal: input.isLegal ?? suggested.isLegal,
  }
}

/**
 * Plan düzeltmesi (K-252): yalnız verilen alanlar denetlenir. Tür değişikliği periyodu ve yasal
 * işareti kendiliğinden değiştirmez. Değişiklik yoksa 422 `maintenance_plan_unchanged`.
 */
export function planMaintenancePlanUpdate(
  current: {
    name: string
    type: MaintenancePlanType
    campusId: string | null
    location: string
    assetTagNumber: string | null
    periodMonths: number
    isLegal: boolean
    lastDoneDate: string | null
    responsible: MaintenancePlanResponsibleInput
  },
  input: UpdateMaintenancePlanFields,
  checks: MaintenancePlanChecks,
): (keyof UpdateMaintenancePlanFields)[] {
  const changed = (Object.keys(input) as (keyof UpdateMaintenancePlanFields)[]).filter((key) => {
    const next = input[key]
    if (next === undefined) return false
    return JSON.stringify(next) !== JSON.stringify(current[key])
  })
  if (changed.length === 0)
    throw ruleError('maintenance_plan_unchanged', 'Planda değişen bir alan yok.')
  const refs: PlanRefs = {}
  if (changed.includes('assetTagNumber')) refs.assetTagNumber = input.assetTagNumber ?? null
  if (changed.includes('campusId')) refs.campusId = input.campusId ?? null
  if (changed.includes('lastDoneDate')) refs.lastDoneDate = input.lastDoneDate ?? null
  if (changed.includes('responsible')) refs.responsible = input.responsible ?? null
  checkPlanRefs(refs, checks)
  return changed
}

/**
 * Denetim kaydı (K-254): gün bugünden sonra olamaz (422 `maintenance_inspection_date_in_future`);
 * aynı planda aynı güne iptal edilmemiş ikinci denetim 409 `maintenance_inspection_exists`.
 */
export function planMaintenanceInspection(
  input: MaintenanceInspectionFields,
  checks: { today: string; sameDayExists: boolean },
): MaintenanceInspectionFields {
  if (input.doneDate > checks.today)
    throw ruleError(
      'maintenance_inspection_date_in_future',
      'Denetim günü bugünden sonra olamaz.',
      'doneDate',
    )
  if (checks.sameDayExists)
    throw new DomainError(
      'maintenance_inspection_exists',
      'Bu plana bu gün için denetim zaten kaydedilmiş.',
      { kind: 'conflict', path: ['doneDate'] },
    )
  return input
}

/** Denetim kaydının iptali: iptal edilmiş kayıt yeniden iptal edilmez. */
export function planMaintenanceInspectionCancel(inspection: { cancelledAt: string | null }) {
  if (inspection.cancelledAt !== null)
    throw ruleError('maintenance_inspection_cancelled', 'Denetim kaydı zaten iptal edilmiş.')
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

export interface MaintenanceRequestDraft {
  title: string
  description: string
  priority: MaintenancePriority
}

/**
 * Uygunsuz denetimden arıza talebi (K-254): yalnız uygunsuz ve kısmen uygun sonuçta, iptal
 * edilmemiş ve henüz talebe bağlanmamış denetimde. Başlık plan adından, açıklama denetimin
 * gününden, yapanından, belge numarasından ve notundan üretilir; uygunsuz sonuç acil, kısmen uygun
 * normal önceliklidir. Yer, kampüs ve demirbaş plandan gelir (servis bağlar).
 */
export function maintenanceRequestFromInspection(
  plan: { name: string; type: MaintenancePlanType },
  inspection: {
    doneDate: string
    performedBy: string
    result: MaintenanceInspectionResult
    documentNumber: string | null
    note: string | null
    cancelledAt: string | null
    maintenanceRequestId: string | null
  },
): MaintenanceRequestDraft {
  if (inspection.cancelledAt !== null)
    throw ruleError('maintenance_inspection_cancelled', 'İptal edilmiş denetimden talep açılmaz.')
  if (inspection.result === 'pass')
    throw ruleError(
      'maintenance_inspection_passed',
      'Uygun sonuçlanan denetimden arıza talebi açılmaz.',
    )
  if (inspection.maintenanceRequestId !== null)
    throw new DomainError(
      'maintenance_inspection_request_exists',
      'Bu denetim için arıza talebi zaten açılmış.',
      { kind: 'conflict' },
    )
  const facts = [
    `${MAINTENANCE_PLAN_TYPE_LABELS[plan.type]} periyodik denetimi`,
    inspection.doneDate,
    inspection.performedBy,
    ...(inspection.documentNumber === null ? [] : [`belge no ${inspection.documentNumber}`]),
  ].join(', ')
  return {
    title: clip(`Denetim uygunsuzluğu: ${plan.name}`, MAINTENANCE_TITLE_MAX),
    description: clip(
      `${facts}. Sonuç: ${MAINTENANCE_INSPECTION_RESULT_LABELS[inspection.result]}. ${inspection.note ?? ''}`.trim(),
      MAINTENANCE_DESCRIPTION_MAX,
    ),
    priority: inspection.result === 'fail' ? 'urgent' : 'normal',
  }
}

// --- CSV -----------------------------------------------------------------------------------------

export interface MaintenancePlanCsvRow {
  name: string
  type: MaintenancePlanType
  isLegal: boolean
  campusName: string | null
  location: string
  assetTagNumber: string | null
  periodMonths: number
  responsibleName: string | null
  lastDoneDate: string | null
  nextDueDate: string | null
  status: MaintenancePlanDueStatus
  daysLeft: number | null
}

/** Plan listesinin CSV'si (`;`, formül kaçışlı): süzgeçle eşleşen bütün planlar (K-255). */
export function maintenancePlansCsv(rows: readonly MaintenancePlanCsvRow[]): string {
  const header = [
    'Plan',
    'Tür',
    'Yasal',
    'Kampüs',
    'Yer',
    'Demirbaş',
    'Periyot (ay)',
    'Sorumlu',
    'Son denetim',
    'Sonraki denetim',
    'Durum',
    'Kalan gün',
  ]
  const lines = [header.map(csvCell).join(CSV_SEPARATOR)]
  for (const row of rows)
    lines.push(
      [
        csvCell(row.name),
        csvCell(MAINTENANCE_PLAN_TYPE_LABELS[row.type]),
        csvCell(row.isLegal ? 'Evet' : 'Hayır'),
        csvCell(row.campusName ?? ''),
        csvCell(row.location),
        csvCell(row.assetTagNumber ?? ''),
        csvCell(row.periodMonths),
        csvCell(row.responsibleName ?? ''),
        csvCell(row.lastDoneDate ?? ''),
        csvCell(row.nextDueDate ?? ''),
        csvCell(MAINTENANCE_PLAN_DUE_STATUS_LABELS[row.status]),
        csvCell(row.daysLeft ?? ''),
      ].join(CSV_SEPARATOR),
    )
  return `${lines.join('\r\n')}\r\n`
}
