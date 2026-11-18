import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel avansı ve ücret kesintileri (docs/domain/finans.md DOM-FIN-101; ON-199). Kurum personeline
 * (yönetici, öğretmen, ön büro üyeliği) verilen avans aylık taksitle ücretten mahsup edilir; icra
 * (maaş haczi) müzekkeresi ve bireysel emeklilik otomatik katılım (BES) kesintisi kayıt olarak
 * tutulur. Bordro hesabı (ON-198) ayı geldiğinde `monthlyDeductions` ile o ayın kesinti listesini
 * okur; burada ücret hesaplanmaz, para aktarılmaz. Hesaplanabilen değer (taksit planı, kalan avans,
 * icra sırası, BES durumu) saklanmaz. Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile
 * gelir. Mevzuat varsayımları **doğrulanmalı** (H-45, H-46, M-42, M-43); ürün kararları K-312…K-315.
 */

/** Okuma ve yazma yalnız yönetici (K-315; muhasebe/İK rolü açılınca o da). */
export const STAFF_DEDUCTION_ROLES = ['yonetici'] as const

// --- Ay ------------------------------------------------------------------------------------------

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
/** Takvim ayı `YYYY-MM`. */
export const monthSchema = z.string().regex(MONTH_PATTERN, 'Geçerli bir ay seçin (YYYY-AA).')

/** Günün ayı (`YYYY-MM-DD` → `YYYY-MM`). */
export const monthOf = (day: string) => day.slice(0, 7)

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1

/** Aya ay ekler (`2026-11` + 3 → `2027-02`). */
export function addMonths(month: string, count: number): string {
  const index = monthIndex(month) + count
  const year = Math.floor(index / 12)
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** İki ay arasındaki fark (`to − from`, ay sayısı). */
export const monthsBetween = (from: string, to: string) => monthIndex(to) - monthIndex(from)

// --- Sabitler ------------------------------------------------------------------------------------

export const STAFF_ADVANCE_PAYMENT_METHODS = ['cash', 'bank_transfer'] as const
export type StaffAdvancePaymentMethod = (typeof STAFF_ADVANCE_PAYMENT_METHODS)[number]
export const STAFF_ADVANCE_PAYMENT_METHOD_LABELS = {
  cash: 'Nakit',
  bank_transfer: 'Banka havalesi',
} as const satisfies Record<StaffAdvancePaymentMethod, string>

/** `active` mahsup sürüyor, `closed` erken kapandı, `cancelled` iptal (kayıt silinmez). */
export const STAFF_ADVANCE_STATUSES = ['active', 'closed', 'cancelled'] as const
export type StaffAdvanceStatus = (typeof STAFF_ADVANCE_STATUSES)[number]
export const STAFF_ADVANCE_STATUS_LABELS = {
  active: 'Mahsup ediliyor',
  closed: 'Erken kapandı',
  cancelled: 'İptal',
} as const satisfies Record<StaffAdvanceStatus, string>

export const STAFF_ADVANCE_MAX_CENTS = 100_000_000
export const STAFF_ADVANCE_MAX_INSTALLMENTS = 24
/** Mahsubun ilk ayı veriliş ayından en çok bu kadar ay sonra olabilir. */
export const STAFF_ADVANCE_MAX_DEFERRAL_MONTHS = 12
export const STAFF_DEDUCTION_REASON_MIN = 5
export const STAFF_DEDUCTION_REASON_MAX = 500

export const STAFF_GARNISHMENT_STATUSES = ['active', 'closed'] as const
export type StaffGarnishmentStatus = (typeof STAFF_GARNISHMENT_STATUSES)[number]
export const STAFF_GARNISHMENT_CLOSE_REASONS = ['paid_off', 'lifted', 'other'] as const
export type StaffGarnishmentCloseReason = (typeof STAFF_GARNISHMENT_CLOSE_REASONS)[number]
export const STAFF_GARNISHMENT_CLOSE_REASON_LABELS = {
  paid_off: 'Borç ödendi',
  lifted: 'Haciz kaldırıldı',
  other: 'Diğer',
} as const satisfies Record<StaffGarnishmentCloseReason, string>
/** İİK md. 83: varsayılan kesinti net ücretin dörtte biri (onbinde 2500; H-45). */
export const STAFF_GARNISHMENT_DEFAULT_RATE_BPS = 2500
export const STAFF_GARNISHMENT_MAX_CLAIM_CENTS = 10_000_000_000
export const STAFF_GARNISHMENT_OFFICE_MAX = 120
export const STAFF_GARNISHMENT_FILE_MAX = 40

/** BES otomatik katılım: çalışan katkısı en az %3 (onbinde 300; H-46). */
export const STAFF_PENSION_DEFAULT_RATE_BPS = 300
export const STAFF_PENSION_MIN_RATE_BPS = 300
/** Bir ara verme en çok 12 ay sürer (H-46). */
export const STAFF_PENSION_MAX_PAUSE_MONTHS = 12
/** Cayma süresi: katılımdan itibaren iki ay; içinde ayrılan katkısını geri alır (H-46). */
export const STAFF_PENSION_COOLING_OFF_MONTHS = 2
export const STAFF_PENSION_STATES = ['scheduled', 'active', 'paused', 'opted_out'] as const
export type StaffPensionState = (typeof STAFF_PENSION_STATES)[number]
export const STAFF_PENSION_STATE_LABELS = {
  scheduled: 'Başlamadı',
  active: 'Kesiliyor',
  paused: 'Ara verildi',
  opted_out: 'Ayrıldı',
} as const satisfies Record<StaffPensionState, string>
export const STAFF_PENSION_OPT_OUT_KINDS = ['cooling_off', 'exit'] as const
export type StaffPensionOptOutKind = (typeof STAFF_PENSION_OPT_OUT_KINDS)[number]
export const STAFF_PENSION_OPT_OUT_KIND_LABELS = {
  cooling_off: 'Cayma (katkı iade edilir)',
  exit: 'Sistemden ayrılma',
} as const satisfies Record<StaffPensionOptOutKind, string>

/** Onbinde oranı yüzdeye çevirir (2500 → "%25"). */
export const rateLabel = (basisPoints: number) =>
  `%${(basisPoints / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`

// --- Şemalar -------------------------------------------------------------------------------------

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')
const reasonSchema = z
  .string('Gerekçeyi yazın.')
  .trim()
  .min(STAFF_DEDUCTION_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
  .max(STAFF_DEDUCTION_REASON_MAX, 'En fazla 500 karakter girebilirsiniz.')
const centsSchema = (max: number, label: string) =>
  z
    .number(`${label} girin.`)
    .int('Tutar kuruş cinsinden tam sayı olmalı.')
    .positive(`${label} sıfırdan büyük olmalı.`)
    .max(max, `${label} çok büyük.`)

/** Avans (K-312): personel, tutar, veriliş günü ve yöntemi, taksit sayısı ve ilk mahsup ayı. */
export const staffAdvanceSchema = z
  .strictObject({
    membershipId: membershipSchema.describe('Avans alan personelin kurum üyeliği'),
    amountCents: centsSchema(STAFF_ADVANCE_MAX_CENTS, 'Avans tutarı').describe(
      'Avans tutarı, kuruş; en çok 1.000.000 ₺',
    ),
    givenDate: daySchema.describe('Avansın verildiği gün; bugünden sonra olamaz'),
    paymentMethod: z
      .enum(STAFF_ADVANCE_PAYMENT_METHODS, 'Ödeme yöntemini seçin.')
      .describe('`cash` nakit, `bank_transfer` banka havalesi'),
    installmentCount: z
      .number('Taksit sayısını girin.')
      .int('Taksit sayısı tam sayı olmalı.')
      .min(1, 'En az 1 taksit olmalı.')
      .max(STAFF_ADVANCE_MAX_INSTALLMENTS, 'En çok 24 taksit olabilir.')
      .describe('Kaç ayda mahsup edileceği (1–24)'),
    firstMonth: monthSchema.describe(
      'Mahsubun başladığı ay (YYYY-MM); veriliş ayından önce, 12 aydan sonra olamaz',
    ),
  })
  .refine((value) => value.amountCents >= value.installmentCount, {
    path: ['installmentCount'],
    message: 'Her taksit en az 1 kuruş olmalı; taksit sayısını azaltın.',
  })
export type StaffAdvanceInput = z.input<typeof staffAdvanceSchema>
export type StaffAdvanceFields = z.output<typeof staffAdvanceSchema>

/** Erken kapama (K-312): kalan taksitler belirtilen aydan itibaren kesilmez, personel öder. */
export const staffAdvanceCloseSchema = z.strictObject({
  closedDate: daySchema.describe('Kalan tutarın geri alındığı gün; bugünden sonra olamaz'),
  fromMonth: monthSchema.describe(
    'Kesilmeyecek ilk taksit ayı (YYYY-MM); kapama ayından önce olamaz, plan içinde olmalı',
  ),
  method: z
    .enum(STAFF_ADVANCE_PAYMENT_METHODS, 'Geri ödeme yöntemini seçin.')
    .describe('Kalan tutarın geri alındığı yöntem'),
})
export type StaffAdvanceCloseFields = z.output<typeof staffAdvanceCloseSchema>

/** İptal (K-312): yanlış girilen avans silinmez, gerekçeyle iptal edilir. */
export const staffDeductionCancelSchema = z.strictObject({
  reason: reasonSchema.describe('İptal gerekçesi, 5–500 karakter; denetim kaydına yazılmaz'),
})

const officeSchema = z
  .string('İcra dairesini yazın.')
  .trim()
  .min(3, 'İcra dairesini en az 3 karakterle yazın (ör. İstanbul 12. İcra Dairesi).')
  .max(STAFF_GARNISHMENT_OFFICE_MAX, 'En fazla 120 karakter girebilirsiniz.')
const fileNumberSchema = z
  .string('Dosya numarasını yazın.')
  .trim()
  .min(3, 'Dosya numarasını yazın (ör. 2026/1234).')
  .max(STAFF_GARNISHMENT_FILE_MAX, 'En fazla 40 karakter girebilirsiniz.')
const rateSchema = (min: number, label: string) =>
  z
    .number(`${label} girin.`)
    .int('Oran onbinde tam sayı olmalı.')
    .min(min, `${label} en az ${rateLabel(min)} olmalı.`)
    .max(10_000, `${label} %100'ü aşamaz.`)

/** İcra kesintisi (K-313): daire, dosya, alacak, oran, tebliğ günü, nafaka işareti. */
export const staffGarnishmentSchema = z.strictObject({
  membershipId: membershipSchema.describe('Hakkında icra müzekkeresi gelen personelin üyeliği'),
  // kvkk: Ç (icra bilgisi; yalnız yönetici, okuma denetimde)
  office: officeSchema.describe('İcra dairesi'),
  // kvkk: Ç
  fileNumber: fileNumberSchema.describe('İcra dosya numarası (ör. 2026/1234)'),
  // kvkk: Ç
  claimCents: centsSchema(STAFF_GARNISHMENT_MAX_CLAIM_CENTS, 'Alacak tutarı').describe(
    'Müzekkeredeki alacak tutarı, kuruş',
  ),
  rateBasisPoints: rateSchema(1, 'Kesinti oranı')
    .default(STAFF_GARNISHMENT_DEFAULT_RATE_BPS)
    .describe('Net ücretten kesilecek oran, onbinde (varsayılan 2500 = dörtte bir; İİK md. 83)'),
  // kvkk: Ç
  isAlimony: z
    .boolean('Nafaka işaretini seçin.')
    .default(false)
    .describe('Nafaka alacağı mı; nafaka hacizleri sıradan önce kesilir'),
  receivedDate: daySchema.describe(
    'Müzekkerenin kuruma tebliğ günü; sıra bu güne göredir, bugünden sonra olamaz',
  ),
})
export type StaffGarnishmentInput = z.input<typeof staffGarnishmentSchema>
export type StaffGarnishmentFields = z.output<typeof staffGarnishmentSchema>

/** Kalan alacak güncellemesi (K-313): icra dairesinin bakiye yazısına göre; alacağı aşamaz. */
export const staffGarnishmentBalanceSchema = z.strictObject({
  remainingCents: z
    .number('Kalan alacağı girin.')
    .int('Tutar kuruş cinsinden tam sayı olmalı.')
    .min(0, 'Kalan alacak negatif olamaz.')
    .describe('Kalan alacak, kuruş; alacak tutarını aşamaz'),
})

/** İcra kapanışı (K-313): gün ve neden; kapanan icra kesilmez. */
export const staffGarnishmentCloseSchema = z.strictObject({
  closedDate: daySchema.describe('Kapanış günü; tebliğden önce, bugünden sonra olamaz'),
  reason: z
    .enum(STAFF_GARNISHMENT_CLOSE_REASONS, 'Kapanış nedenini seçin.')
    .describe('`paid_off` borç ödendi, `lifted` haciz kaldırıldı, `other` diğer'),
})
export type StaffGarnishmentCloseFields = z.output<typeof staffGarnishmentCloseSchema>

/** BES otomatik katılım kaydı (K-314): oran ve başlangıç günü. */
export const staffPensionSchema = z.strictObject({
  membershipId: membershipSchema.describe('Katılan personelin kurum üyeliği'),
  rateBasisPoints: rateSchema(STAFF_PENSION_MIN_RATE_BPS, 'Katkı oranı')
    .default(STAFF_PENSION_DEFAULT_RATE_BPS)
    .describe('Çalışan katkı oranı, onbinde (varsayılan ve en az 300 = %3)'),
  startDate: daySchema.describe('Sisteme dahil olma günü; kesinti bu günün ayından başlar'),
})
export type StaffPensionInput = z.input<typeof staffPensionSchema>
export type StaffPensionFields = z.output<typeof staffPensionSchema>

/** Ara verme (K-314): iki ay dahil, en çok 12 ay. */
export const staffPensionPauseSchema = z
  .strictObject({
    fromMonth: monthSchema.describe('Kesintinin durduğu ilk ay (YYYY-MM)'),
    toMonth: monthSchema.describe('Kesintinin durduğu son ay (YYYY-MM), dahil'),
  })
  .superRefine((value, context) => {
    if (!MONTH_PATTERN.test(value.fromMonth) || !MONTH_PATTERN.test(value.toMonth)) return
    const span = monthsBetween(value.fromMonth, value.toMonth)
    if (span < 0)
      context.addIssue({
        code: 'custom',
        path: ['toMonth'],
        message: 'Son ay ilk aydan önce olamaz.',
      })
    else if (span + 1 > STAFF_PENSION_MAX_PAUSE_MONTHS)
      context.addIssue({
        code: 'custom',
        path: ['toMonth'],
        message: 'Ara verme en çok 12 ay sürebilir.',
      })
  })
export type StaffPensionPause = z.output<typeof staffPensionPauseSchema>

/** Cayma ya da ayrılma (K-314): gün; o günün ayından itibaren kesinti yapılmaz. */
export const staffPensionOptOutSchema = z.strictObject({
  optOutDate: daySchema.describe('Cayma ya da ayrılma günü; başlangıçtan önce olamaz'),
})

/** Ay için kesinti listesi isteği (DOM-FIN-101): ay ve isteğe bağlı net ücret ve BES matrahı. */
export const monthlyDeductionRequestSchema = z.strictObject({
  month: monthSchema.describe('Kesinti ayı (YYYY-MM)'),
  // kvkk: K (ücret; saklanmaz, loglanmaz)
  netCents: z
    .number()
    .int('Tutar kuruş cinsinden tam sayı olmalı.')
    .min(0, 'Net ücret negatif olamaz.')
    .max(STAFF_ADVANCE_MAX_CENTS, 'Net ücret çok büyük.')
    .nullable()
    .default(null)
    .describe('O ayın net ücreti, kuruş; yoksa yalnız sabit tutarlı satırlar hesaplanır'),
  // kvkk: K
  pensionBaseCents: z
    .number()
    .int('Tutar kuruş cinsinden tam sayı olmalı.')
    .min(0, 'BES matrahı negatif olamaz.')
    .max(STAFF_ADVANCE_MAX_CENTS, 'BES matrahı çok büyük.')
    .nullable()
    .default(null)
    .describe('BES katkı matrahı (SGK prime esas kazanç), kuruş; yoksa BES tutarı hesaplanmaz'),
})
export type MonthlyDeductionRequest = z.output<typeof monthlyDeductionRequestSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Kesinti yazılacak üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
export type StaffMember = { role: string; active: boolean } | null

/** Personel denetimi: kurumun etkin yönetici, öğretmen ya da ön büro üyeliği olmalı. */
export function assertDeductionStaff(staff: StaffMember): void {
  if (staff === null)
    throw ruleError('staff_deduction_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(staff.role))
    throw ruleError(
      'staff_deduction_not_staff',
      'Kesinti yalnız personele (yönetici, öğretmen, ön büro) yazılır.',
      'membershipId',
    )
  if (!staff.active)
    throw ruleError(
      'staff_deduction_staff_inactive',
      'Pasif personele yeni kesinti yazılamaz.',
      'membershipId',
    )
}

export interface AdvanceInstallment {
  month: string
  amountCents: number
}

/**
 * Taksit planı (K-312): tutar taksit sayısına bölünür, her taksit aşağı yuvarlanmış eşit kuruş;
 * yuvarlama farkı son taksite eklenir. Toplam her zaman tutara eşittir.
 */
export function advanceInstallmentPlan(advance: {
  amountCents: number
  installmentCount: number
  firstMonth: string
}): AdvanceInstallment[] {
  const base = Math.floor(advance.amountCents / advance.installmentCount)
  return Array.from({ length: advance.installmentCount }, (_, index) => ({
    month: addMonths(advance.firstMonth, index),
    amountCents:
      index === advance.installmentCount - 1
        ? advance.amountCents - base * (advance.installmentCount - 1)
        : base,
  }))
}

/** Avans kuralları (K-312): gelecek gün yok; ilk ay veriliş ayından önce ve 12 aydan sonra değil. */
export function planStaffAdvance(
  input: StaffAdvanceFields,
  checks: { today: string; staff: StaffMember },
): StaffAdvanceFields {
  if (input.givenDate > checks.today)
    throw ruleError(
      'staff_deduction_date_in_future',
      'Avans günü bugünden sonra olamaz.',
      'givenDate',
    )
  const deferral = monthsBetween(monthOf(input.givenDate), input.firstMonth)
  if (deferral < 0)
    throw ruleError(
      'staff_advance_first_month_before_given',
      'Mahsup avansın verildiği aydan önce başlayamaz.',
      'firstMonth',
    )
  if (deferral > STAFF_ADVANCE_MAX_DEFERRAL_MONTHS)
    throw ruleError(
      'staff_advance_first_month_too_late',
      'Mahsup avansın verildiği aydan en çok 12 ay sonra başlayabilir.',
      'firstMonth',
    )
  assertDeductionStaff(checks.staff)
  return input
}

export interface StoredAdvanceTerms {
  amountCents: number
  installmentCount: number
  firstMonth: string
  givenDate: string
  status: StaffAdvanceStatus
  closedFromMonth: string | null
}

/** Taksitin bu ayda kesilip kesilmeyeceği: iptalde hiçbiri, erken kapamada kapanış ayından önceki. */
const installmentDue = (advance: StoredAdvanceTerms, month: string) =>
  advance.status === 'active' ||
  (advance.status === 'closed' &&
    advance.closedFromMonth !== null &&
    month < advance.closedFromMonth)

/** Erken kapamada personelin ödediği kalan: kapanış ayı ve sonrasındaki taksitler. */
export function advanceClosedRemainder(advance: StoredAdvanceTerms): number | null {
  if (advance.status !== 'closed' || advance.closedFromMonth === null) return null
  const from = advance.closedFromMonth
  return advanceInstallmentPlan(advance)
    .filter((item) => item.month >= from)
    .reduce((total, item) => total + item.amountCents, 0)
}

/** Verilen aydan (dahil) itibaren kesilecek avans tutarı; ay öncesi kesilmiş sayılır. */
export function advanceOutstanding(advance: StoredAdvanceTerms, month: string): number {
  return advanceInstallmentPlan(advance)
    .filter((item) => item.month >= month && installmentDue(advance, item.month))
    .reduce((total, item) => total + item.amountCents, 0)
}

/**
 * Erken kapama (K-312): yalnız mahsubu süren avans; kesilmeyecek ilk ay kapama ayından önce
 * olamaz ve planın içinde olmalı. Gün veriliş gününden önce, bugünden sonra olamaz.
 */
export function planStaffAdvanceClose(
  advance: StoredAdvanceTerms,
  input: StaffAdvanceCloseFields,
  today: string,
): void {
  if (advance.status !== 'active')
    throw ruleError(
      'staff_advance_not_active',
      'Yalnız mahsubu süren avans kapatılabilir.',
      'fromMonth',
    )
  if (input.closedDate > today)
    throw ruleError(
      'staff_deduction_date_in_future',
      'Kapama günü bugünden sonra olamaz.',
      'closedDate',
    )
  if (input.closedDate < advance.givenDate)
    throw ruleError(
      'staff_advance_close_before_given',
      'Kapama günü avansın verildiği günden önce olamaz.',
      'closedDate',
    )
  if (input.fromMonth < monthOf(input.closedDate))
    throw ruleError(
      'staff_advance_close_month_past',
      'Kesilmeyecek ilk ay kapama ayından önce olamaz.',
      'fromMonth',
    )
  const plan = advanceInstallmentPlan(advance)
  if (!plan.some((item) => item.month === input.fromMonth))
    throw ruleError(
      'staff_advance_close_month_outside_plan',
      'Seçilen ay avansın taksit planında yok.',
      'fromMonth',
    )
}

/** İptal (K-312): yalnız mahsubu süren avans; kapanan avans iptal edilmez. */
export function planStaffAdvanceCancel(advance: { status: StaffAdvanceStatus }): void {
  if (advance.status !== 'active')
    throw ruleError(
      'staff_advance_not_active',
      'Yalnız mahsubu süren avans iptal edilebilir.',
      'reason',
    )
}

/** İcra kaydı (K-313): tebliğ günü bugünden sonra olamaz; personel kurumun etkin personeli. */
export function planStaffGarnishment(
  input: StaffGarnishmentFields,
  checks: { today: string; staff: StaffMember },
): StaffGarnishmentFields {
  if (input.receivedDate > checks.today)
    throw ruleError(
      'staff_deduction_date_in_future',
      'Tebliğ günü bugünden sonra olamaz.',
      'receivedDate',
    )
  assertDeductionStaff(checks.staff)
  return input
}

/** Kalan alacak (K-313): yalnız açık icrada; alacak tutarını aşamaz. */
export function planStaffGarnishmentBalance(
  garnishment: { status: StaffGarnishmentStatus; claimCents: number },
  remainingCents: number,
): void {
  if (garnishment.status !== 'active')
    throw ruleError(
      'staff_garnishment_closed',
      'Kapanmış icranın kalan alacağı değişmez.',
      'remainingCents',
    )
  if (remainingCents > garnishment.claimCents)
    throw ruleError(
      'staff_garnishment_remaining_exceeds_claim',
      'Kalan alacak alacak tutarını aşamaz.',
      'remainingCents',
    )
}

/** İcra kapanışı (K-313): bir kez; gün tebliğden önce, bugünden sonra olamaz. */
export function planStaffGarnishmentClose(
  garnishment: { status: StaffGarnishmentStatus; receivedDate: string },
  input: StaffGarnishmentCloseFields,
  today: string,
): void {
  if (garnishment.status !== 'active')
    throw ruleError('staff_garnishment_closed', 'Bu icra zaten kapandı.', 'closedDate')
  if (input.closedDate > today)
    throw ruleError(
      'staff_deduction_date_in_future',
      'Kapanış günü bugünden sonra olamaz.',
      'closedDate',
    )
  if (input.closedDate < garnishment.receivedDate)
    throw ruleError(
      'staff_garnishment_close_before_received',
      'Kapanış günü tebliğ gününden önce olamaz.',
      'closedDate',
    )
}

export interface StoredGarnishmentTerms {
  id: string
  status: StaffGarnishmentStatus
  isAlimony: boolean
  rateBasisPoints: number
  remainingCents: number
  receivedDate: string
  sequence: number
  closedDate: string | null
}

/**
 * İcra sırası (K-313): nafaka hacizleri önce, sonra tebliğ gününe göre (ilk gelen önce); aynı gün
 * kayıt sırası. Kesinti sırası saklanmaz, her okumada buradan hesaplanır.
 */
export function garnishmentQueue<T extends StoredGarnishmentTerms>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(b.isAlimony) - Number(a.isAlimony) ||
      a.receivedDate.localeCompare(b.receivedDate) ||
      a.sequence - b.sequence,
  )
}

/** BES katılımı (K-314): personel kurumun etkin personeli; tek açık katılım servis denetler. */
export function planStaffPension(
  input: StaffPensionFields,
  checks: { staff: StaffMember; hasOpenEnrollment: boolean },
): StaffPensionFields {
  if (checks.hasOpenEnrollment)
    throw new DomainError(
      'staff_pension_already_enrolled',
      'Bu personelin açık bir BES katılımı var.',
      { kind: 'conflict', path: ['membershipId'] },
    )
  assertDeductionStaff(checks.staff)
  return input
}

export interface StoredPensionTerms {
  startDate: string
  optOutDate: string | null
  pauses: readonly StaffPensionPause[]
}

/**
 * Ara verme (K-314): ayrılmış katılımda yok; başlangıç ayından önce olamaz, önceki aralarla
 * çakışamaz.
 */
export function planStaffPensionPause(pension: StoredPensionTerms, input: StaffPensionPause): void {
  if (pension.optOutDate !== null)
    throw ruleError('staff_pension_opted_out', 'Ayrılmış katılıma ara verilemez.', 'fromMonth')
  if (input.fromMonth < monthOf(pension.startDate))
    throw ruleError(
      'staff_pension_pause_before_start',
      'Ara verme katılım ayından önce başlayamaz.',
      'fromMonth',
    )
  if (
    pension.pauses.some(
      (pause) => input.fromMonth <= pause.toMonth && pause.fromMonth <= input.toMonth,
    )
  )
    throw ruleError('staff_pension_pause_overlap', 'Bu aylarda zaten ara verilmiş.', 'fromMonth')
}

/** Cayma ya da ayrılma (K-314): bir kez; gün başlangıçtan önce, bugünden sonra olamaz. */
export function planStaffPensionOptOut(
  pension: StoredPensionTerms,
  optOutDate: string,
  today: string,
): void {
  if (pension.optOutDate !== null)
    throw ruleError('staff_pension_opted_out', 'Bu katılımdan zaten ayrılındı.', 'optOutDate')
  if (optOutDate > today)
    throw ruleError(
      'staff_deduction_date_in_future',
      'Ayrılma günü bugünden sonra olamaz.',
      'optOutDate',
    )
  if (optOutDate < pension.startDate)
    throw ruleError(
      'staff_pension_opt_out_before_start',
      'Ayrılma günü katılım gününden önce olamaz.',
      'optOutDate',
    )
}

/** Ayrılma iki aylık cayma süresinde mi (katkı iade edilir) yoksa sistemden ayrılma mı. */
export function pensionOptOutKind(pension: {
  startDate: string
  optOutDate: string | null
}): StaffPensionOptOutKind | null {
  if (pension.optOutDate === null) return null
  const start = pension.startDate
  const limit = `${addMonths(monthOf(start), STAFF_PENSION_COOLING_OFF_MONTHS)}-${start.slice(8, 10)}`
  return pension.optOutDate <= limit ? 'cooling_off' : 'exit'
}

/** Katılımın verilen aydaki durumu: başlamadı, kesiliyor, ara verildi ya da ayrıldı. */
export function pensionStateIn(pension: StoredPensionTerms, month: string): StaffPensionState {
  if (pension.optOutDate !== null && month >= monthOf(pension.optOutDate)) return 'opted_out'
  if (month < monthOf(pension.startDate)) return 'scheduled'
  if (pension.pauses.some((pause) => pause.fromMonth <= month && month <= pause.toMonth))
    return 'paused'
  return 'active'
}

// --- Ay için kesinti listesi ---------------------------------------------------------------------

export const MONTHLY_DEDUCTION_KINDS = ['advance', 'garnishment', 'pension'] as const
export type MonthlyDeductionKind = (typeof MONTHLY_DEDUCTION_KINDS)[number]
export const MONTHLY_DEDUCTION_KIND_LABELS = {
  advance: 'Avans taksiti',
  garnishment: 'İcra kesintisi',
  pension: 'BES katkısı',
} as const satisfies Record<MonthlyDeductionKind, string>

/**
 * Satır durumu: `applied` tam kesildi, `capped` tavana takıldı (net ücretin kalanı ya da kalan
 * alacak), `waiting` icra sırada bekliyor, `settled` icranın kalan alacağı sıfır, `paused` BES'e
 * ara verildi, `needs_net` net ücret girilmedi, `needs_base` BES matrahı girilmedi.
 */
export const MONTHLY_DEDUCTION_STATUSES = [
  'applied',
  'capped',
  'waiting',
  'settled',
  'paused',
  'needs_net',
  'needs_base',
] as const
export type MonthlyDeductionStatus = (typeof MONTHLY_DEDUCTION_STATUSES)[number]
export const MONTHLY_DEDUCTION_STATUS_LABELS = {
  applied: 'Kesilir',
  capped: 'Tavana takıldı',
  waiting: 'Sırada bekliyor',
  settled: 'Alacak bitti',
  paused: 'Ara verildi',
  needs_net: 'Net ücret gerekli',
  needs_base: 'BES matrahı gerekli',
} as const satisfies Record<MonthlyDeductionStatus, string>

export interface MonthlyDeductionLine {
  order: number
  kind: MonthlyDeductionKind
  sourceId: string
  /** Kural tutarı (tavandan önce); hesaplanamıyorsa `null`. */
  requestedCents: number | null
  /** Kesilecek tutar; hesaplanamıyorsa `null`. */
  amountCents: number | null
  status: MonthlyDeductionStatus
}

export interface MonthlyDeductionSources {
  advances: readonly (StoredAdvanceTerms & { id: string })[]
  garnishments: readonly StoredGarnishmentTerms[]
  pensions: readonly (StoredPensionTerms & { id: string; rateBasisPoints: number })[]
}

export interface MonthlyDeductionResult {
  month: string
  netCents: number | null
  lines: MonthlyDeductionLine[]
  /** Hesaplanan satırların toplamı. */
  totalCents: number
  /** Net ücretten kalan; net yoksa `null`. */
  remainingNetCents: number | null
}

/** Oranla kesinti: onbinde oran, kuruşa aşağı yuvarlanır (personel lehine; K-315). */
export const rateCents = (baseCents: number, basisPoints: number) =>
  Math.floor((baseCents * basisPoints) / 10_000)

/**
 * Ay için kesinti listesi (DOM-FIN-101; K-315). Sıra: (1) avans taksitleri (veriliş gününe göre),
 * (2) icra kesintileri (nafaka önce, sonra tebliğ sırası; nafaka dışı icralardan aynı anda yalnız
 * sıradaki ilki kesilir, ötekiler bekler), (3) BES katkısı. İcra tutarı net ücret × oran, kalan
 * alacakla sınırlı; BES tutarı matrah × oran. Net ücret verilirse hiçbir satır net ücretin
 * kalanını aşamaz (tavan) ve toplam net ücreti geçmez; verilmezse yalnız sabit tutarlar (avans
 * taksiti; matrah verildiyse BES) hesaplanır, icra satırı `needs_net` olur. Oranlı tutarlar kuruşa
 * aşağı yuvarlanır.
 */
export function monthlyDeductions(
  request: MonthlyDeductionRequest,
  sources: MonthlyDeductionSources,
): MonthlyDeductionResult {
  const { month, netCents, pensionBaseCents } = request
  let available = netCents
  const lines: MonthlyDeductionLine[] = []
  /** Satır ekler; `limit` (kalan alacak) ve net ücretin kalanı tavandır. */
  const push = (
    kind: MonthlyDeductionKind,
    sourceId: string,
    requested: number | null,
    status: MonthlyDeductionStatus,
    limit = Number.POSITIVE_INFINITY,
  ) => {
    let amount = requested
    let finalStatus = status
    if (requested !== null && status === 'applied') {
      amount = Math.min(requested, limit, available ?? Number.POSITIVE_INFINITY)
      if (amount < requested) finalStatus = 'capped'
      if (available !== null) available -= amount
    }
    lines.push({
      order: lines.length + 1,
      kind,
      sourceId,
      requestedCents: requested,
      amountCents: amount,
      status: finalStatus,
    })
  }

  const advances = [...sources.advances].sort(
    (a, b) => a.givenDate.localeCompare(b.givenDate) || a.id.localeCompare(b.id),
  )
  for (const advance of advances) {
    if (!installmentDue(advance, month)) continue
    const installment = advanceInstallmentPlan(advance).find((item) => item.month === month)
    if (installment) push('advance', advance.id, installment.amountCents, 'applied')
  }

  const inForce = sources.garnishments.filter(
    (item) =>
      monthOf(item.receivedDate) <= month &&
      (item.closedDate === null ? item.status === 'active' : month < monthOf(item.closedDate)),
  )
  let queueTaken = false
  for (const item of garnishmentQueue(inForce)) {
    if (item.remainingCents <= 0) {
      push('garnishment', item.id, 0, 'settled')
      continue
    }
    if (!item.isAlimony && queueTaken) {
      push('garnishment', item.id, 0, 'waiting')
      continue
    }
    if (!item.isAlimony) queueTaken = true
    if (netCents === null) {
      push('garnishment', item.id, null, 'needs_net')
      continue
    }
    push(
      'garnishment',
      item.id,
      rateCents(netCents, item.rateBasisPoints),
      'applied',
      item.remainingCents,
    )
  }

  for (const pension of sources.pensions) {
    const state = pensionStateIn(pension, month)
    if (state === 'scheduled' || state === 'opted_out') continue
    if (state === 'paused') push('pension', pension.id, 0, 'paused')
    else if (pensionBaseCents === null) push('pension', pension.id, null, 'needs_base')
    else
      push('pension', pension.id, rateCents(pensionBaseCents, pension.rateBasisPoints), 'applied')
  }

  const totalCents = lines.reduce((total, line) => total + (line.amountCents ?? 0), 0)
  return {
    month,
    netCents,
    lines,
    totalCents,
    remainingNetCents: netCents === null ? null : netCents - totalCents,
  }
}
