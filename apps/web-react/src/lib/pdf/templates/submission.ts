// Ödev değerlendirme formu: teslim bilgisi, puan ve öğretmen geri bildirimi.
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import { COLORS, date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

/** Ödev değerlendirme formu: teslim bilgisi, puan ve öğretmen geri bildirimi. */
export function submissionDocument(
  measurer: TextMeasurer,
  data: DocumentDataMap['submission'],
  options: TemplateOptions,
): PdfDocument {
  const { homework, submission } = data
  if (!submission || !('student' in data)) throw new Error('Ödev teslim kaydı bulunamadı.')
  const { student } = data
  const evaluated = submission.score != null
  const doc = new DocumentLayout(measurer, {
    label: 'ÖDEV DEĞERLENDİRME FORMU',
    badge: 'DEĞERLENDİRME',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote: `${options.institution} · Teslim ve değerlendirme kaydıdır; resmî belge değildir.`,
  })
  doc.heading('Ödev teslim ve değerlendirme', homework.title)
  doc.fields([
    ['Öğrenci', student.name],
    ['Sınıf / Numara', `${data.classroom?.name || '—'} / ${student.number || student.id}`],
    ['Ders / Öğretmen', `${homework.subject} / ${data.teacher?.name || '—'}`],
    ['Teslim tarihi', date(submission.submittedAt)],
    ['Ek dosya adı', submission.fileName],
    ['Değerlendirme durumu', evaluated ? 'Değerlendirildi' : 'Öğretmen değerlendirmesi bekleniyor'],
  ])
  doc.section('Verilen görev')
  doc.paragraph(homework.description)
  doc.highlight('DEĞERLENDİRME PUANI', evaluated ? `${submission.score} / 100` : 'Bekliyor')
  doc.section('Öğretmen geri bildirimi')
  doc.paragraph(submission.feedback || 'Bu teslim için henüz geri bildirim paylaşılmadı.')
  doc.writingArea('Sonraki çalışma için notlar', 2)
  doc.paragraph(
    'Bu form teslim ve değerlendirme kaydıdır; yüklenen dosyanın içeriğini kapsamaz.',
    8,
    COLORS.muted,
  )
  return doc.finish()
}
