import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'

/**
 * Sağlık verisi okuma gerekçesi (docs/domain/finans.md DOM-FIN-156; ON-164; K-523…K-525;
 * DOM-YTK-052).
 *
 * Sağlık ayrıntısı (şikâyet, yaralanma, ilaç, doz, revir notu …) dönen her personel okumasında
 * gerekçe zorunludur: kod (acil durum, ilk yardım / revir işlemi, veli görüşmesi, tutanak hazırlama,
 * resmî talep, diğer) ve yalnız "diğer"de serbest açıklama (5–200). Gerekçe GET isteğinde gövde
 * olmadığından başlıkla gelir (`X-Access-Reason`, `X-Access-Reason-Note`); sorgu dizesine konmaz
 * (adres loga, geçmişe ve vekil kayıtlarına düşer). Açıklama Türkçe karakter taşıdığından başlıkta
 * yüzde kodlu UTF-8'dir (`encodeURIComponent`).
 *
 * Veli ve öğrenci kendi (çocuğunun) verisini okur; ilgili kişinin erişim hakkıdır (KVKK md. 11),
 * gerekçe sorulmaz (`HEALTH_ACCESS_REASON_EXEMPT_ROLES`). Liste uçları sağlık ayrıntısı
 * döndürmüyorsa gerekçe istemez. Sunucu her gerekçeli okumayı ayrı kaydeder; istemci aynı kayıt
 * için seçilen gerekçeyi 15 dakika bellekte tutup yeniden kullanabilir (K-525).
 *
 * Fonksiyonlar saftır; zaman `now` ile gelir.
 */

export const HEALTH_ACCESS_REASON_CODES = [
  'emergency',
  'first_aid',
  'guardian_meeting',
  'incident_report',
  'official_request',
  'other',
] as const
export type HealthAccessReasonCode = (typeof HEALTH_ACCESS_REASON_CODES)[number]
export const HEALTH_ACCESS_REASON_LABELS = {
  emergency: 'Acil durum',
  first_aid: 'İlk yardım / revir işlemi',
  guardian_meeting: 'Veli görüşmesi',
  incident_report: 'Tutanak hazırlama',
  official_request: 'Resmî talep',
  other: 'Diğer',
} as const satisfies Record<HealthAccessReasonCode, string>

export const HEALTH_ACCESS_NOTE_MIN = 5
export const HEALTH_ACCESS_NOTE_MAX = 200
/** İstemcinin aynı kayıt için gerekçeyi yeniden kullanabileceği süre (K-525). */
export const HEALTH_ACCESS_REASON_TTL_MS = 15 * 60_000

/** Gerekçe başlıkları (küçük harf: Fastify ve `fetch` başlık adlarını küçültür). */
export const HEALTH_ACCESS_REASON_HEADER = 'x-access-reason'
export const HEALTH_ACCESS_NOTE_HEADER = 'x-access-reason-note'

/** Gerekçe sorulmayan roller: ilgili kişi ve yasal temsilcisi kendi verisini okur (KVKK md. 11). */
export const HEALTH_ACCESS_REASON_EXEMPT_ROLES = [
  'veli',
  'ogrenci',
] as const satisfies readonly Role[]
/** Sağlık verisi erişim günlüğünü okuyan rol (DOM-YTK-053: denetimi yalnız yönetici görür). */
export const HEALTH_ACCESS_LOG_ROLES = ['yonetici'] as const satisfies readonly Role[]

export type HealthAccessReason =
  { code: Exclude<HealthAccessReasonCode, 'other'>; note: null } | { code: 'other'; note: string }

const NOTE_REQUIRED = `"Diğer" gerekçede açıklama ${HEALTH_ACCESS_NOTE_MIN}–${HEALTH_ACCESS_NOTE_MAX} karakter olmalı.`
const NOTE_ONLY_OTHER = 'Açıklama yalnız "Diğer" gerekçede yazılır.'

/**
 * Gerekçe: kod ve yalnız "diğer"de açıklama (kırpılır, 5–200). Kodlu gerekçede açıklama
 * reddedilir: denetime gereksiz serbest metin girmez.
 */
export const healthAccessReasonSchema = z
  .object({
    code: z.enum(HEALTH_ACCESS_REASON_CODES, 'Erişim gerekçesini seçin.'),
    note: z.string('Açıklama metin olmalı.').trim().nullish(),
  })
  .superRefine((value, issue) => {
    const note = value.note ?? ''
    if (value.code === 'other') {
      if (note.length < HEALTH_ACCESS_NOTE_MIN || note.length > HEALTH_ACCESS_NOTE_MAX)
        issue.addIssue({ code: 'custom', path: ['note'], message: NOTE_REQUIRED })
    } else if (note !== '')
      issue.addIssue({ code: 'custom', path: ['note'], message: NOTE_ONLY_OTHER })
  })
  .transform((value): HealthAccessReason =>
    value.code === 'other'
      ? { code: 'other', note: value.note ?? '' }
      : { code: value.code, note: null },
  )

/** İstek başlıkları; açıklama yüzde kodlu UTF-8'dir. */
export function healthAccessReasonHeaders(reason: HealthAccessReason): {
  'x-access-reason': HealthAccessReasonCode
  'x-access-reason-note'?: string
} {
  return reason.note === null
    ? { 'x-access-reason': reason.code }
    : { 'x-access-reason': reason.code, 'x-access-reason-note': encodeURIComponent(reason.note) }
}

export type HealthAccessReasonIssue = { path: string[]; code: string; message: string }
export type HealthAccessReasonParse =
  | { ok: true; reason: HealthAccessReason }
  | {
      ok: false
      code: 'health_access_reason_required' | 'health_access_reason_invalid'
      message: string
      issues: HealthAccessReasonIssue[]
    }

export const HEALTH_ACCESS_REASON_MESSAGES = {
  health_access_reason_required: 'Sağlık bilgisini açmak için erişim gerekçesini seçin.',
  health_access_reason_invalid: 'Erişim gerekçesi geçersiz. Gerekçeyi yeniden seçin.',
} as const

const single = (value: string | readonly string[] | undefined) =>
  typeof value === 'string'
    ? value
    : value?.length === 1
      ? value[0]
      : value === undefined
        ? undefined
        : null

function decodeNote(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Başlıklardan gerekçe. Kod yoksa `health_access_reason_required`; tekrarlanan başlık, bilinmeyen
 * kod, çözülemeyen ya da kurala uymayan açıklama `health_access_reason_invalid` (alan yollarıyla).
 */
export function parseHealthAccessReasonHeaders(headers: {
  code: string | readonly string[] | undefined
  note: string | readonly string[] | undefined
}): HealthAccessReasonParse {
  const code = single(headers.code)
  const rawNote = single(headers.note)
  const invalid = (path: string, message: string): HealthAccessReasonParse => ({
    ok: false,
    code: 'health_access_reason_invalid',
    message: HEALTH_ACCESS_REASON_MESSAGES.health_access_reason_invalid,
    issues: [{ path: [path], code: 'custom', message }],
  })
  if (code === undefined || (code !== null && code.trim() === ''))
    return {
      ok: false,
      code: 'health_access_reason_required',
      message: HEALTH_ACCESS_REASON_MESSAGES.health_access_reason_required,
      issues: [
        {
          path: [HEALTH_ACCESS_REASON_HEADER],
          code: 'custom',
          message: 'Erişim gerekçesini seçin.',
        },
      ],
    }
  if (code === null) return invalid(HEALTH_ACCESS_REASON_HEADER, 'Gerekçe tek kez gönderilir.')
  if (rawNote === null) return invalid(HEALTH_ACCESS_NOTE_HEADER, 'Açıklama tek kez gönderilir.')
  const note = rawNote === undefined ? null : decodeNote(rawNote)
  if (rawNote !== undefined && note === null)
    return invalid(HEALTH_ACCESS_NOTE_HEADER, 'Açıklama okunamadı.')
  const parsed = healthAccessReasonSchema.safeParse({ code: code.trim(), note })
  if (parsed.success) return { ok: true, reason: parsed.data }
  const first = parsed.error.issues[0]
  return invalid(
    first?.path[0] === 'note' ? HEALTH_ACCESS_NOTE_HEADER : HEALTH_ACCESS_REASON_HEADER,
    first?.message ?? HEALTH_ACCESS_REASON_MESSAGES.health_access_reason_invalid,
  )
}

/** Gerekçe bu rolden istenir mi (personel evet; veli ve öğrenci hayır). */
export function healthAccessReasonRequired(role: Role): boolean {
  return !(HEALTH_ACCESS_REASON_EXEMPT_ROLES as readonly Role[]).includes(role)
}

/** İstemcide saklanan gerekçe: seçildiği an; `TTL` geçince yeniden sorulur (K-525). */
export type RememberedHealthAccessReason = { reason: HealthAccessReason; chosenAt: number }

export function rememberedReasonValid(
  entry: RememberedHealthAccessReason | undefined,
  now: number,
): entry is RememberedHealthAccessReason {
  return (
    entry !== undefined &&
    now >= entry.chosenAt &&
    now - entry.chosenAt < HEALTH_ACCESS_REASON_TTL_MS
  )
}

/** Gerekçenin okunur metni: "Veli görüşmesi" ya da "Diğer: <açıklama>". */
export function healthAccessReasonText(reason: {
  code: HealthAccessReasonCode
  note: string | null
}): string {
  const label = HEALTH_ACCESS_REASON_LABELS[reason.code]
  return reason.code === 'other' && reason.note !== null ? `${label}: ${reason.note}` : label
}

/**
 * Gerekçeli okumanın denetim eylemi → günlükte görünen kayıt türü. Yeni sağlık okuması (ON-161,
 * ON-163, ON-165) eylemini buraya ekler; bilinmeyen eylem "Sağlık kaydı" görünür.
 */
export const HEALTH_ACCESS_ACTION_LABELS: Readonly<Record<string, string>> = {
  'finance.incident.read': 'Kaza tutanağı',
  'finance.infirmary.visit_read': 'Revir ziyareti',
  'finance.infirmary.consent_read': 'İlaç talebi',
  'finance.infirmary.schedule_read': 'İlaç uygulama listesi',
  'finance.infirmary.chart_read': 'İlaç çizelgesi',
  'finance.trip_day.emergency_card': 'Gezi acil kartı',
  'finance.trip_day.emergency_card_full': 'Gezi acil kartı (tam telefon)',
  'finance.health_screening.read': 'Sağlık taraması',
  'finance.emergency_summary.read': 'Acil durum özeti',
  'finance.emergency_summary.print': 'Acil durum özeti (sınıf PDF’i)',
  'finance.emergency_summary.manage_read': 'Acil durum özeti (yönetim)',
}

export function healthAccessActionLabel(action: string): string {
  return Object.hasOwn(HEALTH_ACCESS_ACTION_LABELS, action)
    ? (HEALTH_ACCESS_ACTION_LABELS[action] ?? 'Sağlık kaydı')
    : 'Sağlık kaydı'
}
