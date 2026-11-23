// Gezi ve etkinlik katılım listesi (DOM-FIN-112; ON-156; K-371): etkinlik bilgisi, sayılar ve
// katılımcı tablosu (sıra, öğrenci, sınıf, maskeli veli telefonu, katılım, veli izni, ödeme). Veli
// telefonu API'den yalnız maskeli gelir (KVKK); tam telefon, IBAN ve izni verenin adı yazılmaz.
// Rakamlar API yanıtındandır, burada yeniden hesaplanmaz.
import type {
  PaidActivityRoster,
  PaidActivityRosterRow,
} from '@kampus/react-shared/use-finance-paid-activities.ts'
import {
  compareRosterRows,
  rosterConsentText,
  rosterStatusText,
} from '@kampus/school-core/lib/finance-paid-activity-participants.ts'
import {
  PAID_ACTIVITY_KIND_LABELS,
  PARTICIPATION_PAYMENT_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const PAID_ACTIVITY_ROSTER_TITLE = 'Katılım listesi'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

const COLUMNS = [
  { header: '#', width: 8 },
  { header: 'Öğrenci', width: 38 },
  { header: 'Sınıf', width: 14 },
  { header: 'Veli telefonu', width: 30 },
  { header: 'Katılım', width: 22 },
  { header: 'Veli izni', width: 36 },
  { header: 'Ödeme', width: 26 },
] as const

/** Belge numarası: etkinlik günü ve kimliğin ilk sekiz hanesi; ayrı sayaç yok. */
export const paidActivityRosterReference = (activity: PaidActivityRoster['activity']) =>
  `GEZ-${activity.activityDate.replaceAll('-', '')}-${activity.id.slice(0, 8).toUpperCase()}`

export const paidActivityRosterFilename = (activity: PaidActivityRoster['activity']) =>
  `katilim-listesi-${paidActivityRosterReference(activity)}.pdf`

const paymentText = (row: PaidActivityRosterRow) =>
  row.paymentStatus === 'not_billed'
    ? PARTICIPATION_PAYMENT_STATUS_LABELS.not_billed
    : `${PARTICIPATION_PAYMENT_STATUS_LABELS[row.paymentStatus]} · ${money(row.collectedCents)}`

/** Katılım listesi PDF'i: etkinlik bilgileri, sayılar, asiller ve yedekler tek tabloda. */
export function paidActivityRosterDocument(
  measurer: TextMeasurer,
  roster: PaidActivityRoster,
  options: TemplateOptions & { learnerTitle?: string },
): PdfDocument {
  const { activity } = roster
  const reference = paidActivityRosterReference(activity)
  const doc = new DocumentLayout(measurer, {
    label: 'KATILIM LİSTESİ',
    badge: PAID_ACTIVITY_KIND_LABELS[activity.kind].toLocaleUpperCase('tr'),
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference,
    footerNote:
      'Kurum içi katılım listesidir. Veli telefonu kişisel veridir ve maskelidir; liste yalnız etkinlik görevlisiyle paylaşılır.',
  })
  doc.heading(PAID_ACTIVITY_ROSTER_TITLE, activity.name)
  doc.fields([
    ['Kurum', options.institution],
    ['Etkinlik', `${activity.name} · ${PAID_ACTIVITY_KIND_LABELS[activity.kind]}`],
    ['Gün', dayText(activity.activityDate)],
    ['Kişi başı ücret', money(activity.feeCents)],
    ['Veli izni', activity.requiresConsent ? 'Zorunlu' : 'İstenmiyor'],
  ])
  const rows = [...roster.items].sort(compareRosterRows)
  const seats = rows.filter((row) => row.status !== 'waitlisted')
  doc.metrics([
    ['ASİL / KONTENJAN', `${String(seats.length)} / ${String(activity.capacity)}`],
    ['İZİN BEKLEYEN', String(rows.filter((row) => row.status === 'awaiting_consent').length)],
    ['YEDEK', String(rows.length - seats.length)],
  ])
  doc.section('Katılımcılar')
  if (rows.length === 0) doc.paragraph('Henüz katılımcı yok.', 9)
  else
    doc.table(
      [
        { ...COLUMNS[0] },
        { ...COLUMNS[1], header: options.learnerTitle ?? 'Öğrenci' },
        ...COLUMNS.slice(2),
      ],
      rows.map((row, index) => [
        String(index + 1),
        row.studentName,
        row.className ?? '—',
        row.guardianPhoneMasked ?? '—',
        rosterStatusText(row),
        rosterConsentText(row),
        paymentText(row),
      ]),
      true,
    )
  doc.paragraph(
    'Asiller ada göre, yedekler sıralarına göre yazılır. Yer açıldığında sıradaki yedek kendiliğinden asile geçer ve taksiti o anda açılır.',
    8,
  )
  doc.signatures('Etkinlik sorumlusu', 'Okul müdürü', true)
  return doc.finish()
}
