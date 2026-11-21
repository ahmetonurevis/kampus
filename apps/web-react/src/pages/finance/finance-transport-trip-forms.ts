import { z } from 'zod'

import type {
  TransportTripDayRow,
  TransportTripMarkBody,
  TransportTripRosterRow,
} from '@kampus/react-shared/use-finance-transport-trips.ts'
import { TRANSPORT_TIME_PATTERN } from '@kampus/school-core/lib/finance-transport.ts'
import {
  TRANSPORT_CORRECTION_REASON_MAX,
  TRANSPORT_CORRECTION_REASON_MIN,
  TRANSPORT_ROSTER_STATUS_LABELS,
  TRANSPORT_TRIP_STATUS_LABELS,
  transportTripCountsLabel,
  type TransportRosterStatus,
  type TransportTripCounts,
  type TransportTripStatus,
} from '@kampus/school-core/lib/finance-transport-trips.ts'
import { timeLabel } from '@kampus/school-core/lib/format.ts'
import { istanbulLocalToUtc } from '@kampus/school-core/skills/scoring.ts'

/**
 * Servis "Seferler" görünümünün saf mantığı (DOM-FIN-149; ON-145; K-502…K-504): durum metinleri,
 * durak sırasına göre işaretleme listesi, araçta öğrenci uyarısı ve kapanmış sefer düzeltme formu.
 * Saatler Europe/Istanbul gösterilir; düzeltmede seferin günüyle UTC'ye çevrilir.
 */

export const rosterStatusText = (status: TransportRosterStatus) =>
  TRANSPORT_ROSTER_STATUS_LABELS[status]
export const tripStatusText = (status: TransportTripStatus | null) =>
  status === null ? 'Başlamadı' : TRANSPORT_TRIP_STATUS_LABELS[status]
export const tripCountsText = (counts: TransportTripCounts) => transportTripCountsLabel(counts)

/** İşaret anı İstanbul saatiyle (`07:24`); yoksa boş. */
export const markTimeText = (value: string | null) => (value === null ? '' : timeLabel(value))

/** Satırın durum metni ve saati: `Bindi 07:24`, `İndi 07:50 (biniş 07:24)`. */
export function rosterStatusLine(row: TransportTripRosterRow): string {
  const label = rosterStatusText(row.status)
  if (row.status === 'boarded') return `${label} ${markTimeText(row.boardedAt)}`
  if (row.status === 'alighted')
    return `${label} ${markTimeText(row.alightedAt)} (biniş ${markTimeText(row.boardedAt)})`
  return label
}

export interface RosterGroup {
  stopId: string
  stopName: string
  stopTime: string | null
  position: number
  rows: TransportTripRosterRow[]
}

/** İşaretleme listesi durak sırasıyla gruplanır (liste sunucuda sıralıdır, sıra korunur). */
export function rosterGroups(roster: readonly TransportTripRosterRow[]): RosterGroup[] {
  const groups: RosterGroup[] = []
  for (const row of roster) {
    const last = groups.at(-1)
    if (last !== undefined && last.stopId === row.stopId) last.rows.push(row)
    else
      groups.push({
        stopId: row.stopId,
        stopName: row.stopName,
        stopTime: row.stopTime,
        position: row.stopPosition,
        rows: [row],
      })
  }
  return groups
}

/** Açık uyarılar (K-504): sürmekte olan seferde binip inişi işaretlenmemiş öğrenci. */
export function onBoardAlerts(rows: readonly TransportTripDayRow[]) {
  return rows.flatMap((row) =>
    row.trip !== null && row.trip.status === 'open' && row.trip.counts.onBoard > 0
      ? [{ routeId: row.routeId, routeName: row.routeName, count: row.trip.counts.onBoard }]
      : [],
  )
}

/** Sefer yalnız bugün ve seferi yürütebilen kullanıcı tarafından başlatılır (K-502). */
export const canStartTrip = (row: TransportTripDayRow, date: string, today: string) =>
  row.trip === null && row.canOperate && date === today

// --- Düzeltme formu (K-503) ------------------------------------------------------------------

const optionalTime = z
  .string()
  .trim()
  .refine((value) => value === '' || TRANSPORT_TIME_PATTERN.test(value), 'Saati SS:DD girin.')

export const correctionFormSchema = z
  .object({
    status: z.enum(['alighted', 'absent'], 'Durumu seçin.'),
    boardedTime: optionalTime,
    alightedTime: optionalTime,
    reason: z
      .string()
      .trim()
      .min(
        TRANSPORT_CORRECTION_REASON_MIN,
        `Gerekçe en az ${String(TRANSPORT_CORRECTION_REASON_MIN)} karakter olmalı.`,
      )
      .max(
        TRANSPORT_CORRECTION_REASON_MAX,
        `En çok ${String(TRANSPORT_CORRECTION_REASON_MAX)} karakter girebilirsiniz.`,
      ),
  })
  .superRefine((value, context) => {
    if (value.status !== 'alighted') return
    if (value.boardedTime === '')
      context.addIssue({ code: 'custom', path: ['boardedTime'], message: 'Biniş saatini girin.' })
    if (value.alightedTime === '')
      context.addIssue({ code: 'custom', path: ['alightedTime'], message: 'İniş saatini girin.' })
    if (
      value.boardedTime !== '' &&
      value.alightedTime !== '' &&
      value.alightedTime < value.boardedTime
    )
      context.addIssue({
        code: 'custom',
        path: ['alightedTime'],
        message: 'İniş saati biniş saatinden önce olamaz.',
      })
  })
export type CorrectionFormValues = z.input<typeof correctionFormSchema>

export function correctionDefaults(row: TransportTripRosterRow): CorrectionFormValues {
  return {
    status: row.status === 'absent' ? 'absent' : 'alighted',
    boardedTime: markTimeText(row.boardedAt),
    alightedTime: markTimeText(row.alightedAt),
    reason: '',
  }
}

/** Form → işaret gövdesi; saat seferin günüyle İstanbul saatinden UTC'ye çevrilir. */
export function correctionBody(
  values: z.output<typeof correctionFormSchema>,
  tripDate: string,
  studentId: string,
): TransportTripMarkBody {
  if (values.status === 'absent') return { studentId, status: 'absent', reason: values.reason }
  const at = (time: string) => istanbulLocalToUtc(`${tripDate}T${time}`) ?? undefined
  return {
    studentId,
    status: 'alighted',
    boardedAt: at(values.boardedTime),
    alightedAt: at(values.alightedTime),
    reason: values.reason,
  }
}

/** Sunucu alan yolu → form alanı. */
export function correctionFormField(
  name: string,
): 'status' | 'boardedTime' | 'alightedTime' | 'reason' | null {
  if (name === 'status' || name === 'reason') return name
  if (name === 'boardedAt') return 'boardedTime'
  if (name === 'alightedAt') return 'alightedTime'
  return null
}
