// Kıdem ve ihbar tazminatı tahmini (DOM-FIN-094; ON-205): dayanaklar, kalem kalem döküm, notlar ve
// "tahmini hesap" uyarısı. Veri yalnız hesap yanıtıdır; kişi adı yok. Belge web'de üretilir,
// sunucuda saklanmaz (K-273).
import type { SeveranceEstimateResult } from '@kampus/react-shared/use-finance-severance.ts'
import {
  SEVERANCE_ESTIMATE_NOTE,
  severanceBreakdownRows,
  severanceFacts,
  severanceNotes,
} from '@kampus/school-core/lib/finance-severance.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const SEVERANCE_ESTIMATE_TITLE = 'Kıdem ve ihbar tazminatı tahmini'

const COLUMNS = [
  { header: 'Kalem', width: 48 },
  { header: 'Kıdem', width: 42 },
  { header: 'İhbar', width: 42 },
  { header: 'Toplam', width: 42 },
] as const

const dayText = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { day: 'numeric', month: 'long', year: 'numeric' })

/** Dosya adı yalnız çıkış gününü taşır (kişi adı yok). */
export function severanceEstimateFilename(estimate: Pick<SeveranceEstimateResult, 'service'>) {
  return `kidem-ihbar-tahmini-${estimate.service.endDate}.pdf`
}

export function severanceEstimateDocument(
  measurer: TextMeasurer,
  estimate: SeveranceEstimateResult,
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'KIDEM VE İHBAR TAHMİNİ',
    badge: 'TAHMİN',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `kidem-ihbar-${estimate.service.endDate}`,
    footerNote: SEVERANCE_ESTIMATE_NOTE,
  })
  doc.heading(
    SEVERANCE_ESTIMATE_TITLE,
    `${dayText(estimate.service.startDate)} – ${dayText(estimate.service.endDate)}`,
  )
  doc.paragraph(SEVERANCE_ESTIMATE_NOTE)
  doc.section('Dayanaklar')
  doc.fields([['Kurum', options.institution], ...severanceFacts(estimate)])
  doc.section('Döküm')
  doc.table(COLUMNS, severanceBreakdownRows(estimate))
  const notes = severanceNotes(estimate)
  if (notes.length > 0) {
    doc.section('Notlar')
    for (const note of notes) doc.paragraph(note)
  }
  return doc.finish()
}
