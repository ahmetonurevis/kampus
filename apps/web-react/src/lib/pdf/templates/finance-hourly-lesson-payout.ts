// Ders saati hakediş dökümü (DOM-FIN-167; ON-075; IST-087): saat ücretli öğretmenin ay dökümü ve
// ayın öğretmen özeti. Veri `purpose=pdf` ile okunan yanıttır (okuma denetime düşer); burada
// yeniden hesaplanmaz. Döküm bordro değildir ve bordroya aktarılmaz (K-558).
import type {
  HourlyLessonPayoutDetail,
  HourlyLessonPayouts,
} from '@kampus/react-shared/use-finance-hourly-lesson-payouts.ts'
import {
  HOURLY_PAYOUT_NOTE,
  PAYOUT_LINE_KIND_LABELS,
  PAYOUT_LINE_STATUS_LABELS,
  PAYOUT_PAY_BASIS_LABELS,
  PAYOUT_UNPRICED_LABELS,
  PAYOUT_WARNING_LABELS,
  hourlyPayoutFilename,
  payoutMonthLabel,
  payoutRateText,
} from '@kampus/school-core/lib/finance-hourly-lesson-payouts.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const HOURLY_PAYOUT_TITLE = 'Ders saati hakediş dökümü'

const META = {
  label: 'DERS SAATİ HAKEDİŞ DÖKÜMÜ',
  badge: 'DÖKÜM',
  footerNote: 'Bordro değildir; tutar ücret tanımından hesaplanan dökümdür.',
} as const

const LINE_COLUMNS = [
  { header: 'Gün', width: 20 },
  { header: 'Saat', width: 14 },
  { header: 'Sınıf / grup', width: 26 },
  { header: 'Ders', width: 30 },
  { header: 'Tür', width: 22 },
  { header: 'Durum', width: 26 },
  { header: 'Süre', width: 14 },
  { header: 'Tutar', width: 22 },
] as const

const SUMMARY_COLUMNS = [
  { header: 'Öğretmen', width: 40 },
  { header: 'Ücret', width: 30 },
  { header: 'Verilen', width: 22 },
  { header: 'Ders saati', width: 18 },
  { header: 'İptal', width: 14 },
  { header: 'Telafi', width: 14 },
  { header: 'Tutar', width: 36 },
] as const

const shortDay = (day: string) => dateLabel(`${day}T09:00:00.000Z`)
const longDay = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export const hourlyPayoutPdfFilename = (month: string, membershipId?: string) =>
  membershipId === undefined
    ? hourlyPayoutFilename(month, 'pdf')
    : hourlyPayoutFilename(month, 'pdf').replace(
        '.pdf',
        `-${membershipId.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)}.pdf`,
      )

type Line = HourlyLessonPayoutDetail['days'][number]['lines'][number]

/** Tutar hücresi: verilen derste tutar ya da neden boş; verilmeyende tire. */
export function payoutAmountCell(line: Line): string {
  if (line.amountCents !== null) return money(line.amountCents)
  if (line.status !== 'counted') return '—'
  return line.unpriced === null ? '—' : PAYOUT_UNPRICED_LABELS[line.unpriced]
}

/** Öğretmenin ay dökümü: özet, ücret dilimleri, gün gün dersler ve uyarılar. */
export function hourlyPayoutDetailDocument(
  measurer: TextMeasurer,
  detail: HourlyLessonPayoutDetail,
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    ...META,
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `ders-saati-${detail.month}`,
  })
  const { totals } = detail
  doc.heading(HOURLY_PAYOUT_TITLE, `${detail.staffName} · ${payoutMonthLabel(detail.month)}`)
  doc.paragraph(HOURLY_PAYOUT_NOTE)
  doc.metrics([
    ['VERİLEN DERS', String(totals.givenLessons)],
    ['DERS SAATİ', String(totals.givenHours)],
    ['İPTAL / TELAFİ', `${String(totals.cancelledLessons)} / ${String(totals.makeupLessons)}`],
    ['TUTAR', money(totals.amountCents)],
  ])
  doc.section('Özet')
  doc.fields([
    ['Kurum', options.institution],
    ['Ücret türü', PAYOUT_PAY_BASIS_LABELS[detail.payBasis]],
    ['Verilen süre', `${String(totals.givenMinutes)} dakika`],
    [
      'Yedek / grup dersi',
      `${String(totals.substituteHours)} / ${String(totals.groupHours)} ders saati`,
    ],
    [
      'Ödenmeyen',
      `${String(totals.substitutedOutLessons)} yedeğe devredildi, ${String(totals.holidayLessons)} tatil, ${String(totals.leaveLessons)} izinli`,
    ],
    ['Ay durumu', detail.monthComplete ? 'Ay tamamlandı' : 'Ay sürüyor; gelecek dersler sayılmadı'],
  ])
  if (detail.rates.length > 0) {
    doc.section('Ücret dilimleri')
    for (const rate of detail.rates)
      doc.paragraph(
        `${payoutRateText(rate.rateType, rate.rateCents)} (${longDay(rate.startDate)}${rate.endDate === null ? ' itibarıyla' : ` – ${longDay(rate.endDate)}`}): ${String(rate.lessons)} ders, ${String(rate.hours)} ders saati, ${String(rate.minutes)} dakika · ${money(rate.amountCents)}`,
      )
  }
  doc.section('Dersler')
  const lines = detail.days.flatMap((day) => day.lines)
  if (lines.length === 0) doc.paragraph('Bu ay ders yok.')
  else
    doc.table(
      LINE_COLUMNS,
      lines.map((line) => [
        shortDay(line.day),
        timeLabel(line.startsAt),
        line.placeName ?? line.classId ?? '—',
        line.title ?? '—',
        PAYOUT_LINE_KIND_LABELS[line.kind],
        PAYOUT_LINE_STATUS_LABELS[line.status],
        `${String(line.minutes)} dk`,
        payoutAmountCell(line),
      ]),
      true,
    )
  if (detail.warnings.length > 0) {
    doc.section('Uyarılar')
    for (const code of detail.warnings) doc.paragraph(PAYOUT_WARNING_LABELS[code])
  }
  return doc.finish()
}

/** Ayın öğretmen özeti (yönetici). */
export function hourlyPayoutSummaryDocument(
  measurer: TextMeasurer,
  list: HourlyLessonPayouts,
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    ...META,
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `ders-saati-${list.month}`,
  })
  doc.heading(HOURLY_PAYOUT_TITLE, payoutMonthLabel(list.month))
  doc.paragraph(HOURLY_PAYOUT_NOTE)
  doc.metrics([
    ['ÖĞRETMEN', String(list.totals.teacherCount)],
    ['DERS SAATİ', String(list.totals.givenHours)],
    [
      'İPTAL / TELAFİ',
      `${String(list.totals.cancelledLessons)} / ${String(list.totals.makeupLessons)}`,
    ],
    ['TUTAR', money(list.totals.amountCents)],
  ])
  doc.section('Öğretmenler')
  if (list.teachers.length === 0) doc.paragraph('Bu ay saat ücretli öğretmenin dersi yok.')
  else
    doc.table(
      SUMMARY_COLUMNS,
      list.teachers.map((teacher) => [
        teacher.staffName,
        PAYOUT_PAY_BASIS_LABELS[teacher.payBasis],
        `${String(teacher.totals.givenLessons)} ders`,
        String(teacher.totals.givenHours),
        String(teacher.totals.cancelledLessons),
        String(teacher.totals.makeupLessons),
        teacher.totals.unpricedHours > 0
          ? `${money(teacher.totals.amountCents)} (${String(teacher.totals.unpricedHours)} saat eksik)`
          : money(teacher.totals.amountCents),
      ]),
      true,
    )
  const warned = list.teachers.filter((teacher) => teacher.warnings.length > 0)
  if (warned.length > 0) {
    doc.section('Uyarılar')
    for (const teacher of warned)
      doc.paragraph(
        `${teacher.staffName}: ${teacher.warnings.map((code) => PAYOUT_WARNING_LABELS[code]).join('; ')}.`,
      )
  }
  return doc.finish()
}
