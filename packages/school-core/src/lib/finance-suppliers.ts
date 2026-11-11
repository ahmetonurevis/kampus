import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isValidTckn, isValidVkn } from './finance-corporate.ts'
import { maskNationalId } from './scope.ts'
import { isValidTurkishIban } from './withdrawals.ts'

/**
 * Tedarikçi kaydı (docs/domain/finans.md DOM-FIN-070; ON-221, K23 satın alma). Tedarikçi şirket
 * (tüzel kişi, 10 haneli VKN) ya da şahıstır (gerçek kişi, 11 haneli TCKN); vergi numarası kurumda
 * tekildir, kayıt silinmez, `isActive` ile pasifleşir. Şahıs tedarikçinin TCKN'si kişisel veridir:
 * listede maskelenir, loglanmaz. Kategori sabit kümedir (K-125); belgeler ad, geçerlilik günü ve
 * nottan oluşan listedir, dosya yüklemesi yoktur (K-127). Fonksiyonlar saftır.
 */

/** Tedarikçiyi yazan rol (K-126); muhasebe rolü açılınca listeye girer. */
export const SUPPLIER_WRITE_ROLES = ['yonetici'] as const
/** Tedarikçi listesini okuyan roller: ön büro satın alma talebinde tedarikçi önerir (K-126). */
export const SUPPLIER_READ_ROLES = ['yonetici', 'onburo'] as const

export const SUPPLIER_TYPES = ['company', 'individual'] as const
export type SupplierType = (typeof SUPPLIER_TYPES)[number]
export const SUPPLIER_TYPE_LABELS = {
  company: 'Şirket',
  individual: 'Şahıs',
} as const satisfies Record<SupplierType, string>

/** Kurumun satın alma kategorileri (K-125); bir tedarikçi birden çok kategoride olabilir. */
export const SUPPLIER_CATEGORIES = [
  'stationery',
  'cleaning',
  'food',
  'it',
  'maintenance',
  'furniture',
  'educational',
  'services',
  'transport',
  'other',
] as const
export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number]
export const SUPPLIER_CATEGORY_LABELS = {
  stationery: 'Kırtasiye',
  cleaning: 'Temizlik',
  food: 'Gıda ve yemek',
  it: 'Bilişim',
  maintenance: 'Bakım ve onarım',
  furniture: 'Mobilya ve demirbaş',
  educational: 'Eğitim materyali',
  services: 'Hizmet',
  transport: 'Taşıma',
  other: 'Diğer',
} as const satisfies Record<SupplierCategory, string>

export const SUPPLIER_NAME_MAX = 200
export const SUPPLIER_TAX_OFFICE_MAX = 100
export const SUPPLIER_ADDRESS_MAX = 500
export const SUPPLIER_DOCUMENTS_MAX = 20
export const SUPPLIER_DOCUMENT_NAME_MAX = 120
export const SUPPLIER_DOCUMENT_NOTE_MAX = 300
/** Geçerliliği bu kadar gün içinde bitecek belge "süresi yaklaşıyor" sayılır (K-127). */
export const SUPPLIER_DOCUMENT_WARNING_DAYS = 30

const TAX_NUMBER_LENGTH = { company: 10, individual: 11 } as const satisfies Record<
  SupplierType,
  number
>

/** Tedarikçi türüne göre vergi numarası: şirkette VKN, şahısta TCKN; kontrol haneleri denetlenir. */
export function isValidSupplierTaxNumber(type: SupplierType, value: string): boolean {
  if (value.length !== TAX_NUMBER_LENGTH[type]) return false
  return type === 'company' ? isValidVkn(value) : isValidTckn(value)
}

function taxNumberIssue(type: SupplierType, value: string): string | null {
  if (value.length !== TAX_NUMBER_LENGTH[type])
    return type === 'company'
      ? 'Şirket tedarikçide 10 haneli vergi kimlik numarası (VKN) girin.'
      : 'Şahıs tedarikçide 11 haneli T.C. kimlik numarası girin.'
  if (!isValidSupplierTaxNumber(type, value))
    return type === 'company'
      ? 'Vergi kimlik numarası geçersiz; hanelerini kontrol edin.'
      : 'T.C. kimlik numarası geçersiz; hanelerini kontrol edin.'
  return null
}

// --- Şemalar -------------------------------------------------------------------------------------

const nameSchema = z
  .string('Tedarikçi unvanını yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(SUPPLIER_NAME_MAX, `En fazla ${String(SUPPLIER_NAME_MAX)} karakter girebilirsiniz.`)
const typeSchema = z.enum(SUPPLIER_TYPES, 'Tedarikçi türünü seçin.')
const taxNumberSchema = z
  .string('Vergi numarasını yazın.')
  .trim()
  .regex(/^\d{10,11}$/, 'Vergi numarası 10 haneli VKN ya da 11 haneli TCKN olmalıdır.')
const taxOfficeSchema = z
  .string('Vergi dairesini yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(
    SUPPLIER_TAX_OFFICE_MAX,
    `En fazla ${String(SUPPLIER_TAX_OFFICE_MAX)} karakter girebilirsiniz.`,
  )
const categoriesSchema = z
  .array(z.enum(SUPPLIER_CATEGORIES, 'Kategori geçersiz.'), 'Kategori seçin.')
  .min(1, 'En az bir kategori seçin.')
  .max(SUPPLIER_CATEGORIES.length)
  // Sıra sabit kümenin sırasıdır; yinelenen seçim tek kategori sayılır.
  .transform((values) => SUPPLIER_CATEGORIES.filter((category) => values.includes(category)))
const contactNameSchema = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(120, 'En fazla 120 karakter girebilirsiniz.')
  .nullable()
const contactPhoneSchema = z
  .string()
  .trim()
  .regex(/^0\d{10}$/, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.')
  .nullable()
const contactEmailSchema = z.email('Geçerli bir e-posta adresi girin.').max(254).nullable()
const addressSchema = z
  .string()
  .trim()
  .min(10, 'Adresi en az 10 karakterle yazın.')
  .max(SUPPLIER_ADDRESS_MAX, `En fazla ${String(SUPPLIER_ADDRESS_MAX)} karakter girebilirsiniz.`)
  .nullable()
const ibanSchema = z
  .string('IBAN yazın.')
  .transform((value) => value.replace(/\s/g, '').toUpperCase())
  .refine(isValidTurkishIban, 'Geçerli bir TR IBAN girin (TR ile başlayan 26 karakter).')
  .nullable()

/** Belge listesi satırı (K-127): dosya değil, kurumun tuttuğu belgenin adı ve geçerlilik günü. */
export const supplierDocumentSchema = z.strictObject({
  name: z
    .string('Belge adını yazın.')
    .trim()
    .min(2, 'En az 2 karakter girin.')
    .max(
      SUPPLIER_DOCUMENT_NAME_MAX,
      `En fazla ${String(SUPPLIER_DOCUMENT_NAME_MAX)} karakter girebilirsiniz.`,
    ),
  expiryDate: daySchema.nullable().default(null).describe('Son geçerlilik günü; süresizse boş'),
  note: z
    .string()
    .trim()
    .max(
      SUPPLIER_DOCUMENT_NOTE_MAX,
      `En fazla ${String(SUPPLIER_DOCUMENT_NOTE_MAX)} karakter girebilirsiniz.`,
    )
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
})
export type SupplierDocument = z.output<typeof supplierDocumentSchema>

const documentsSchema = z
  .array(supplierDocumentSchema)
  .max(SUPPLIER_DOCUMENTS_MAX, `En fazla ${String(SUPPLIER_DOCUMENTS_MAX)} belge eklenebilir.`)

const checkTaxNumber = (
  value: { type?: SupplierType | undefined; taxNumber?: string | undefined },
  context: z.RefinementCtx,
) => {
  if (value.type === undefined || value.taxNumber === undefined) return
  const issue = taxNumberIssue(value.type, value.taxNumber)
  if (issue) context.addIssue({ code: 'custom', path: ['taxNumber'], message: issue })
}

/** Yeni tedarikçi (DOM-FIN-070). İletişim, adres ve IBAN isteğe bağlıdır; boşsa `null`. */
export const supplierSchema = z
  .strictObject({
    name: nameSchema,
    type: typeSchema,
    // kvkk: K (şahıs tedarikçide TCKN; listede maskeli, loglanmaz)
    taxNumber: taxNumberSchema,
    taxOffice: taxOfficeSchema,
    categories: categoriesSchema,
    // kvkk: K
    contactName: contactNameSchema.default(null),
    // kvkk: K
    contactPhone: contactPhoneSchema.default(null),
    // kvkk: K
    contactEmail: contactEmailSchema.default(null),
    // kvkk: K (şahıs tedarikçide ev ya da iş adresi)
    address: addressSchema.default(null),
    // kvkk: K (şahıs tedarikçide kişisel hesap; listede maskeli)
    iban: ibanSchema.default(null),
    documents: documentsSchema.default([]),
  })
  .superRefine(checkTaxNumber)
export type SupplierInput = z.input<typeof supplierSchema>
export type SupplierFields = z.output<typeof supplierSchema>

/**
 * Kısmi düzeltme. Tür ve vergi numarası birlikte gönderilir: vergi numarasının biçimi türe bağlıdır.
 * `isActive: false` pasifleştirir, `true` yeniden etkinleştirir. Belge listesi bütün olarak yazılır.
 */
export const updateSupplierSchema = z
  .strictObject({
    name: nameSchema.optional(),
    type: typeSchema.optional(),
    taxNumber: taxNumberSchema.optional(),
    taxOffice: taxOfficeSchema.optional(),
    categories: categoriesSchema.optional(),
    contactName: contactNameSchema.optional(),
    contactPhone: contactPhoneSchema.optional(),
    contactEmail: contactEmailSchema.optional(),
    address: addressSchema.optional(),
    iban: ibanSchema.optional(),
    documents: documentsSchema.optional(),
    isActive: z.boolean('Etkinlik durumu açık ya da kapalı olmalıdır.').optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
  .superRefine((value, context) => {
    if ((value.type === undefined) !== (value.taxNumber === undefined))
      context.addIssue({
        code: 'custom',
        path: [value.type === undefined ? 'type' : 'taxNumber'],
        message: 'Tedarikçi türü ve vergi numarası birlikte değiştirilir.',
      })
    checkTaxNumber(value, context)
  })
export type UpdateSupplierInput = z.input<typeof updateSupplierSchema>
export type SupplierChanges = z.output<typeof updateSupplierSchema>

// --- Kurallar ------------------------------------------------------------------------------------

/** Vergi numarası kurumun bütün tedarikçileri (pasifler dahil) arasında tekildir. */
export function assertSupplierTaxNumberFree(taken: boolean): void {
  if (taken)
    throw new DomainError(
      'supplier_tax_number_exists',
      'Bu vergi numarasıyla kayıtlı bir tedarikçi var.',
      { kind: 'conflict', path: ['taxNumber'] },
    )
}

/**
 * Listede gösterilen vergi numarası: şahıs tedarikçinin TCKN'si son dört hane dışında maskelenir
 * (guvenlik-kvkk.md §8); şirket VKN'si kişisel veri değildir, açık döner.
 */
export function maskSupplierTaxNumber(type: SupplierType, taxNumber: string): string {
  return type === 'individual' ? maskNationalId(taxNumber) : taxNumber
}

/** Listede gösterilen IBAN: ülke kodu ve son dört hane (`TR**********************1326`). */
export function maskIban(iban: string): string {
  return `${iban.slice(0, 2)}${'*'.repeat(Math.max(iban.length - 6, 0))}${iban.slice(-4)}`
}

export type SupplierDocumentStatus = 'valid' | 'expiring' | 'expired' | 'open-ended'

/** Belgenin bugüne (Europe/Istanbul günü) göre durumu; son gün dahil geçerlidir. */
export function supplierDocumentStatus(
  document: Pick<SupplierDocument, 'expiryDate'>,
  today: string,
): SupplierDocumentStatus {
  if (document.expiryDate === null) return 'open-ended'
  if (document.expiryDate < today) return 'expired'
  const warning = new Date(`${today}T00:00:00Z`)
  warning.setUTCDate(warning.getUTCDate() + SUPPLIER_DOCUMENT_WARNING_DAYS)
  return document.expiryDate <= warning.toISOString().slice(0, 10) ? 'expiring' : 'valid'
}

/** Süresi geçmiş ve yaklaşan belge sayısı (listede uyarı). */
export function supplierDocumentAlerts(
  documents: readonly Pick<SupplierDocument, 'expiryDate'>[],
  today: string,
): { expired: number; expiring: number } {
  let expired = 0
  let expiring = 0
  for (const document of documents) {
    const status = supplierDocumentStatus(document, today)
    if (status === 'expired') expired += 1
    else if (status === 'expiring') expiring += 1
  }
  return { expired, expiring }
}
