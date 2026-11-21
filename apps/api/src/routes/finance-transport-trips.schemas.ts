import { z } from 'zod'

import { TRANSPORT_DIRECTIONS } from '@kampus/school-core/lib/finance-transport.ts'
import {
  TRANSPORT_ROSTER_STATUSES,
  TRANSPORT_TRIP_STATUSES,
} from '@kampus/school-core/lib/finance-transport-trips.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Servis seferi ve biniş-iniş şemaları (DOM-FIN-149; ON-145). Konum alanı yoktur. */

const direction = z
  .enum(TRANSPORT_DIRECTIONS)
  .describe('`morning` sabah (evden okula), `evening` akşam (okuldan eve)')
const tripStatus = z.enum(TRANSPORT_TRIP_STATUSES).describe('`open` sürüyor, `closed` kapandı')
const rosterStatus = z
  .enum(TRANSPORT_ROSTER_STATUSES)
  .describe('`pending` işaretlenmedi, `boarded` bindi (araçta), `alighted` indi, `absent` gelmedi')

export const tripCountsSchema = z.object({
  total: z.number().int().describe('Listedeki öğrenci'),
  pending: z.number().int().describe('İşaretlenmemiş'),
  boarded: z.number().int().describe('Binen (inen dahil)'),
  alighted: z.number().int().describe('İnen'),
  absent: z.number().int().describe('Gelmeyen'),
  onBoard: z
    .number()
    .int()
    .describe('Binip inişi işaretlenmemiş: araçta olabilir; sıfır değilse sefer kapanmaz (K-504)'),
})

export const tripRosterRowSchema = z.object({
  studentId: z.string(),
  // kvkk: K (öğrenci)
  studentName: z.string(),
  stopId: z.string(),
  stopName: z.string(),
  stopPosition: z.number().int().describe('Durak sırası (1’den); liste bu sıraya göredir'),
  stopTime: z.string().nullable().describe('Duraktan geçiş saati (SS:DD)'),
  status: rosterStatus,
  boardedAt: z.string().nullable().describe('Biniş anı (ISO 8601 UTC)'),
  alightedAt: z.string().nullable().describe('İniş anı (ISO 8601 UTC)'),
  correctedAt: z.string().nullable().describe('Son yönetici düzeltmesinin anı (K-503)'),
  // kvkk: K (serbest metin)
  correctionReason: z
    .string()
    .nullable()
    .describe('Son düzeltmenin gerekçesi; yalnız yöneticiye döner (K-503)'),
})

export const tripDetailSchema = z.object({
  id: z.string(),
  routeId: z.string(),
  routeName: z.string(),
  direction,
  tripDate: z.string().describe('Seferin günü (YYYY-MM-DD, Europe/Istanbul)'),
  status: tripStatus,
  vehiclePlate: z.string().nullable().describe('Başlatma anındaki aracın plakası'),
  guideName: z.string().nullable().describe('Güzergâhın aracının rehber personeli'),
  startedAt: z.string(),
  closedAt: z.string().nullable(),
  counts: tripCountsSchema,
  canOperate: z.boolean().describe('Oturumdaki kullanıcı bu açık seferi işaretleyip kapatabilir'),
  canCorrect: z
    .boolean()
    .describe('Oturumdaki kullanıcı bu kapanmış seferi düzeltebilir (yönetici)'),
  version: z.number().int().describe('Kapatma `If-Match` sürümü'),
  roster: z.array(tripRosterRowSchema).describe('Öğrenciler durak sırasına ve ada göre'),
})

export const tripDayRowSchema = z.object({
  routeId: z.string(),
  routeName: z.string(),
  direction,
  vehiclePlate: z.string().nullable(),
  guideName: z.string().nullable(),
  assigned: z.number().int().describe('Güzergâha bugün atanmış öğrenci'),
  canOperate: z.boolean().describe('Oturumdaki kullanıcı bu güzergâhın seferini yürütebilir'),
  trip: z
    .object({
      id: z.string(),
      status: tripStatus,
      startedAt: z.string(),
      closedAt: z.string().nullable(),
      counts: tripCountsSchema,
      version: z.number().int(),
    })
    .nullable()
    .describe('Günün seferi; başlatılmadıysa `null`'),
})

export const myTripSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  direction,
  routeName: z.string(),
  stopName: z.string(),
  stopTime: z.string().nullable(),
  tripDate: z.string().describe('Bugün (YYYY-MM-DD, Europe/Istanbul)'),
  tripStatus: z
    .enum(['not_started', ...TRANSPORT_TRIP_STATUSES])
    .describe('`not_started` sefer başlamadı, `open` sürüyor, `closed` kapandı'),
  status: rosterStatus,
  boardedAt: z.string().nullable(),
  alightedAt: z.string().nullable(),
})

export const tripResponse = dataResponse(tripDetailSchema)
export const tripDayListResponse = z.object({
  data: z.array(tripDayRowSchema),
  meta: pageMetaSchema,
})
export const myTripsResponse = dataResponse(z.array(myTripSchema))

export const tripDayQuery = z.strictObject({
  ...pageQuerySchema.shape,
  date: z.iso
    .date('Günü YYYY-MM-DD biçiminde girin.')
    .optional()
    .describe('Gün (YYYY-MM-DD, Europe/Istanbul); verilmezse bugün'),
  direction: direction.optional(),
})

export const tripParams = z.object({ tripId: z.uuid('Sefer geçersiz.') })
export const tripRouteParams = z.object({ routeId: z.uuid('Güzergâh geçersiz.') })
