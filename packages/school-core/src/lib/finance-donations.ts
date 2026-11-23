import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isValidTaxNumber, isValidTckn } from './finance-corporate.ts'
import { maskNationalId } from './scope.ts'

/**
 * Bağış kampanyası, bağışçı ve bağış makbuzu (docs/domain/finans.md DOM-FIN-097; ON-258). Çevrim
 * içi ödeme yoktur: bağış elle kaydedilir (nakit, havale/EFT, kart slipi) ya da ayni bağış olarak
 * açıklamayla yazılır. Her bağış kurumda yıl bazlı sıralı makbuz numarası alır; bağış silinmez,
 * gerekçeyle iptal edilir ve numara yeniden kullanılmaz. Vergi indirimi ibaresi yalnız kurum ayarı
 * açıksa makbuza kopyalanır (H-37). Bağışçı verisi yalnız yöneticiye açıktır, kimlik numarası
 * listelerde maskelidir (K-296…K-299, H-38). Fonksiyonlar saftır.
 */

/** Bağış ekranını ve bağışçı verisini yalnız yönetici okur ve yazar; muhasebe rolü açılınca o da (K-299). */
export const DONATION_ROLES = ['yonetici'] as const

export const DONATION_CAMPAIGN_NAME_MAX = 120
export const DONATION_CAMPAIGN_PURPOSE_MAX = 1000
export const DONOR_NAME_MAX = 200
export const DONOR_ADDRESS_MAX = 500
export const DONATION_REFERENCE_MAX = 100
export const DONATION_DESCRIPTION_MAX = 500
export const DONATION_NOTE_MAX = 200
export const DONATION_REASON_MAX = 500
export const DONATION_TAX_NOTICE_MIN = 20
export const DONATION_TAX_NOTICE_MAX = 600
/** Tek bağış, ayni değer ya da kampanya hedefi en çok 100 milyon TL (kuruş). */
export const DONATION_AMOUNT_MAX = 100_000_000_00

export const DONATION_CAMPAIGN_STATUSES = ['draft', 'open', 'closed'] as const
export type DonationCampaignStatus = (typeof DONATION_CAMPAIGN_STATUSES)[number]
export const DONATION_CAMPAIGN_STATUS_LABELS = {
  draft: 'Taslak',
  open: 'Açık',
  closed: 'Kapandı',
} as const satisfies Record<DonationCampaignStatus, string>

export const DONOR_KINDS = ['person', 'organization'] as const
export type DonorKind = (typeof DONOR_KINDS)[number]
export const DONOR_KIND_LABELS = {
  person: 'Kişi',
  organization: 'Kurum',
} as const satisfies Record<DonorKind, string>

/** Bağışçının okulla bağı: bir öğrencinin velisi ya da mezun öğrencinin kendisi (isteğe bağlı). */
export const DONOR_RELATIONS = ['parent', 'alumnus'] as const
export type DonorRelation = (typeof DONOR_RELATIONS)[number]
export const DONOR_RELATION_LABELS = {
  parent: 'Veli',
  alumnus: 'Mezun',
} as const satisfies Record<DonorRelation, string>

/** Nakdi bağış kampanya hedefine sayılır; ayni bağış açıklama ve beyan edilen değerle ayrı izlenir (K-297). */
export const DONATION_KINDS = ['cash', 'in_kind'] as const
export type DonationKind = (typeof DONATION_KINDS)[number]
export const DONATION_KIND_LABELS = {
  cash: 'Nakdi',
  in_kind: 'Ayni',
} as const satisfies Record<DonationKind, string>

/** Nakdi bağışın geliş yolu; sanal POS yoktur, kart yalnız fiziksel POS slipiyle elle girilir. */
export const DONATION_METHODS = ['cash', 'bank_transfer', 'card_slip'] as const
export type DonationMethod = (typeof DONATION_METHODS)[number]
export const DONATION_METHOD_LABELS = {
  cash: 'Nakit',
  bank_transfer: 'Banka havalesi / EFT',
  card_slip: 'Kart (POS slipi)',
} as const satisfies Record<DonationMethod, string>

export const ANONYMOUS_DONOR_LABEL = 'Anonim bağışçı'

// --- Şemalar -------------------------------------------------------------------------------------

const tooLong = (max: number) => `En fazla ${String(max)} karakter girebilirsiniz.`
const text = (required: string, min: number, max: number) =>
  z
    .string(required)
    .trim()
    .min(min, `En az ${String(min)} karakter girin.`)
    .max(max, tooLong(max))
/** İsteğe bağlı metin: boş ya da yok `null` olur (PATCH'te `null` alanı temizler). */
const optionalText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .max(max, tooLong(max))
    .nullable()
    .optional()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value))
    .refine(
      (value) => value === null || value.length >= min,
      `En az ${String(min)} karakter girin.`,
    )
const amountSchema = (message: string) =>
  z
    .number(message)
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .min(1, 'Tutar sıfırdan büyük olmalıdır.')
    .max(DONATION_AMOUNT_MAX, 'Tutar çok büyük.')

const campaignFields = {
  name: text('Kampanya adını yazın.', 2, DONATION_CAMPAIGN_NAME_MAX),
  purpose: text('Kampanyanın amacını yazın.', 5, DONATION_CAMPAIGN_PURPOSE_MAX),
  targetCents: amountSchema('Hedef tutarı girin.'),
  startsOn: daySchema,
  endsOn: daySchema,
  bankAccountId: z.uuid('Banka hesabı geçersiz.').nullable().optional(),
}

/** Kampanya taslak olarak açılır; bitiş başlangıçtan önce olamaz. */
export const createDonationCampaignSchema = z
  .strictObject(campaignFields)
  .superRefine((data, context) => {
    if (data.endsOn < data.startsOn)
      context.addIssue({
        code: 'custom',
        message: 'Bitiş günü başlangıçtan önce olamaz.',
        path: ['endsOn'],
      })
  })
export type CreateDonationCampaignInput = z.input<typeof createDonationCampaignSchema>

export const updateDonationCampaignSchema = z
  .strictObject({
    name: campaignFields.name.optional(),
    purpose: campaignFields.purpose.optional(),
    targetCents: campaignFields.targetCents.optional(),
    startsOn: daySchema.optional(),
    endsOn: daySchema.optional(),
    bankAccountId: campaignFields.bankAccountId,
  })
  .refine((data) => Object.keys(data).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdateDonationCampaignInput = z.input<typeof updateDonationCampaignSchema>

const identitySchema = z
  .string()
  .trim()
  .regex(/^\d{10,11}$/, 'Kimlik numarası 11 haneli TCKN ya da 10 haneli VKN olmalıdır.')
  .nullable()
  .optional()
  .transform((value) => value ?? null)
const linkSchema = z.strictObject({
  studentId: z.string('Öğrenciyi seçin.').trim().min(1, 'Öğrenciyi seçin.').max(200),
  relation: z.enum(DONOR_RELATIONS, 'Bağı seçin.'),
})
const donorFields = {
  name: text('Bağışçının adını ya da kurum adını yazın.', 2, DONOR_NAME_MAX),
  identityNumber: identitySchema,
  phone: z
    .string()
    .trim()
    .regex(/^0\d{10}$/, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.')
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  email: z
    .email('Geçerli bir e-posta adresi girin.')
    .max(254)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  address: optionalText(DONOR_ADDRESS_MAX, 10),
  link: linkSchema
    .nullable()
    .optional()
    .transform((value) => value ?? null),
}

/** Kimlik numarası kişide TCKN, kurumda VKN (şahıs işletmesinde TCKN); kontrol haneleri denetlenir. */
export function donorIdentityIssue(kind: DonorKind, value: string | null): string | null {
  if (value === null) return null
  if (kind === 'person')
    return value.length === 11 && isValidTckn(value)
      ? null
      : 'Kişi bağışçıda geçerli 11 haneli T.C. kimlik numarası girin.'
  return isValidTaxNumber(value)
    ? null
    : 'Kurum bağışçıda geçerli 10 haneli VKN ya da 11 haneli TCKN girin.'
}

/**
 * Bağışçı kaydı (K-298): ad zorunlu; kimlik numarası, telefon, e-posta, adres ve veli/mezun bağı
 * isteğe bağlıdır. Anonim bağışçı kaydı yoktur; anonim bağış bağışçısız yazılır.
 */
export const createDonorSchema = z
  .strictObject({ kind: z.enum(DONOR_KINDS, 'Bağışçı türünü seçin.'), ...donorFields })
  .superRefine((data, context) => {
    const issue = donorIdentityIssue(data.kind, data.identityNumber)
    if (issue !== null)
      context.addIssue({ code: 'custom', message: issue, path: ['identityNumber'] })
  })
export type CreateDonorInput = z.input<typeof createDonorSchema>

/** Bağışçı düzeltmesi; tür değişmez, `null` isteğe bağlı alanı temizler. */
export const updateDonorSchema = z
  .strictObject({
    name: donorFields.name.optional(),
    identityNumber: z
      .string()
      .trim()
      .regex(/^\d{10,11}$/, 'Kimlik numarası 11 haneli TCKN ya da 10 haneli VKN olmalıdır.')
      .nullable()
      .optional(),
    phone: z
      .string()
      .trim()
      .regex(/^0\d{10}$/, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.')
      .nullable()
      .optional(),
    email: z.email('Geçerli bir e-posta adresi girin.').max(254).nullable().optional(),
    address: z
      .string()
      .trim()
      .min(10, 'En az 10 karakter girin.')
      .max(DONOR_ADDRESS_MAX, tooLong(DONOR_ADDRESS_MAX))
      .nullable()
      .optional(),
    link: linkSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdateDonorInput = z.input<typeof updateDonorSchema>

/**
 * Bağış kaydı. `donorId: null` anonim bağıştır (K-298). Nakdi bağış tutar ve yöntem ister; banka
 * hesabı yalnız havalede verilir (verilmezse kampanyanın hesabı). Ayni bağış açıklama ister, tutar
 * ve yöntem almaz; bağışçının beyan ettiği değer isteğe bağlıdır (K-297).
 */
export const donationSchema = z
  .strictObject({
    donorId: z.uuid('Bağışçıyı seçin.').nullable(),
    kind: z.enum(DONATION_KINDS, 'Bağış türünü seçin.'),
    donatedOn: daySchema,
    amountCents: amountSchema('Tutarı girin.').optional(),
    method: z.enum(DONATION_METHODS, 'Ödeme yolunu seçin.').optional(),
    bankAccountId: z.uuid('Banka hesabı geçersiz.').optional(),
    reference: optionalText(DONATION_REFERENCE_MAX),
    description: optionalText(DONATION_DESCRIPTION_MAX, 5),
    declaredValueCents: amountSchema('Beyan edilen değeri girin.').optional(),
    note: optionalText(DONATION_NOTE_MAX),
  })
  .superRefine((data, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', message, path: [path] })
    if (data.kind === 'cash') {
      if (data.amountCents === undefined) issue('amountCents', 'Tutarı girin.')
      if (data.method === undefined) issue('method', 'Ödeme yolunu seçin.')
      if (data.description !== null)
        issue('description', 'Ayni bağış açıklaması nakdi bağışta yazılmaz.')
      if (data.declaredValueCents !== undefined)
        issue('declaredValueCents', 'Beyan edilen değer yalnız ayni bağışta girilir.')
      if (data.bankAccountId !== undefined && data.method !== 'bank_transfer')
        issue('bankAccountId', 'Banka hesabı yalnız havale/EFT bağışında seçilir.')
      return
    }
    if (data.description === null) issue('description', 'Ayni bağışı açıklayın (ne, kaç adet).')
    if (data.amountCents !== undefined)
      issue('amountCents', 'Ayni bağışta tutar yerine beyan edilen değer girilir.')
    if (data.method !== undefined) issue('method', 'Ayni bağışta ödeme yolu seçilmez.')
    if (data.bankAccountId !== undefined)
      issue('bankAccountId', 'Ayni bağışta banka hesabı seçilmez.')
  })
export type DonationInput = z.input<typeof donationSchema>

export const donationCancelSchema = z.strictObject({
  reason: text('İptal gerekçesini yazın.', 5, DONATION_REASON_MAX),
})
export type DonationCancelInput = z.input<typeof donationCancelSchema>

/** Makbuzdaki vergi indirimi ibaresi kurum ayarıdır; açıkken metin zorunludur (K-299, H-37). */
export const donationSettingsSchema = z
  .strictObject({
    taxNoticeEnabled: z.boolean('Ayarı seçin.'),
    taxNoticeText: z
      .string()
      .trim()
      .max(DONATION_TAX_NOTICE_MAX, tooLong(DONATION_TAX_NOTICE_MAX))
      .nullable()
      .transform((value) => (value === null || value === '' ? null : value)),
  })
  .superRefine((data, context) => {
    if (data.taxNoticeEnabled && (data.taxNoticeText ?? '').length < DONATION_TAX_NOTICE_MIN)
      context.addIssue({
        code: 'custom',
        message: `İbare açıkken en az ${String(DONATION_TAX_NOTICE_MIN)} karakterlik metni yazın.`,
        path: ['taxNoticeText'],
      })
  })
export type DonationSettingsInput = z.input<typeof donationSettingsSchema>

// --- Kampanya kuralları --------------------------------------------------------------------------

export interface DonationCampaignState {
  id: string
  name: string
  status: DonationCampaignStatus
  startsOn: string
  endsOn: string
  bankAccountId: string | null
}

const nameKey = (name: string) => name.toLocaleLowerCase('tr')

/** Arşivlenmemiş kampanyalar arasında aynı ad (Türkçe küçük harfle) ikinci kez kullanılmaz. */
function assertNameFree(
  name: string,
  taken: readonly { id: string; name: string }[],
  selfId?: string,
) {
  const key = nameKey(name)
  if (taken.some((row) => row.id !== selfId && nameKey(row.name) === key))
    throw new DomainError('donation_campaign_exists', 'Bu adla bir bağış kampanyası var.', {
      kind: 'conflict',
      path: ['name'],
    })
}

/** Banka hesabı kurumun arşivlenmemiş hesaplarından olmalıdır; başkası 404 (varlık sızmaz). */
function assertBankAccount(id: string | null | undefined, accounts: ReadonlySet<string>) {
  if (id !== null && id !== undefined && !accounts.has(id))
    throw new DomainError('bank_account_not_found', 'Banka hesabı bulunamadı.', {
      kind: 'not_found',
      path: ['bankAccountId'],
    })
}

export function planDonationCampaignCreate(
  input: unknown,
  context: { taken: readonly { id: string; name: string }[]; accounts: ReadonlySet<string> },
) {
  const data = createDonationCampaignSchema.parse(input)
  assertNameFree(data.name, context.taken)
  assertBankAccount(data.bankAccountId, context.accounts)
  return {
    name: data.name,
    purpose: data.purpose,
    targetCents: data.targetCents,
    startsOn: data.startsOn,
    endsOn: data.endsOn,
    bankAccountId: data.bankAccountId ?? null,
  }
}

export type DonationCampaignChanges = Partial<ReturnType<typeof planDonationCampaignCreate>>

/**
 * Kampanya düzeltmesi taslakta ve açıkken yapılır, kapanınca değişmez. Geçerli bağışı olan
 * kampanyanın günleri bağış günlerini dışarıda bırakamaz (K-296).
 */
export function planDonationCampaignUpdate(
  campaign: DonationCampaignState,
  input: unknown,
  context: {
    taken: readonly { id: string; name: string }[]
    accounts: ReadonlySet<string>
    donationDays: { first: string; last: string } | null
  },
): DonationCampaignChanges {
  const data = updateDonationCampaignSchema.parse(input)
  if (campaign.status === 'closed')
    throw new DomainError('donation_campaign_closed', 'Kapanmış kampanya değiştirilemez.')
  const startsOn = data.startsOn ?? campaign.startsOn
  const endsOn = data.endsOn ?? campaign.endsOn
  if (endsOn < startsOn)
    throw new DomainError(
      'donation_campaign_dates_invalid',
      'Bitiş günü başlangıçtan önce olamaz.',
      {
        path: [data.endsOn === undefined ? 'startsOn' : 'endsOn'],
      },
    )
  const days = context.donationDays
  if (days !== null && (startsOn > days.first || endsOn < days.last))
    throw new DomainError(
      'donation_campaign_dates_conflict',
      'Kampanya günleri kayıtlı bağışların günlerini kapsamalıdır.',
      { path: [startsOn > days.first ? 'startsOn' : 'endsOn'] },
    )
  if (data.name !== undefined) assertNameFree(data.name, context.taken, campaign.id)
  assertBankAccount(data.bankAccountId, context.accounts)
  const changes: DonationCampaignChanges = {}
  if (data.name !== undefined) changes.name = data.name
  if (data.purpose !== undefined) changes.purpose = data.purpose
  if (data.targetCents !== undefined) changes.targetCents = data.targetCents
  if (data.startsOn !== undefined) changes.startsOn = data.startsOn
  if (data.endsOn !== undefined) changes.endsOn = data.endsOn
  if (data.bankAccountId !== undefined) changes.bankAccountId = data.bankAccountId
  return changes
}

/** Taslak açılır; bitiş günü geçmiş kampanya açılmaz (K-296). */
export function planDonationCampaignOpen(campaign: DonationCampaignState, today: string) {
  if (campaign.status !== 'draft')
    throw new DomainError('donation_campaign_not_draft', 'Yalnız taslak kampanya açılır.', {
      kind: 'conflict',
    })
  if (campaign.endsOn < today)
    throw new DomainError(
      'donation_campaign_ended',
      'Bitiş günü geçmiş kampanya açılamaz; önce bitiş gününü düzeltin.',
      { path: ['endsOn'] },
    )
}

/** Açık kampanya kapanır; kapanan kampanyaya bağış yazılmaz, geri açılmaz (K-296). */
export function planDonationCampaignClose(campaign: DonationCampaignState) {
  if (campaign.status !== 'open')
    throw new DomainError('donation_campaign_not_open', 'Yalnız açık kampanya kapatılır.', {
      kind: 'conflict',
    })
}

export interface DonationCampaignProgress {
  /** Hedefin yüzde kaçı toplandı (aşağı yuvarlanır, 100'ü geçebilir). */
  percent: number
  remainingCents: number
}

/** İlerleme yalnız geçerli nakdi bağışlardandır; ayni bağış hedefe sayılmaz (K-297). */
export function donationCampaignProgress(
  targetCents: number,
  collectedCents: number,
): DonationCampaignProgress {
  return {
    percent: targetCents > 0 ? Math.floor((collectedCents * 100) / targetCents) : 0,
    remainingCents: Math.max(targetCents - collectedCents, 0),
  }
}

// --- Bağışçı kuralları ---------------------------------------------------------------------------

export interface DonorState {
  kind: DonorKind
  identityNumber: string | null
}

function assertIdentityFree(taken: boolean) {
  if (taken)
    throw new DomainError(
      'donor_identity_exists',
      'Bu kimlik numarasıyla kayıtlı bir bağışçı var.',
      {
        kind: 'conflict',
        path: ['identityNumber'],
      },
    )
}

function assertStudent(link: { studentId: string } | null, studentExists: boolean) {
  if (link !== null && !studentExists)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', {
      kind: 'not_found',
      path: ['link', 'studentId'],
    })
}

export function planDonorCreate(
  input: unknown,
  context: { identityTaken: boolean; studentExists: boolean },
) {
  const data = createDonorSchema.parse(input)
  assertIdentityFree(context.identityTaken)
  assertStudent(data.link, context.studentExists)
  return data
}

export type DonorChanges = z.output<typeof updateDonorSchema>

/** Düzeltmede kimlik numarası bağışçının türüne göre denetlenir (tür değişmez). */
export function planDonorUpdate(
  donor: DonorState,
  input: unknown,
  context: { identityTaken: boolean; studentExists: boolean },
): DonorChanges {
  const data = updateDonorSchema.parse(input)
  if (data.identityNumber !== undefined) {
    const issue = donorIdentityIssue(donor.kind, data.identityNumber)
    if (issue !== null)
      throw new DomainError('donor_identity_invalid', issue, { path: ['identityNumber'] })
  }
  assertIdentityFree(context.identityTaken)
  assertStudent(data.link ?? null, context.studentExists)
  return data
}

/** Listede ve dökümde kimlik numarası son dört hane dışında maskelenir (guvenlik-kvkk.md §8; K-298). */
export const maskDonorIdentity = (value: string | null): string | null =>
  value === null ? null : maskNationalId(value)

// --- Bağış kuralları -----------------------------------------------------------------------------

export interface DonationDonor {
  id: string
  kind: DonorKind
  name: string
  identityNumber: string | null
}

export interface DonationSettingsState {
  taxNoticeEnabled: boolean
  taxNoticeText: string | null
}

/**
 * Bağış girişi: kampanya açık olmalı, bağış günü kampanya günleri içinde ve gelecekte olmamalıdır.
 * Havalede banka hesabı verilmezse kampanyanınki alınır, ikisi de yoksa 422. Bağışçının adı, türü
 * ve kimlik numarası makbuz için bağışa kopyalanır; bağışçı sonradan düzeltilse de kesilmiş makbuz
 * değişmez. Vergi indirimi ibaresi ayar açıksa ve bağış anonim değilse kopyalanır (K-297, K-299).
 */
export function planDonation(
  campaign: DonationCampaignState,
  donor: DonationDonor | null,
  context: { accounts: ReadonlySet<string>; settings: DonationSettingsState; today: string },
  input: unknown,
) {
  const data = donationSchema.parse(input)
  if (campaign.status !== 'open')
    throw new DomainError(
      'donation_campaign_not_open',
      campaign.status === 'draft'
        ? 'Taslak kampanyaya bağış yazılmaz; önce kampanyayı açın.'
        : 'Kapanmış kampanyaya bağış yazılmaz.',
    )
  if (data.donatedOn > context.today)
    throw new DomainError('donation_date_future', 'Gelecek bir tarih girilemez.', {
      path: ['donatedOn'],
    })
  if (data.donatedOn < campaign.startsOn || data.donatedOn > campaign.endsOn)
    throw new DomainError(
      'donation_date_outside_campaign',
      'Bağış günü kampanya günleri içinde olmalıdır.',
      { path: ['donatedOn'] },
    )
  let bankAccountId: string | null = null
  if (data.method === 'bank_transfer') {
    bankAccountId = data.bankAccountId ?? campaign.bankAccountId
    if (bankAccountId === null)
      throw new DomainError(
        'donation_bank_account_required',
        'Havale/EFT bağışında banka hesabını seçin; kampanyaya bağlı hesap yok.',
        { path: ['bankAccountId'] },
      )
    assertBankAccount(bankAccountId, context.accounts)
  }
  const notice =
    context.settings.taxNoticeEnabled && donor !== null ? context.settings.taxNoticeText : null
  return {
    donorId: donor?.id ?? null,
    donorKind: donor?.kind ?? null,
    donorName: donor?.name ?? null,
    donorIdentityNumber: donor?.identityNumber ?? null,
    kind: data.kind,
    amountCents: data.kind === 'cash' ? (data.amountCents ?? null) : null,
    method: data.kind === 'cash' ? (data.method ?? null) : null,
    bankAccountId,
    reference: data.reference,
    description: data.kind === 'in_kind' ? data.description : null,
    declaredValueCents: data.kind === 'in_kind' ? (data.declaredValueCents ?? null) : null,
    donatedOn: data.donatedOn,
    note: data.note,
    taxNotice: notice,
  }
}
export type DonationPlan = ReturnType<typeof planDonation>

/** İptal makbuzu geçersiz kılar; numara boşa çıkmaz, yeniden kullanılmaz. Kapanmış kampanyada da yapılır (K-297). */
export function planDonationCancel(donation: { cancelledAt: string | null }, input: unknown) {
  const data = donationCancelSchema.parse(input)
  if (donation.cancelledAt !== null)
    throw new DomainError('donation_cancelled', 'Bu bağış zaten iptal edildi.', {
      kind: 'conflict',
    })
  return data
}

/** Makbuz numarasının tek gösterim biçimi: "BM-<yıl>-<sıra>"; dekont serisinden ayrıdır (K-297). */
export function donationReceiptLabel(donation: { receiptYear: number; receiptNumber: number }) {
  return `BM-${String(donation.receiptYear)}-${String(donation.receiptNumber)}`
}

// --- Döküm ---------------------------------------------------------------------------------------

export interface DonationListRow {
  donorKind: DonorKind | null
  donorName: string | null
  maskedIdentityNumber: string | null
  kind: DonationKind
  amountCents: number | null
  method: DonationMethod | null
  reference: string | null
  description: string | null
  declaredValueCents: number | null
  donatedOn: string
  receiptYear: number
  receiptNumber: number
  cancelledAt: string | null
  cancelReason: string | null
}

const CSV_COLUMNS = [
  'Kampanya',
  'Makbuz no',
  'Bağış günü',
  'Bağışçı',
  'Kimlik no',
  'Tür',
  'Ödeme yolu',
  'Referans',
  'Tutar',
  'Ayni açıklama',
  'Beyan edilen değer',
  'Durum',
  'İptal gerekçesi',
]

/**
 * Kampanyanın bağış dökümü CSV'si (`;`, ondalık virgül, formül kaçışı). Kimlik numarası maskelidir,
 * iletişim bilgisi yoktur; son satır geçerli nakdi bağışların toplamıdır (K-298).
 */
export function donationsCsv(campaign: { name: string }, rows: readonly DonationListRow[]): string {
  const collected = rows.reduce(
    (total, row) => (row.cancelledAt === null ? total + (row.amountCents ?? 0) : total),
    0,
  )
  const lines = rows.map((row) => [
    csvCell(campaign.name),
    csvCell(donationReceiptLabel(row)),
    csvCell(row.donatedOn),
    csvCell(row.donorName ?? ANONYMOUS_DONOR_LABEL),
    csvCell(row.maskedIdentityNumber ?? ''),
    csvCell(DONATION_KIND_LABELS[row.kind]),
    csvCell(row.method === null ? '' : DONATION_METHOD_LABELS[row.method]),
    csvCell(row.reference ?? ''),
    row.amountCents === null ? csvCell('') : csvAmount(row.amountCents),
    csvCell(row.description ?? ''),
    row.declaredValueCents === null ? csvCell('') : csvAmount(row.declaredValueCents),
    csvCell(row.cancelledAt === null ? 'Geçerli' : 'İptal edildi'),
    csvCell(row.cancelReason ?? ''),
  ])
  const total = CSV_COLUMNS.map((_, index) =>
    index === 0
      ? csvCell(campaign.name)
      : index === 2
        ? csvCell('Toplam nakdi bağış')
        : index === 8
          ? csvAmount(collected)
          : csvCell(''),
  )
  return [CSV_COLUMNS.map(csvCell), ...lines, total]
    .map((row) => row.join(CSV_SEPARATOR))
    .join('\r\n')
}
