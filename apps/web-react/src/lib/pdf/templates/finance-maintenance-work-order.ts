// Arıza iş emri (DOM-FIN-089; ON-239): talep numarası, bildirim, yer ve demirbaş, sorumlu, arızanın
// açıklaması, çözüm ve iş emri geçmişi; iki imza alanı. Maliyet satırı yalnız yanıtta maliyet
// anahtarı varsa (yönetici) yazılır (K-238). Belge web'de üretilir, sunucuda saklanmaz.
import type { MaintenanceRequestDetail } from '@kampus/react-shared/use-finance-maintenance-requests.ts'
import {
  MAINTENANCE_EVENT_LABELS,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
  maintenanceAssigneeLabel,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const MAINTENANCE_WORK_ORDER_TITLE = 'Arıza iş emri'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const moment = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

const HISTORY_COLUMNS = [
  { header: 'Zaman', width: 36 },
  { header: 'Adım', width: 30 },
  { header: 'Yapan', width: 36 },
  { header: 'Not', width: 72 },
] as const

/** Dosya adı talep numarasıyla: `is-emri-AT-0007.pdf` (kişi adı yazılmaz). */
export function maintenanceWorkOrderFilename(request: Pick<MaintenanceRequestDetail, 'number'>) {
  return `is-emri-${request.number}.pdf`
}

const assigneeText = (assignee: MaintenanceRequestDetail['assignee']) =>
  assignee === null
    ? 'Atanmadı'
    : maintenanceAssigneeLabel({ assigneeType: assignee.type, name: assignee.name })

export function maintenanceWorkOrderDocument(
  measurer: TextMeasurer,
  request: MaintenanceRequestDetail,
  options: TemplateOptions,
): PdfDocument {
  const generatedAt = options.generatedAt ?? new Date()
  const doc = new DocumentLayout(measurer, {
    label: 'ARIZA İŞ EMRİ',
    badge: MAINTENANCE_STATUS_LABELS[request.status].toLocaleUpperCase('tr-TR'),
    institution: options.institution,
    generatedAt,
    reference: request.number,
    footerNote: 'Kurum içi iş emri belgesidir; imzalı nüshası kurumda saklanır.',
  })
  doc.heading(MAINTENANCE_WORK_ORDER_TITLE, `${request.number} · ${request.title}`)
  doc.fields([
    ['Kurum', options.institution],
    ['Talep numarası', request.number],
    ['Bildirim', moment(request.reportedAt)],
    ['Bildiren', request.reportedByName ?? '—'],
    ['Öncelik', MAINTENANCE_PRIORITY_LABELS[request.priority]],
    ['Durum', MAINTENANCE_STATUS_LABELS[request.status]],
    ['Kampüs', request.campusName ?? '—'],
    ['Yer', request.location],
    [
      'Demirbaş',
      request.asset ? `${request.asset.tagNumber} · ${request.asset.name}` : 'Bağlı demirbaş yok',
    ],
    ['Sorumlu', assigneeText(request.assignee)],
  ])
  doc.section('Arızanın açıklaması')
  doc.paragraph(request.description)
  doc.section('Çözüm')
  if (request.resolvedDate !== null) {
    doc.fields([
      ['Çözüm günü', dayText(request.resolvedDate)],
      ['Yapılan iş', request.resolution ?? '—'],
      ['Tedarikçi', request.resolutionSupplier?.name ?? '—'],
      ...('resolutionCostCents' in request
        ? ([
            [
              'Maliyet',
              request.resolutionCostCents == null ? '—' : money(request.resolutionCostCents),
            ],
          ] as const)
        : []),
    ])
  } else if (request.status === 'cancelled') {
    doc.fields([['İptal gerekçesi', request.cancelReason ?? '—']])
  } else {
    doc.writingArea('Yapılan iş (işi yapan doldurur)', 4)
  }
  doc.section('İş emri geçmişi')
  doc.table(
    HISTORY_COLUMNS,
    request.events.map((event) => [
      moment(event.occurredAt),
      MAINTENANCE_EVENT_LABELS[event.event],
      event.actorName ?? '—',
      [event.assignee ? `Sorumlu: ${assigneeText(event.assignee)}` : null, event.note]
        .filter((part): part is string => part !== null && part !== '')
        .join(' · ') || '—',
    ]),
    true,
  )
  doc.signatures(
    'Talep eden — ad soyad, imza',
    request.assignee?.type === 'supplier'
      ? `İşi yapan — ${request.assignee.name ?? 'tedarikçi'}, imza`
      : 'İşi yapan — ad soyad, imza',
  )
  return doc.finish()
}
