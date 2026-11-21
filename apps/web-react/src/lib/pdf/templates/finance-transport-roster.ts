// Servis listesi PDF'i (DOM-FIN-148; ON-148; K-499…K-501): kurum, güzergâh, plaka, sürücü (telefonu
// maskeli), rehber, gün, durak grupları ve imza alanı; A4 dikey. Veli telefonu API'den amaca göre
// gelir (kurum içi listede maskeli, sürücü listesinde tam); burada yeniden maskelenmez ya da
// açılmaz. Sağlık ve alerji bilgisi yoktur (ON-165).
import type {
  TransportRoster,
  TransportRosterStudent,
} from '@kampus/react-shared/use-finance-transport-roster.ts'
import { transportRosterRelationshipLabel } from '@kampus/school-core/lib/finance-transport-roster.ts'
import {
  TRANSPORT_DIRECTION_LABELS,
  transportPlateLabel,
} from '@kampus/school-core/lib/finance-transport.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const TRANSPORT_ROSTER_TITLE = 'Servis listesi'

const COLUMNS = [
  { header: '#', width: 8 },
  { header: 'Öğrenci', width: 54 },
  { header: 'Sınıf', width: 18 },
  { header: 'Acil iletişim', width: 94 },
] as const

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Belge numarası: liste günü ve güzergâh kimliğinin ilk sekiz hanesi; ayrı sayaç yok. */
export const transportRosterReference = (roster: Pick<TransportRoster, 'listDate' | 'route'>) =>
  `SRV-${roster.listDate.replaceAll('-', '')}-${roster.route.id.slice(0, 8).toUpperCase()}`

export const transportRosterFilename = (roster: Pick<TransportRoster, 'listDate' | 'route'>) =>
  `servis-listesi-${transportRosterReference(roster)}.pdf`

/** Acil iletişim hücresi: `Ayşe Yılmaz (Anne) 0532 *** ** 12; …`; kişi yoksa `—`. */
export function rosterContactText(student: Pick<TransportRosterStudent, 'contacts'>) {
  if (student.contacts.length === 0) return '—'
  return student.contacts
    .map((contact) => {
      const relationship = transportRosterRelationshipLabel(contact.relationship)
      return [
        contact.name ?? 'Veli',
        relationship === null ? null : `(${relationship})`,
        contact.phone ?? 'telefon yok',
      ]
        .filter((part) => part !== null)
        .join(' ')
    })
    .join('; ')
}

/** Servis listesi PDF'i: araç ve personel bilgisi, durak grupları, imza alanı. */
export function transportRosterDocument(
  measurer: TextMeasurer,
  roster: TransportRoster,
  options: TemplateOptions & { learnerTitle?: string },
): PdfDocument {
  const { route } = roster
  const plate = route.vehiclePlate === null ? '—' : transportPlateLabel(route.vehiclePlate)
  const doc = new DocumentLayout(measurer, {
    label: 'SERVİS LİSTESİ',
    badge: TRANSPORT_DIRECTION_LABELS[route.direction].toLocaleUpperCase('tr'),
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: transportRosterReference(roster),
    footerNote: roster.phonesMasked
      ? 'Kurum içi servis listesidir. Veli telefonları kişisel veridir ve maskelidir.'
      : 'Sürücüye verilecek servis listesidir. Veli telefonları kişisel veridir; liste yalnız servis görevlisinde kalır, çoğaltılmaz, iş bitince imha edilir.',
  })
  doc.heading(TRANSPORT_ROSTER_TITLE, `${route.name} · ${plate}`)
  doc.fields([
    ['Kurum', options.institution],
    ['Gün', dayText(roster.listDate)],
    ['Güzergâh', `${route.name} · ${TRANSPORT_DIRECTION_LABELS[route.direction]}`],
    ['Araç plakası', plate],
    ['Sürücü', route.driverName ?? '—'],
    ['Sürücü telefonu', route.driverPhoneMasked ?? '—'],
    ['Rehber personel', route.guideName ?? '—'],
    ['Liste', roster.phonesMasked ? 'Kurum içi (telefon maskeli)' : 'Sürücüye verilecek'],
  ])
  doc.metrics([
    ['ÖĞRENCİ / KAPASİTE', `${String(roster.total)} / ${String(route.capacity)}`],
    ['DURAK', String(roster.stops.length)],
  ])
  let order = 0
  for (const stop of roster.stops) {
    doc.section(`${String(stop.position)}. ${stop.name} · ${stop.time}`)
    if (stop.students.length === 0) {
      doc.paragraph('Bu durakta öğrenci yok.', 9)
      continue
    }
    doc.table(
      [
        { ...COLUMNS[0] },
        { ...COLUMNS[1], header: options.learnerTitle ?? 'Öğrenci' },
        ...COLUMNS.slice(2),
      ],
      stop.students.map((student) => [
        String((order += 1)),
        student.studentName,
        student.className ?? '—',
        rosterContactText(student),
      ]),
      true,
    )
  }
  if (roster.stops.length === 0) doc.paragraph('Güzergâhta durak yok.', 9)
  doc.paragraph(
    'Liste kayıtlı öğrencileri durak sırasıyla gösterir. Sağlık ve alerji bilgisi bu listede yer almaz.',
    8,
  )
  doc.signatures('Servis sorumlusu', 'Okul müdürü', true)
  return doc.finish()
}
