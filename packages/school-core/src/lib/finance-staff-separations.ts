import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel } from './format.ts'
import { addDays, daysBetween } from './finance-opening-watch.ts'
import { noticeWeeks } from './finance-severance.ts'
import { isStaffRole, STAFF_ROLE_LABELS } from './staff-accounts.ts'

/**
 * İşten ayrılış süreci (docs/domain/finans.md DOM-FIN-118; ON-180). Yönetici ayrılan personel için
 * bir ayrılış dosyası açar: ayrılış günü, nedeni ve SGK çıkış kodu, işe giriş ve bildirim günü.
 * Dosyanın kontrol listesi altı adımdır (K-404): zimmet iadesi, avans ve icra kontrolü, kullanılmayan
 * yıllık izin, kıdem ve ihbar hesabı, hesap kapatma, hizmet belgesi. Zimmet, hesap kapatma ve hizmet
 * belgesi adımları ilgili kayıtlardan kendiliğinden okunur (demirbaş zimmeti DOM-FIN-086, hesap
 * pasifleştirme DOM-YTK-070, personel belgesi DOM-FIN-106); avans/icra, izin ve kıdem adımlarını
 * yönetici "kontrol edildi" diye işaretler. Zorunlu adımların tamamı bitince dosya tamamlanır
 * (ilişik kesilir) ve ilişik kesme belgesi basılır; açık dosya gerekçeyle iptal edilir (K-403).
 * Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Dosyayı yalnız yönetici açar, okur ve yürütür (K-403; ücret ve icra bilgisiyle aynı). */
export const FINANCE_STAFF_SEPARATION_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const STAFF_SEPARATION_REASONS = [
  'resignation',
  'termination',
  'retirement',
  'contract_end',
  'other',
] as const
export type StaffSeparationReason = (typeof STAFF_SEPARATION_REASONS)[number]
export const STAFF_SEPARATION_REASON_LABELS = {
  resignation: 'İstifa',
  termination: 'İşveren feshi',
  retirement: 'Emeklilik',
  contract_end: 'Sözleşme sonu',
  other: 'Diğer',
} as const satisfies Record<StaffSeparationReason, string>

/**
 * SGK işten ayrılış nedeni kodları (yaygın olanlar; H-85 doğrulanmalı). Listede olmayan neden
 * "22 Diğer nedenler" ile bildirilir.
 */
export const SGK_EXIT_CODES = ['01', '02', '03', '04', '05', '08', '09', '10', '22', '29'] as const
export type SgkExitCode = (typeof SGK_EXIT_CODES)[number]
export const SGK_EXIT_CODE_LABELS = {
  '01': 'Deneme süreli iş sözleşmesinin işverence feshi',
  '02': 'Deneme süreli iş sözleşmesinin işçi tarafından feshi',
  '03': 'Belirsiz süreli iş sözleşmesinin işçi tarafından feshi (istifa)',
  '04': 'Belirsiz süreli iş sözleşmesinin işveren tarafından haklı sebep bildirilmeden feshi',
  '05': 'Belirli süreli iş sözleşmesinin sona ermesi',
  '08': 'Emeklilik (yaşlılık) veya toptan ödeme',
  '09': 'Malulen emeklilik',
  '10': 'Ölüm',
  '22': 'Diğer nedenler',
  '29': 'İşverence ahlak ve iyi niyet kurallarına aykırı davranış nedeniyle fesih',
} as const satisfies Record<SgkExitCode, string>

/** Nedenden önerilen SGK çıkış kodu (K-403; H-85): kod verilmezse bu yazılır. */
export const SGK_EXIT_CODE_SUGGESTIONS = {
  resignation: '03',
  termination: '04',
  retirement: '08',
  contract_end: '05',
  other: '22',
} as const satisfies Record<StaffSeparationReason, SgkExitCode>

export const sgkExitCodeLabel = (code: SgkExitCode) => `${code} · ${SGK_EXIT_CODE_LABELS[code]}`

export const STAFF_SEPARATION_STATUSES = ['open', 'completed', 'cancelled'] as const
export type StaffSeparationStatus = (typeof STAFF_SEPARATION_STATUSES)[number]
export const STAFF_SEPARATION_STATUS_LABELS = {
  open: 'Açık',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<StaffSeparationStatus, string>

/** Kontrol listesi adımları, ekrandaki ve belgedeki sırasıyla (K-404). */
export const STAFF_SEPARATION_STEPS = [
  'asset_return',
  'deductions',
  'leave',
  'severance',
  'account_closure',
  'service_certificate',
] as const
export type StaffSeparationStep = (typeof STAFF_SEPARATION_STEPS)[number]
export const STAFF_SEPARATION_STEP_LABELS = {
  asset_return: 'Zimmet iadesi',
  deductions: 'Avans ve icra kontrolü',
  leave: 'Kullanılmayan yıllık izin',
  severance: 'Kıdem ve ihbar hesabı',
  account_closure: 'Hesap kapatma',
  service_certificate: 'Hizmet belgesi',
} as const satisfies Record<StaffSeparationStep, string>

/** Yöneticinin "kontrol edildi" diye işaretlediği adımlar; ötekiler kayıtlardan okunur (K-404). */
export const STAFF_SEPARATION_MANUAL_STEPS = [
  'deductions',
  'leave',
  'severance',
] as const satisfies readonly StaffSeparationStep[]
export type StaffSeparationManualStep = (typeof STAFF_SEPARATION_MANUAL_STEPS)[number]
/** Tamamlamayı beklemeyen adım: kıdem ve ihbar hesabı bilgidir, sonucu saklanmaz (K-273). */
export const STAFF_SEPARATION_OPTIONAL_STEPS = [
  'severance',
] as const satisfies readonly StaffSeparationStep[]

export const isManualSeparationStep = (step: string): step is StaffSeparationManualStep =>
  (STAFF_SEPARATION_MANUAL_STEPS as readonly string[]).includes(step)
export const isRequiredSeparationStep = (step: StaffSeparationStep) =>
  !(STAFF_SEPARATION_OPTIONAL_STEPS as readonly string[]).includes(step)

export const STAFF_SEPARATION_NOTE_MAX = 500
export const STAFF_SEPARATION_CANCEL_REASON_MIN = 5
export const STAFF_SEPARATION_CANCEL_REASON_MAX = 500
/** Ayrılış günü en çok bu kadar gün ileride olabilir (bildirim süresi işlerken dosya açılır). */
export const STAFF_SEPARATION_MAX_DAYS_AHEAD = 365
export const STAFF_SEPARATION_MIN_DATE = '2000-01-01'

// --- Şemalar -------------------------------------------------------------------------------------

const noteSchema = z
  .string()
  .trim()
  .max(
    STAFF_SEPARATION_NOTE_MAX,
    `En fazla ${String(STAFF_SEPARATION_NOTE_MAX)} karakter girebilirsiniz.`,
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
const separationDateSchema = daySchema.describe(
  'Ayrılış (son çalışma) günü; bugünden en çok 365 gün sonra',
)
const reasonSchema = z
  .enum(STAFF_SEPARATION_REASONS, 'Ayrılış nedenini seçin.')
  .describe(
    '`resignation` istifa, `termination` işveren feshi, `retirement` emeklilik, `contract_end` sözleşme sonu, `other` diğer',
  )
const sgkExitCodeSchema = z
  .enum(SGK_EXIT_CODES, 'SGK çıkış kodunu seçin.')
  .describe('SGK işten ayrılış nedeni kodu; `null` ise nedenden önerilir (H-85)')
const hireDateSchema = daySchema.describe(
  'İşe giriş günü; bildirim süresi buradan hesaplanır, boşsa bildirim bilgisi gösterilmez',
)
const noticeGivenDateSchema = daySchema.describe(
  'Fesih bildiriminin yapıldığı gün (istifa ya da işveren feshinde)',
)

type DateFields = {
  separationDate?: string | undefined
  hireDate?: string | null | undefined
  noticeGivenDate?: string | null | undefined
}

/** Gün ilişkileri (açılış ve düzeltmede aynı): giriş ≤ bildirim ≤ ayrılış. */
function checkDates(value: DateFields, context: z.RefinementCtx) {
  const { separationDate, hireDate, noticeGivenDate } = value
  if (separationDate !== undefined && separationDate < STAFF_SEPARATION_MIN_DATE)
    context.addIssue({
      code: 'custom',
      path: ['separationDate'],
      message: 'Ayrılış günü geçersiz.',
    })
  if (separationDate !== undefined && hireDate && hireDate > separationDate)
    context.addIssue({
      code: 'custom',
      path: ['hireDate'],
      message: 'İşe giriş günü ayrılış gününden sonra olamaz.',
    })
  if (separationDate !== undefined && noticeGivenDate && noticeGivenDate > separationDate)
    context.addIssue({
      code: 'custom',
      path: ['noticeGivenDate'],
      message: 'Bildirim günü ayrılış gününden sonra olamaz.',
    })
  if (hireDate && noticeGivenDate && noticeGivenDate < hireDate)
    context.addIssue({
      code: 'custom',
      path: ['noticeGivenDate'],
      message: 'Bildirim günü işe giriş gününden önce olamaz.',
    })
}

/** Ayrılış dosyası aç (DOM-FIN-118, K-403). */
export const staffSeparationInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: z
      .string('Personel seçin.')
      .trim()
      .min(1, 'Personel seçin.')
      .max(100, 'Personel geçersiz.')
      .describe('Ayrılan personelin kurum üyeliği'),
    separationDate: separationDateSchema,
    reason: reasonSchema,
    sgkExitCode: sgkExitCodeSchema.nullable().default(null),
    hireDate: hireDateSchema.nullable().default(null),
    noticeGivenDate: noticeGivenDateSchema.nullable().default(null),
    note: noteSchema.default(null).describe('İsteğe bağlı not, en çok 500 karakter'),
  })
  .superRefine(checkDates)
export type StaffSeparationInput = z.input<typeof staffSeparationInputSchema>
export type StaffSeparationFields = z.output<typeof staffSeparationInputSchema>

/** Açık dosyanın ayrıntısını düzelt: gönderilen alanlar değişir (K-403). */
export const staffSeparationUpdateSchema = z
  .strictObject({
    separationDate: separationDateSchema.optional(),
    reason: reasonSchema.optional(),
    sgkExitCode: sgkExitCodeSchema.optional(),
    hireDate: hireDateSchema.nullable().optional(),
    noticeGivenDate: noticeGivenDateSchema.nullable().optional(),
    note: noteSchema.optional().describe('Not; boş metin notu siler'),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((item) => item === undefined))
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
    checkDates(value, context)
  })
export type StaffSeparationUpdateInput = z.input<typeof staffSeparationUpdateSchema>
export type StaffSeparationUpdateFields = z.output<typeof staffSeparationUpdateSchema>

/** Elle işaretlenen adım (K-404): yalnız avans/icra, izin ve kıdem adımları. */
export const staffSeparationStepSchema = z.strictObject({
  step: z
    .enum(STAFF_SEPARATION_MANUAL_STEPS, 'Adımı seçin.')
    .describe('`deductions` avans ve icra kontrolü, `leave` izin, `severance` kıdem ve ihbar'),
  done: z
    .boolean('Adımın bitip bitmediğini seçin.')
    .describe('`true` kontrol edildi, `false` işareti kaldır'),
})
export type StaffSeparationStepInput = z.input<typeof staffSeparationStepSchema>

export const staffSeparationCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(STAFF_SEPARATION_CANCEL_REASON_MIN, 'İptal gerekçesini en az 5 karakterle yazın.')
    .max(
      STAFF_SEPARATION_CANCEL_REASON_MAX,
      `En fazla ${String(STAFF_SEPARATION_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .describe('İptal gerekçesi; denetim kaydına yazılmaz'),
})
export type StaffSeparationCancelFields = z.output<typeof staffSeparationCancelSchema>

// --- Bildirim süresi -----------------------------------------------------------------------------

/** Bildirim süresi uygulanan nedenler: belirsiz süreli sözleşmenin feshi (4857 md. 17; H-86). */
export const NOTICE_REASONS = [
  'resignation',
  'termination',
] as const satisfies readonly StaffSeparationReason[]

export interface StaffSeparationNotice {
  /** Bu neden için yasal bildirim süresi uygulanır mı. */
  applies: boolean
  /** Hizmet süresine göre bildirim süresi (hafta). */
  weeks: 2 | 4 | 6 | 8
  /** Bildirim gününden süre sonunda sözleşmenin bittiği gün; bildirim günü yoksa `null`. */
  noticeEndDate: string | null
  /** Ayrılış bildirim süresi bitmeden ise eksik kalan gün (ihbar tazminatına konu); yoksa 0. */
  shortDays: number
}

/**
 * Bildirim süresi bilgisi (K-405): işe giriş günü yoksa `null`. Süre 4857 md. 17'den hizmet süresine
 * göre (`noticeWeeks`); bildirim günü verilmişse sürenin bittiği gün ve ayrılış ondan önceyse eksik
 * kalan gün hesaplanır. Yalnız bilgidir; hiçbir adımı engellemez.
 */
export function staffSeparationNotice(separation: {
  reason: StaffSeparationReason
  hireDate: string | null
  separationDate: string
  noticeGivenDate: string | null
}): StaffSeparationNotice | null {
  if (separation.hireDate === null) return null
  const weeks = noticeWeeks(separation.hireDate, separation.separationDate)
  const applies = (NOTICE_REASONS as readonly string[]).includes(separation.reason)
  const noticeEndDate =
    separation.noticeGivenDate === null ? null : addDays(separation.noticeGivenDate, weeks * 7)
  const shortDays =
    applies && noticeEndDate !== null
      ? Math.max(0, daysBetween(separation.separationDate, noticeEndDate))
      : 0
  return { applies, weeks, noticeEndDate, shortDays }
}

// --- Kontrol listesi -----------------------------------------------------------------------------

/** Kayıtlardan okunan durum (servis yükler; K-404). */
export interface StaffSeparationFacts {
  /** Personelin iade edilmemiş zimmet sayısı (DOM-FIN-086). */
  openAssetCount: number
  /** Ayrılış ayından (dahil) kesilecek avans toplamı, kuruş (DOM-FIN-101). */
  openAdvanceCents: number
  /** Süren icra sayısı (DOM-FIN-101). */
  activeGarnishmentCount: number
  /** Üyelik pasifleştirildi mi (DOM-YTK-070). */
  accountClosed: boolean
  /** İptal edilmemiş hizmet belgesi var mı (DOM-FIN-106). */
  serviceCertificate: boolean
}

/** Dosyada saklanan işaretler (elle adımlar). */
export interface StaffSeparationMarks {
  deductionsCheckedAt: string | null
  leaveCheckedAt: string | null
  severanceCheckedAt: string | null
}

export interface StaffSeparationStepState {
  step: StaffSeparationStep
  required: boolean
  /** Kayıtlardan okunur (işaretlenmez). */
  automatic: boolean
  done: boolean
  /** Elle adımda işaret anı; kendiliğinden biten adımda `null`. */
  checkedAt: string | null
}

const MARK_FIELD = {
  deductions: 'deductionsCheckedAt',
  leave: 'leaveCheckedAt',
  severance: 'severanceCheckedAt',
} as const satisfies Record<StaffSeparationManualStep, keyof StaffSeparationMarks>

export const markFieldOf = (step: StaffSeparationManualStep) => MARK_FIELD[step]

/**
 * Adımların durumu (K-404). Zimmet adımı açık zimmet kalmayınca, hesap kapatma üyelik
 * pasifleştirilince, hizmet belgesi iptal edilmemiş belge düzenlenince biter. Avans ve icra adımı
 * kesilecek avans ve süren icra yoksa kendiliğinden, varsa yönetici işaretleyince biter. İzin ve
 * kıdem adımları yalnız işaretle biter; kıdem adımı zorunlu değildir.
 */
export function staffSeparationSteps(
  marks: StaffSeparationMarks,
  facts: StaffSeparationFacts,
): StaffSeparationStepState[] {
  const nothingOpen = facts.openAdvanceCents === 0 && facts.activeGarnishmentCount === 0
  const doneOf: Record<StaffSeparationStep, boolean> = {
    asset_return: facts.openAssetCount === 0,
    deductions: marks.deductionsCheckedAt !== null || nothingOpen,
    leave: marks.leaveCheckedAt !== null,
    severance: marks.severanceCheckedAt !== null,
    account_closure: facts.accountClosed,
    service_certificate: facts.serviceCertificate,
  }
  return STAFF_SEPARATION_STEPS.map((step) => ({
    step,
    required: isRequiredSeparationStep(step),
    automatic: !isManualSeparationStep(step),
    done: doneOf[step],
    checkedAt: isManualSeparationStep(step) ? marks[MARK_FIELD[step]] : null,
  }))
}

/** Bitmemiş zorunlu adımlar (sırasıyla). */
export const missingSeparationSteps = (steps: readonly StaffSeparationStepState[]) =>
  steps.filter((item) => item.required && !item.done).map((item) => item.step)

// --- Kurallar ------------------------------------------------------------------------------------

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const closedError = (status: StaffSeparationStatus) =>
  new DomainError(
    'staff_separation_closed',
    status === 'completed'
      ? 'Bu ayrılış dosyası tamamlandı; değiştirilemez.'
      : 'Bu ayrılış dosyası iptal edildi; değiştirilemez.',
    { kind: 'conflict' },
  )

/** Açılışta ve düzeltmede gün sınırları (bugüne göre). */
function checkDays(
  value: { separationDate: string; hireDate: string | null; noticeGivenDate: string | null },
  today: string,
) {
  if (daysBetween(today, value.separationDate) > STAFF_SEPARATION_MAX_DAYS_AHEAD)
    throw ruleError(
      'staff_separation_date_too_far',
      `Ayrılış günü bugünden en çok ${String(STAFF_SEPARATION_MAX_DAYS_AHEAD)} gün sonra olabilir.`,
      'separationDate',
    )
  if (value.hireDate !== null && value.hireDate > today)
    throw ruleError(
      'staff_separation_hire_date_future',
      'İşe giriş günü bugünden sonra olamaz.',
      'hireDate',
    )
  if (value.noticeGivenDate !== null && value.noticeGivenDate > today)
    throw ruleError(
      'staff_separation_notice_date_future',
      'Bildirim günü bugünden sonra olamaz.',
      'noticeGivenDate',
    )
}

/** Dosya açılışının denetimi için servis kurum kilidi altında yükler. */
export interface StaffSeparationChecks {
  /** Üyelik: kurumda yoksa `null`. Pasifleştirilmiş personele de dosya açılır. */
  staff: { role: string } | null
  /** Personelin açık ayrılış dosyası var mı. */
  hasOpen: boolean
  today: string
}

export interface StaffSeparationPlan {
  membershipId: string
  separationDate: string
  reason: StaffSeparationReason
  sgkExitCode: SgkExitCode
  hireDate: string | null
  noticeGivenDate: string | null
  note: string | null
}

/**
 * Dosya aç (DOM-FIN-118, K-403). Personel kurumun yönetici, öğretmen ya da ön büro üyeliğidir
 * (pasifleştirilmiş olabilir); aynı personelin tek açık dosyası olur (409). SGK kodu verilmezse
 * nedenden önerilir. Ayrılış günü bugünden en çok 365 gün sonra; işe giriş ve bildirim günü
 * bugünden sonra olamaz.
 */
export function planStaffSeparation(
  input: StaffSeparationFields,
  checks: StaffSeparationChecks,
): StaffSeparationPlan {
  if (checks.staff === null)
    throw ruleError('staff_separation_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'staff_separation_not_staff',
      'Ayrılış dosyası yalnız personele (yönetici, öğretmen, ön büro) açılır.',
      'membershipId',
    )
  if (checks.hasOpen)
    throw new DomainError(
      'staff_separation_open_exists',
      'Bu personelin açık bir ayrılış dosyası var; onu sürdürün ya da iptal edin.',
      { kind: 'conflict', path: ['membershipId'] },
    )
  checkDays(input, checks.today)
  return {
    membershipId: input.membershipId,
    separationDate: input.separationDate,
    reason: input.reason,
    sgkExitCode: input.sgkExitCode ?? SGK_EXIT_CODE_SUGGESTIONS[input.reason],
    hireDate: input.hireDate,
    noticeGivenDate: input.noticeGivenDate,
    note: input.note,
  }
}

/** Dosyanın düzeltilebilir alanları. */
export interface StaffSeparationDetails {
  separationDate: string
  reason: StaffSeparationReason
  sgkExitCode: SgkExitCode
  hireDate: string | null
  noticeGivenDate: string | null
  note: string | null
}

const DETAIL_KEYS = [
  'separationDate',
  'reason',
  'sgkExitCode',
  'hireDate',
  'noticeGivenDate',
  'note',
] as const satisfies readonly (keyof StaffSeparationDetails)[]

/**
 * Düzeltme (K-403): yalnız açık dosyada; birleşik değerler açılıştaki gün kurallarından geçer.
 * Neden değişip kod verilmezse kod yeni nedenin önerisine döner. Değişiklik yoksa 422
 * `staff_separation_unchanged`. Değişen alan adları döner.
 */
export function planStaffSeparationUpdate(
  current: StaffSeparationDetails & { status: StaffSeparationStatus },
  input: StaffSeparationUpdateFields,
  today: string,
): { next: StaffSeparationDetails; changed: (keyof StaffSeparationDetails)[] } {
  if (current.status !== 'open') throw closedError(current.status)
  const reason = input.reason ?? current.reason
  const next: StaffSeparationDetails = {
    separationDate: input.separationDate ?? current.separationDate,
    reason,
    sgkExitCode:
      input.sgkExitCode ??
      (input.reason !== undefined && input.reason !== current.reason
        ? SGK_EXIT_CODE_SUGGESTIONS[reason]
        : current.sgkExitCode),
    hireDate: input.hireDate === undefined ? current.hireDate : input.hireDate,
    noticeGivenDate:
      input.noticeGivenDate === undefined ? current.noticeGivenDate : input.noticeGivenDate,
    note: input.note === undefined ? current.note : input.note,
  }
  const changed = DETAIL_KEYS.filter((key) => next[key] !== current[key])
  if (changed.length === 0)
    throw ruleError('staff_separation_unchanged', 'Değişiklik yok; dosya aynı kaldı.')
  if (next.hireDate !== null && next.hireDate > next.separationDate)
    throw ruleError(
      'staff_separation_hire_after_exit',
      'İşe giriş günü ayrılış gününden sonra olamaz.',
      'hireDate',
    )
  if (next.noticeGivenDate !== null) {
    if (next.noticeGivenDate > next.separationDate)
      throw ruleError(
        'staff_separation_notice_after_exit',
        'Bildirim günü ayrılış gününden sonra olamaz.',
        'noticeGivenDate',
      )
    if (next.hireDate !== null && next.noticeGivenDate < next.hireDate)
      throw ruleError(
        'staff_separation_notice_before_hire',
        'Bildirim günü işe giriş gününden önce olamaz.',
        'noticeGivenDate',
      )
  }
  checkDays(next, today)
  return { next, changed }
}

/**
 * Elle adımı işaretle ya da işareti kaldır (K-404): yalnız açık dosyada. Durum aynıysa `changed`
 * `false` döner (yazılmaz).
 */
export function planStaffSeparationStep(
  current: StaffSeparationMarks & { status: StaffSeparationStatus },
  input: unknown,
): { step: StaffSeparationManualStep; done: boolean; changed: boolean } {
  const parsed = staffSeparationStepSchema.parse(input)
  if (current.status !== 'open') throw closedError(current.status)
  const checked = current[MARK_FIELD[parsed.step]] !== null
  return { step: parsed.step, done: parsed.done, changed: checked !== parsed.done }
}

/**
 * Tamamla, ilişiği kes (K-403): yalnız açık dosya; ayrılış günü gelmiş olmalı (422
 * `staff_separation_not_due`) ve zorunlu adımların tamamı bitmiş olmalı (422
 * `staff_separation_steps_incomplete`, eksik adımlar iletide).
 */
export function planStaffSeparationComplete(
  current: { status: StaffSeparationStatus; separationDate: string },
  steps: readonly StaffSeparationStepState[],
  today: string,
): void {
  if (current.status !== 'open') throw closedError(current.status)
  if (current.separationDate > today)
    throw ruleError(
      'staff_separation_not_due',
      `Ayrılış günü (${dayText(current.separationDate)}) gelmeden ilişik kesilmez.`,
    )
  const missing = missingSeparationSteps(steps)
  if (missing.length > 0)
    throw ruleError(
      'staff_separation_steps_incomplete',
      `Önce şu adımları bitirin: ${missing.map((step) => STAFF_SEPARATION_STEP_LABELS[step]).join(', ')}.`,
    )
}

/** İptal (K-403): yalnız açık dosya, gerekçeyle; tamamlanmış dosya iptal edilmez. */
export function planStaffSeparationCancel(
  current: { status: StaffSeparationStatus },
  input: unknown,
): StaffSeparationCancelFields {
  const parsed = staffSeparationCancelSchema.parse(input)
  if (current.status !== 'open') throw closedError(current.status)
  return parsed
}

// --- Belge metni ---------------------------------------------------------------------------------

/** Rol adı (personel rolleri); bilinmeyen rol olduğu gibi. */
export const staffRoleText = (role: string) => (isStaffRole(role) ? STAFF_ROLE_LABELS[role] : role)

/**
 * İlişik kesme belgesinin gövdesi (K-403): personel, görev, giriş ve ayrılış günü, neden ve
 * ilişiğin kesildiği. Taslakta (tamamlanmamış dosya) ilişik kesildi denmez.
 */
export function staffSeparationParagraphs(document: {
  staffName: string
  staffRole: string
  hireDate: string | null
  separationDate: string
  reason: StaffSeparationReason
  status: StaffSeparationStatus
}): string[] {
  const since =
    document.hireDate === null ? '' : `${dayText(document.hireDate)} tarihinden itibaren `
  const first = `${document.staffName}, kurumumuzda ${since}${staffRoleText(document.staffRole).toLocaleLowerCase('tr-TR')} olarak çalışmış; ${dayText(document.separationDate)} tarihinde "${STAFF_SEPARATION_REASON_LABELS[document.reason]}" nedeniyle ayrılmıştır.`
  const second =
    document.status === 'completed'
      ? 'Zimmetindeki demirbaşlar iade alınmış, avans ve icra durumu, kullanılmayan yıllık izni kontrol edilmiş, kurum hesabı kapatılmış ve hizmet belgesi düzenlenmiştir. Kurumla ilişiği kesilmiştir.'
      : 'Ayrılış işlemleri sürmektedir; bu belge ilişiğin kesildiğini göstermez.'
  return [first, second]
}
