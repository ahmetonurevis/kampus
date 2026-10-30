// Ödev belgeleri: çalışma kâğıdı ve değerlendirme formu. Veri core `documentData`'dan gelir;
// sayfa iskeleti ve yazı alanı `DocumentLayout`'tandır, ikinci bir çizim yolu yoktur.
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import { COLORS, date, DocumentLayout, type PdfDocument, type TextMeasurer } from './layout.ts'
import { BLANK, type TemplateOptions } from './templates.ts'

/** Ödev çalışma kâğıdı: görev, yönerge ve öğrencinin dolduracağı çözüm alanları. */
export function homeworkDocument(
  measurer: TextMeasurer,
  data: DocumentDataMap['homework'],
  options: TemplateOptions,
): PdfDocument {
  const { homework } = data
  // Öğretmen belgeyi öğrenciye vermek için açar: öğrenci alanları boş kalır, elle doldurulur.
  const student = 'student' in data ? data.student : undefined
  const doc = new DocumentLayout(measurer, {
    label: 'ÖDEV ÇALIŞMA KÂĞIDI',
    badge: 'ÖDEV',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote: `${options.institution} · Çalışma belgesidir; resmî belge değildir.`,
  })
  doc.heading(homework.title, `${homework.subject} · ${data.classroom?.name || 'Sınıf çalışması'}`)
  doc.fields([
    ['Öğretmen', data.teacher?.name],
    ['Son teslim', date(homework.dueDate)],
    ['Öğrenci', student?.name || BLANK],
    ['Okul numarası', student?.number || BLANK],
  ])
  doc.section('01 / Görev ve yönerge')
  doc.paragraph(homework.description)
  doc.paragraph(
    'Çözüm adımlarını ve kullandığın yöntemi açıkça göster. Çalışmanı tamamladıktan sonra öğretmenine ilet.',
    9,
    COLORS.muted,
  )
  doc.writingArea('02 / Çalışmam', 6)
  doc.writingArea('03 / Kontrol ve öz değerlendirme', 2)
  doc.paragraph(
    'Kontrol: Tüm soruları ele aldım · İşlem ve açıklamalarımı kontrol ettim · Çalışmamı teslim ettim',
    8,
    COLORS.muted,
  )
  return doc.finish()
}

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
