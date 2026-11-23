import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  doseTimeSchema,
  MEDICATION_NOTE_MAX,
  type ConsentStatus,
  type InfirmaryStaffMember,
} from './finance-infirmary.ts'
import { addDays } from './finance-opening-watch.ts'
import { dayKey } from './format.ts'
import { STAFF_ROLES } from './staff-accounts.ts'

/**
 * Günlük ilaç çizelgesi, atlama ve düzeltme (docs/domain/finans.md DOM-FIN-152; ON-161; IST-102
 * genişlemesi; K-511…K-513). Onay ve uygulama modeli DOM-FIN-151'dedir (`finance-infirmary.ts`);
 * burada ikinci kez tanımlanmaz.
 *
 * Çizelge (K-511): seçilen günü (Europe/Istanbul) kapsayan onaylı talebin her doz saati bir
 * satırdır. Satırın durumu etkin kayıttan türetilir, saklanmaz: uygulandı, atlandı; sonuç yoksa doz
 * anı + kurumun gecikme payı (varsayılan 30 dk, 5–180) geçtiyse gecikti, değilse bekliyor. Geciken
 * dozlar üstte, sonra bekleyenler, sonra sonuçlananlar; her grup saat sırasıyla. Öğrenci o gün
 * yoklamada yok ya da izinliyse satır işaretlenir (yoklama yalnız okunur).
 *
 * Atlama (K-512): verilmeyen doz gerekçeyle (öğrenci okulda yok, reddetti, veli iptal etti, diğer;
 * "diğer"de açıklama zorunlu) kaydedilir. Bir doz saatinin tek etkin sonucu olur: uygulama varken
 * atlama, atlama varken uygulama yazılmaz (409).
 *
 * Düzeltme (K-513): uygulama ve atlama kaydı silinmez, değişmez. Yönetici gerekçeli düzeltme kaydı
 * ekler: iptal (kayıt hiç olmamış sayılır, doz saati yeniden sonuçlanabilir) ya da düzeltme
 * (uygulamada an, uygulayan ve not; atlamada gerekçe ve açıklama). Etkin değer, kaydın üzerine
 * düzeltmelerin sırayla uygulanmasıdır; iptal edilmiş kayıt düzeltilmez. İptalden sonra yazılan
 * kayıt iptal edilen kaydın yerine geçer (`replacesId`); böylece her doz saatinde tür başına tek
 * zincir kalır. Fonksiyonlar saftır; zaman `now` ile gelir.
 */

/** Atlama yazan ve çizelgeyi okuyan roller: revir işini yürütenler (K-510). */
export const FINANCE_MEDICATION_CHART_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Düzeltme/iptal ve gecikme payı yalnız yöneticide (K-513, K-511). */
export const FINANCE_MEDICATION_CORRECTION_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const DOSE_SKIP_REASONS = [
  'student_absent',
  'refused',
  'guardian_cancelled',
  'other',
] as const
export type DoseSkipReason = (typeof DOSE_SKIP_REASONS)[number]
export const DOSE_SKIP_REASON_LABELS = {
  student_absent: 'Öğrenci okulda yok',
  refused: 'Öğrenci reddetti',
  guardian_cancelled: 'Veli iptal etti',
  other: 'Diğer',
} as const satisfies Record<DoseSkipReason, string>

export const DOSE_STATES = ['overdue', 'pending', 'administered', 'skipped'] as const
export type DoseState = (typeof DOSE_STATES)[number]
export const DOSE_STATE_LABELS = {
  overdue: 'Gecikti',
  pending: 'Bekliyor',
  administered: 'Verildi',
  skipped: 'Atlandı',
} as const satisfies Record<DoseState, string>

export const DOSE_RECORD_KINDS = ['administration', 'skip'] as const
export type DoseRecordKind = (typeof DOSE_RECORD_KINDS)[number]

export const DOSE_CORRECTION_KINDS = ['void', 'amend'] as const
export type DoseCorrectionKind = (typeof DOSE_CORRECTION_KINDS)[number]
export const DOSE_CORRECTION_KIND_LABELS = {
  void: 'İptal',
  amend: 'Düzeltme',
} as const satisfies Record<DoseCorrectionKind, string>

export const LATE_TOLERANCE_DEFAULT_MINUTES = 30
export const LATE_TOLERANCE_MIN_MINUTES = 5
export const LATE_TOLERANCE_MAX_MINUTES = 180
/** Atlama bugün ya da dün için yazılır (uygulamanın 24 saatlik geriye yazma sınırıyla uyumlu). */
export const DOSE_SKIP_BACKDATE_DAYS = 1
export const SKIP_OTHER_NOTE_MIN = 5
export const CORRECTION_REASON_MIN = 5
export const CORRECTION_REASON_MAX = 500
/** Velinin doz geçmişi en çok bu kadar günlük aralıkla okunur (uçlar dahil). */
export const GUARDIAN_DOSE_RANGE_MAX_DAYS = 92
const MINUTE_MS = 60_000

// --- Şemalar -------------------------------------------------------------------------------------

const optionalNote = z
  .string('Açıklama metin olmalı.')
  .trim()
  .max(MEDICATION_NOTE_MAX, `Açıklama en çok ${String(MEDICATION_NOTE_MAX)} karakter olabilir.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()

const skipReasonSchema = z
  .enum(DOSE_SKIP_REASONS, 'Atlama gerekçesini seçin.')
  .describe(
    '`student_absent` öğrenci okulda yok, `refused` reddetti, `guardian_cancelled` veli iptal etti, `other` diğer (açıklama zorunlu; şifreli)',
  )

const otherNeedsNote = (reason: DoseSkipReason | undefined, note: string | null | undefined) =>
  reason !== 'other' || (note !== null && note !== undefined && note.length >= SKIP_OTHER_NOTE_MIN)
const OTHER_NOTE_MESSAGE = `"Diğer" gerekçede en az ${String(SKIP_OTHER_NOTE_MIN)} karakterlik açıklama yazın.`

export const medicationDoseSkipSchema = z
  .strictObject({
    scheduledTime: doseTimeSchema.describe('Onaydaki doz saati (SS:DD)'),
    doseDay: daySchema
      .nullable()
      .default(null)
      .describe('Doz günü (YYYY-MM-DD, Europe/Istanbul); boşsa bugün. Yalnız bugün ya da dün'),
    // kvkk: Ö — sağlık; gerekçe ve açıklama şifreli saklanır.
    reason: skipReasonSchema,
    // kvkk: Ö — sağlık; şifreli saklanır.
    note: optionalNote.default(null).describe('Açıklama (≤ 500; "diğer"de en az 5; şifreli)'),
  })
  .refine((value) => otherNeedsNote(value.reason, value.note), {
    message: OTHER_NOTE_MESSAGE,
    path: ['note'],
  })
export type MedicationDoseSkipInput = z.input<typeof medicationDoseSkipSchema>
export type MedicationDoseSkipFields = z.output<typeof medicationDoseSkipSchema>

// kvkk: Ö — düzeltme gerekçesi sağlık bilgisi taşıyabilir; şifreli saklanır.
const correctionReasonSchema = z
  .string('Düzeltme gerekçesini yazın.')
  .trim()
  .min(CORRECTION_REASON_MIN, `Gerekçe en az ${String(CORRECTION_REASON_MIN)} karakter olmalı.`)
  .max(CORRECTION_REASON_MAX, `Gerekçe en çok ${String(CORRECTION_REASON_MAX)} karakter olabilir.`)
  .describe('Düzeltme ya da iptal gerekçesi (5–500; şifreli)')

const correctionKindSchema = z
  .enum(DOSE_CORRECTION_KINDS, 'Düzeltme türünü seçin.')
  .describe('`void` iptal (kayıt hiç olmamış sayılır), `amend` düzeltme')

/** Verilen düzeltme alanı var mı (iptalde alan verilmez, düzeltmede en az biri). */
function correctionFieldsMatchKind(
  kind: DoseCorrectionKind,
  fields: readonly unknown[],
  ctx: z.RefinementCtx,
) {
  const given = fields.some((value) => value !== undefined)
  if (kind === 'void' && given)
    ctx.addIssue({ code: 'custom', message: 'İptalde düzeltme alanı gönderilmez.', path: ['kind'] })
  if (kind === 'amend' && !given)
    ctx.addIssue({ code: 'custom', message: 'Düzeltilecek en az bir alan girin.', path: ['kind'] })
}

export const administrationCorrectionSchema = z
  .strictObject({
    kind: correctionKindSchema,
    reason: correctionReasonSchema,
    administeredAt: z.iso
      .datetime({ offset: true, error: 'Uygulama anını girin.' })
      .optional()
      .describe('Düzeltilmiş uygulama anı; kaydın doz günüyle aynı gün olmalı'),
    administeredByMembershipId: z
      .string('Uygulayanı seçin.')
      .trim()
      .min(1, 'Uygulayanı seçin.')
      .optional()
      .describe('Düzeltilmiş uygulayan personel üyeliği'),
    // kvkk: Ö — sağlık; şifreli saklanır.
    note: optionalNote.optional().describe('Düzeltilmiş not (boş metin notu siler; şifreli)'),
  })
  .superRefine((value, ctx) =>
    correctionFieldsMatchKind(
      value.kind,
      [value.administeredAt, value.administeredByMembershipId, value.note],
      ctx,
    ),
  )
export type AdministrationCorrectionInput = z.input<typeof administrationCorrectionSchema>
export type AdministrationCorrectionFields = z.output<typeof administrationCorrectionSchema>

export const skipCorrectionSchema = z
  .strictObject({
    kind: correctionKindSchema,
    reason: correctionReasonSchema,
    // kvkk: Ö — sağlık; şifreli saklanır.
    skipReason: skipReasonSchema.optional(),
    // kvkk: Ö — sağlık; şifreli saklanır.
    note: optionalNote.optional().describe('Düzeltilmiş açıklama (şifreli)'),
  })
  .superRefine((value, ctx) =>
    correctionFieldsMatchKind(value.kind, [value.skipReason, value.note], ctx),
  )
export type SkipCorrectionInput = z.input<typeof skipCorrectionSchema>
export type SkipCorrectionFields = z.output<typeof skipCorrectionSchema>

export const medicationSettingsSchema = z.strictObject({
  lateToleranceMinutes: z
    .number('Gecikme payını dakika olarak girin.')
    .int('Gecikme payı tam dakika olmalı.')
    .min(
      LATE_TOLERANCE_MIN_MINUTES,
      `Gecikme payı en az ${String(LATE_TOLERANCE_MIN_MINUTES)} dakika olmalı.`,
    )
    .max(
      LATE_TOLERANCE_MAX_MINUTES,
      `Gecikme payı en çok ${String(LATE_TOLERANCE_MAX_MINUTES)} dakika olabilir.`,
    )
    .describe('Doz saatinden sonra "gecikti" sayılmadan önceki pay (5–180 dk)'),
})
export type MedicationSettingsFields = z.output<typeof medicationSettingsSchema>
export interface MedicationSettings {
  lateToleranceMinutes: number
}
export const DEFAULT_MEDICATION_SETTINGS: MedicationSettings = {
  lateToleranceMinutes: LATE_TOLERANCE_DEFAULT_MINUTES,
}

// --- Şifreli içerik ------------------------------------------------------------------------------

/** Atlamanın şifreli sağlık grubu (K-512). */
export const skipHealthSchema = z.strictObject({
  reason: z.enum(DOSE_SKIP_REASONS),
  note: z.string().max(MEDICATION_NOTE_MAX).nullable(),
})
export type SkipHealth = z.output<typeof skipHealthSchema>

/** Düzeltmenin şifreli grubu (K-513): gerekçe ve verildiyse düzeltilmiş not ya da atlama gerekçesi. */
export const correctionHealthSchema = z.strictObject({
  reason: z.string().max(CORRECTION_REASON_MAX),
  note: z.string().max(MEDICATION_NOTE_MAX).nullable().optional(),
  skipReason: z.enum(DOSE_SKIP_REASONS).optional(),
})
export type CorrectionHealth = z.output<typeof correctionHealthSchema>

// --- Zaman ---------------------------------------------------------------------------------------

const wallClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** Anın Europe/Istanbul duvar saati, UTC'ymiş gibi milisaniye. */
function istanbulWallMs(at: number): number {
  const parts = Object.fromEntries(
    wallClock.formatToParts(new Date(at)).map((part) => [part.type, part.value]),
  )
  return Date.parse(
    `${String(parts.year)}-${String(parts.month)}-${String(parts.day)}T${String(parts.hour)}:${String(parts.minute)}:00Z`,
  )
}

/** Europe/Istanbul günü ve SS:DD saatinin UTC anı (ISO 8601). */
export function istanbulInstant(day: string, time: string): string {
  const wall = Date.parse(`${day}T${time}:00Z`)
  // Fark tahmin edilen anda ölçülür; saat dilimi geçişinde ikinci adım bir saatlik kaymayı düzeltir.
  const first = wall - (istanbulWallMs(wall) - wall)
  const second = wall - (istanbulWallMs(first) - first)
  return new Date(second).toISOString()
}

// --- Kayıt zinciri -------------------------------------------------------------------------------

/** Uygulama ya da atlama kaydının çizelge için gereken düz alanları. */
export interface DoseRecordRef {
  kind: DoseRecordKind
  id: string
  consentId: string
  doseDay: string
  scheduledTime: string
  /** İptal edilen aynı tür kaydın yerine geçtiyse onun kimliği. */
  replacesId: string | null
  createdAt: string
}

/** Düzeltmenin düz alanları; şifreli grup çözülmüş olarak gelir. */
export interface DoseCorrectionRef {
  id: string
  targetKind: DoseRecordKind
  targetId: string
  kind: DoseCorrectionKind
  administeredAt: string | null
  administeredByMembershipId: string | null
  health: CorrectionHealth
  createdAt: string
}

export const doseSlotKey = (consentId: string, day: string, time: string) =>
  `${consentId} ${day} ${time}`

export interface DoseSlotState {
  /** Etkin (iptal edilmemiş) kayıt; yoksa doz sonuçsuz. */
  active: { kind: DoseRecordKind; id: string } | null
  /** Tür başına zincirin son kaydı: yeni kayıt bunun yerine geçer (iptal edilmiş olmalı). */
  tail: Record<DoseRecordKind, string | null>
}

/**
 * Doz saatlerinin durumu: her doz saatinde tür başına kayıtlar `replacesId` ile tek zincirdir;
 * zincirin son kaydı iptal edilmemişse etkin sonuçtur. Etkin kayıt en çok biridir (servis kilit
 * altında denetler).
 */
export function resolveDoseSlots(
  records: readonly DoseRecordRef[],
  voidedIds: ReadonlySet<string>,
): Map<string, DoseSlotState> {
  const replaced = new Set(
    records.flatMap((row) => (row.replacesId === null ? [] : [row.replacesId])),
  )
  const slots = new Map<string, DoseSlotState>()
  for (const row of records) {
    const key = doseSlotKey(row.consentId, row.doseDay, row.scheduledTime)
    const slot = slots.get(key) ?? { active: null, tail: { administration: null, skip: null } }
    if (!replaced.has(row.id)) {
      slot.tail[row.kind] = row.id
      if (!voidedIds.has(row.id)) slot.active = { kind: row.kind, id: row.id }
    }
    slots.set(key, slot)
  }
  return slots
}

/** İptal edilmiş kayıtlar (her kaydın en çok bir iptali olur; veritabanında kısmi tekil indeks). */
export const voidedRecordIds = (corrections: readonly DoseCorrectionRef[]) =>
  new Set(corrections.filter((row) => row.kind === 'void').map((row) => row.targetId))

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })
const conflictError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'conflict', path })

/**
 * Doz saati yeni sonuca açık mı (K-512): etkin uygulama varsa 409 `infirmary_dose_already_given`,
 * etkin atlama varsa 409 `infirmary_dose_already_skipped`. Yeni kaydın yerine geçeceği iptal
 * edilmiş kayıt (zincirin sonu) döner.
 */
export function assertDoseSlotOpen(
  slot: DoseSlotState | undefined,
  kind: DoseRecordKind,
): { replacesId: string | null } {
  if (slot?.active?.kind === 'administration')
    throw conflictError(
      'infirmary_dose_already_given',
      'Bu doz saati için bugün uygulama zaten kayıtlı.',
      ['scheduledTime'],
    )
  if (slot?.active?.kind === 'skip')
    throw conflictError('infirmary_dose_already_skipped', 'Bu doz saati atlandı olarak kayıtlı.', [
      'scheduledTime',
    ])
  return { replacesId: slot?.tail[kind] ?? null }
}

// --- Atlama --------------------------------------------------------------------------------------

/**
 * Atlama (K-512): talep onaylı (422 `infirmary_consent_not_approved`); doz günü bugün ya da dün
 * (gelecek 422 `infirmary_skip_in_future`, daha eski 422 `infirmary_skip_too_old`) ve onay dönemi
 * içinde (422 `infirmary_skip_outside_period`); saat onaydaki saatlerden biri (422
 * `infirmary_dose_time_not_approved`); doz saatinin etkin sonucu yok (409).
 */
export function planDoseSkip(
  consent: { status: ConsentStatus; startDate: string; endDate: string; times: readonly string[] },
  input: MedicationDoseSkipFields,
  checks: { now: Date; slot: (day: string) => DoseSlotState | undefined },
): { doseDay: string; replacesId: string | null; health: SkipHealth } {
  if (consent.status !== 'approved')
    throw ruleError(
      'infirmary_consent_not_approved',
      'Onaylanmamış ilacın dozu atlanamaz; önce veli talebini onaylayın.',
      [],
    )
  const today = dayKey(checks.now)
  const doseDay = input.doseDay ?? today
  if (doseDay > today)
    throw ruleError('infirmary_skip_in_future', 'Gelecek günün dozu atlanamaz.', ['doseDay'])
  if (doseDay < addDays(today, -DOSE_SKIP_BACKDATE_DAYS))
    throw ruleError(
      'infirmary_skip_too_old',
      `Atlama en çok ${String(DOSE_SKIP_BACKDATE_DAYS)} gün geriye yazılır.`,
      ['doseDay'],
    )
  if (doseDay < consent.startDate || doseDay > consent.endDate)
    throw ruleError('infirmary_skip_outside_period', 'Doz günü onaylı dönemin dışında.', [
      'doseDay',
    ])
  if (!consent.times.includes(input.scheduledTime))
    throw ruleError('infirmary_dose_time_not_approved', 'Bu saat veli onayında yok.', [
      'scheduledTime',
    ])
  const { replacesId } = assertDoseSlotOpen(checks.slot(doseDay), 'skip')
  return { doseDay, replacesId, health: { reason: input.reason, note: input.note } }
}

// --- Düzeltme ------------------------------------------------------------------------------------

export interface EffectiveAdministration {
  administeredAt: string
  administeredByMembershipId: string
  note: string | null
}

/** Uygulamanın etkin değerleri: kayıt + sırayla düzeltmeler (K-513). */
export function effectiveAdministration(
  base: EffectiveAdministration,
  corrections: readonly DoseCorrectionRef[],
): EffectiveAdministration & { voided: boolean; corrected: boolean } {
  let value = { ...base }
  let voided = false
  for (const row of corrections) {
    if (row.kind === 'void') {
      voided = true
      continue
    }
    value = {
      administeredAt: row.administeredAt ?? value.administeredAt,
      administeredByMembershipId:
        row.administeredByMembershipId ?? value.administeredByMembershipId,
      note: row.health.note === undefined ? value.note : row.health.note,
    }
  }
  return { ...value, voided, corrected: corrections.length > 0 }
}

/** Atlamanın etkin değerleri: kayıt + sırayla düzeltmeler (K-513). */
export function effectiveSkip(
  base: SkipHealth,
  corrections: readonly DoseCorrectionRef[],
): SkipHealth & { voided: boolean; corrected: boolean } {
  let value = { ...base }
  let voided = false
  for (const row of corrections) {
    if (row.kind === 'void') {
      voided = true
      continue
    }
    value = {
      reason: row.health.skipReason ?? value.reason,
      note: row.health.note === undefined ? value.note : row.health.note,
    }
  }
  return { ...value, voided, corrected: corrections.length > 0 }
}

function assertNotVoided(voided: boolean) {
  if (voided)
    throw conflictError(
      'infirmary_dose_record_voided',
      'İptal edilmiş kayıt düzeltilemez; doz saatine yeni kayıt yazın.',
    )
}

/**
 * Uygulama düzeltmesi (K-513): kayıt iptal edilmemiş olmalı (409 `infirmary_dose_record_voided`).
 * İptal yalnız gerekçe ister. Düzeltmede verilen an gelecekte olamaz (422
 * `infirmary_administration_in_future`) ve kaydın doz günündedir (422
 * `infirmary_correction_day_mismatch`); uygulayan kurumun etkin personeli (422
 * `infirmary_administered_by_*`); etkin değerde değişiklik yoksa 422 `infirmary_correction_unchanged`.
 * Değişen alan adları döner (denetim için).
 */
export function planAdministrationCorrection(
  current: EffectiveAdministration & { voided: boolean; doseDay: string },
  input: AdministrationCorrectionFields,
  checks: { now: Date; administeredBy?: InfirmaryStaffMember | undefined },
): {
  administeredAt: string | null
  administeredByMembershipId: string | null
  health: CorrectionHealth
  changed: string[]
} {
  assertNotVoided(current.voided)
  if (input.kind === 'void')
    return {
      administeredAt: null,
      administeredByMembershipId: null,
      health: { reason: input.reason },
      changed: ['voided'],
    }
  const administeredAt =
    input.administeredAt === undefined ? null : new Date(input.administeredAt).toISOString()
  if (administeredAt !== null) {
    if (Date.parse(administeredAt) > checks.now.getTime())
      throw ruleError('infirmary_administration_in_future', 'Uygulama anı şimdiden sonra olamaz.', [
        'administeredAt',
      ])
    if (dayKey(administeredAt) !== current.doseDay)
      throw ruleError(
        'infirmary_correction_day_mismatch',
        'Düzeltilmiş an kaydın doz günüyle aynı gün olmalı; başka günün dozu için kaydı iptal edin.',
        ['administeredAt'],
      )
  }
  const changed = [
    ...(administeredAt === null || administeredAt === current.administeredAt
      ? []
      : ['administeredAt']),
    ...(input.administeredByMembershipId === undefined ||
    input.administeredByMembershipId === current.administeredByMembershipId
      ? []
      : ['administeredByMembershipId']),
    ...(input.note === undefined || input.note === current.note ? [] : ['note']),
  ]
  if (changed.length === 0)
    throw ruleError('infirmary_correction_unchanged', 'Düzeltmede değişiklik yok.', [])
  if (changed.includes('administeredByMembershipId')) {
    const member = checks.administeredBy
    if (member === null || member === undefined)
      throw ruleError('infirmary_administered_by_not_found', 'Uygulayan bulunamadı.', [
        'administeredByMembershipId',
      ])
    if (!(STAFF_ROLES as readonly string[]).includes(member.role))
      throw ruleError('infirmary_administered_by_not_staff', 'Uygulayan kurum personeli olmalı.', [
        'administeredByMembershipId',
      ])
    if (!member.active)
      throw ruleError('infirmary_administered_by_inactive', 'Uygulayan hesabı pasif.', [
        'administeredByMembershipId',
      ])
  }
  return {
    administeredAt: changed.includes('administeredAt') ? administeredAt : null,
    administeredByMembershipId: changed.includes('administeredByMembershipId')
      ? (input.administeredByMembershipId ?? null)
      : null,
    health: {
      reason: input.reason,
      ...(changed.includes('note') ? { note: input.note ?? null } : {}),
    },
    changed,
  }
}

/**
 * Atlama düzeltmesi (K-513): kayıt iptal edilmemiş olmalı (409); düzeltmede etkin gerekçe "diğer"
 * ise açıklama zorunlu (422 `infirmary_skip_note_required`); değişiklik yoksa 422
 * `infirmary_correction_unchanged`.
 */
export function planSkipCorrection(
  current: SkipHealth & { voided: boolean },
  input: SkipCorrectionFields,
): { health: CorrectionHealth; changed: string[] } {
  assertNotVoided(current.voided)
  if (input.kind === 'void') return { health: { reason: input.reason }, changed: ['voided'] }
  const changed = [
    ...(input.skipReason === undefined || input.skipReason === current.reason
      ? []
      : ['skipReason']),
    ...(input.note === undefined || input.note === current.note ? [] : ['note']),
  ]
  if (changed.length === 0)
    throw ruleError('infirmary_correction_unchanged', 'Düzeltmede değişiklik yok.', [])
  const next = {
    reason: input.skipReason ?? current.reason,
    note: input.note === undefined ? current.note : input.note,
  }
  if (!otherNeedsNote(next.reason, next.note))
    throw ruleError('infirmary_skip_note_required', OTHER_NOTE_MESSAGE, ['note'])
  return {
    health: {
      reason: input.reason,
      ...(changed.includes('skipReason') ? { skipReason: next.reason } : {}),
      ...(changed.includes('note') ? { note: next.note } : {}),
    },
    changed,
  }
}

// --- Çizelge -------------------------------------------------------------------------------------

/**
 * Doz satırının durumu (K-511): etkin kayıt uygulamaysa uygulandı, atlamaysa atlandı; sonuç yoksa
 * doz anı + gecikme payı geçtiyse gecikti, değilse bekliyor.
 */
export function doseState(
  active: DoseSlotState['active'],
  dueAt: string,
  now: Date,
  toleranceMinutes: number,
): DoseState {
  if (active?.kind === 'administration') return 'administered'
  if (active?.kind === 'skip') return 'skipped'
  return now.getTime() > Date.parse(dueAt) + toleranceMinutes * MINUTE_MS ? 'overdue' : 'pending'
}

const STATE_ORDER: Record<DoseState, number> = {
  overdue: 0,
  pending: 1,
  administered: 2,
  skipped: 2,
}

/** Çizelge sırası (K-511): geciken, bekleyen, sonuçlanan; grup içinde saat, öğrenci adı, talep. */
export function sortDoseChart<
  T extends {
    state: DoseState
    scheduledTime: string
    studentName: string | null
    consentId: string
  },
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      a.scheduledTime.localeCompare(b.scheduledTime) ||
      (a.studentName ?? '').localeCompare(b.studentName ?? '', 'tr') ||
      a.consentId.localeCompare(b.consentId),
  )
}

/**
 * Velinin doz geçmişi aralığı: verilmezse son 30 gün (bugün dahil); başlangıç bitişten sonra 422
 * `infirmary_dose_range_invalid`, aralık en çok 92 gün (422 `infirmary_dose_range_too_long`).
 */
export function guardianDoseRange(
  input: { from?: string | undefined; to?: string | undefined },
  now: Date,
): { from: string; to: string } {
  const to = input.to ?? dayKey(now)
  const from = input.from ?? addDays(to, -29)
  if (from > to)
    throw ruleError('infirmary_dose_range_invalid', 'Başlangıç günü bitişten sonra olamaz.', [
      'from',
    ])
  if (from < addDays(to, -(GUARDIAN_DOSE_RANGE_MAX_DAYS - 1)))
    throw ruleError(
      'infirmary_dose_range_too_long',
      `Doz geçmişi en çok ${String(GUARDIAN_DOSE_RANGE_MAX_DAYS)} günlük aralıkla okunur.`,
      ['from'],
    )
  return { from, to }
}

/** Gecikme payı ayarı (K-511): değişiklik yoksa 422 `infirmary_settings_unchanged`. */
export function planMedicationSettings(
  current: MedicationSettings,
  input: MedicationSettingsFields,
): { next: MedicationSettings; changed: string[] } {
  if (input.lateToleranceMinutes === current.lateToleranceMinutes)
    throw ruleError('infirmary_settings_unchanged', 'Ayarda değişiklik yok.', [])
  return {
    next: { lateToleranceMinutes: input.lateToleranceMinutes },
    changed: ['lateToleranceMinutes'],
  }
}
