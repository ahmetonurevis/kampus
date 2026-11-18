// Gezi planı onay dosyası (DOM-FIN-111; ON-155; K-368): plan özeti (amaç, gün ve saat, öğrenci
// sayısı, bağlı ücretli etkinlik), güzergâh, görevliler ve oran uyarısı, ulaşım, risk tablosu, acil
// iletişim, onay ve millî eğitim bildirimi bilgisi; hazırlayan, sorumlu öğretmen ve okul müdürü imza
// alanları. Onaylanmamış planın dosyası "taslak" etiketi taşır. Belge web'de üretilir, saklanmaz.
import type { TripPlanDetail } from '@kampus/react-shared/use-finance-trip-plans.ts'
import { PAID_ACTIVITY_KIND_LABELS } from '@kampus/school-core/lib/finance-paid-activities.ts'
import {
  TRIP_PLAN_STATUS_LABELS,
  TRIP_STAFF_ROLE_LABELS,
  TRIP_TRANSPORT_TYPE_LABELS,
  tripPlateLabel,
  tripStaffRatioMessage,
} from '@kampus/school-core/lib/finance-trip-plans.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const TRIP_PLAN_TITLE = 'Gezi planı ve onay dosyası'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const moment = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

const STOP_COLUMNS = [
  { header: 'Sıra', width: 14 },
  { header: 'Durak', width: 70 },
  { header: 'Not', width: 90 },
] as const
const STAFF_COLUMNS = [
  { header: 'Ad soyad', width: 80 },
  { header: 'Görev', width: 50 },
  { header: 'İmza', width: 44 },
] as const
const RISK_COLUMNS = [
  { header: 'No', width: 12 },
  { header: 'Risk', width: 70 },
  { header: 'Önlem', width: 92 },
] as const
const CONTACT_COLUMNS = [
  { header: 'Ad soyad', width: 70 },
  { header: 'Görevi', width: 54 },
  { header: 'Telefon', width: 50 },
] as const

/** Dosya adı plan numarasıyla: `gezi-plani-GZ-0007.pdf` (kişi adı yazılmaz). */
export function tripPlanFilename(plan: Pick<TripPlanDetail, 'number'>) {
  return `gezi-plani-${plan.number}.pdf`
}

const isApproved = (plan: TripPlanDetail) =>
  plan.status === 'approved' || plan.status === 'completed'

export function tripPlanDocument(
  measurer: TextMeasurer,
  plan: TripPlanDetail,
  options: TemplateOptions,
): PdfDocument {
  const generatedAt = options.generatedAt ?? new Date()
  const doc = new DocumentLayout(measurer, {
    label: 'GEZİ PLANI',
    badge: (isApproved(plan) ? TRIP_PLAN_STATUS_LABELS[plan.status] : 'Taslak').toLocaleUpperCase(
      'tr-TR',
    ),
    institution: options.institution,
    generatedAt,
    reference: plan.number,
    footerNote: isApproved(plan)
      ? 'Okul müdürlüğünce onaylanan gezi planıdır; imzalı nüshası kurumda saklanır.'
      : 'TASLAK — onaylanmamıştır; geziye çıkış için okul müdürünün onayı gerekir.',
  })
  doc.heading(TRIP_PLAN_TITLE, `${plan.number} · ${plan.name}`)
  const transport = plan.transport
  doc.fields([
    ['Kurum', options.institution],
    ['Plan numarası', plan.number],
    ['Durum', TRIP_PLAN_STATUS_LABELS[plan.status]],
    ['Çıkış', moment(plan.departureAt)],
    ['Dönüş', moment(plan.returnAt)],
    ['Beklenen öğrenci', String(plan.expectedStudentCount)],
    [
      'Ücretli etkinlik',
      plan.paidActivity
        ? `${plan.paidActivity.name} (${PAID_ACTIVITY_KIND_LABELS[plan.paidActivity.kind]}, ${dayText(plan.paidActivity.activityDate)})`
        : 'Ücretsiz gezi',
    ],
    ['Hazırlayan', plan.createdByName ?? '—'],
  ])
  doc.section('Amaç ve kazanım')
  doc.paragraph(plan.purpose)
  doc.section('Güzergâh')
  doc.table(
    STOP_COLUMNS,
    plan.stops.map((stop, index) => [String(index + 1), stop.place, stop.note ?? '—']),
    true,
  )
  doc.section('Görevli öğretmenler')
  doc.table(
    STAFF_COLUMNS,
    plan.staff.map((member) => [member.name ?? '—', TRIP_STAFF_ROLE_LABELS[member.role], '']),
    true,
  )
  const ratio = tripStaffRatioMessage(plan.expectedStudentCount, plan.staff.length)
  if (ratio !== null) doc.paragraph(`Uyarı: ${ratio}`)
  doc.section('Ulaşım')
  doc.fields([
    ['Araç türü', TRIP_TRANSPORT_TYPE_LABELS[transport.type]],
    ['Firma', transport.company ?? '—'],
    ['Plaka', transport.plate === null ? '—' : tripPlateLabel(transport.plate)],
    ['Sürücü', transport.driverName ?? '—'],
    ['Sürücü telefonu', transport.driverPhone ?? '—'],
    ['Belge', transport.documentFile?.name ?? 'Eklenmedi'],
  ])
  doc.section('Risk değerlendirmesi')
  if (plan.risks.length === 0) doc.paragraph('Risk maddesi eklenmedi.')
  else
    doc.table(
      RISK_COLUMNS,
      plan.risks.map((item, index) => [String(index + 1), item.risk, item.measure]),
      true,
    )
  doc.section('Acil iletişim')
  if (plan.emergencyContacts.length === 0) doc.paragraph('Acil iletişim kişisi eklenmedi.')
  else
    doc.table(
      CONTACT_COLUMNS,
      plan.emergencyContacts.map((contact) => [
        contact.name,
        contact.relation ?? '—',
        contact.phone,
      ]),
      true,
    )
  doc.section('Onay ve bildirim')
  doc.fields([
    [
      'Onay',
      plan.approvedAt
        ? `${moment(plan.approvedAt)}${plan.approvedByName ? ` · ${plan.approvedByName}` : ''}`
        : 'Onaylanmadı',
    ],
    [
      'Millî eğitim bildirimi',
      plan.authorityNotifiedOn
        ? `${dayText(plan.authorityNotifiedOn)}${plan.authorityReference ? ` · ${plan.authorityReference}` : ''}`
        : 'İşaretlenmedi',
    ],
  ])
  const lead = plan.staff.find((member) => member.role === 'lead')
  doc.signatures(
    `Hazırlayan — ${plan.createdByName ?? 'ad soyad'}, imza`,
    `Sorumlu öğretmen — ${lead?.name ?? 'ad soyad'}, imza`,
  )
  doc.signatures('Uygundur — okul müdürü, ad soyad, imza, mühür', 'Tarih')
  return doc.finish()
}
