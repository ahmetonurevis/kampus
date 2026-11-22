import { z } from 'zod'

import type {
  TripReport,
  TripReportPhoto,
  TripReportUpdateBody,
  TripReportView,
} from '@kampus/react-shared/use-finance-trip-reports.ts'
import { INCIDENT_KIND_LABELS } from '@kampus/school-core/lib/finance-incidents.ts'
import {
  photoTagIssue,
  TRIP_REPORT_CAPTION_MAX,
  TRIP_REPORT_INCIDENT_NOTE_MAX,
  TRIP_REPORT_LIST_STATUS_LABELS,
  TRIP_REPORT_OUTCOME_MAX,
  TRIP_REPORT_PHOTO_VISIBILITY_LABELS,
  TRIP_REPORT_SUMMARY_MAX,
  tripReportReturnSchema,
  type TripReportListStatus,
  type TripReportPhotoVisibility,
} from '@kampus/school-core/lib/finance-trip-reports.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * "Gezi raporu" görünümünün saf mantığı (DOM-FIN-158; ON-158; K-529…K-531): rapor formu ve değişen
 * alanlar, fotoğraf etiket formu, durum ve yayım rozetleri, katılım ve değerlendirme özeti metinleri.
 * Saatler Europe/Istanbul gösterilir.
 */

export const REPORT_STATUS_VIEW = {
  missing: { label: TRIP_REPORT_LIST_STATUS_LABELS.missing, tone: 'gray' },
  draft: { label: TRIP_REPORT_LIST_STATUS_LABELS.draft, tone: 'gray' },
  submitted: { label: TRIP_REPORT_LIST_STATUS_LABELS.submitted, tone: 'purple' },
  approved: { label: TRIP_REPORT_LIST_STATUS_LABELS.approved, tone: 'green' },
  returned: { label: TRIP_REPORT_LIST_STATUS_LABELS.returned, tone: 'amber' },
} as const satisfies Record<TripReportListStatus, { label: string; tone: BadgeTone }>

export const PHOTO_VISIBILITY_VIEW = {
  internal: { label: TRIP_REPORT_PHOTO_VISIBILITY_LABELS.internal, tone: 'gray' },
  consent_missing: { label: TRIP_REPORT_PHOTO_VISIBILITY_LABELS.consent_missing, tone: 'amber' },
  awaiting_approval: {
    label: TRIP_REPORT_PHOTO_VISIBILITY_LABELS.awaiting_approval,
    tone: 'purple',
  },
  published: { label: TRIP_REPORT_PHOTO_VISIBILITY_LABELS.published, tone: 'green' },
} as const satisfies Record<TripReportPhotoVisibility, { label: string; tone: BadgeTone }>

/** `20 Eki 2026 09:30` (Europe/Istanbul). */
export const dateTimeLabel = (value: string) =>
  `${dateLabel(value, { year: 'numeric' })} ${timeLabel(value)}`

const text = (max: number) =>
  z.string().max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)

/** Rapor formu: metinler taslakta boş kalabilir; gönderim kuralını sunucu uygular. */
export const reportFormSchema = z.object({
  summary: text(TRIP_REPORT_SUMMARY_MAX),
  incidentNote: text(TRIP_REPORT_INCIDENT_NOTE_MAX),
  incidentIds: z.array(z.string()),
  outcomeNote: text(TRIP_REPORT_OUTCOME_MAX),
})
export type ReportFormValues = z.infer<typeof reportFormSchema>

export const reportDefaults = (report: TripReport): ReportFormValues => ({
  summary: report.summary ?? '',
  incidentNote: report.incidentNote ?? '',
  incidentIds: report.incidents.map((incident) => incident.id),
  outcomeNote: report.outcomeNote ?? '',
})

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Değişen alanlar; değişiklik yoksa `null` (istek atılmaz). */
export function reportChanges(
  report: TripReport,
  values: ReportFormValues,
): TripReportUpdateBody | null {
  const changes: TripReportUpdateBody = {}
  const summary = blankToNull(values.summary)
  const incidentNote = blankToNull(values.incidentNote)
  const outcomeNote = blankToNull(values.outcomeNote)
  if (summary !== report.summary) changes.summary = summary
  if (incidentNote !== report.incidentNote) changes.incidentNote = incidentNote
  if (outcomeNote !== report.outcomeNote) changes.outcomeNote = outcomeNote
  const before = report.incidents.map((incident) => incident.id).sort()
  const after = [...values.incidentIds].sort()
  if (before.join('|') !== after.join('|')) changes.incidentIds = values.incidentIds
  return Object.keys(changes).length === 0 ? null : changes
}

/** Fotoğraf formu: etiket ya da "öğrenci görünmüyor"dan tam biri (core kuralı, K-530). */
export const photoFormSchema = z
  .object({
    caption: text(TRIP_REPORT_CAPTION_MAX),
    studentIds: z.array(z.string()),
    noStudentsVisible: z.boolean(),
    shareWithFamilies: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const issue = photoTagIssue(value.studentIds, value.noStudentsVisible)
    if (issue !== null) ctx.addIssue({ code: 'custom', path: ['studentIds'], message: issue })
  })
export type PhotoFormValues = z.infer<typeof photoFormSchema>

export const photoDefaults = (photo?: TripReportPhoto): PhotoFormValues => ({
  caption: photo?.caption ?? '',
  studentIds: photo?.students.map((student) => student.studentId) ?? [],
  noStudentsVisible: photo?.noStudentsVisible ?? false,
  shareWithFamilies: photo?.shareWithFamilies ?? true,
})

export const photoBody = (values: PhotoFormValues) => ({
  caption: blankToNull(values.caption),
  studentIds: values.noStudentsVisible ? [] : values.studentIds,
  noStudentsVisible: values.noStudentsVisible,
  shareWithFamilies: values.shareWithFamilies,
})

/** Fotoğrafın değişen alanları; değişiklik yoksa `null`. */
export function photoChanges(photo: TripReportPhoto, values: PhotoFormValues) {
  const next = photoBody(values)
  const changes: Partial<ReturnType<typeof photoBody>> = {}
  if (next.caption !== photo.caption) changes.caption = next.caption
  const before = photo.students.map((student) => student.studentId).sort()
  if (before.join('|') !== [...next.studentIds].sort().join('|'))
    changes.studentIds = next.studentIds
  if (next.noStudentsVisible !== photo.noStudentsVisible)
    changes.noStudentsVisible = next.noStudentsVisible
  if (next.shareWithFamilies !== photo.shareWithFamilies)
    changes.shareWithFamilies = next.shareWithFamilies
  return Object.keys(changes).length === 0 ? null : changes
}

export const returnFormSchema = tripReportReturnSchema
export type ReturnFormValues = z.input<typeof returnFormSchema>

/** Katılım satırı: `Katılan 2 · Katılmayan 1 (yoklamadan, gönderimde donduruldu)`. */
export function attendanceText(attendance: TripReportView['attendance']): string {
  if (attendance.source === 'none') return 'Gezi günü yoklaması yapılmadı; katılım sayısı yok.'
  const base = `Katılan ${String(attendance.attendedCount)} · Katılmayan ${String(attendance.absentCount)} (listede ${String(attendance.rosterCount)})`
  return attendance.frozen ? `${base} · gönderimde donduruldu` : `${base} · gezi günü yoklamasından`
}

/** Değerlendirme özeti metni; az yanıtta gizlidir (K-531). */
export function evaluationText(summary: TripReportView['evaluations']): string {
  if (summary.responses === 0) return 'Henüz katılımcı değerlendirmesi yok.'
  if (summary.hidden || summary.average === null)
    return `${String(summary.responses)} yanıt. Ortalama ve yorumlar en az 5 yanıtta gösterilir.`
  return `${String(summary.responses)} yanıt · ortalama ${summary.average.toLocaleString('tr-TR')} / 5`
}

/** Dağılım satırları: `5 puan: 1`. */
export const distributionRows = (distribution: readonly number[] | null) =>
  distribution === null
    ? []
    : distribution
        .map((count, index) => ({ score: index + 1, count }))
        .reverse()
        .map((row) => `${String(row.score)} puan: ${String(row.count)}`)

/** Kaza tutanağı seçeneği: `20.10.2026 09:30 · Düşme · Müze merdiveni`. */
export const incidentLabel = (incident: { occurredAt: string; kind: string; location: string }) =>
  [
    dateTimeLabel(incident.occurredAt),
    INCIDENT_KIND_LABELS[incident.kind as keyof typeof INCIDENT_KIND_LABELS] ?? incident.kind,
    incident.location,
  ].join(' · ')

/** Raporun bilgi satırı (yazan, gönderim, karar). */
export function reportMeta(report: TripReport): string[] {
  const rows = [`Yazan: ${report.createdByName ?? '—'}`]
  if (report.submittedAt !== null)
    rows.push(`Gönderildi: ${dateTimeLabel(report.submittedAt)} (${report.submittedByName ?? '—'})`)
  if (report.decidedAt !== null)
    rows.push(
      `${report.status === 'approved' ? 'Onaylandı' : 'Karar'}: ${dateTimeLabel(report.decidedAt)} (${report.decidedByName ?? '—'})`,
    )
  return rows
}
