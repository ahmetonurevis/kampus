import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { PAYROLL_REASON_MAX, PAYROLL_REASON_MIN } from './finance-payroll-periods.ts'

/**
 * Ek ders çizelgesi onayı (docs/domain/finans.md DOM-FIN-120; ON-196). Ay için elle girilen ek
 * ders saatleri (DOM-FIN-105, K-337) bordroya girmeden önce üç adımdan geçer (K-409): taslak (ön
 * büro ya da yönetici saat girer) → öğretmen kontrolü (her personelin teyidi ya da gerekçeli
 * itirazı; itiraz çizelgeyi taslağa döndürür) → müdür onayı (yönetici; ay kilitlenir). Onaylı ay
 * yalnız yönetici tarafından gerekçeyle yeniden açılır ve taslağa döner.
 *
 * Öğretmenin kendi ekranı bu modülde yoktur: teyit ya da itirazı ön büro veya yönetici öğretmen
 * adına, alındığı kanalla (yüz yüze, telefon, e-posta, mesaj, imzalı çizelge) işler. Teyit
 * personelin o anki saat kayıtlarının parmak izini taşır; kayıt sonradan düzeltilir, silinir ya
 * da yeni kayıt eklenirse teyit geçersizleşir ve yeniden alınır.
 *
 * Kilit (K-410): müdür onaylı ayda ek ders saati yazılamaz (409 `lesson_hours_locked`); bordro
 * dönemi kilitliyse (DOM-FIN-108) saat, onay ve yeniden açma 409 `payroll_period_locked`.
 * Bordroya yalnız onaylı ayın saatleri girer (K-411): aktarım dosyası onaysız saati "onay
 * bekliyor" işaretiyle, tutarsız verir; bordro hesabı `lessonHoursForPayroll` ile yalnız onaylı
 * saatleri okur. Fonksiyonlar saftır.
 */

/** Saat girişi, çizelgeyi gönderme ve öğretmen yanıtını işleme (K-409). */
export const LESSON_SHEET_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Müdür onayı ve yeniden açma yalnız yöneticide (K-409). */
export const LESSON_SHEET_APPROVER_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Çizelge durumu: kaydı olmayan ay taslaktır. */
export const LESSON_SHEET_STATUSES = ['draft', 'teacher_review', 'approved'] as const
export type LessonSheetStatus = (typeof LESSON_SHEET_STATUSES)[number]
export const LESSON_SHEET_STATUS_LABELS = {
  draft: 'Taslak',
  teacher_review: 'Öğretmen kontrolünde',
  approved: 'Müdür onaylı (kilitli)',
} as const satisfies Record<LessonSheetStatus, string>

/** Öğretmen yanıtı: teyit ya da gerekçeli itiraz. */
export const LESSON_CONFIRMATION_OUTCOMES = ['confirmed', 'disputed'] as const
export type LessonConfirmationOutcome = (typeof LESSON_CONFIRMATION_OUTCOMES)[number]
export const LESSON_CONFIRMATION_OUTCOME_LABELS = {
  confirmed: 'Teyit etti',
  disputed: 'İtiraz etti',
} as const satisfies Record<LessonConfirmationOutcome, string>

/** Öğretmen yanıtının alındığı kanal (öğretmen ekranı yok; K-409). */
export const LESSON_CONFIRMATION_CHANNELS = [
  'in_person',
  'phone',
  'email',
  'message',
  'signed_sheet',
] as const
export type LessonConfirmationChannel = (typeof LESSON_CONFIRMATION_CHANNELS)[number]
export const LESSON_CONFIRMATION_CHANNEL_LABELS = {
  in_person: 'Yüz yüze',
  phone: 'Telefon',
  email: 'E-posta',
  message: 'Mesaj',
  signed_sheet: 'İmzalı çizelge',
} as const satisfies Record<LessonConfirmationChannel, string>

/** Personelin çizelgedeki teyit durumu. */
export const LESSON_TEACHER_STATES = ['pending', 'confirmed', 'disputed'] as const
export type LessonTeacherState = (typeof LESSON_TEACHER_STATES)[number]
export const LESSON_TEACHER_STATE_LABELS = {
  pending: 'Teyit bekleniyor',
  confirmed: 'Teyit edildi',
  disputed: 'İtiraz etti',
} as const satisfies Record<LessonTeacherState, string>

export const LESSON_HOURS_HASH_PATTERN = /^[0-9a-f]{64}$/

// --- Şemalar -------------------------------------------------------------------------------------

const reasonSchema = (label: string) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(PAYROLL_REASON_MIN, `${label} en az ${String(PAYROLL_REASON_MIN)} karakterle yazın.`)
    .max(PAYROLL_REASON_MAX, `En fazla ${String(PAYROLL_REASON_MAX)} karakter girebilirsiniz.`)

/** Öğretmen kontrolüne gönderme; gövde boştur. */
export const lessonSheetSubmitSchema = z.strictObject({})

/**
 * Öğretmen yanıtı (K-409): personel, sonuç, kanal; itirazda gerekçe zorunlu (5–500), teyitte
 * gerekçe yazılmaz.
 */
export const lessonConfirmationInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: z
      .string('Personel seçin.')
      .trim()
      .min(1, 'Personel seçin.')
      .max(100, 'Personel geçersiz.')
      .describe('Saati girilmiş personelin kurum üyeliği'),
    outcome: z
      .enum(LESSON_CONFIRMATION_OUTCOMES, 'Teyit ya da itiraz seçin.')
      .describe('`confirmed` teyit, `disputed` itiraz (çizelge taslağa döner)'),
    channel: z
      .enum(LESSON_CONFIRMATION_CHANNELS, 'Yanıtın alındığı kanalı seçin.')
      .describe('Yanıtın alındığı kanal: `in_person`, `phone`, `email`, `message`, `signed_sheet`'),
    // kvkk: Ç
    reason: reasonSchema('İtiraz gerekçesini')
      .nullable()
      .default(null)
      .describe('İtiraz gerekçesi (5–500); teyitte boş'),
  })
  .superRefine((value, context) => {
    if (value.outcome === 'disputed' && value.reason === null)
      context.addIssue({
        code: 'custom',
        message: 'İtiraz gerekçesini yazın.',
        path: ['reason'],
      })
    if (value.outcome === 'confirmed' && value.reason !== null)
      context.addIssue({
        code: 'custom',
        message: 'Teyitte gerekçe yazılmaz.',
        path: ['reason'],
      })
  })
export type LessonConfirmationInput = z.input<typeof lessonConfirmationInputSchema>
export type LessonConfirmationFields = z.output<typeof lessonConfirmationInputSchema>

/** Müdür onayı: onaylayanın gördüğü saat kayıtlarının damgası. */
export const lessonSheetApproveSchema = z.strictObject({
  entriesHash: z
    .string('Çizelgeyi yenileyip yeniden deneyin.')
    .regex(LESSON_HOURS_HASH_PATTERN, 'Çizelgeyi yenileyip yeniden deneyin.')
    .describe('Çizelgenin `entriesHash` değeri; onaylanan saatler bunlardır'),
})
export type LessonSheetApproveFields = z.output<typeof lessonSheetApproveSchema>

export const lessonSheetReopenSchema = z.strictObject({
  // kvkk: Ç
  reason: reasonSchema('Yeniden açma gerekçesini').describe(
    'Yeniden açma gerekçesi (5–500); çizelge kaydında kalır, denetim kaydına yazılmaz',
  ),
})
export type LessonSheetReopenFields = z.output<typeof lessonSheetReopenSchema>

// --- Durum ---------------------------------------------------------------------------------------

export interface StoredLessonSheet {
  status: LessonSheetStatus
}

export const lessonSheetStatus = (stored: StoredLessonSheet | null): LessonSheetStatus =>
  stored?.status ?? 'draft'

export const isLessonSheetApproved = (stored: StoredLessonSheet | null) =>
  lessonSheetStatus(stored) === 'approved'

/** Bir personelin ay içindeki saat kaydı (parmak izi için kimlik ve sürüm). */
export interface LessonEntryRef {
  id: string
  membershipId: string
  version: number
}

/**
 * Saat kayıtlarının parmak izi kaynağı: kimlik ve sürüm, kimliğe göre sıralı. Düzeltme sürümü
 * artırır, silme kaydı çıkarır, yeni kayıt ekler; üçü de parmak izini değiştirir. API bunu
 * SHA-256 ile özetler.
 */
export function lessonEntriesFingerprint(entries: readonly Omit<LessonEntryRef, 'membershipId'>[]) {
  return [...entries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => `${entry.id}:${String(entry.version)}`)
    .join('|')
}

/** Personel başına parmak izi kaynağı (teyidin hangi kayıtlara verildiği). */
export function staffFingerprints(entries: readonly LessonEntryRef[]): Map<string, string> {
  const groups = new Map<string, LessonEntryRef[]>()
  for (const entry of entries)
    groups.set(entry.membershipId, [...(groups.get(entry.membershipId) ?? []), entry])
  return new Map(
    [...groups].map(([membershipId, own]) => [membershipId, lessonEntriesFingerprint(own)]),
  )
}

export interface LessonConfirmationRecord {
  membershipId: string
  outcome: LessonConfirmationOutcome
  /** Teyidin verildiği kayıtların özeti (`staffFingerprints` → SHA-256). */
  entriesHash: string
  /** Kayıt sırası; büyük olan sonradır. */
  sequence: number
}

/**
 * Personelin teyit durumu: son yanıt bugünkü kayıtlara verilmişse onun sonucu, değilse (yanıt
 * yok ya da kayıtlar sonradan değişti) `pending`.
 */
export function lessonTeacherStates<T extends LessonConfirmationRecord>(
  currentHashes: ReadonlyMap<string, string>,
  confirmations: readonly T[],
): Map<string, { state: LessonTeacherState; last: T | null }> {
  const last = new Map<string, T>()
  for (const item of confirmations) {
    const previous = last.get(item.membershipId)
    if (previous === undefined || item.sequence > previous.sequence)
      last.set(item.membershipId, item)
  }
  return new Map(
    [...currentHashes].map(([membershipId, hash]) => {
      const response = last.get(membershipId) ?? null
      const state: LessonTeacherState =
        response === null || response.entriesHash !== hash ? 'pending' : response.outcome
      return [membershipId, { state, last: response }]
    }),
  )
}

// --- Geçişler ------------------------------------------------------------------------------------

const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })
const rule = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })

/** Saat yazılabilir mi (K-410): müdür onaylı ay kilitlidir. */
export function assertLessonHoursWritable(stored: StoredLessonSheet | null): void {
  if (isLessonSheetApproved(stored))
    throw conflict(
      'lesson_hours_locked',
      'Bu ayın ek ders çizelgesi müdür onaylı ve kilitli; saat değiştirmek için çizelgeyi yeniden açın.',
    )
}

/** Taslak → öğretmen kontrolü; ayda en az bir saat kaydı olmalı. */
export function planLessonSheetSubmit(stored: StoredLessonSheet | null, entryCount: number): void {
  if (lessonSheetStatus(stored) !== 'draft')
    throw conflict('lesson_sheet_not_draft', 'Çizelge taslak değil; yalnız taslak gönderilir.')
  if (entryCount === 0)
    throw rule('lesson_sheet_empty', 'Bu ay ek ders saati girilmedi; gönderilecek çizelge yok.')
}

/**
 * Öğretmen yanıtı: çizelge öğretmen kontrolünde olmalı, personelin bu ay saat kaydı bulunmalı.
 * İtiraz çizelgeyi taslağa döndürür; teyit durumu değiştirmez.
 */
export function planLessonConfirmation(
  stored: StoredLessonSheet | null,
  input: Pick<LessonConfirmationFields, 'outcome'>,
  staffHasHours: boolean,
): { nextStatus: LessonSheetStatus } {
  if (lessonSheetStatus(stored) !== 'teacher_review')
    throw conflict(
      'lesson_sheet_not_in_review',
      'Çizelge öğretmen kontrolünde değil; önce öğretmen kontrolüne gönderin.',
    )
  if (!staffHasHours)
    throw rule(
      'lesson_confirmation_no_hours',
      'Bu personelin bu ay ek ders saati yok.',
      'membershipId',
    )
  return { nextStatus: input.outcome === 'disputed' ? 'draft' : 'teacher_review' }
}

/**
 * Müdür onayı: çizelge öğretmen kontrolünde, saati olan her personel bugünkü kayıtlarını teyit
 * etmiş ve onaylayanın gördüğü kayıtlar değişmemiş olmalı.
 */
export function planLessonSheetApproval(
  stored: StoredLessonSheet | null,
  states: ReadonlyMap<string, { state: LessonTeacherState }>,
  hashes: { expected: string; current: string },
): void {
  if (lessonSheetStatus(stored) !== 'teacher_review')
    throw conflict(
      'lesson_sheet_not_in_review',
      'Çizelge öğretmen kontrolünde değil; önce öğretmen kontrolüne gönderin.',
    )
  if (hashes.expected !== hashes.current)
    throw conflict(
      'lesson_hours_changed',
      'Ek ders saatleri siz bakarken değişti. Çizelgeyi yenileyip yeniden onaylayın.',
    )
  const waiting = [...states.values()].filter((item) => item.state !== 'confirmed').length
  if (waiting > 0)
    throw rule(
      'lesson_sheet_unconfirmed',
      `${String(waiting)} personelin teyidi eksik; müdür onayı için her personelin güncel saatlerini teyit etmesi gerekir.`,
    )
}

/** Yeniden açma: yalnız müdür onaylı çizelge; taslağa döner. */
export function planLessonSheetReopen(stored: StoredLessonSheet | null): void {
  if (!isLessonSheetApproved(stored))
    throw conflict('lesson_sheet_not_approved', 'Çizelge müdür onaylı değil; yeniden açılmaz.')
}

/**
 * Bordroya giren ek ders saatleri (K-411): yalnız müdür onaylı ayın kayıtları; taslak ya da
 * öğretmen kontrolündeki ayda boş. Bordro hesabı (ON-198) saatleri buradan okur.
 */
export function lessonHoursForPayroll<T>(
  stored: StoredLessonSheet | null,
  entries: readonly T[],
): T[] {
  return isLessonSheetApproved(stored) ? [...entries] : []
}
