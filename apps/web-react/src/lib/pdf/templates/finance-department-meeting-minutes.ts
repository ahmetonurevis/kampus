// Zümre toplantısı tutanağı (DOM-FIN-132; ON-217, K-452, K-453): zümre, tür, gün, yer, başkan;
// gündem maddeleri ve görüşme özeti, katılım, numaralı kararlar (sorumlu, termin, durum) ve
// katılanların imza alanları. Veri tutanak ayrıntı ucundan gelir; belge web'de üretilir, sunucuda
// saklanmaz. Kesinleşmemiş tutanak "TASLAK" ibaresiyle basılır.
import type { DepartmentMeeting } from '@kampus/react-shared/use-finance-department-meetings.ts'
import {
  attendanceCounts,
  DEPARTMENT_DECISION_STATUS_LABELS,
  DEPARTMENT_MEETING_ATTENDANCE_LABELS,
  DEPARTMENT_MEETING_KIND_LABELS,
} from '@kampus/school-core/lib/finance-department-meetings.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const DEPARTMENT_MEETING_MINUTES_TITLE = 'Zümre toplantısı tutanağı'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

const DECISION_COLUMNS = [
  { header: 'No', width: 12 },
  { header: 'Karar', width: 82 },
  { header: 'Sorumlu', width: 36 },
  { header: 'Termin', width: 24 },
  { header: 'Durum', width: 20 },
] as const

/** ASCII dosya adı: `zumre-tutanagi-2026-09-10-matematik.pdf`. */
export function departmentMeetingMinutesFilename(
  meeting: Pick<DepartmentMeeting, 'meetingDate' | 'subjectName'>,
) {
  const slug = meeting.subjectName
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `zumre-tutanagi-${meeting.meetingDate}${slug ? `-${slug}` : ''}.pdf`
}

/** Kararın gösterimi: madde başlığı da yazılır; takip notu varsa altında. */
export function departmentDecisionRows(meeting: DepartmentMeeting): string[][] {
  return meeting.decisions.map((decision) => [
    decision.number,
    decision.followUpNote === null || meeting.status !== 'finalized'
      ? decision.text
      : `${decision.text} — Takip: ${decision.followUpNote}`,
    decision.responsibleName,
    decision.dueDate === null ? '—' : dayText(decision.dueDate),
    DEPARTMENT_DECISION_STATUS_LABELS[decision.status],
  ])
}

export function departmentMeetingMinutesDocument(
  measurer: TextMeasurer,
  meeting: DepartmentMeeting,
  options: TemplateOptions,
): PdfDocument {
  const draft = meeting.status !== 'finalized'
  const doc = new DocumentLayout(measurer, {
    label: 'ZÜMRE TUTANAĞI',
    badge: draft ? 'TASLAK' : 'KESİNLEŞTİ',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `zumre-${meeting.meetingDate}-${meeting.id.slice(0, 8)}`,
    footerNote: draft
      ? 'Taslaktır; imza günüyle kesinleşmemiştir.'
      : 'Kurum içi tutanaktır; imzalı nüshası kurumda saklanır.',
  })
  doc.heading(
    `${meeting.subjectName} ${DEPARTMENT_MEETING_MINUTES_TITLE.toLocaleLowerCase('tr-TR')}`,
    `${DEPARTMENT_MEETING_KIND_LABELS[meeting.kind]} · ${dayText(meeting.meetingDate)}`,
  )
  const counts = attendanceCounts(meeting.attendees)
  doc.fields([
    ['Zümre', meeting.subjectName],
    ['Toplantı türü', DEPARTMENT_MEETING_KIND_LABELS[meeting.kind]],
    ['Toplantı günü', dayText(meeting.meetingDate)],
    ['Yer', meeting.location],
    ['Başkan', meeting.chairName],
    ['İmza günü', meeting.signedDate === null ? 'Kesinleşmedi' : dayText(meeting.signedDate)],
    ['Katılan', String(counts.attended)],
    ['Katılmayan / mazeretli', `${String(counts.absent)} / ${String(counts.excused)}`],
  ])

  doc.section('Gündem')
  meeting.agenda.forEach((item, index) => {
    doc.paragraph(`${String(index + 1)}. ${item.title}`)
    if (item.discussion !== null) doc.paragraph(item.discussion, 9)
  })

  doc.section('Katılım')
  doc.table(
    [
      { header: 'Ad soyad', width: 90 },
      { header: 'Durum', width: 84 },
    ],
    meeting.attendees.map((attendee) => [
      attendee.membershipId === meeting.chairMembershipId
        ? `${attendee.name} (başkan)`
        : attendee.name,
      DEPARTMENT_MEETING_ATTENDANCE_LABELS[attendee.status],
    ]),
    true,
  )

  doc.section('Kararlar')
  if (meeting.decisions.length === 0) doc.paragraph('Bu toplantıda karar alınmadı.')
  else doc.table(DECISION_COLUMNS, departmentDecisionRows(meeting), true)

  doc.section('İmzalar')
  const signers = meeting.attendees.filter((attendee) => attendee.status === 'attended')
  for (let index = 0; index < signers.length; index += 2) {
    const left = signers[index]
    const right = signers[index + 1]
    const label = (person: typeof left) =>
      person === undefined
        ? ''
        : person.membershipId === meeting.chairMembershipId
          ? `${person.name} — Başkan`
          : `${person.name} — Üye`
    doc.signatures(label(left), label(right), true)
  }
  return doc.finish()
}
