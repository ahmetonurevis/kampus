import { z } from 'zod'

import {
  MONTHLY_DEDUCTION_KINDS,
  MONTHLY_DEDUCTION_STATUSES,
  STAFF_ADVANCE_PAYMENT_METHODS,
  STAFF_ADVANCE_STATUSES,
  STAFF_GARNISHMENT_CLOSE_REASONS,
  STAFF_GARNISHMENT_STATUSES,
  STAFF_PENSION_OPT_OUT_KINDS,
  STAFF_PENSION_STATES,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Avans ve kesinti şemaları (DOM-FIN-101; ON-199). Bütün alanlar yalnız yöneticiye döner (K-315). */

const staffSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
})

const staffRowSchema = staffSchema.extend({
  activeAdvanceCount: z.number().int().describe('Mahsubu süren avans sayısı'),
  activeGarnishmentCount: z.number().int().describe('Açık icra sayısı'),
  openPensionCount: z.number().int().describe('Ayrılmamış BES katılımı (0 ya da 1)'),
})
export const staffListResponse = z.object({ data: z.array(staffRowSchema), meta: pageMetaSchema })

const advanceSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  amountCents: z.number().int(),
  givenDate: z.string(),
  paymentMethod: z.enum(STAFF_ADVANCE_PAYMENT_METHODS),
  installmentCount: z.number().int(),
  firstMonth: z.string(),
  status: z.enum(STAFF_ADVANCE_STATUSES),
  closedDate: z.string().nullable(),
  closedFromMonth: z.string().nullable(),
  closeMethod: z.enum(STAFF_ADVANCE_PAYMENT_METHODS).nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  installments: z
    .array(
      z.object({
        month: z.string(),
        amountCents: z.number().int(),
        state: z
          .enum(['past', 'current', 'upcoming', 'closed', 'cancelled'])
          .describe(
            'Bugünün ayına göre: `past` geçmiş ay, `current` bu ay, `upcoming` gelecek, `closed` erken kapamada personelin ödediği, `cancelled` iptal',
          ),
      }),
    )
    .describe('Taksit planı (saklanmaz; eşit kuruş, fark son taksitte)'),
  outstandingCents: z.number().int().describe('Bu ay dahil kesilecek kalan tutar'),
  closedRemainderCents: z
    .number()
    .int()
    .nullable()
    .describe('Erken kapamada personelin ödediği kalan; kapanmamışsa boş'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const advanceResponse = dataResponse(advanceSchema)

const garnishmentSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  office: z.string(),
  fileNumber: z.string(),
  claimCents: z.number().int(),
  remainingCents: z.number().int(),
  rateBasisPoints: z.number().int().describe('Net ücretten oran, onbinde'),
  isAlimony: z.boolean(),
  receivedDate: z.string(),
  sequence: z.number().int().describe('Personelde kayıt sıra numarası'),
  queuePosition: z
    .number()
    .int()
    .nullable()
    .describe(
      'Açık icralar arasında kesinti sırası (nafaka önce, sonra tebliğ günü); kapanmışta boş',
    ),
  status: z.enum(STAFF_GARNISHMENT_STATUSES),
  closedDate: z.string().nullable(),
  closeReason: z.enum(STAFF_GARNISHMENT_CLOSE_REASONS).nullable(),
  createdAt: z.string(),
  version: z.number().int(),
})
export const garnishmentResponse = dataResponse(garnishmentSchema)

const pensionSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  rateBasisPoints: z.number().int(),
  startDate: z.string(),
  pauses: z.array(z.object({ fromMonth: z.string(), toMonth: z.string() })),
  optOutDate: z.string().nullable(),
  state: z.enum(STAFF_PENSION_STATES).describe('Bugünün ayındaki durum'),
  optOutKind: z
    .enum(STAFF_PENSION_OPT_OUT_KINDS)
    .nullable()
    .describe('`cooling_off` iki ay içinde cayma, `exit` sonra ayrılma'),
  createdAt: z.string(),
  version: z.number().int(),
})
export const pensionResponse = dataResponse(pensionSchema)

export const staffDeductionsResponse = dataResponse(
  z.object({
    staff: staffSchema,
    advances: z.array(advanceSchema),
    garnishments: z.array(garnishmentSchema),
    pensions: z.array(pensionSchema),
  }),
)

export const monthlyDeductionResponse = dataResponse(
  z.object({
    month: z.string(),
    netCents: z.number().int().nullable(),
    lines: z.array(
      z.object({
        order: z.number().int(),
        kind: z.enum(MONTHLY_DEDUCTION_KINDS),
        sourceId: z.string().describe('Avans, icra ya da BES katılımının kimliği'),
        requestedCents: z.number().int().nullable().describe('Kural tutarı (tavandan önce)'),
        amountCents: z.number().int().nullable().describe('Kesilecek tutar; hesaplanamıyorsa boş'),
        status: z.enum(MONTHLY_DEDUCTION_STATUSES),
      }),
    ),
    totalCents: z.number().int(),
    remainingNetCents: z.number().int().nullable(),
  }),
)

export const membershipParams = z.object({
  membershipId: z.string().trim().min(1).max(100, 'Personel geçersiz.'),
})
export const advanceParams = z.object({ advanceId: z.uuid('Avans geçersiz.') })
export const garnishmentParams = z.object({ garnishmentId: z.uuid('İcra kaydı geçersiz.') })
export const pensionParams = z.object({ enrollmentId: z.uuid('BES katılımı geçersiz.') })

export const staffListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Personel adında arama, Türkçe harf duyarsız'),
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  holding: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` yalnız açık avansı, icrası ya da BES katılımı olan personel'),
})
