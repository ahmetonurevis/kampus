import { z } from 'zod'

import { GUARDIAN_RELATIONSHIP_KEYS } from '@kampus/school-core/lib/guardianship.ts'
import {
  TRIP_DAY_CARD_PURPOSES,
  TRIP_DAY_CHECK_STATUSES,
  TRIP_DAY_HEALTH_KINDS,
  TRIP_DAY_HEALTH_SOURCES,
  TRIP_DAY_MARK_STATUSES,
  TRIP_DAY_ROSTER_STATUSES,
  tripDayCardPurposeSchema,
} from '@kampus/school-core/lib/finance-trip-day.ts'
import { TRIP_PLAN_STATUSES, TRIP_STAFF_ROLES } from '@kampus/school-core/lib/finance-trip-plans.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Gezi günü şemaları (DOM-FIN-154; ON-157; K-517…K-519). Görünüm rolün görebildiği grupları,
 * öğrencilerini ve turlarını taşır; acil kart öğrenci başına acil iletişim ve en az bilgiyle sağlık
 * uyarısı taşır (alerjen, ilaç adı ve doz yok).
 */

export const tripDayParams = z.object({ planId: z.uuid('Gezi planı kimliği geçersiz.') })
export const tripDayGroupParams = tripDayParams.extend({
  groupId: z.uuid('Grup kimliği geçersiz.'),
})
export const tripDayCheckParams = tripDayParams.extend({
  checkId: z.uuid('Yoklama turu kimliği geçersiz.'),
})
export const tripDayCardQuery = z.strictObject({ purpose: tripDayCardPurposeSchema })

const studentSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  className: z.string().nullable(),
})

const countsSchema = z.object({
  total: z.number().int(),
  present: z.number().int(),
  absent: z.number().int(),
  pending: z.number().int(),
})

const checkSchema = z.object({
  id: z.string(),
  sequence: z.number().int().describe('Grupta tur sırası'),
  checkpoint: z.string().describe('Kontrol noktası'),
  status: z.enum(TRIP_DAY_CHECK_STATUSES),
  startedAt: z.string(),
  startedByName: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  counts: countsSchema,
  missingReason: z
    .string()
    .nullable()
    .describe('Eksikle devam gerekçesi; yalnız turu yürütebilen role döner'),
  canOperate: z.boolean().describe('Oturumdaki rol bu turda işaretler ve turu bitirir'),
  version: z.number().int().describe('`If-Match` için turun sürümü'),
  roster: z
    .array(
      studentSchema.extend({
        status: z.enum(TRIP_DAY_ROSTER_STATUSES),
        markedAt: z.string().nullable(),
      }),
    )
    .describe('Süren turda grubun öğrencileri, kapanan turda işaretler; ada göre'),
})

const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  vehiclePlate: z.string().nullable(),
  leaderMembershipId: z.string(),
  leaderName: z.string().nullable(),
  position: z.number().int(),
  students: z.array(studentSchema).describe('Grubun öğrencileri (katılımı süren), ada göre'),
  checks: z.array(checkSchema).describe('Yoklama turları, sırasıyla'),
  openCheckId: z.string().nullable(),
  canEdit: z.boolean(),
  canStartCheck: z.boolean(),
  canOperate: z.boolean(),
  canReadCard: z.boolean(),
  canReadFullCard: z.boolean().describe('Tam telefonlu acil kartı açabilir (K-518)'),
  version: z.number().int().describe('`If-Match` için grubun sürümü'),
})

export const tripDayResponse = dataResponse(
  z.object({
    planId: z.string(),
    planNumber: z.string(),
    planName: z.string(),
    planStatus: z.enum(TRIP_PLAN_STATUSES),
    departureAt: z.string(),
    returnAt: z.string(),
    firstDay: z.string().describe('Gezinin ilk günü (YYYY-MM-DD, Europe/Istanbul)'),
    lastDay: z.string().describe('Gezinin son günü'),
    isTripDay: z.boolean().describe('Bugün gezi günlerinden biri; tur yalnız o zaman açılır'),
    transportPlate: z.string().nullable().describe('Planın ulaşım plakası (grup için öneri)'),
    paidActivity: z.object({ id: z.string(), name: z.string() }).nullable(),
    participantSource: z
      .enum(['activity', 'students'])
      .describe(
        '`activity` bağlı ücretli etkinliğin asil katılımları, `students` kayıtlı öğrenciler',
      ),
    participantCount: z.number().int(),
    canManage: z.boolean().describe('Grup kurar ve dağıtır (yönetici, ön büro)'),
    staff: z
      .array(
        z.object({
          membershipId: z.string(),
          name: z.string().nullable(),
          role: z.enum(TRIP_STAFF_ROLES),
        }),
      )
      .describe('Planın görevlileri (grup sorumlusu seçenekleri); yalnız yönetici ve ön büroya'),
    groups: z.array(groupSchema),
    unassigned: z
      .array(studentSchema)
      .describe('Grubu olmayan katılımcılar (en çok 500, ada göre); yalnız yönetici ve ön büroya'),
    unassignedTotal: z.number().int(),
  }),
)

const healthSchema = z.object({
  alert: z.boolean(),
  kinds: z.array(z.enum(TRIP_DAY_HEALTH_KINDS)).describe('Yalnız tür: alerji, kronik durum, ilaç'),
  action: z.string().nullable().describe('Kısaltılmış acil talimat (en çok 200 karakter)'),
  medicationToday: z.boolean().describe('Revirde kart günü için onaylı ilaç talebi var'),
  source: z
    .enum(TRIP_DAY_HEALTH_SOURCES)
    .describe('`unavailable`: okuyanın sağlık profili erişimi yok; yalnız revir işareti'),
})

export const tripDayCardResponse = dataResponse(
  z.object({
    plan: z.object({
      id: z.string(),
      number: z.string(),
      name: z.string(),
      departureAt: z.string(),
      returnAt: z.string(),
      emergencyContacts: z.array(
        z.object({ name: z.string(), phone: z.string(), relation: z.string().nullable() }),
      ),
    }),
    group: z.object({
      id: z.string(),
      name: z.string(),
      vehiclePlate: z.string().nullable(),
      leaderName: z.string().nullable(),
    }),
    purpose: z.enum(TRIP_DAY_CARD_PURPOSES),
    phonesMasked: z.boolean(),
    cardDay: z.string().describe('Revir ilaç işaretinin günü (YYYY-MM-DD)'),
    total: z.number().int(),
    students: z.array(
      studentSchema.extend({
        contacts: z.array(
          z.object({
            name: z.string().nullable(),
            relationship: z.enum(GUARDIAN_RELATIONSHIP_KEYS).nullable(),
            phone: z.string().nullable().describe('Amaca göre maskeli ya da tam'),
          }),
        ),
        health: healthSchema,
      }),
    ),
  }),
)

export const myTripDaysResponse = dataResponse(
  z.array(
    z.object({
      studentId: z.string(),
      studentName: z.string(),
      planId: z.string(),
      planName: z.string(),
      departureAt: z.string(),
      returnAt: z.string(),
      groupName: z.string(),
      leaderName: z.string().nullable(),
      checkpoint: z.string().nullable().describe('Son kapanan kontrol noktası; yoksa boş'),
      checkedAt: z.string().nullable(),
      status: z.enum(TRIP_DAY_MARK_STATUSES).nullable().describe('Çocuğun o noktadaki işareti'),
    }),
  ),
)
