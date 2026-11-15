// Ücretsiz okutma değerlendirme kurulu tutanağı (DOM-FIN-026; ON-284, K-270): toplantı günü,
// eğitim yılı, kurul üyeleri, adayların gerekçesi, teslim edilen belgeler ve kararı; üyelerin imza
// alanları. Belge web'de üretilir, sunucuda saklanmaz. Belgenin kendisi değil teslim işareti yazılır.
import type { FreeTuitionMeeting } from '@kampus/react-shared/use-finance-free-tuition.ts'
import {
  FREE_TUITION_DOCUMENT_LABELS,
  FREE_TUITION_REASON_LABELS,
  FREE_TUITION_STATUS_LABELS,
  freeTuitionDecisionCounts,
} from '@kampus/school-core/lib/finance-free-tuition.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const FREE_TUITION_MINUTES_TITLE = 'Ücretsiz okutma kurul tutanağı'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

const DECISION_COLUMNS = [
  { header: 'Sıra', width: 12 },
  { header: 'Öğrenci', width: 46 },
  { header: 'Gerekçe', width: 44 },
  { header: 'Teslim edilen belgeler', width: 50 },
  { header: 'Karar', width: 22 },
] as const

/** Dosya adı toplantı günüyle: `ucretsiz-okutma-tutanagi-2026-10-01.pdf` (kişi adı yazılmaz). */
export function freeTuitionMinutesFilename(meeting: Pick<FreeTuitionMeeting, 'meetingDate'>) {
  return `ucretsiz-okutma-tutanagi-${meeting.meetingDate}.pdf`
}

export function freeTuitionMinutesDocument(
  measurer: TextMeasurer,
  meeting: FreeTuitionMeeting,
  options: TemplateOptions,
): PdfDocument {
  const generatedAt = options.generatedAt ?? new Date()
  const year = `${String(meeting.academicYear)}–${String(meeting.academicYear + 1)}`
  const doc = new DocumentLayout(measurer, {
    label: 'KURUL TUTANAĞI',
    badge: 'ÜCRETSİZ OKUTMA',
    institution: options.institution,
    generatedAt,
    reference: meeting.meetingDate,
    footerNote: 'Kurum içi tutanaktır; imzalı nüshası kurumda saklanır.',
  })
  doc.heading(FREE_TUITION_MINUTES_TITLE, `${year} eğitim yılı · ${dayText(meeting.meetingDate)}`)
  const counts = freeTuitionDecisionCounts(meeting.decisions)
  doc.fields([
    ['Kurum', options.institution],
    ['Eğitim yılı', year],
    ['Toplantı günü', dayText(meeting.meetingDate)],
    ['Kabul', String(counts.accepted)],
    ['Yedek', String(counts.reserve)],
    ['Ret', String(counts.rejected)],
  ])
  doc.section('Kurul üyeleri')
  doc.table(
    [
      { header: 'Ad soyad', width: 80 },
      { header: 'Görev', width: 94 },
    ],
    meeting.members.map((member) => [member.name, member.title]),
    true,
  )
  doc.section('Kararlar')
  doc.table(
    DECISION_COLUMNS,
    meeting.decisions.map((item, index) => [
      String(index + 1),
      item.studentName ?? '—',
      FREE_TUITION_REASON_LABELS[item.reason],
      item.documents.length === 0
        ? 'Teslim yok'
        : item.documents.map((code) => FREE_TUITION_DOCUMENT_LABELS[code]).join(', '),
      FREE_TUITION_STATUS_LABELS[item.decision],
    ]),
    true,
  )
  doc.paragraph(
    'Kabul edilen öğrencilerin bu eğitim yılına ait ödenmemiş öğrenim taksitleri kapatılmış, alınmış öğrenim ücreti iade kaydına alınmıştır. Hak yalnız bu eğitim yılı için geçerlidir.',
  )
  doc.section('İmzalar')
  for (let index = 0; index < meeting.members.length; index += 2) {
    const left = meeting.members[index]
    const right = meeting.members[index + 1]
    doc.signatures(
      left ? `${left.name} — ${left.title}` : '',
      right ? `${right.name} — ${right.title}` : '',
      true,
    )
  }
  return doc.finish()
}
