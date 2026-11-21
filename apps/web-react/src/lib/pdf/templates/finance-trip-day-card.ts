// Gezi günü acil kartı PDF'i (DOM-FIN-154; ON-157; K-518): grup başına; yazdırılıp grup
// sorumlusunun çantasında taşınır. Kurum, gezi, grup, plaka, sorumlu, okulun acil iletişimi ve
// öğrenci başına acil iletişim (veli telefonu API'den amaca göre maskeli ya da tam gelir; burada
// yeniden maskelenmez ya da açılmaz) ile en az bilgiyle sağlık uyarısı. Alerjen, ilaç adı ve doz
// karta girmez; A4 dikey.
import type { TripDayCard } from '@kampus/react-shared/use-finance-trip-day.ts'
import { tripDayHealthLabel } from '@kampus/school-core/lib/finance-trip-day.ts'
import { tripPlateLabel } from '@kampus/school-core/lib/finance-trip-plans.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { rosterContactText } from './finance-transport-roster.ts'
import type { TemplateOptions } from './shared.ts'

export const TRIP_DAY_CARD_TITLE = 'Gezi acil kartı'

const COLUMNS = [
  { header: '#', width: 8 },
  { header: 'Öğrenci', width: 44 },
  { header: 'Sınıf', width: 14 },
  { header: 'Acil iletişim', width: 64 },
  { header: 'Sağlık uyarısı', width: 44 },
] as const

const moment = (value: string) => `${dateLabel(value, { year: 'numeric' })} ${timeLabel(value)}`

/** Belge numarası: plan numarası ve grup kimliğinin ilk altı hanesi; ayrı sayaç yok. */
export const tripDayCardReference = (card: Pick<TripDayCard, 'plan' | 'group'>) =>
  `${card.plan.number}-${card.group.id.slice(0, 6).toUpperCase()}`

export const tripDayCardFilename = (card: Pick<TripDayCard, 'plan' | 'group'>) =>
  `gezi-acil-karti-${tripDayCardReference(card)}.pdf`

/** Sağlık hücresi: uyarı metni ve kısa acil eylem; uyarı yoksa `—`. */
export function tripDayHealthText(student: Pick<TripDayCard['students'][number], 'health'>) {
  const { health } = student
  const label = tripDayHealthLabel(health)
  const parts = [label, health.action === null ? null : `Acil: ${health.action}`].filter(
    (part) => part !== null,
  )
  return parts.length === 0 ? '—' : parts.join('. ')
}

export function tripDayCardDocument(
  measurer: TextMeasurer,
  card: TripDayCard,
  options: TemplateOptions & { learnerTitle?: string },
): PdfDocument {
  const plate = card.group.vehiclePlate === null ? '—' : tripPlateLabel(card.group.vehiclePlate)
  const doc = new DocumentLayout(measurer, {
    label: 'GEZİ ACİL KARTI',
    badge: card.group.name.toLocaleUpperCase('tr'),
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: tripDayCardReference(card),
    footerNote: card.phonesMasked
      ? 'Kurum içi acil kart; veli telefonları maskelidir. Sağlık bilgisi özel nitelikli kişisel veridir, çoğaltılmaz.'
      : 'Veli telefonları ve sağlık uyarısı kişisel veridir; kart yalnız grup sorumlusunda kalır, çoğaltılmaz, gezi bitince imha edilir.',
  })
  doc.heading(TRIP_DAY_CARD_TITLE, `${card.plan.number} · ${card.plan.name}`)
  doc.fields([
    ['Kurum', options.institution],
    ['Gezi', card.plan.name],
    ['Çıkış', moment(card.plan.departureAt)],
    ['Dönüş', moment(card.plan.returnAt)],
    ['Grup', card.group.name],
    ['Araç plakası', plate],
    ['Grup sorumlusu', card.group.leaderName ?? '—'],
    ['Telefonlar', card.phonesMasked ? 'Maskeli' : 'Tam (acil durum için)'],
  ])
  doc.metrics([
    ['ÖĞRENCİ', String(card.total)],
    ['SAĞLIK UYARISI', String(card.students.filter((row) => row.health.alert).length)],
  ])
  if (card.plan.emergencyContacts.length > 0) {
    doc.section('Okulun acil iletişimi')
    doc.table(
      [
        { header: 'Kişi', width: 70 },
        { header: 'Görevi', width: 50 },
        { header: 'Telefon', width: 54 },
      ],
      card.plan.emergencyContacts.map((contact) => [
        contact.name,
        contact.relation ?? '—',
        contact.phone,
      ]),
      true,
    )
  }
  doc.section(options.learnerTitle === undefined ? 'Öğrenciler' : `${options.learnerTitle} listesi`)
  if (card.students.length === 0) doc.paragraph('Grupta öğrenci yok.', 9)
  else
    doc.table(
      [
        { ...COLUMNS[0] },
        { ...COLUMNS[1], header: options.learnerTitle ?? 'Öğrenci' },
        ...COLUMNS.slice(2),
      ],
      card.students.map((student, index) => [
        String(index + 1),
        student.studentName,
        student.className ?? '—',
        rosterContactText(student),
        tripDayHealthText(student),
      ]),
      true,
    )
  doc.paragraph(
    'Sağlık uyarısı yalnız "alerji / kronik durum / ilaç var" işaretini ve kısa acil talimatı gösterir; ayrıntı için veliyi ya da okul yönetimini arayın. "Bugün ilaç var" revirdeki onaylı ilaç talebinden gelir.',
    8,
  )
  doc.signatures('Grup sorumlusu', 'Okul müdürü', true)
  return doc.finish()
}
