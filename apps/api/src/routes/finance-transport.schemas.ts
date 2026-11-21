import { z } from 'zod'

import { TRANSPORT_DIRECTIONS } from '@kampus/school-core/lib/finance-transport.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Servis aracı, güzergâh ve atama şemaları (DOM-FIN-142; ON-098). Telefon yalnız maskeli (K-481). */

const direction = z
  .enum(TRANSPORT_DIRECTIONS)
  .describe('`morning` sabah (evden okula), `evening` akşam (okuldan eve)')

export const vehicleSchema = z.object({
  id: z.string(),
  plate: z.string().describe('Plaka, boşluksuz büyük harf (`34ABC123`)'),
  capacity: z.number().int().describe('Öğrenci koltuk sayısı'),
  // kvkk: K (sürücü kimliği)
  driverName: z.string().describe('Sürücünün adı soyadı'),
  driverPhoneMasked: z.string().describe('Sürücü telefonu, maskeli (`0532 *** ** 67`; K-481)'),
  guideMembershipId: z.string().nullable().describe('Rehber personelin kurum üyeliği'),
  guideName: z.string().nullable().describe('Rehber personelin adı'),
  routeCount: z.number().int().describe('Aracın etkin güzergâh sayısı'),
  maxRouteLoad: z
    .number()
    .int()
    .describe('Aracın güzergâhlarındaki en yüksek atanmış öğrenci sayısı (kapasite alt sınırı)'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const routeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  direction,
  vehicleId: z.string(),
  vehiclePlate: z.string().nullable(),
  capacity: z.number().int().describe('Aracın kapasitesi'),
  load: z.number().int().describe('Güzergâhtaki etkin atama sayısı'),
  stopCount: z.number().int(),
  firstStopTime: z.string().nullable().describe('İlk durağın saati (SS:DD)'),
  lastStopTime: z.string().nullable().describe('Son durağın saati (SS:DD)'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const assignmentSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  // kvkk: K (öğrenci)
  studentName: z.string(),
  stopId: z.string(),
  stopName: z.string(),
  stopTime: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için atama sürümü (kaldırma)'),
})

export const routeDetailSchema = routeRowSchema.extend({
  driverName: z.string().nullable(),
  driverPhoneMasked: z.string().nullable().describe('Sürücü telefonu, maskeli (K-481)'),
  guideName: z.string().nullable(),
  stops: z.array(
    z.object({
      id: z.string(),
      position: z.number().int().describe('Sıra (1’den)'),
      name: z.string().describe('Durak adı ya da semt'),
      time: z.string().describe('Geçiş saati (SS:DD)'),
      assigned: z.number().int().describe('Durağa atanmış öğrenci sayısı'),
    }),
  ),
  assignments: z.array(assignmentSchema).describe('Etkin atamalar, durak sırası ve ada göre'),
})

export const myTransportSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  direction,
  routeName: z.string(),
  stopName: z.string(),
  stopPosition: z.number().int(),
  stopTime: z.string().describe('Duraktan geçiş saati (SS:DD)'),
  vehiclePlate: z.string().nullable(),
  driverName: z.string().nullable(),
  driverPhoneMasked: z.string().nullable().describe('Sürücü telefonu, maskeli (K-481)'),
  guideName: z.string().nullable(),
})

export const vehicleResponse = dataResponse(vehicleSchema)
export const vehicleListResponse = z.object({
  data: z.array(vehicleSchema),
  meta: pageMetaSchema,
})
export const routeResponse = dataResponse(routeDetailSchema)
export const routeListResponse = z.object({ data: z.array(routeRowSchema), meta: pageMetaSchema })
export const assignmentResponse = dataResponse(assignmentSchema)
export const archivedResponse = dataResponse(z.object({ id: z.string() }))
export const myTransportResponse = dataResponse(z.array(myTransportSchema))

const searchQuery = z.string().trim().min(2).max(100).optional()

export const vehicleListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: searchQuery.describe('Plakada arama (boşluksuz)'),
})
export const routeListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: searchQuery.describe('Güzergâh adında arama'),
  direction: direction.optional(),
  vehicleId: z.uuid().optional().describe('Aracın güzergâhları'),
})

export const vehicleParams = z.object({ vehicleId: z.uuid('Araç geçersiz.') })
export const routeParams = z.object({ routeId: z.uuid('Güzergâh geçersiz.') })
export const assignmentParams = z.object({ assignmentId: z.uuid('Atama geçersiz.') })
