import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Servis seferi ve biniş-iniş kaydı (docs/domain/finans.md DOM-FIN-149; ON-145; IST-144).
 * Sefer güzergâh × gün (Europe/Istanbul) × yöndür; aynı güzergâhın aynı gün ve yönde ikinci seferi
 * olmaz (409; K-502). Rehber personel ya da yönetici seferi başlatır, öğrenci başına bindi (saat),
 * indi (saat) ya da gelmedi işaretler ve seferi kapatır. Yalnız güzergâha atanmış öğrenci
 * işaretlenir; konum alınmaz, biyometri yoktur. Kapanmış seferde değişiklik yalnız yöneticinin
 * gerekçeli düzeltmesidir (K-503). Binip inişi işaretlenmemiş (araçta kalmış olabilecek) ya da
 * hiç işaretlenmemiş öğrenci varken sefer kapanmaz (K-504). Fonksiyonlar saftır.
 */

/** Sefer uçlarına giren roller; kapsam rehberliğe göre daralır (`transportTripAccess`, K-502). */
export const FINANCE_TRANSPORT_TRIP_ROLES = [
  'yonetici',
  'ogretmen',
  'onburo',
] as const satisfies readonly Role[]
/** Çocuğunun (kendinin) bugünkü biniş-iniş durumunu okuyan roller (K-502). */
export const FINANCE_TRANSPORT_TRIP_FAMILY_ROLES = [
  'veli',
  'ogrenci',
] as const satisfies readonly Role[]

export const TRANSPORT_TRIP_STATUSES = ['open', 'closed'] as const
export type TransportTripStatus = (typeof TRANSPORT_TRIP_STATUSES)[number]
export const TRANSPORT_TRIP_STATUS_LABELS = {
  open: 'Sürüyor',
  closed: 'Kapandı',
} as const satisfies Record<TransportTripStatus, string>

export const TRANSPORT_MARK_STATUSES = ['boarded', 'alighted', 'absent'] as const
export type TransportMarkStatus = (typeof TRANSPORT_MARK_STATUSES)[number]
/** Listedeki öğrencinin durumu: işaretlenmemiş (`pending`) ya da işaret. */
export const TRANSPORT_ROSTER_STATUSES = ['pending', ...TRANSPORT_MARK_STATUSES] as const
export type TransportRosterStatus = (typeof TRANSPORT_ROSTER_STATUSES)[number]
export const TRANSPORT_ROSTER_STATUS_LABELS = {
  pending: 'İşaretlenmedi',
  boarded: 'Bindi',
  alighted: 'İndi',
  absent: 'Gelmedi',
} as const satisfies Record<TransportRosterStatus, string>

export const TRANSPORT_CORRECTION_REASON_MIN = 5
export const TRANSPORT_CORRECTION_REASON_MAX = 500
/** Cihaz saatinin sunucudan ileri olabileceği pay: çevrimdışı işaret bu kadar ileri tarihli olabilir. */
export const TRANSPORT_MARK_CLOCK_SKEW_MS = 5 * 60 * 1000

// --- Şemalar -------------------------------------------------------------------------------------

/** Sefer başlatma gövdesi boştur: gün sunucunun İstanbul günüdür, yön güzergâhın yönüdür. */
export const transportTripStartSchema = z.strictObject({})
/** Sefer kapatma gövdesi boştur; sürüm `If-Match` ile gelir. */
export const transportTripCloseSchema = z.strictObject({})

const instant = (description: string) =>
  z.iso
    .datetime({ offset: true, error: 'Saati ISO 8601 biçiminde gönderin.' })
    .optional()
    .describe(description)

export const transportTripMarkSchema = z
  .strictObject({
    studentId: z
      .string('Öğrenciyi seçin.')
      .trim()
      .min(1, 'Öğrenciyi seçin.')
      .max(100)
      .describe('Güzergâha atanmış öğrencinin kaydı'),
    status: z
      .enum(TRANSPORT_MARK_STATUSES, 'Durumu seçin.')
      .describe('`boarded` bindi, `alighted` indi, `absent` gelmedi'),
    boardedAt: instant(
      'Biniş anı (ISO 8601). Verilmezse işaret anı; öğrenci zaten bindiyse korunur. Çevrimdışı yeniden denemede cihazın işaret anı gönderilir.',
    ),
    alightedAt: instant(
      'İniş anı (ISO 8601; yalnız `alighted`). Verilmezse işaret anı; öğrenci zaten indiyse korunur.',
    ),
    reason: z
      .string('Gerekçeyi yazın.')
      .trim()
      .min(
        TRANSPORT_CORRECTION_REASON_MIN,
        `Gerekçe en az ${String(TRANSPORT_CORRECTION_REASON_MIN)} karakter olmalı.`,
      )
      .max(
        TRANSPORT_CORRECTION_REASON_MAX,
        `En çok ${String(TRANSPORT_CORRECTION_REASON_MAX)} karakter girebilirsiniz.`,
      )
      .optional()
      .describe(
        'Kapanmış seferde yöneticinin düzeltme gerekçesi (zorunlu); açık seferde yok sayılır (K-503)',
      ),
  })
  .superRefine((value, context) => {
    if (value.status !== 'alighted' && value.alightedAt !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['alightedAt'],
        message: 'İniş saati yalnız "İndi" işaretinde gönderilir.',
      })
    if (value.status === 'absent' && value.boardedAt !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['boardedAt'],
        message: 'Gelmeyen öğrencide biniş saati olmaz.',
      })
  })
export type TransportTripMarkFields = z.output<typeof transportTripMarkSchema>

// --- Erişim --------------------------------------------------------------------------------------

export interface TransportTripActor {
  role: Role
  membershipId: string
}

export interface TransportTripAccess {
  /** Seferi ve listesini görür. */
  read: boolean
  /** Seferi başlatır, açık seferde işaretler ve kapatır. */
  operate: boolean
  /** Kapanmış seferi gerekçeyle düzeltir. */
  correct: boolean
}

/**
 * Sefer yetkisi (K-502): yönetici bütün seferleri görür, yürütür ve kapanmış seferi düzeltir. Rehber
 * personel (güzergâhın aracının rehberi) yalnız kendi güzergâhının seferini yürütür. Ön büro
 * servisi yönettiği için bütün seferleri görür, yalnız rehberi olduğu seferi yürütür; öğretmen
 * yalnız rehberi olduğu güzergâhı görür (başkası 404).
 */
export function transportTripAccess(
  actor: TransportTripActor,
  guideMembershipId: string | null,
): TransportTripAccess {
  if (actor.role === 'yonetici') return { read: true, operate: true, correct: true }
  const guide = guideMembershipId !== null && guideMembershipId === actor.membershipId
  if (actor.role === 'onburo') return { read: true, operate: guide, correct: false }
  if (actor.role === 'ogretmen') return { read: guide, operate: guide, correct: false }
  return { read: false, operate: false, correct: false }
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })

function assertOperator(access: TransportTripAccess): void {
  if (!access.operate)
    throw new DomainError(
      'transport_trip_not_guide',
      'Seferi yalnız güzergâhın rehber personeli ya da yönetici yürütür.',
      { kind: 'forbidden' },
    )
}

/** Sefer başlatma (K-502): rehber ya da yönetici; aynı güzergâhın bugünkü seferi varsa 409. */
export function planTransportTripStart(checks: {
  access: TransportTripAccess
  tripExists: boolean
}): void {
  assertOperator(checks.access)
  if (checks.tripExists)
    throw new DomainError(
      'transport_trip_exists',
      'Bu güzergâhın bugünkü seferi zaten başlatılmış.',
      { kind: 'conflict' },
    )
}

export interface TransportMarkState {
  status: TransportMarkStatus
  boardedAt: Date | null
  alightedAt: Date | null
}

export interface TransportTripMarkChecks {
  trip: { status: TransportTripStatus; tripDate: string }
  access: TransportTripAccess
  /** Öğrenci listede mi: açık seferde etkin ataması ya da işareti, kapanmışta işareti olmalı. */
  onRoster: boolean
  current: TransportMarkState | null
  now: Date
}

export type TransportTripMarkPlan =
  | { kind: 'unchanged' }
  | {
      kind: 'write'
      next: TransportMarkState
      changed: ('status' | 'boardedAt' | 'alightedAt')[]
      /** Kapanmış seferin yönetici düzeltmesi (gerekçe ile ayrı satıra yazılır; K-503). */
      correction: boolean
    }

function assertMarkTime(value: Date, tripDate: string, now: Date, field: string): void {
  if (value.getTime() > now.getTime() + TRANSPORT_MARK_CLOCK_SKEW_MS)
    throw ruleError('transport_mark_future', 'İşaret saati ileri bir zaman olamaz.', [field])
  if (dayKey(value) !== tripDate)
    throw ruleError('transport_mark_other_day', 'İşaret saati seferin gününde olmalı.', [field])
}

const sameTime = (a: Date | null, b: Date | null) =>
  a === null || b === null ? a === b : a.getTime() === b.getTime()

/**
 * Biniş-iniş işareti (K-502, K-503): yalnız listedeki öğrenci; açık seferde rehber ya da yönetici,
 * kapanmış seferde yalnız yönetici gerekçeyle ve "bindi" bırakmadan düzeltir. "İndi" önce biniş
 * ister; saatler seferin gününde, ileri tarihsiz ve iniş binişten sonradır. Açık seferde aynı
 * işaretin yinelenmesi değişiklik değildir (`unchanged`; çift dokunma ve yeniden deneme güvenli),
 * kapanmışta 422.
 */
export function planTransportTripMark(
  input: TransportTripMarkFields,
  checks: TransportTripMarkChecks,
): TransportTripMarkPlan {
  const closed = checks.trip.status === 'closed'
  if (closed) {
    if (!checks.access.correct)
      throw ruleError(
        'transport_trip_closed',
        'Sefer kapandı; değişikliği yönetici gerekçeyle yapar.',
      )
  } else assertOperator(checks.access)
  if (!checks.onRoster)
    throw ruleError('transport_trip_student_not_on_route', 'Öğrenci bu güzergâha atanmış değil.', [
      'studentId',
    ])
  if (closed && input.reason === undefined)
    throw ruleError(
      'transport_mark_reason_required',
      'Kapanmış seferi düzeltmek için gerekçe yazın.',
      ['reason'],
    )
  if (closed && input.status === 'boarded')
    throw ruleError(
      'transport_trip_closed_on_board',
      'Kapanmış seferde öğrenci araçta bırakılamaz; inişini ya da gelmediğini işaretleyin.',
      ['status'],
    )

  const current = checks.current
  const keptBoarding = current !== null && current.status !== 'absent' ? current.boardedAt : null
  const given = (value: string | undefined) => (value === undefined ? null : new Date(value))
  let next: TransportMarkState
  if (input.status === 'absent') next = { status: 'absent', boardedAt: null, alightedAt: null }
  else if (input.status === 'boarded')
    next = {
      status: 'boarded',
      boardedAt: given(input.boardedAt) ?? keptBoarding ?? checks.now,
      alightedAt: null,
    }
  else {
    const boardedAt = given(input.boardedAt) ?? keptBoarding
    if (boardedAt === null)
      throw ruleError('transport_mark_not_boarded', 'Önce öğrencinin binişini işaretleyin.', [
        'status',
      ])
    next = {
      status: 'alighted',
      boardedAt,
      alightedAt:
        given(input.alightedAt) ??
        (current?.status === 'alighted' ? current.alightedAt : null) ??
        checks.now,
    }
  }
  if (next.boardedAt !== null)
    assertMarkTime(next.boardedAt, checks.trip.tripDate, checks.now, 'boardedAt')
  if (next.alightedAt !== null) {
    assertMarkTime(next.alightedAt, checks.trip.tripDate, checks.now, 'alightedAt')
    if (next.boardedAt !== null && next.alightedAt.getTime() < next.boardedAt.getTime())
      throw ruleError(
        'transport_mark_alight_before_board',
        'İniş saati biniş saatinden önce olamaz.',
        ['alightedAt'],
      )
  }

  const changed: ('status' | 'boardedAt' | 'alightedAt')[] = []
  if (current === null || current.status !== next.status) changed.push('status')
  if (!sameTime(current?.boardedAt ?? null, next.boardedAt)) changed.push('boardedAt')
  if (!sameTime(current?.alightedAt ?? null, next.alightedAt)) changed.push('alightedAt')
  if (current !== null && changed.length === 0) {
    if (closed) throw ruleError('transport_mark_unchanged', 'İşarette değişiklik yok.')
    return { kind: 'unchanged' }
  }
  return { kind: 'write', next, changed, correction: closed }
}

export interface TransportTripCounts {
  /** Listedeki öğrenci sayısı. */
  total: number
  pending: number
  /** Binen (inen dahil). */
  boarded: number
  alighted: number
  absent: number
  /** Binip inişi işaretlenmemiş: araçta olabilir (K-504). */
  onBoard: number
}

/** Sefer özeti (K-502): binen (inen dahil), inen, gelmeyen, araçta ve işaretlenmemiş sayıları. */
export function transportTripCounts(
  statuses: readonly TransportRosterStatus[],
): TransportTripCounts {
  const count = (status: TransportRosterStatus) =>
    statuses.filter((value) => value === status).length
  const onBoard = count('boarded')
  const alighted = count('alighted')
  return {
    total: statuses.length,
    pending: count('pending'),
    boarded: onBoard + alighted,
    alighted,
    absent: count('absent'),
    onBoard,
  }
}

/**
 * Sefer kapatma (K-504, güvenlik): binip inişi işaretlenmemiş öğrenci varken (araçta kalmış
 * olabilir) ve işaretlenmemiş öğrenci varken sefer kapanmaz (422). Kapanmış sefer yeniden açılmaz.
 */
export function planTransportTripClose(checks: {
  status: TransportTripStatus
  access: TransportTripAccess
  roster: readonly TransportRosterStatus[]
}): void {
  assertOperator(checks.access)
  if (checks.status === 'closed')
    throw new DomainError('transport_trip_already_closed', 'Sefer zaten kapatılmış.', {
      kind: 'conflict',
    })
  const counts = transportTripCounts(checks.roster)
  if (counts.onBoard > 0)
    throw ruleError(
      'transport_trip_students_on_board',
      `${String(counts.onBoard)} öğrencinin inişi işaretlenmedi; araçta öğrenci kalmadığını kontrol edip inişlerini işaretleyin.`,
    )
  if (counts.pending > 0)
    throw ruleError(
      'transport_trip_unmarked',
      `${String(counts.pending)} öğrenci işaretlenmedi; binmeyenleri "Gelmedi" olarak işaretleyin.`,
    )
}

// --- Görünüm -------------------------------------------------------------------------------------

/** Sefer özeti metni: `3 bindi · 2 indi · 1 gelmedi`. */
export function transportTripCountsLabel(counts: TransportTripCounts): string {
  const parts = [
    `${String(counts.boarded)} bindi`,
    `${String(counts.alighted)} indi`,
    `${String(counts.absent)} gelmedi`,
  ]
  if (counts.pending > 0) parts.push(`${String(counts.pending)} işaretlenmedi`)
  return parts.join(' · ')
}
