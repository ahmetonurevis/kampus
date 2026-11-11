// Ders çalışma kâğıdı: materyal içeriği ve öğrencinin dolduracağı çözüm alanı.
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import { date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { BLANK, type TemplateOptions } from './shared.ts'

/** Ders çalışma kâğıdı: materyal içeriği ve öğrencinin dolduracağı çözüm alanı. */
export function materialDocument(
  measurer: TextMeasurer,
  data: DocumentDataMap['material'],
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'DERS ÇALIŞMA KÂĞIDI',
    badge: 'ÇALIŞMA',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote: `${options.institution} · Çalışma belgesidir; resmî belge değildir.`,
  })
  doc.heading(data.title, `${data.subject} · ${data.level}`)
  doc.fields([
    ['Hazırlayan öğretmen', data.teacher?.name],
    ['Yayın tarihi', date(data.createdAt)],
  ])
  doc.fields([
    ['Öğrenci adı soyadı', BLANK],
    ['Sınıf / Numara', BLANK],
  ])
  doc.section('01 / Konuyu hatırlayalım')
  data.content.forEach((text, index) => {
    if (index === 1) doc.section('02 / Uygulama ve yönergeler')
    doc.paragraph(text)
  })
  doc.writingArea('03 / Çözüm ve çalışma alanı', 5)
  return doc.finish()
}
