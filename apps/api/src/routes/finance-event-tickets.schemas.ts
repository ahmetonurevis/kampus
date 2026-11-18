import { z } from 'zod'

import {
  EVENT_LIMIT_SCOPES,
  EVENT_SEATING_MODES,
  EVENT_TICKET_KINDS,
  EVENT_TICKET_PAYMENT_METHODS,
  EVENT_TICKET_PAYMENT_STATUSES,
  EVENT_TICKET_REFUND_STATUSES,
  EVENT_TICKET_STATES,
  EVENT_TICKET_STATUSES,
} from '@kampus/school-core/lib/finance-event-tickets.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Etkinlik bileti ve oturma şemaları (DOM-FIN-103; ON-159, ON-345; K-324…K-327, K-378…K-380). */

const ticketTypeSchema = z.object({
  key: z.string().describe('Bilet türü anahtarı (ayırmada `ticketTypeKey`)'),
  name: z.string(),
  kind: z.enum(EVENT_TICKET_KINDS).describe('`invitation` ücretsiz davetiye, `paid` ücretli'),
  priceCents: z.number().int().describe('Fiyat, kuruş; davetiyede 0'),
})

const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: z.string().describe('Başlangıç anı (ISO 8601 UTC)'),
  venue: z.string(),
  schoolEventId: z.string().nullable().describe('Bağlı okul takvimi etkinliği'),
  schoolEventTitle: z.string().nullable().describe('Takvim etkinliğinin başlığı'),
  seatingMode: z.enum(EVENT_SEATING_MODES).describe('`seated` numaralı, `general` numarasız'),
  rowCount: z.number().int().nullable(),
  seatsPerRow: z.number().int().nullable(),
  blockedSeats: z.array(z.string()).describe('Satışa kapalı koltuklar'),
  capacity: z.number().int().nullable().describe('Numarasız etkinliğin kontenjanı'),
  ticketTypes: z.array(ticketTypeSchema),
  perStudentLimit: z
    .number()
    .int()
    .nullable()
    .describe('Öğrenci ya da aile başına üst sınır; boşsa sınırsız'),
  limitScope: z
    .enum(EVENT_LIMIT_SCOPES)
    .describe('`student` öğrenci başına, `family` aile başına (kardeşler birlikte sayılır; K-379)'),
  salesOpen: z.boolean(),
  totalCapacity: z.number().int().describe('Satışa açık koltuk ya da kontenjan'),
  activeCount: z.number().int().describe('Etkin (iptal edilmemiş) bilet'),
  availableCount: z.number().int().describe('Boş yer'),
  invitationCount: z.number().int().describe('Etkin davetiye'),
  usedCount: z.number().int().describe('Girişte kullanılan bilet'),
  unpaidCount: z.number().int().describe('Ödemesi beklenen ücretli bilet'),
  collectedCents: z
    .number()
    .int()
    .describe('Ödenmiş biletlerin net toplamı, kuruş: iptalde yazılan iade düşer, kesinti kalır'),
  pendingRefundCount: z.number().int().describe('Ödendiği işaretlenmemiş iade sayısı (K-380)'),
  pendingRefundCents: z.number().int().describe('Ödenmesi bekleyen iade toplamı, kuruş'),
  takenSeats: z.array(z.string()).describe('Etkin bileti olan koltuklar (koltuk haritası)'),
  version: z.number().int().describe('`If-Match` için etkinliğin sürümü'),
})

export const ticketedEventResponse = dataResponse(eventSchema)
export const ticketedEventListResponse = z.object({
  data: z.array(eventSchema),
  meta: pageMetaSchema,
})
export const ticketedEventArchiveResponse = dataResponse(
  z.object({ id: z.string(), archivedAt: z.string() }),
)
export const ticketedEventListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Ad ve salonda arama, Türkçe harf duyarsız'),
  when: z
    .enum(['upcoming', 'past'])
    .optional()
    .describe('`upcoming` başlamamış, `past` başlamış etkinlikler'),
})
export const ticketedEventParams = z.object({ eventId: z.uuid('Etkinlik geçersiz.') })

const ticketSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  code: z.string().describe('Bilet kodu (`XXXX-XXXX-XXXX`); PDF ve girişte kullanılır'),
  ticketTypeKey: z.string(),
  ticketTypeName: z.string().describe('Ayırma anındaki tür adı'),
  ticketKind: z.enum(EVENT_TICKET_KINDS),
  priceCents: z.number().int().describe('Ayırma anındaki fiyat, kuruş'),
  seat: z.string().nullable(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  holderName: z.string().describe('Bileti kullanacak veli ya da misafir'),
  status: z.enum(EVENT_TICKET_STATUSES),
  paymentStatus: z.enum(EVENT_TICKET_PAYMENT_STATUSES),
  paymentMethod: z.enum(EVENT_TICKET_PAYMENT_METHODS).nullable(),
  paidAt: z.string().nullable(),
  refundCents: z
    .number()
    .int()
    .nullable()
    .describe('İptal edilen ödenmiş bilette iade tutarı, kuruş (0…bedel; K-380); diğerlerinde boş'),
  refundMethod: z.enum(EVENT_TICKET_PAYMENT_METHODS).nullable().describe('İadenin yöntemi'),
  refundedAt: z.string().nullable().describe('İadenin ödendiğinin işaretlendiği an'),
  refundStatus: z
    .enum(EVENT_TICKET_REFUND_STATUSES)
    .describe('`none` iade yok, `pending` iade bekliyor, `paid` iade ödendi'),
  usedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  state: z
    .enum(EVENT_TICKET_STATES)
    .describe(
      '`valid` girişe hazır, `unpaid` ödeme bekliyor, `used` kullanıldı, `cancelled` iptal',
    ),
  checkInUndoCount: z.number().int().describe('Geri alınmış giriş sayısı (K-378)'),
  canUndoCheckIn: z
    .boolean()
    .describe(
      'İsteği yapan bu biletin girişini şimdi geri alabilir mi (kullanılmış, yönetici ya da okutan, etkinlik günü bitmemiş)',
    ),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için biletin sürümü'),
})

export const eventTicketResponse = dataResponse(ticketSchema)
export const eventTicketAllocationResponse = dataResponse(z.array(ticketSchema))
export const eventTicketListResponse = z.object({
  data: z.array(ticketSchema),
  meta: pageMetaSchema,
})
export const eventTicketListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Bilet sahibi, öğrenci adı, koltuk ve kodda arama'),
  state: z.enum(EVENT_TICKET_STATES).optional().describe('Bilet durumu'),
  studentId: z.string().trim().min(1).max(64).optional().describe('Öğrencinin biletleri'),
})
export const eventTicketParams = z.object({ ticketId: z.uuid('Bilet geçersiz.') })
