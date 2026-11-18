// Etkinlik bileti (DOM-FIN-103; ON-159; K-326): bilet başına bir sayfa. Etkinlik adı, gün ve saat
// (Europe/Istanbul), salon, koltuk ya da "Numarasız", bilet türü, bilet sahibi, öğrenci ve ödeme
// durumu; altta büyük harfli bilet kodu ve yalnız kodu taşıyan karekod (kişi verisi yok). Girişte
// karekod okutulur ya da kod elle yazılır. Belge web'de üretilir, sunucuda saklanmaz.
import type {
  EventTicketRow,
  TicketedEventRow,
} from '@kampus/react-shared/use-finance-event-tickets.ts'
import {
  EVENT_TICKET_KIND_LABELS,
  EVENT_TICKET_PAYMENT_METHOD_LABELS,
} from '@kampus/school-core/lib/finance-event-tickets.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  COLORS,
  DocumentLayout,
  PAGE,
  type PdfDocument,
  type QrModules,
  type TextMeasurer,
} from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const EVENT_TICKET_TITLE = 'Etkinlik bileti'

export type PrintableTicket = EventTicketRow & { qr: QrModules }
type TicketEvent = Pick<TicketedEventRow, 'name' | 'startsAt' | 'venue'>

const QR_SIZE = 52

const eventMoment = (iso: string) =>
  `${dateLabel(iso, { year: 'numeric', weekday: 'long' })} · ${timeLabel(iso)}`

/** Ödeme satırı: davetiye, ödenmiş (yöntemiyle) ya da ödenmemiş ücretli bilet. */
export function ticketPaymentText(
  ticket: Pick<EventTicketRow, 'ticketKind' | 'priceCents' | 'paymentStatus' | 'paymentMethod'>,
) {
  if (ticket.ticketKind === 'invitation') return EVENT_TICKET_KIND_LABELS.invitation
  const price = money(ticket.priceCents)
  if (ticket.paymentStatus === 'paid')
    return `${price} · Ödendi${ticket.paymentMethod ? ` (${EVENT_TICKET_PAYMENT_METHOD_LABELS[ticket.paymentMethod]})` : ''}`
  return `${price} · Ödenmedi`
}

/** Dosya adı etkinlik gününden ve bilet sayısından; kişi adı ve kod yazılmaz. */
export function eventTicketsFilename(event: TicketEvent, count: number) {
  const day = event.startsAt.slice(0, 10)
  return count === 1
    ? `etkinlik-bileti-${day}.pdf`
    : `etkinlik-biletleri-${day}-${String(count)}.pdf`
}

export function eventTicketsDocument(
  measurer: TextMeasurer,
  event: TicketEvent,
  tickets: readonly PrintableTicket[],
  options: TemplateOptions,
): PdfDocument {
  if (tickets.length === 0) throw new Error('Belgede en az bir bilet olmalıdır.')
  const generatedAt = options.generatedAt ?? new Date()
  const doc = new DocumentLayout(measurer, {
    label: 'ETKİNLİK BİLETİ',
    badge: 'BİLET',
    institution: options.institution,
    generatedAt,
    reference: event.name,
    footerNote: 'Bilet kodu girişte bir kez kullanılır; kodu paylaşmayın.',
  })
  tickets.forEach((ticket, index) => {
    if (index > 0) doc.newPage()
    doc.heading(event.name, eventMoment(event.startsAt))
    doc.fields([
      ['Salon', event.venue],
      ['Koltuk', ticket.seat ?? 'Numarasız'],
      ['Bilet türü', ticket.ticketTypeName],
      ['Ücret', ticketPaymentText(ticket)],
      ['Bilet sahibi', ticket.holderName],
      ['Öğrenci', ticket.studentName ?? '—'],
    ])
    doc.y += 4
    const top = doc.y
    doc.qrCode(ticket.qr, PAGE.left, top, QR_SIZE)
    const textX = PAGE.left + QR_SIZE + 8
    doc.text('Bilet kodu', textX, top + 14, 9, COLORS.muted)
    doc.text(ticket.code, textX, top + 26, 22, COLORS.sapphire)
    doc.text(
      ticket.state === 'unpaid'
        ? 'Ödeme alınmadan girişte kabul edilmez.'
        : 'Girişte karekodu okutun ya da kodu söyleyin.',
      textX,
      top + 36,
      9,
      COLORS.muted,
    )
    doc.y = top + QR_SIZE + 6
  })
  return doc.finish()
}
