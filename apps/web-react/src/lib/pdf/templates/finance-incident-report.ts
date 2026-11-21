// Kaza ve yaralanma tutanağı (DOM-FIN-146; ON-162; K-493, K-494): yaralanan, olay anı, yer ve
// türü, olayın anlatımı, yaralanma bölgesi ve şiddeti, ilk müdahale, sevk, tanıklar, veli
// bildirimleri, kesinleşmeden sonraki ek notlar ve boş imza alanları. Veri yöneticinin ayrıntı
// ucundan gelir (okuma denetime düşer); belge web'de üretilir, sunucuda saklanmaz. Yalnız
// kesinleşmiş tutanak basılır; sağlık grubu olmayan yanıtla belge kurulmaz.
import type { IncidentDetail } from '@kampus/react-shared/use-finance-incidents.ts'
import {
  INCIDENT_KIND_LABELS,
  INCIDENT_NOTIFICATION_CHANNEL_LABELS,
  INCIDENT_REFERRAL_LABELS,
  INJURED_KIND_LABELS,
  INJURY_BODY_PART_LABELS,
  INJURY_SEVERITY_LABELS,
} from '@kampus/school-core/lib/finance-incidents.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const INCIDENT_REPORT_TITLE = 'Kaza ve yaralanma tutanağı'

const TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const at = (value: string) =>
  `${dateLabel(value, { year: 'numeric' })} ${TIME.format(new Date(value))}`

/** ASCII dosya adı: `kaza-tutanagi-2026-10-06-1a2b3c4d.pdf`. */
export function incidentReportFilename(detail: Pick<IncidentDetail, 'id' | 'occurredAt'>) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(detail.occurredAt),
  )
  return `kaza-tutanagi-${day}-${detail.id.slice(0, 8)}.pdf`
}

export function incidentReportDocument(
  measurer: TextMeasurer,
  detail: IncidentDetail,
  options: TemplateOptions,
): PdfDocument {
  const health = detail.health
  if (detail.status !== 'finalized' || health === undefined)
    throw new Error('Yalnız kesinleşmiş tutanak yönetici ayrıntısından basılır.')
  const doc = new DocumentLayout(measurer, {
    label: 'KAZA VE YARALANMA TUTANAĞI',
    badge: 'KESİNLEŞTİ',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `kaza-${detail.id.slice(0, 8)}`,
    footerNote:
      'Özel nitelikli kişisel veri içerir; kurum içi tutanaktır, imzalı nüsha kurumda saklanır.',
  })
  doc.heading(
    INCIDENT_REPORT_TITLE,
    `${INCIDENT_KIND_LABELS[detail.kind]} · ${at(detail.occurredAt)}`,
  )
  doc.fields([
    ['Yaralanan', `${detail.injuredName ?? '—'} (${INJURED_KIND_LABELS[detail.injuredKind]})`],
    ['Olay anı', at(detail.occurredAt)],
    ['Olay yeri', detail.location],
    ['Olay türü', INCIDENT_KIND_LABELS[detail.kind]],
    ['Sorumlu personel', detail.responsibleName ?? '—'],
    ['Kesinleşme', detail.finalizedAt === null ? '—' : at(detail.finalizedAt)],
  ])

  doc.section('Olayın anlatımı')
  doc.paragraph(detail.description)

  doc.section('Yaralanma ve müdahale')
  doc.fields([
    ['Yaralanma bölgesi', health.bodyParts.map((part) => INJURY_BODY_PART_LABELS[part]).join(', ')],
    ['Şiddet', INJURY_SEVERITY_LABELS[health.severity]],
    ['Sevk', INCIDENT_REFERRAL_LABELS[health.referral]],
    [
      'İlk müdahaleyi yapan',
      health.firstAid === null
        ? 'Müdahale yapılmadı'
        : (health.firstAid.byName ?? 'Kurum dışından'),
    ],
  ])
  if (health.injuryNote !== null) doc.paragraph(`Yaralanma notu: ${health.injuryNote}`, 9)
  if (health.firstAid !== null) doc.paragraph(`Yapılan müdahale: ${health.firstAid.action}`, 9)

  doc.section('Tanıklar')
  if (detail.witnesses.length === 0) doc.paragraph('Tanık yazılmadı.')
  else
    doc.table(
      [{ header: 'Ad soyad', width: 174 }],
      detail.witnesses.map((witness) => [witness.name ?? '—']),
      true,
    )

  if (detail.injuredKind === 'student') {
    doc.section('Veli bildirimi')
    if (detail.notifications.length === 0) doc.paragraph('Veliye bildirim kaydedilmedi.')
    else
      doc.table(
        [
          { header: 'Zaman', width: 60 },
          { header: 'Kanal', width: 44 },
          { header: 'Bildiren', width: 70 },
        ],
        detail.notifications.map((item) => [
          at(item.notifiedAt),
          INCIDENT_NOTIFICATION_CHANNEL_LABELS[item.channel],
          item.notifiedByName ?? '—',
        ]),
        true,
      )
  }

  if (detail.addenda !== undefined && detail.addenda.length > 0) {
    doc.section('Ek notlar (kesinleşmeden sonra)')
    for (const item of detail.addenda)
      doc.paragraph(`${at(item.createdAt)} · ${item.createdByName ?? '—'}: ${item.note}`, 9)
  }

  doc.section('İmzalar')
  doc.signatures('Tutanağı düzenleyen', 'Sorumlu personel')
  doc.signatures(
    'Okul müdürü',
    detail.injuredKind === 'student' ? 'Veli (tebellüğ)' : 'Yaralanan personel',
  )
  return doc.finish()
}
