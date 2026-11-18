import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isValidVkn } from './finance-corporate.ts'
import { daysBetween } from './finance-opening-watch.ts'
import { maskEmail, maskPhone } from './parent-contact.ts'

/**
 * Paydaş ve sponsor kaydı (docs/domain/finans.md DOM-FIN-102; ON-262). Kurum sponsorlarını, iş
 * birliği yaptığı kurumları, üniversiteleri, belediye ve STK'ları, veli derneğini ve tedarikçi
 * olmayan öteki kurumsal paydaşlarını tek listede tutar (K-316). Paydaşla yapılan iş birliği ya da
 * sponsorluk anlaşması konu, başlangıç–bitiş, yenileme bildirim günü, katkı (nakdi tutar, ayni
 * ya da hizmet açıklaması), karşılık (logo, etkinlik adı…) ve sözleşme dosyası taşır. Durum
 * taslak → yürürlükte → feshedildi olarak saklanır; "sona erdi" saklanmaz, bitiş günü geçmiş
 * yürürlükteki anlaşmada hesaplanır (K-318). Bitişe kalan gün yenileme bildirim gününe inince
 * anlaşma uyarıdadır (K-319). Sponsorun katkısı bağış kaydı değildir (burs fonu ve bağış
 * kampanyası ayrı kurallardır); anlaşmada tutar olarak durur, tahsilat ya da muhasebe kaydı
 * açmaz. Fonksiyonlar saftır; gün `today` (Europe/Istanbul) ile gelir.
 */

/** Paydaşları ve anlaşmaları okuyan ve yazan rol (K-317); muhasebe rolü açılınca o da. */
export const STAKEHOLDER_ROLES = ['yonetici'] as const
export const canManageStakeholders = (role: string) => role === 'yonetici'

export const STAKEHOLDER_TYPES = [
  'sponsor',
  'partner',
  'corporate',
  'university',
  'municipality_ngo',
  'parent_association',
] as const
export type StakeholderType = (typeof STAKEHOLDER_TYPES)[number]
export const STAKEHOLDER_TYPE_LABELS = {
  sponsor: 'Sponsor',
  partner: 'İş birliği kurumu',
  corporate: 'Kurumsal paydaş',
  university: 'Üniversite',
  municipality_ngo: 'Belediye / STK',
  parent_association: 'Veli derneği',
} as const satisfies Record<StakeholderType, string>

export const STAKEHOLDER_NAME_MIN = 2
export const STAKEHOLDER_NAME_MAX = 200
export const STAKEHOLDER_CONTACT_NAME_MAX = 120
export const STAKEHOLDER_EMAIL_MAX = 254
export const STAKEHOLDER_TAGS_MAX = 10
export const STAKEHOLDER_TAG_MIN = 2
export const STAKEHOLDER_TAG_MAX = 40

export const AGREEMENT_STATUSES = ['draft', 'active', 'terminated'] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]
/** Gösterilen durum: saklanan durum ile bitiş gününden hesaplanan "sona erdi" (K-318). */
export const AGREEMENT_VIEW_STATUSES = ['draft', 'active', 'ended', 'terminated'] as const
export type AgreementViewStatus = (typeof AGREEMENT_VIEW_STATUSES)[number]
export const AGREEMENT_VIEW_STATUS_LABELS = {
  draft: 'Taslak',
  active: 'Yürürlükte',
  ended: 'Sona erdi',
  terminated: 'Feshedildi',
} as const satisfies Record<AgreementViewStatus, string>

export const CONTRIBUTION_TYPES = ['cash', 'in_kind', 'service'] as const
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number]
export const CONTRIBUTION_TYPE_LABELS = {
  cash: 'Nakdi',
  in_kind: 'Ayni',
  service: 'Hizmet',
} as const satisfies Record<ContributionType, string>

export const AGREEMENT_BENEFITS = ['logo', 'event_naming', 'announcement', 'other'] as const
export type AgreementBenefit = (typeof AGREEMENT_BENEFITS)[number]
export const AGREEMENT_BENEFIT_LABELS = {
  logo: 'Logo kullanımı',
  event_naming: 'Etkinlik adı',
  announcement: 'Duyuru ve teşekkür',
  other: 'Diğer',
} as const satisfies Record<AgreementBenefit, string>

export const AGREEMENT_SUBJECT_MIN = 3
export const AGREEMENT_SUBJECT_MAX = 200
export const AGREEMENT_DESCRIPTION_MIN = 3
export const AGREEMENT_DESCRIPTION_MAX = 500
export const AGREEMENT_BENEFIT_NOTE_MAX = 300
export const AGREEMENT_NOTICE_DAYS_DEFAULT = 30
export const AGREEMENT_NOTICE_DAYS_MAX = 365
/** Katkı tutarının üst sınırı: 1 milyar TL (kuruş). */
export const AGREEMENT_AMOUNT_MAX_CENTS = 100_000_000_000
export const AGREEMENT_REASON_MIN = 5
export const AGREEMENT_REASON_MAX = 500
/** "Bitişi N gün içinde" süzgecinin üst sınırı. */
export const AGREEMENT_EXPIRING_MAX_DAYS = 365

const maxMessage = (max: number) => `En fazla ${String(max)} karakter girebilirsiniz.`

// --- Paydaş --------------------------------------------------------------------------------------

/** Etiketin karşılaştırılan biçimi: boşluklar sadeleşir, Türkçe küçük harf. */
export const normalizeStakeholderTag = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')

const nameSchema = z
  .string('Kurum adını yazın.')
  .trim()
  .min(STAKEHOLDER_NAME_MIN, 'Kurum adını en az 2 karakterle yazın.')
  .max(STAKEHOLDER_NAME_MAX, maxMessage(STAKEHOLDER_NAME_MAX))
const typeSchema = z
  .enum(STAKEHOLDER_TYPES, 'Paydaş türünü seçin.')
  .describe(
    '`sponsor` sponsor, `partner` iş birliği kurumu, `corporate` kurumsal paydaş (tedarikçi dışı), `university` üniversite, `municipality_ngo` belediye ya da STK, `parent_association` veli derneği',
  )
const taxNumberSchema = z
  .string('Vergi kimlik numarasını yazın.')
  .trim()
  .regex(/^\d{10}$/, 'Vergi kimlik numarası (VKN) 10 hane olmalıdır.')
  .refine(isValidVkn, 'Vergi kimlik numarası geçersiz; hanelerini kontrol edin.')
  .nullable()
  .describe('İsteğe bağlı 10 haneli VKN; verilmişse kurumda tekil')
const contactNameSchema = z
  .string()
  .trim()
  .min(2, 'İletişim kişisinin adını en az 2 karakterle yazın.')
  .max(STAKEHOLDER_CONTACT_NAME_MAX, maxMessage(STAKEHOLDER_CONTACT_NAME_MAX))
  .nullable()
const contactPhoneSchema = z
  .string()
  .trim()
  .regex(/^0\d{10}$/, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.')
  .nullable()
const contactEmailSchema = z
  .email('Geçerli bir e-posta adresi girin.')
  .max(STAKEHOLDER_EMAIL_MAX)
  .nullable()
const tagsSchema = z
  .array(
    z
      .string('Etiketi yazın.')
      .transform(normalizeStakeholderTag)
      .pipe(
        z
          .string()
          .min(STAKEHOLDER_TAG_MIN, 'Etiket en az 2 karakter olmalıdır.')
          .max(STAKEHOLDER_TAG_MAX, maxMessage(STAKEHOLDER_TAG_MAX)),
      ),
    'Etiketleri liste olarak gönderin.',
  )
  .max(STAKEHOLDER_TAGS_MAX, `En fazla ${String(STAKEHOLDER_TAGS_MAX)} etiket eklenebilir.`)
  // Aynı etiket (büyük-küçük harf ve boşluk farkı dahil) bir kez tutulur, ilk sıra korunur.
  .transform((values) => [...new Set(values)])
  .describe('Serbest etiketler (en çok 10, Türkçe küçük harfe çevrilir, yinelenen tek sayılır)')

/** Yeni paydaş (DOM-FIN-102, K-316). VKN, iletişim kişisi ve etiketler isteğe bağlıdır. */
export const stakeholderSchema = z.strictObject({
  name: nameSchema,
  type: typeSchema,
  taxNumber: taxNumberSchema.default(null),
  // kvkk: K
  contactName: contactNameSchema.default(null),
  // kvkk: K (listede maskeli)
  contactEmail: contactEmailSchema.default(null),
  // kvkk: K (listede maskeli)
  contactPhone: contactPhoneSchema.default(null),
  tags: tagsSchema.default([]),
})
export type StakeholderInput = z.input<typeof stakeholderSchema>
export type StakeholderFields = z.output<typeof stakeholderSchema>

/**
 * Kısmi düzeltme (K-316). `isActive: false` pasifleştirir, `true` yeniden etkinleştirir; paydaş
 * silinmez. Etiket listesi bütün olarak yazılır.
 */
export const updateStakeholderSchema = z
  .strictObject({
    name: nameSchema.optional(),
    type: typeSchema.optional(),
    taxNumber: taxNumberSchema.optional(),
    contactName: contactNameSchema.optional(),
    contactEmail: contactEmailSchema.optional(),
    contactPhone: contactPhoneSchema.optional(),
    tags: tagsSchema.optional(),
    isActive: z.boolean('Etkinlik durumu açık ya da kapalı olmalıdır.').optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type UpdateStakeholderInput = z.input<typeof updateStakeholderSchema>
export type StakeholderChanges = z.output<typeof updateStakeholderSchema>

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })

/** VKN kurumun bütün paydaşları (pasifler dahil) arasında tekildir (K-316). */
export function assertStakeholderTaxNumberFree(taken: boolean): void {
  if (taken)
    throw new DomainError(
      'stakeholder_tax_number_exists',
      'Bu vergi kimlik numarasıyla kayıtlı bir paydaş var.',
      { kind: 'conflict', path: ['taxNumber'] },
    )
}

/**
 * Paydaş düzeltmesinin değişen alanları (K-316): aynı değer değişiklik sayılmaz; hiçbir alan
 * değişmiyorsa 422 `stakeholder_unchanged`.
 */
export function planStakeholderUpdate(
  current: StakeholderFields & { isActive: boolean },
  changes: StakeholderChanges,
): (keyof StakeholderChanges)[] {
  const changed = (Object.keys(changes) as (keyof StakeholderChanges)[]).filter((key) => {
    const next = changes[key]
    return next !== undefined && JSON.stringify(next) !== JSON.stringify(current[key])
  })
  if (changed.length === 0)
    throw ruleError('stakeholder_unchanged', 'Paydaşta değişen bir alan yok.')
  return changed
}

/**
 * Listede gösterilen iletişim bilgisi (K-317): e-posta ve telefon maskelidir (`a***@alan.com`,
 * `0532 *** ** 12`); kişinin adı açık kalır. Tam değerler yalnız ayrıntıdadır.
 */
export function maskStakeholderContact(contact: {
  contactEmail: string | null
  contactPhone: string | null
}): { contactEmail: string | null; contactPhone: string | null } {
  return {
    contactEmail: contact.contactEmail === null ? null : maskEmail(contact.contactEmail),
    contactPhone: contact.contactPhone === null ? null : maskPhone(contact.contactPhone),
  }
}

// --- Anlaşma -------------------------------------------------------------------------------------

const subjectSchema = z
  .string('Anlaşmanın konusunu yazın.')
  .trim()
  .min(AGREEMENT_SUBJECT_MIN, 'Konuyu en az 3 karakterle yazın (ör. Bahar şenliği sponsorluğu).')
  .max(AGREEMENT_SUBJECT_MAX, maxMessage(AGREEMENT_SUBJECT_MAX))
const noticeDaysSchema = z
  .number('Yenileme bildirim gününü girin.')
  .int('Yenileme bildirim günü tam sayı olmalıdır.')
  .min(0, 'Yenileme bildirim günü 0 ya da daha büyük olmalıdır.')
  .max(AGREEMENT_NOTICE_DAYS_MAX, 'Yenileme bildirim günü en çok 365 olabilir.')
  .describe('Bitişten kaç gün önce uyarı verileceği (0–365)')
const contributionTypeSchema = z
  .enum(CONTRIBUTION_TYPES, 'Katkı türünü seçin.')
  .describe('`cash` nakdi, `in_kind` ayni, `service` hizmet')
const amountSchema = z
  .number('Tutarı girin.')
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .positive('Tutar sıfırdan büyük olmalıdır.')
  .max(AGREEMENT_AMOUNT_MAX_CENTS, "Tutar 1.000.000.000 TL'yi aşamaz.")
  .nullable()
  .describe('Kuruş. Nakdi katkıda tutar; ayni ve hizmette isteğe bağlı tahmini değer')
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, maxMessage(max))
    .transform((value) => (value === '' ? null : value))
    .nullable()
const benefitsSchema = z
  .array(z.enum(AGREEMENT_BENEFITS, 'Karşılık geçersiz.'), 'Karşılıkları liste olarak gönderin.')
  .max(AGREEMENT_BENEFITS.length)
  // Sıra sabit kümenin sırasıdır; yinelenen seçim tek sayılır.
  .transform((values) => AGREEMENT_BENEFITS.filter((benefit) => values.includes(benefit)))
  .describe(
    '`logo` logo kullanımı, `event_naming` etkinlik adı, `announcement` duyuru ve teşekkür, `other` diğer',
  )
const fileIdSchema = z
  .uuid('Sözleşme dosyası geçersiz.')
  .nullable()
  .describe('`POST /files` (`purpose: document`) ile yüklenmiş PDF; yükleyen yönetici bağlar')

/** Yeni anlaşma (DOM-FIN-102). Tarih ve katkı uyumu `checkAgreementTerms` ile denetlenir (422). */
export const stakeholderAgreementSchema = z.strictObject({
  subject: subjectSchema,
  startDate: daySchema.describe('Başlangıç günü'),
  endDate: daySchema.describe('Bitiş günü; başlangıçtan önce olamaz'),
  renewalNoticeDays: noticeDaysSchema.default(AGREEMENT_NOTICE_DAYS_DEFAULT),
  contributionType: contributionTypeSchema,
  contributionAmountCents: amountSchema.default(null),
  contributionDescription: optionalText(AGREEMENT_DESCRIPTION_MAX)
    .default(null)
    .describe('Ayni ve hizmet katkısında zorunlu açıklama (ör. 40 tablet, yaz okulu eğitmenliği)'),
  benefits: benefitsSchema.default([]),
  benefitNote: optionalText(AGREEMENT_BENEFIT_NOTE_MAX)
    .default(null)
    .describe('Karşılığın ayrıntısı (ör. etkinlik adı, logo yeri)'),
  contractFileId: fileIdSchema.default(null),
})
export type StakeholderAgreementInput = z.input<typeof stakeholderAgreementSchema>
export type StakeholderAgreementFields = z.output<typeof stakeholderAgreementSchema>

/** Anlaşma düzeltmesi: verilen alan değişir; en az bir alan. `contractFileId: null` eki kaldırır. */
export const updateStakeholderAgreementSchema = z
  .strictObject({
    subject: subjectSchema.optional(),
    startDate: daySchema.optional(),
    endDate: daySchema.optional(),
    renewalNoticeDays: noticeDaysSchema.optional(),
    contributionType: contributionTypeSchema.optional(),
    contributionAmountCents: amountSchema.optional(),
    contributionDescription: optionalText(AGREEMENT_DESCRIPTION_MAX).optional(),
    benefits: benefitsSchema.optional(),
    benefitNote: optionalText(AGREEMENT_BENEFIT_NOTE_MAX).optional(),
    contractFileId: fileIdSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type UpdateStakeholderAgreementInput = z.input<typeof updateStakeholderAgreementSchema>
export type StakeholderAgreementChanges = z.output<typeof updateStakeholderAgreementSchema>

/** Fesih (K-318): fesih günü ve gerekçe. */
export const terminateStakeholderAgreementSchema = z.strictObject({
  terminationDate: daySchema.describe('Fesih günü; başlangıç ile bitiş arasında'),
  reason: z
    .string('Fesih gerekçesini yazın.')
    .trim()
    .min(AGREEMENT_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(AGREEMENT_REASON_MAX, maxMessage(AGREEMENT_REASON_MAX)),
})
export type TerminateStakeholderAgreementInput = z.input<typeof terminateStakeholderAgreementSchema>

export type AgreementTerms = Omit<StakeholderAgreementFields, 'contractFileId'>

/**
 * Tarih ve katkı uyumu (DOM-FIN-102): bitiş başlangıçtan önce olamaz; nakdi katkıda tutar,
 * ayni ve hizmet katkısında en az 3 karakterlik açıklama zorunludur. Açılışta ve düzeltmede
 * birleşik değerle çağrılır.
 */
export function checkAgreementTerms(terms: AgreementTerms): void {
  if (terms.endDate < terms.startDate)
    throw ruleError(
      'stakeholder_agreement_dates_invalid',
      'Bitiş günü başlangıç gününden önce olamaz.',
      'endDate',
    )
  if (terms.contributionType === 'cash' && terms.contributionAmountCents === null)
    throw ruleError(
      'stakeholder_agreement_amount_required',
      'Nakdi katkıda tutarı girin.',
      'contributionAmountCents',
    )
  if (
    terms.contributionType !== 'cash' &&
    (terms.contributionDescription === null ||
      terms.contributionDescription.length < AGREEMENT_DESCRIPTION_MIN)
  )
    throw ruleError(
      'stakeholder_agreement_description_required',
      'Ayni ya da hizmet katkısını en az 3 karakterle açıklayın.',
      'contributionDescription',
    )
}

function assertStakeholderActive(stakeholder: { isActive: boolean }) {
  if (!stakeholder.isActive)
    throw ruleError(
      'stakeholder_inactive',
      'Pasif paydaşla anlaşma açılamaz ya da yürürlüğe alınamaz.',
    )
}

/** Anlaşma açılışı (K-316, K-318): paydaş etkin olmalı; anlaşma taslak olarak açılır. */
export function planStakeholderAgreement(
  input: StakeholderAgreementFields,
  stakeholder: { isActive: boolean },
): StakeholderAgreementFields {
  assertStakeholderActive(stakeholder)
  checkAgreementTerms(input)
  return input
}

/**
 * Anlaşma düzeltmesi (K-318): feshedilmiş anlaşma değişmez (422
 * `stakeholder_agreement_terminated`); taslak, yürürlükteki ve sona ermiş anlaşma düzeltilir
 * (ör. bitiş uzatma). Değişiklik yoksa 422 `stakeholder_agreement_unchanged`; birleşik değer
 * `checkAgreementTerms`'ten geçer.
 */
export function planStakeholderAgreementUpdate(
  current: StakeholderAgreementFields & { status: AgreementStatus },
  changes: StakeholderAgreementChanges,
): (keyof StakeholderAgreementChanges)[] {
  if (current.status === 'terminated')
    throw ruleError('stakeholder_agreement_terminated', 'Feshedilmiş anlaşma değiştirilemez.')
  const changed = (Object.keys(changes) as (keyof StakeholderAgreementChanges)[]).filter((key) => {
    const next = changes[key]
    return next !== undefined && JSON.stringify(next) !== JSON.stringify(current[key])
  })
  if (changed.length === 0)
    throw ruleError('stakeholder_agreement_unchanged', 'Anlaşmada değişen bir alan yok.')
  const merged = { ...current }
  for (const key of changed) Object.assign(merged, { [key]: changes[key] })
  checkAgreementTerms(merged)
  return changed
}

/** Yürürlüğe alma (K-318): yalnız taslak ve etkin paydaşla. */
export function planStakeholderAgreementActivate(
  current: { status: AgreementStatus },
  stakeholder: { isActive: boolean },
): void {
  if (current.status !== 'draft')
    throw ruleError('stakeholder_agreement_not_draft', 'Yalnız taslak anlaşma yürürlüğe alınır.')
  assertStakeholderActive(stakeholder)
}

/**
 * Fesih (K-318): yalnız yürürlükteki ve bitiş günü geçmemiş anlaşma; fesih günü başlangıç ile
 * bitiş (dahil) arasındadır. Bitiş günü değişmez, fesih günü ayrı saklanır.
 */
export function planStakeholderAgreementTerminate(
  current: { status: AgreementStatus; startDate: string; endDate: string },
  input: { terminationDate: string },
  today: string,
): void {
  if (current.status === 'draft')
    throw ruleError(
      'stakeholder_agreement_not_active',
      'Taslak anlaşma feshedilmez; gerekmiyorsa silin.',
    )
  if (current.status === 'terminated')
    throw ruleError('stakeholder_agreement_terminated', 'Anlaşma zaten feshedilmiş.')
  if (current.endDate < today)
    throw ruleError('stakeholder_agreement_ended', 'Süresi bitmiş anlaşma feshedilemez.')
  if (input.terminationDate < current.startDate || input.terminationDate > current.endDate)
    throw ruleError(
      'stakeholder_agreement_termination_date_invalid',
      'Fesih günü anlaşmanın başlangıç ve bitiş günleri arasında olmalıdır.',
      'terminationDate',
    )
}

/** Silme (arşiv): yalnız taslak anlaşma (K-318). */
export function planStakeholderAgreementArchive(current: { status: AgreementStatus }): void {
  if (current.status !== 'draft')
    throw ruleError(
      'stakeholder_agreement_not_draft',
      'Yalnız taslak anlaşma silinir; yürürlükteki anlaşma feshedilir.',
    )
}

export interface AgreementSchedule {
  status: AgreementViewStatus
  /** Bitişe kalan gün (bugün bitiyorsa 0); yalnız yürürlükteki anlaşmada. */
  daysLeft: number | null
  /** Yenileme bildirimi günü: bitiş − bildirim günü; yalnız yürürlükteki anlaşmada. */
  noticeDate: string | null
  /** Bitişe kalan gün bildirim gününe indi mi (uyarı, K-319). */
  renewalDue: boolean
}

/** Güne gün ekler (eksi de olabilir). */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Anlaşmanın bugünkü durumu (K-318, K-319): yürürlükteki anlaşmanın bitiş günü bugünden önceyse
 * "sona erdi"; değilse kalan gün bildirim gününe eşit ya da azsa uyarıdadır. Bitiş günü son
 * gündür (dahil). Hesap saklanmaz; liste süzgeci aynı sınırları SQL'de kullanır.
 */
export function agreementSchedule(
  agreement: { status: AgreementStatus; endDate: string; renewalNoticeDays: number },
  today: string,
): AgreementSchedule {
  if (agreement.status !== 'active')
    return { status: agreement.status, daysLeft: null, noticeDate: null, renewalDue: false }
  const daysLeft = daysBetween(today, agreement.endDate)
  if (daysLeft < 0) return { status: 'ended', daysLeft: null, noticeDate: null, renewalDue: false }
  return {
    status: 'active',
    daysLeft,
    noticeDate: addDays(agreement.endDate, -agreement.renewalNoticeDays),
    renewalDue: daysLeft <= agreement.renewalNoticeDays,
  }
}

/** Katkının tek satırlık özeti (liste ve CSV): nakdide tutar, ayni ve hizmette açıklama. */
export function contributionSummary(
  agreement: Pick<
    StakeholderAgreementFields,
    'contributionType' | 'contributionAmountCents' | 'contributionDescription'
  >,
  formatMoney: (cents: number) => string,
): string {
  const amount =
    agreement.contributionAmountCents === null
      ? null
      : formatMoney(agreement.contributionAmountCents)
  const label = CONTRIBUTION_TYPE_LABELS[agreement.contributionType]
  if (agreement.contributionType === 'cash') return `${label} · ${amount ?? ''}`
  return [label, agreement.contributionDescription, amount === null ? null : `tahmini ${amount}`]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')
}

// --- CSV -----------------------------------------------------------------------------------------

const csvLines = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  `${[header.map(csvCell).join(CSV_SEPARATOR), ...rows.map((row) => row.join(CSV_SEPARATOR))].join('\r\n')}\r\n`

export interface StakeholderCsvRow {
  name: string
  type: StakeholderType
  taxNumber: string | null
  tags: readonly string[]
  isActive: boolean
  activeAgreementCount: number
  renewalDueCount: number
}

/**
 * Paydaş listesinin CSV'si (`;`, formül kaçışlı). İletişim kişisi kişisel veri olduğu için
 * dosyaya girmez (K-317).
 */
export function stakeholdersCsv(rows: readonly StakeholderCsvRow[]): string {
  return csvLines(
    ['Paydaş', 'Tür', 'VKN', 'Etiketler', 'Durum', 'Yürürlükteki anlaşma', 'Yenileme uyarısı'],
    rows.map((row) => [
      csvCell(row.name),
      csvCell(STAKEHOLDER_TYPE_LABELS[row.type]),
      csvCell(row.taxNumber ?? ''),
      csvCell(row.tags.join(', ')),
      csvCell(row.isActive ? 'Etkin' : 'Pasif'),
      csvCell(row.activeAgreementCount),
      csvCell(row.renewalDueCount),
    ]),
  )
}

export interface StakeholderAgreementCsvRow {
  stakeholderName: string
  stakeholderType: StakeholderType
  subject: string
  startDate: string
  endDate: string
  renewalNoticeDays: number
  contributionType: ContributionType
  contributionAmountCents: number | null
  contributionDescription: string | null
  benefits: readonly AgreementBenefit[]
  benefitNote: string | null
  status: AgreementViewStatus
  daysLeft: number | null
  terminationDate: string | null
}

/** Anlaşma listesinin CSV'si: tutar ondalık virgüllü TL, gün `YYYY-MM-DD`. */
export function stakeholderAgreementsCsv(rows: readonly StakeholderAgreementCsvRow[]): string {
  return csvLines(
    [
      'Paydaş',
      'Paydaş türü',
      'Konu',
      'Başlangıç',
      'Bitiş',
      'Bildirim (gün)',
      'Katkı türü',
      'Tutar (TL)',
      'Katkı açıklaması',
      'Karşılık',
      'Karşılık ayrıntısı',
      'Durum',
      'Kalan gün',
      'Fesih günü',
    ],
    rows.map((row) => [
      csvCell(row.stakeholderName),
      csvCell(STAKEHOLDER_TYPE_LABELS[row.stakeholderType]),
      csvCell(row.subject),
      csvCell(row.startDate),
      csvCell(row.endDate),
      csvCell(row.renewalNoticeDays),
      csvCell(CONTRIBUTION_TYPE_LABELS[row.contributionType]),
      row.contributionAmountCents === null ? csvCell('') : csvAmount(row.contributionAmountCents),
      csvCell(row.contributionDescription ?? ''),
      csvCell(row.benefits.map((benefit) => AGREEMENT_BENEFIT_LABELS[benefit]).join(', ')),
      csvCell(row.benefitNote ?? ''),
      csvCell(AGREEMENT_VIEW_STATUS_LABELS[row.status]),
      csvCell(row.daysLeft ?? ''),
      csvCell(row.terminationDate ?? ''),
    ]),
  )
}
