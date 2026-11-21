import { z } from 'zod'

import type {
  TripDay,
  TripDayCheck,
  TripDayGroup,
  TripDayMarksBody,
  TripDayStudent,
} from '@kampus/react-shared/use-finance-trip-day.ts'
import {
  TRIP_DAY_CHECK_STATUS_LABELS,
  TRIP_DAY_CHECKPOINT_SUGGESTIONS,
  TRIP_DAY_ROSTER_STATUS_LABELS,
  tripDayCheckProceedSchema,
  tripDayCheckStartSchema,
  tripDayCountsLabel,
  tripDayGroupSchema,
  type TripDayCheckStatus,
  type TripDayRosterStatus,
} from '@kampus/school-core/lib/finance-trip-day.ts'
import { tripPlateLabel } from '@kampus/school-core/lib/finance-trip-plans.ts'
import { timeLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * "Gezi günü" görünümünün saf mantığı (DOM-FIN-154; ON-157; K-517…K-519): grup formu, kontrol
 * noktası önerisi, tur durum rozetleri, "hepsi var" işaret gövdesi, dağıtım listesi ve özet
 * metinleri. Saatler Europe/Istanbul gösterilir.
 */

export const CHECK_STATUS_VIEW = {
  open: { label: TRIP_DAY_CHECK_STATUS_LABELS.open, tone: 'purple' },
  complete: { label: TRIP_DAY_CHECK_STATUS_LABELS.complete, tone: 'green' },
  incomplete: { label: TRIP_DAY_CHECK_STATUS_LABELS.incomplete, tone: 'amber' },
} as const satisfies Record<TripDayCheckStatus, { label: string; tone: BadgeTone }>

export const rosterStatusText = (status: TripDayRosterStatus) =>
  TRIP_DAY_ROSTER_STATUS_LABELS[status]

/** Grup formu: core şeması (plaka boşluksuz büyük harfe, boş plaka `null`). */
export const groupFormSchema = tripDayGroupSchema
export type GroupFormValues = z.input<typeof groupFormSchema>

export function groupDefaults(
  day: Pick<TripDay, 'transportPlate' | 'staff' | 'groups'>,
  group?: TripDayGroup,
): { name: string; vehiclePlate: string; leaderMembershipId: string } {
  if (group !== undefined)
    return {
      name: group.name,
      vehiclePlate: group.vehiclePlate === null ? '' : tripPlateLabel(group.vehiclePlate),
      leaderMembershipId: group.leaderMembershipId,
    }
  const first = day.groups.length === 0
  return {
    name: `${String(day.groups.length + 1)}. grup`,
    // Planın ulaşım plakası yalnız ilk gruba önerilir; diğer araçların plakası elle girilir.
    vehiclePlate: first && day.transportPlate !== null ? tripPlateLabel(day.transportPlate) : '',
    leaderMembershipId: day.staff[0]?.membershipId ?? '',
  }
}

/** Düzeltmede yalnız değişen alanlar gider (değişiklik yoksa `null`). */
export function groupChanges(
  group: TripDayGroup,
  values: z.output<typeof groupFormSchema>,
): Partial<z.output<typeof groupFormSchema>> | null {
  const changes: Partial<z.output<typeof groupFormSchema>> = {}
  if (values.name !== group.name) changes.name = values.name
  if (values.vehiclePlate !== group.vehiclePlate) changes.vehiclePlate = values.vehiclePlate
  if (values.leaderMembershipId !== group.leaderMembershipId)
    changes.leaderMembershipId = values.leaderMembershipId
  return Object.keys(changes).length === 0 ? null : changes
}

export const checkFormSchema = tripDayCheckStartSchema
export type CheckFormValues = z.input<typeof checkFormSchema>

/** Sıradaki kontrol noktası önerisi: grubun tur sayısına göre; öneriler bitince boş. */
export const nextCheckpoint = (group: Pick<TripDayGroup, 'checks'>) =>
  TRIP_DAY_CHECKPOINT_SUGGESTIONS[group.checks.length] ?? ''

export const proceedFormSchema = tripDayCheckProceedSchema
export type ProceedFormValues = z.input<typeof proceedFormSchema>

/** "Hepsi var": işaretlenmemiş öğrenciler var işaretlenir; "yok" işaretliler değişmez. */
export function pendingPresentBody(check: Pick<TripDayCheck, 'roster'>): TripDayMarksBody | null {
  const marks = check.roster
    .filter((row) => row.status === 'pending')
    .map((row) => ({ studentId: row.studentId, status: 'present' as const }))
  return marks.length === 0 ? null : { marks }
}

/** Turun özeti: `1. Okuldan çıkış · 12 var · 1 yok`. */
export const checkSummary = (check: Pick<TripDayCheck, 'sequence' | 'checkpoint' | 'counts'>) =>
  `${String(check.sequence)}. ${check.checkpoint} · ${tripDayCountsLabel(check.counts)}`

/** Tur kapanışı: `Tamam · 10:42` ya da süren tur için açılış saati. */
export function checkTimeText(check: Pick<TripDayCheck, 'status' | 'startedAt' | 'closedAt'>) {
  if (check.closedAt === null) return `Başladı ${timeLabel(check.startedAt)}`
  return `${CHECK_STATUS_VIEW[check.status].label} · ${timeLabel(check.closedAt)}`
}

/** Grup satırı: `2 öğrenci · 06 ABC 123 · Sorumlu: Selin Kaya`. */
export function groupLine(group: Pick<TripDayGroup, 'students' | 'vehiclePlate' | 'leaderName'>) {
  const parts = [`${String(group.students.length)} öğrenci`]
  if (group.vehiclePlate !== null) parts.push(tripPlateLabel(group.vehiclePlate))
  parts.push(`Sorumlu: ${group.leaderName ?? '—'}`)
  return parts.join(' · ')
}

/** Eksik öğrencinin adları (kapanış onayında gösterilir). */
export const missingNames = (check: Pick<TripDayCheck, 'roster'>) =>
  check.roster.filter((row) => row.status !== 'present').map((row) => row.studentName)

export interface AssignOption extends TripDayStudent {
  groupId: string | null
  groupName: string | null
}

/** Dağıtım listesi: grupsuzlar önce, sonra grup sırasıyla; her satır şimdiki grubuyla. */
export function assignOptions(day: Pick<TripDay, 'groups' | 'unassigned'>): AssignOption[] {
  return [
    ...day.unassigned.map((row) => ({ ...row, groupId: null, groupName: null })),
    ...day.groups.flatMap((group) =>
      group.students.map((row) => ({ ...row, groupId: group.id, groupName: group.name })),
    ),
  ]
}

export const assignFormSchema = z.object({
  target: z.string('Hedef grubu seçin.').min(1, 'Hedef grubu seçin.'),
  studentIds: z.array(z.string()).min(1, 'En az bir öğrenci seçin.'),
})
export type AssignFormValues = z.infer<typeof assignFormSchema>
/** Hedef seçeneğinde "gruptan çıkar" değeri. */
export const UNASSIGN = 'grupsuz'

export const assignBody = (values: AssignFormValues) => ({
  groupId: values.target === UNASSIGN ? null : values.target,
  studentIds: values.studentIds,
})

/** Görünümün durum notu: neden yoklama açılamıyor. */
export function dayNotice(day: Pick<TripDay, 'planStatus' | 'isTripDay' | 'firstDay'>) {
  if (day.planStatus === 'cancelled' || day.planStatus === 'completed')
    return 'Gezi kapandı; gruplar ve yoklamalar yalnız okunur.'
  if (day.planStatus !== 'approved')
    return 'Gruplar hazırlanabilir; yoklama plan onaylandıktan sonra gezi günü açılır.'
  if (!day.isTripDay) return `Yoklama gezi günü (${day.firstDay}) açılır.`
  return null
}
