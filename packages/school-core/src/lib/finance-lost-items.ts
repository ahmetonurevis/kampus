import { z } from 'zod'

import type { FilePurpose } from '../content/taxonomy.ts'
import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { addDays } from './finance-opening-watch.ts'
import { STAFF_ROLES } from './staff-accounts.ts'

/**
 * Kayıp eşya (docs/domain/finans.md DOM-FIN-145; ON-171). Ön büro bulunan eşyayı kaydeder: tanım,
 * kategori, bulunduğu yer ve gün, isteğe bağlı bulan personel (kurum üyeliği), saklama yeri ve en
 * çok üç fotoğraf (platform dosya altyapısı) (K-490). Veli çocuğu için, öğrenci kendisi için
 * "kaybettim" bildirimi açar; ön büro bildirimi bulunan eşyayla eşler (K-491). Teslimde teslim alan
 * öğrenci, öğrencinin kısıtsız velisi ya da adıyla başka biri ve teslim eden üyelik kaydedilir;
 * teslim edilen eşya bir daha değişmez (K-490).
 *
 * Saklama (K-492): eşya bulunduğu günden kurum ayarlı süre (gün; varsayılan 30) saklanır. Süresi
 * dolanlar listelenir; yönetici seçtiklerini gerekçeyle toplu "bağışlandı" ya da "imha edildi"
 * kapatır, fotoğrafları imhaya işaretlenir. Periyodik iş yoktur. Fonksiyonlar saftır; gün `today`
 * (Europe/Istanbul) ile gelir.
 */

/** Bulunan eşya, eşleme, teslim ve ayar okuma: yönetici ve ön büro (K-490). */
export const FINANCE_LOST_ITEM_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Ayar yazma, saklama listesi ve toplu bağış/imha: yalnız yönetici (K-492). */
export const FINANCE_LOST_ITEM_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Kayıp bildirimi ve bekleyen eşya galerisi: veli ve öğrenci (K-491). */
export const LOST_ITEM_FAMILY_ROLES = ['veli', 'ogrenci'] as const satisfies readonly Role[]
/** Bildirim listesi ve kapatma: personel ve aile (aile yalnız kendi kapsamını görür). */
export const LOST_ITEM_REPORT_READ_ROLES = [
  ...FINANCE_LOST_ITEM_ROLES,
  ...LOST_ITEM_FAMILY_ROLES,
] as const satisfies readonly Role[]

/**
 * Fotoğrafın dosya amacı (K-490). Platformda kurum personelinin yüklediği görsel amacı henüz
 * yoktur; geçiş süresince jpg/png/webp kabul eden `question_image` (2 MB) kullanılır. Platform
 * `lost_item_photo` amacını (yönetici ve ön büro, jpg/png/webp) açınca yalnız bu sabit ve
 * `LOST_ITEM_PHOTO_UPLOAD_ROLES` değişir.
 */
export const LOST_ITEM_PHOTO_PURPOSE = 'question_image' as const satisfies FilePurpose
/** Fotoğrafı yükleyebilen roller: amacın yükleyicileriyle aynı (geçişte yalnız yönetici). */
export const LOST_ITEM_PHOTO_UPLOAD_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const LOST_ITEM_CATEGORIES = [
  'clothing',
  'electronics',
  'stationery',
  'valuable',
  'other',
] as const
export type LostItemCategory = (typeof LOST_ITEM_CATEGORIES)[number]
export const LOST_ITEM_CATEGORY_LABELS = {
  clothing: 'Giysi',
  electronics: 'Elektronik',
  stationery: 'Kırtasiye',
  valuable: 'Değerli eşya',
  other: 'Diğer',
} as const satisfies Record<LostItemCategory, string>

export const LOST_ITEM_STATUSES = ['pending', 'handed_over', 'donated', 'destroyed'] as const
export type LostItemStatus = (typeof LOST_ITEM_STATUSES)[number]
export const LOST_ITEM_STATUS_LABELS = {
  pending: 'Bekliyor',
  handed_over: 'Teslim edildi',
  donated: 'Bağışlandı',
  destroyed: 'İmha edildi',
} as const satisfies Record<LostItemStatus, string>

/** Saklama süresi dolan eşyanın kapanışı (K-492). */
export const LOST_ITEM_DISPOSAL_OUTCOMES = ['donated', 'destroyed'] as const
export type LostItemDisposalOutcome = (typeof LOST_ITEM_DISPOSAL_OUTCOMES)[number]

/** Teslim alan: öğrencinin kendisi, öğrencinin velisi (aile bağı) ya da adıyla başka biri. */
export const LOST_ITEM_RECIPIENT_TYPES = ['student', 'guardian', 'other'] as const
export type LostItemRecipientType = (typeof LOST_ITEM_RECIPIENT_TYPES)[number]
export const LOST_ITEM_RECIPIENT_TYPE_LABELS = {
  student: 'Öğrenci',
  guardian: 'Veli',
  other: 'Başka kişi',
} as const satisfies Record<LostItemRecipientType, string>

export const LOST_REPORT_STATUSES = ['open', 'matched', 'returned', 'closed'] as const
export type LostReportStatus = (typeof LOST_REPORT_STATUSES)[number]
export const LOST_REPORT_STATUS_LABELS = {
  open: 'Aranıyor',
  matched: 'Bulundu, teslim bekliyor',
  returned: 'Teslim edildi',
  closed: 'Kapatıldı',
} as const satisfies Record<LostReportStatus, string>

export const LOST_ITEM_DESCRIPTION_MAX = 300
export const LOST_ITEM_LOCATION_MAX = 120
export const LOST_ITEM_RECIPIENT_NAME_MAX = 120
export const LOST_ITEM_DISPOSAL_REASON_MAX = 300
export const LOST_ITEM_PHOTO_MAX = 3
export const LOST_ITEM_DISPOSAL_BATCH_MAX = 100
export const LOST_ITEM_RETENTION_DEFAULT_DAYS = 30
export const LOST_ITEM_RETENTION_MIN_DAYS = 7
export const LOST_ITEM_RETENTION_MAX_DAYS = 365
/** Bulunma ve kaybolma günü en çok bu kadar geriye yazılır. */
export const LOST_ITEM_BACKDATE_DAYS = 90
/** Teslim edilen eşyanın fotoğrafı teslimden bu kadar gün sonra imhaya işaretlenir (K-492). */
export const LOST_ITEM_HANDOVER_PHOTO_DAYS = 30

// --- Şemalar -------------------------------------------------------------------------------------

const requiredText = (min: number, max: number, label: string) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(min, min === 1 ? `${label} yazın.` : `${label} en az ${String(min)} karakter olmalı.`)
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)

const day = (message: string) =>
  z.string(message).pipe(daySchema).describe('Gün (YYYY-MM-DD, Europe/Istanbul)')

const membershipRef = (message: string) =>
  z.string(message).trim().min(1, message).nullable().default(null)

const photoIdsSchema = z
  .array(z.uuid('Fotoğraf geçersiz.'), 'Fotoğrafları seçin.')
  .max(LOST_ITEM_PHOTO_MAX, `Eşyaya en çok ${String(LOST_ITEM_PHOTO_MAX)} fotoğraf eklenir.`)
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı fotoğraf iki kez seçilmiş.')

const itemFields = {
  // kvkk: K (serbest metin; eşyada ad yazılı olabilir)
  description: requiredText(2, LOST_ITEM_DESCRIPTION_MAX, 'Eşyanın tanımı').describe(
    'Eşyanın tanımı (2–300); aile galerisinde gösterilmez',
  ),
  category: z
    .enum(LOST_ITEM_CATEGORIES, 'Kategoriyi seçin.')
    .describe(
      '`clothing` giysi, `electronics` elektronik, `stationery` kırtasiye, `valuable` değerli eşya, `other` diğer',
    ),
  foundLocation: requiredText(1, LOST_ITEM_LOCATION_MAX, 'Bulunduğu yeri').describe(
    'Bulunduğu yer (≤ 120)',
  ),
  foundOn: day('Bulunduğu günü seçin.'),
  storageLocation: requiredText(1, LOST_ITEM_LOCATION_MAX, 'Saklama yerini').describe(
    'Saklandığı yer (≤ 120; ör. ön büro dolabı)',
  ),
}

export const lostItemCreateSchema = z.strictObject({
  ...itemFields,
  // kvkk: K (bulan personelin üyeliği)
  finderMembershipId: membershipRef('Bulan kişiyi seçin.').describe(
    'Bulan ya da eşyayı teslim alan personelin kurum üyeliği (isteğe bağlı; etkin personel)',
  ),
  photoFileIds: photoIdsSchema
    .default([])
    .describe('Fotoğraflar (0–3; önce `POST /files` ile yüklenmiş, `ready` dosya kimlikleri)'),
})
export type LostItemCreateInput = z.input<typeof lostItemCreateSchema>
export type LostItemCreateFields = z.output<typeof lostItemCreateSchema>

export const lostItemUpdateSchema = z
  .strictObject({
    description: itemFields.description.optional(),
    category: itemFields.category.optional(),
    foundLocation: itemFields.foundLocation.optional(),
    foundOn: itemFields.foundOn.optional(),
    storageLocation: itemFields.storageLocation.optional(),
    finderMembershipId: z
      .string('Bulan kişiyi seçin.')
      .trim()
      .min(1, 'Bulan kişiyi seçin.')
      .nullable()
      .optional()
      .describe('Bulan personel; `null` kaldırır'),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((field) => field === undefined))
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type LostItemUpdateFields = z.output<typeof lostItemUpdateSchema>

export const lostItemPhotoSchema = z.strictObject({
  fileId: z.uuid('Fotoğraf geçersiz.').describe('Yüklenmiş (`ready`) fotoğraf dosyası'),
})
export type LostItemPhotoFields = z.output<typeof lostItemPhotoSchema>

export const lostItemHandoverSchema = z
  .strictObject({
    recipientType: z
      .enum(LOST_ITEM_RECIPIENT_TYPES, 'Teslim alanı seçin.')
      .describe('`student` öğrenci, `guardian` öğrencinin velisi, `other` adıyla başka kişi'),
    studentId: z
      .string('Öğrenciyi seçin.')
      .trim()
      .min(1, 'Öğrenciyi seçin.')
      .nullable()
      .default(null)
      .describe('Eşyanın sahibi öğrenci (`student` ve `guardian` için zorunlu)'),
    guardianLinkId: z
      .string('Veliyi seçin.')
      .trim()
      .min(1, 'Veliyi seçin.')
      .nullable()
      .default(null)
      .describe('Öğrencinin veli bağı (`GET /finance/lost-item-recipients`; yalnız `guardian`)'),
    // kvkk: K (teslim alanın adı)
    recipientName: z
      .string('Teslim alanın adını yazın.')
      .trim()
      .max(
        LOST_ITEM_RECIPIENT_NAME_MAX,
        `Ad en çok ${String(LOST_ITEM_RECIPIENT_NAME_MAX)} karakter olabilir.`,
      )
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .default(null)
      .describe('Teslim alanın adı (yalnız `other`, 2–120)'),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })
    if (value.recipientType !== 'other' && value.studentId === null)
      issue('studentId', 'Öğrenciyi seçin.')
    if (value.recipientType === 'other' && value.studentId !== null)
      issue('studentId', 'Başka kişiye teslimde öğrenci seçilmez.')
    if (value.recipientType === 'guardian' && value.guardianLinkId === null)
      issue('guardianLinkId', 'Veliyi seçin.')
    if (value.recipientType !== 'guardian' && value.guardianLinkId !== null)
      issue('guardianLinkId', 'Veli yalnız veliye teslimde seçilir.')
    if (value.recipientType === 'other' && (value.recipientName ?? '').length < 2)
      issue('recipientName', 'Teslim alanın adını yazın (en az 2 karakter).')
    if (value.recipientType !== 'other' && value.recipientName !== null)
      issue('recipientName', 'Ad yalnız başka kişiye teslimde yazılır.')
  })
export type LostItemHandoverFields = z.output<typeof lostItemHandoverSchema>

export const lostItemDisposalSchema = z.strictObject({
  itemIds: z
    .array(z.uuid('Eşya kaydı geçersiz.'), 'Eşyaları seçin.')
    .min(1, 'En az bir eşya seçin.')
    .max(
      LOST_ITEM_DISPOSAL_BATCH_MAX,
      `Tek seferde en çok ${String(LOST_ITEM_DISPOSAL_BATCH_MAX)} eşya kapatılır.`,
    )
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı eşya iki kez seçilmiş.')
    .describe('Kapatılacak eşyalar (1–100)'),
  outcome: z
    .enum(LOST_ITEM_DISPOSAL_OUTCOMES, 'Bağış ya da imha seçin.')
    .describe('`donated` bağışlandı, `destroyed` imha edildi'),
  // kvkk: K (serbest metin)
  reason: requiredText(2, LOST_ITEM_DISPOSAL_REASON_MAX, 'Gerekçeyi').describe(
    'Gerekçe (2–300; ör. bağış yapılan kurum); denetime ve loga yazılmaz',
  ),
})
export type LostItemDisposalFields = z.output<typeof lostItemDisposalSchema>

export const lostItemSettingsSchema = z
  .strictObject({
    retentionDays: z
      .number('Saklama süresini gün olarak girin.')
      .int('Süre tam gün olmalı.')
      .min(
        LOST_ITEM_RETENTION_MIN_DAYS,
        `Süre en az ${String(LOST_ITEM_RETENTION_MIN_DAYS)} gün olmalı.`,
      )
      .max(
        LOST_ITEM_RETENTION_MAX_DAYS,
        `Süre en çok ${String(LOST_ITEM_RETENTION_MAX_DAYS)} gün olabilir.`,
      )
      .optional()
      .describe('Saklama süresi (gün, 7–365; varsayılan 30)'),
    familyGalleryEnabled: z
      .boolean('Aile galerisini açın ya da kapatın.')
      .optional()
      .describe(
        'Veli ve öğrenci bekleyen eşyaların kategori ve fotoğrafını görür (varsayılan açık)',
      ),
  })
  .superRefine((value, context) => {
    if (value.retentionDays === undefined && value.familyGalleryEnabled === undefined)
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type LostItemSettingsFields = z.output<typeof lostItemSettingsSchema>

export interface LostItemSettings {
  retentionDays: number
  familyGalleryEnabled: boolean
}
export const DEFAULT_LOST_ITEM_SETTINGS: LostItemSettings = {
  retentionDays: LOST_ITEM_RETENTION_DEFAULT_DAYS,
  familyGalleryEnabled: true,
}

export const lostReportCreateSchema = z.strictObject({
  studentId: z
    .string('Öğrenciyi seçin.')
    .trim()
    .min(1, 'Öğrenciyi seçin.')
    .describe('Eşyası kaybolan öğrenci: veli kendi çocuğu, öğrenci kendisi'),
  // kvkk: K (serbest metin)
  description: requiredText(2, LOST_ITEM_DESCRIPTION_MAX, 'Kaybolan eşyanın tanımı').describe(
    'Eşyanın tanımı (2–300)',
  ),
  category: z
    .enum(LOST_ITEM_CATEGORIES, 'Kategoriyi seçin.')
    .nullable()
    .default(null)
    .describe('Kategori (isteğe bağlı)'),
  lostOn: day('Kaybolduğu günü seçin.'),
})
export type LostReportCreateFields = z.output<typeof lostReportCreateSchema>

export const lostReportMatchSchema = z.strictObject({
  itemId: z.uuid('Eşya kaydı geçersiz.').describe('Eşlenecek bekleyen eşya'),
})
export type LostReportMatchFields = z.output<typeof lostReportMatchSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })

/** Bulunan eşyanın saklama süresinin dolduğu gün: bulunma günü + süre (K-492). */
export const lostItemRetentionDueOn = (foundOn: string, retentionDays: number) =>
  addDays(foundOn, retentionDays)

function assertPastDay(
  value: string,
  today: string,
  codes: { future: string; old: string },
  path: string,
  label: string,
) {
  if (value > today) throw ruleError(codes.future, `${label} bugünden sonra olamaz.`, [path])
  if (value < addDays(today, -LOST_ITEM_BACKDATE_DAYS))
    throw ruleError(
      codes.old,
      `${label} en çok ${String(LOST_ITEM_BACKDATE_DAYS)} gün geriye yazılır.`,
      [path],
    )
}

const FOUND_DAY = { future: 'lost_item_found_future', old: 'lost_item_found_too_old' }

/** Bulan kişi seçildiyse kurumun etkin personeli olmalı. */
function assertFinder(
  finderMembershipId: string | null | undefined,
  finder: { role: string; active: boolean } | null | undefined,
) {
  if (finderMembershipId === null || finderMembershipId === undefined) return
  if (finder === null || finder === undefined)
    throw ruleError('lost_item_finder_not_found', 'Bulan kişi bulunamadı.', ['finderMembershipId'])
  if (!(STAFF_ROLES as readonly string[]).includes(finder.role))
    throw ruleError('lost_item_finder_not_staff', 'Bulan kişi kurum personeli olmalı.', [
      'finderMembershipId',
    ])
  if (!finder.active)
    throw ruleError('lost_item_finder_inactive', 'Bulan kişinin hesabı pasif.', [
      'finderMembershipId',
    ])
}

export interface LostItemRecordChecks {
  today: string
  /** Bulan üyelik: seçilmediyse `undefined`, kurumda yoksa `null`. */
  finder: { role: string; active: boolean } | null | undefined
}

/**
 * Bulunan eşya kaydı (K-490): bulunma günü bugünden sonra ve 90 günden eski olamaz; bulan kişi
 * kurumun etkin personeli olmalı. Fotoğrafların bağlanabilirliğini dosya altyapısı denetler.
 */
export function planLostItemRecord(
  input: Pick<LostItemCreateFields, 'foundOn' | 'finderMembershipId'>,
  checks: LostItemRecordChecks,
): void {
  assertPastDay(input.foundOn, checks.today, FOUND_DAY, 'foundOn', 'Bulunduğu gün')
  assertFinder(input.finderMembershipId, checks.finder)
}

export interface StoredLostItemState {
  status: LostItemStatus
  description: string
  category: LostItemCategory
  foundLocation: string
  foundOn: string
  storageLocation: string
  finderMembershipId: string | null
}

/** Teslim edilen, bağışlanan ya da imha edilen eşya değişmez (K-490). */
export function assertLostItemOpen(current: Pick<StoredLostItemState, 'status'>): void {
  if (current.status !== 'pending')
    throw ruleError(
      'lost_item_closed',
      `Eşya ${LOST_ITEM_STATUS_LABELS[current.status].toLocaleLowerCase('tr')}; kayıt değiştirilemez.`,
    )
}

const UPDATABLE = [
  'description',
  'category',
  'foundLocation',
  'foundOn',
  'storageLocation',
  'finderMembershipId',
] as const satisfies readonly (keyof StoredLostItemState)[]
type Updatable = (typeof UPDATABLE)[number]

/**
 * Düzeltme (K-490): yalnız bekleyen eşyada; gönderilmeyen alan korunur, değişiklik yoksa 422.
 * Değişen alanlar ve yeni değerler döner.
 */
export function planLostItemUpdate(
  current: StoredLostItemState,
  input: LostItemUpdateFields,
  checks: LostItemRecordChecks,
): { changed: Updatable[]; next: Pick<StoredLostItemState, Updatable> } {
  assertLostItemOpen(current)
  const next = {
    description: input.description ?? current.description,
    category: input.category ?? current.category,
    foundLocation: input.foundLocation ?? current.foundLocation,
    foundOn: input.foundOn ?? current.foundOn,
    storageLocation: input.storageLocation ?? current.storageLocation,
    finderMembershipId:
      input.finderMembershipId === undefined
        ? current.finderMembershipId
        : input.finderMembershipId,
  }
  const changed = UPDATABLE.filter((field) => next[field] !== current[field])
  if (changed.length === 0) throw ruleError('lost_item_unchanged', 'Kayıtta değişiklik yok.')
  if (changed.includes('foundOn'))
    assertPastDay(next.foundOn, checks.today, FOUND_DAY, 'foundOn', 'Bulunduğu gün')
  if (changed.includes('finderMembershipId')) assertFinder(next.finderMembershipId, checks.finder)
  return { changed, next }
}

/** Fotoğraf ekleme (K-490): bekleyen eşyada, en çok üç fotoğraf. */
export function planLostItemPhotoAdd(
  current: Pick<StoredLostItemState, 'status'>,
  photoCount: number,
): void {
  assertLostItemOpen(current)
  if (photoCount >= LOST_ITEM_PHOTO_MAX)
    throw ruleError(
      'lost_item_photo_limit',
      `Eşyaya en çok ${String(LOST_ITEM_PHOTO_MAX)} fotoğraf eklenir.`,
      ['fileId'],
    )
}

export interface LostItemHandoverChecks {
  /** Öğrenci kurumda var mı; teslim alan başka kişiyse `undefined`. */
  studentExists: boolean | undefined
  /** Veli bağı: veliye teslimde öğrencinin etkin bağı (yoksa `null`); diğerlerinde `undefined`. */
  guardian: { contactRestricted: boolean } | null | undefined
}

/**
 * Teslim (K-490): eşya bekliyor olmalı; öğrenci kurumun öğrencisi, veli o öğrencinin etkin ve
 * iletişim kısıtı olmayan velisi olmalı. Kısıtlı veliye teslim yapılmaz (DOM-ILT-072).
 */
export function planLostItemHandover(
  current: Pick<StoredLostItemState, 'status'>,
  input: LostItemHandoverFields,
  checks: LostItemHandoverChecks,
): void {
  assertLostItemOpen(current)
  if (input.recipientType !== 'other' && checks.studentExists !== true)
    throw ruleError('lost_item_student_not_found', 'Öğrenci bulunamadı.', ['studentId'])
  if (input.recipientType === 'guardian') {
    if (checks.guardian === null || checks.guardian === undefined)
      throw ruleError('lost_item_guardian_not_found', 'Bu veli öğrenciye bağlı değil.', [
        'guardianLinkId',
      ])
    if (checks.guardian.contactRestricted)
      throw ruleError(
        'lost_item_guardian_restricted',
        'Bu veliye öğrenci adına teslim yapılamaz; öğrenciye ya da başka bir veliye teslim edin.',
        ['guardianLinkId'],
      )
  }
}

export interface LostItemDisposalTarget {
  id: string
  status: LostItemStatus
  foundOn: string
  /** Eşya bir kayıp bildirimiyle eşlenmiş ve teslim bekliyor. */
  matched: boolean
}

/**
 * Toplu bağış/imha kuralı (K-492): her eşya kurumda, bekliyor, eşlenmemiş ve saklama süresi
 * dolmuş olmalı. Hata yolu eşyanın dizideki sırasıdır; biri reddedilirse hiçbiri değişmez.
 */
export function assertLostItemDisposal(
  input: Pick<LostItemDisposalFields, 'itemIds'>,
  found: ReadonlyMap<string, LostItemDisposalTarget>,
  checks: { retentionDays: number; today: string },
): void {
  for (const [index, id] of input.itemIds.entries()) {
    const path = ['itemIds', String(index)]
    const target = found.get(id)
    if (target === undefined) throw ruleError('lost_item_not_found', 'Eşya bulunamadı.', path)
    if (target.status !== 'pending')
      throw ruleError('lost_item_closed', 'Eşya zaten kapatılmış.', path)
    if (target.matched)
      throw ruleError(
        'lost_item_matched',
        'Eşya bir kayıp bildirimiyle eşlenmiş; sahibine teslim edin ya da eşlemeyi kaldırın.',
        path,
      )
    if (lostItemRetentionDueOn(target.foundOn, checks.retentionDays) > checks.today)
      throw ruleError('lost_item_retention_not_due', 'Eşyanın saklama süresi dolmadı.', path)
  }
}

/** Ayar (K-491, K-492): gönderilmeyen alan korunur; değişiklik yoksa 422. */
export function planLostItemSettings(
  current: LostItemSettings,
  input: LostItemSettingsFields,
): { next: LostItemSettings; changed: string[] } {
  const next: LostItemSettings = {
    retentionDays: input.retentionDays ?? current.retentionDays,
    familyGalleryEnabled: input.familyGalleryEnabled ?? current.familyGalleryEnabled,
  }
  const changed = [
    ...(next.retentionDays === current.retentionDays ? [] : ['retentionDays']),
    ...(next.familyGalleryEnabled === current.familyGalleryEnabled ? [] : ['familyGalleryEnabled']),
  ]
  if (changed.length === 0)
    throw ruleError('lost_item_settings_unchanged', 'Ayarda değişiklik yok.')
  return { next, changed }
}

// --- Kayıp bildirimi -----------------------------------------------------------------------------

const LOST_DAY = { future: 'lost_report_future', old: 'lost_report_too_old' }

/** Bildirim (K-491): kaybolma günü bugünden sonra ve 90 günden eski olamaz. */
export function planLostReport(input: Pick<LostReportCreateFields, 'lostOn'>, today: string) {
  assertPastDay(input.lostOn, today, LOST_DAY, 'lostOn', 'Kaybolduğu gün')
}

export interface StoredLostReportState {
  status: LostReportStatus
  matchedItemId: string | null
}

/**
 * Eşleme (K-491): bildirim açık, eşya bekliyor olmalı; eşya başka bildirimle eşlenmişse 409.
 * Eşleme eşyayı teslim etmez; teslim ayrı kayıttır.
 */
export function planLostReportMatch(
  report: StoredLostReportState,
  item: { status: LostItemStatus; matchedReportId: string | null },
): void {
  if (report.status !== 'open')
    throw ruleError('lost_report_not_open', 'Bildirim açık değil; yalnız aranan eşya eşlenir.')
  assertLostItemOpen(item)
  if (item.matchedReportId !== null)
    throw new DomainError(
      'lost_item_already_matched',
      'Bu eşya başka bir bildirimle eşlenmiş; önce o eşlemeyi kaldırın.',
      { kind: 'conflict', path: ['itemId'] },
    )
}

/** Eşlemeyi kaldırma: yalnız eşlenmiş (teslim edilmemiş) bildirimde; bildirim yeniden açılır. */
export function planLostReportUnmatch(report: StoredLostReportState): void {
  if (report.status !== 'matched')
    throw ruleError('lost_report_not_matched', 'Bildirim bir eşyayla eşlenmemiş.')
}

/**
 * Kapatma (K-491): açık ya da eşlenmiş bildirim kapatılır (veli eşyayı buldu, ön büro bulunamadı
 * dedi); eşleme varsa kalkar. Teslim edilmiş ya da kapalı bildirim 422.
 */
export function planLostReportClose(report: StoredLostReportState): void {
  if (report.status !== 'open' && report.status !== 'matched')
    throw ruleError('lost_report_not_open', 'Bildirim zaten kapanmış.')
}
