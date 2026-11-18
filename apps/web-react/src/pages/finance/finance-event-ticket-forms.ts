import { z } from 'zod'
import type {
  CreateTicketedEventBody,
  TicketedEventRow,
} from '@kampus/react-shared/use-finance-event-tickets.ts'
import {
  EVENT_SEATING_MODES,
  EVENT_TICKET_KINDS,
  normalizeSeat,
} from '@kampus/school-core/lib/finance-event-tickets.ts'

// Etkinlik bileti formlarının saf yardımcıları (DOM-FIN-103; ON-159): form değerleri metindir,
// gövdeye çevrilirken sayı ve kuruşa döner. Başlangıç saati Türkiye saatiyle girilir (UTC+3, yaz
// saati yok); sunucu ISO anı saklar.

const TURKEY_OFFSET = '+03:00'
const MINUTE_MS = 60_000

/** ISO anı `datetime-local` değerine (Türkiye saati) çevirir. */
export function localInputOf(iso: string): string {
  const shifted = new Date(Date.parse(iso) + 180 * MINUTE_MS)
  return shifted.toISOString().slice(0, 16)
}

/** `datetime-local` değerini (Türkiye saati) ISO ana çevirir. */
export const isoOfLocal = (value: string) => `${value}:00${TURKEY_OFFSET}`

/** "150" ya da "150,50" → kuruş; geçersizse `null`. */
export function centsOf(value: string): number | null {
  const text = value.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  return Math.round(Number(text) * 100)
}

export const priceTextOf = (cents: number) =>
  cents === 0 ? '0' : (cents / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')

const optionalInt = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d+$/.test(value), `${label} tam sayı olmalıdır.`)

export const eventFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Etkinlik adını yazın.').max(120),
    startsAt: z.string().min(1, 'Başlangıç gün ve saatini seçin.'),
    venue: z.string().trim().min(2, 'Salonu yazın.').max(120),
    seatingMode: z.enum(EVENT_SEATING_MODES),
    rowCount: optionalInt('Sıra sayısı'),
    seatsPerRow: optionalInt('Koltuk sayısı'),
    blockedSeats: z.string(),
    capacity: optionalInt('Kontenjan'),
    perStudentLimit: optionalInt('Üst sınır'),
    ticketTypes: z
      .array(
        z.object({
          key: z.string(),
          name: z.string().trim().min(2, 'Bilet türünün adını yazın.').max(60),
          kind: z.enum(EVENT_TICKET_KINDS),
          price: z.string(),
        }),
      )
      .min(1, 'En az bir bilet türü ekleyin.')
      .max(5, 'En çok 5 bilet türü olabilir.'),
  })
  .superRefine((value, ctx) => {
    if (value.seatingMode === 'seated') {
      if (value.rowCount === '')
        ctx.addIssue({ code: 'custom', path: ['rowCount'], message: 'Sıra sayısını yazın.' })
      if (value.seatsPerRow === '')
        ctx.addIssue({
          code: 'custom',
          path: ['seatsPerRow'],
          message: 'Sıra başına koltuk sayısını yazın.',
        })
    } else if (value.capacity === '')
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Kontenjanı yazın.' })
    value.ticketTypes.forEach((type, index) => {
      const cents = type.kind === 'invitation' ? 0 : centsOf(type.price)
      if (cents === null || (type.kind === 'paid' && cents === 0))
        ctx.addIssue({
          code: 'custom',
          path: ['ticketTypes', index, 'price'],
          message: 'Fiyatı 150 ya da 150,50 biçiminde yazın.',
        })
    })
  })
export type EventFormValues = z.infer<typeof eventFormSchema>

export function eventDefaults(event?: TicketedEventRow): EventFormValues {
  if (!event)
    return {
      name: '',
      startsAt: '',
      venue: '',
      seatingMode: 'seated',
      rowCount: '10',
      seatsPerRow: '12',
      blockedSeats: '',
      capacity: '',
      perStudentLimit: '2',
      ticketTypes: [{ key: '', name: 'Davetiye', kind: 'invitation', price: '0' }],
    }
  const text = (value: number | null) => (value === null ? '' : String(value))
  return {
    name: event.name,
    startsAt: localInputOf(event.startsAt),
    venue: event.venue,
    seatingMode: event.seatingMode,
    rowCount: text(event.rowCount),
    seatsPerRow: text(event.seatsPerRow),
    blockedSeats: event.blockedSeats.join(', '),
    capacity: text(event.capacity),
    perStudentLimit: text(event.perStudentLimit),
    ticketTypes: event.ticketTypes.map((type) => ({
      key: type.key,
      name: type.name,
      kind: type.kind,
      price: priceTextOf(type.priceCents),
    })),
  }
}

const intOrNull = (value: string) => (value.trim() === '' ? null : Number(value))

/** Form değerlerinden gövde; numaralı/numarasız düzene ait olmayan alanlar boş gider. */
export function eventBody(values: EventFormValues): CreateTicketedEventBody {
  const seated = values.seatingMode === 'seated'
  return {
    name: values.name.trim(),
    startsAt: isoOfLocal(values.startsAt),
    venue: values.venue.trim(),
    seatingMode: values.seatingMode,
    rowCount: seated ? intOrNull(values.rowCount) : null,
    seatsPerRow: seated ? intOrNull(values.seatsPerRow) : null,
    blockedSeats: seated
      ? values.blockedSeats
          .split(/[,;\s]+/)
          .map(normalizeSeat)
          .filter((seat) => seat !== '')
      : [],
    capacity: seated ? null : intOrNull(values.capacity),
    perStudentLimit: intOrNull(values.perStudentLimit),
    ticketTypes: values.ticketTypes.map((type) => ({
      ...(type.key === '' ? {} : { key: type.key }),
      name: type.name.trim(),
      kind: type.kind,
      priceCents: type.kind === 'invitation' ? 0 : (centsOf(type.price) ?? 0),
    })),
  }
}

const EVENT_FIELDS = [
  'name',
  'startsAt',
  'venue',
  'seatingMode',
  'rowCount',
  'seatsPerRow',
  'blockedSeats',
  'capacity',
  'perStudentLimit',
  'ticketTypes',
] as const
export type EventFormField = (typeof EVENT_FIELDS)[number]

/** Sunucu alan yolunu forma eşler (`blockedSeats.2` → `blockedSeats`); tanınmayan yol `null`. */
export function eventFormField(name: string): EventFormField | null {
  const [head] = name.split('.')
  return EVENT_FIELDS.find((field) => field === head) ?? null
}
