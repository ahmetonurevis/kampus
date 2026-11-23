import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  HEALTH_SCREENING_KINDS,
  HEALTH_SCREENING_NOTIFICATION_STATUSES,
  HEALTH_SCREENING_OUTCOMES,
  HEALTH_SCREENING_STATUSES,
} from '@kampus/school-core/lib/finance-health-screenings.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Okul sağlığı taraması şemaları (DOM-FIN-153; ON-163). */

const kind = z.enum(HEALTH_SCREENING_KINDS).describe('`growth` boy-kilo, `vision` görme')
const status = z
  .enum(HEALTH_SCREENING_STATUSES)
  .describe('`open` açık (sonuç girilir), `published` yayımlandı (veli görür, değişmez)')
const outcome = z
  .enum(HEALTH_SCREENING_OUTCOMES)
  .describe('`screened` tarandı, `absent` katılmadı, `refused` reddetti')
const notificationStatus = z
  .enum(HEALTH_SCREENING_NOTIFICATION_STATUSES)
  .nullable()
  .describe('Veli bildirim kaydı: `pending` gönderilecek (gönderim yok); öneri yoksa boş')

const thresholdsSchema = z
  .union([
    z.object({ bmiBelow: z.number().nullable(), bmiAbove: z.number().nullable() }),
    z.object({ acuityBelow: z.number().nullable() }),
  ])
  .describe(
    'Kurumun eşikleri: boy-kiloda BKİ alt/üst (kg/m²), görmede ondalık keskinlik alt sınırı',
  )

const measurementSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('growth'),
      heightCm: z.number().describe('Boy (cm)'),
      weightKg: z.number().describe('Kilo (kg)'),
      bmi: z.number().describe('Beden kitle indeksi (kg/m², tek ondalık; sunucuda hesaplanır)'),
    }),
    z.object({
      kind: z.literal('vision'),
      rightAcuity: z.number().describe('Sağ göz ondalık keskinlik'),
      leftAcuity: z.number().describe('Sol göz ondalık keskinlik'),
      wearsGlasses: z.boolean(),
    }),
  ])
  .nullable()
  .describe('Ölçüm (özel nitelikli; şifreli saklanır); taranmayanda boş')

const sessionSchema = z.object({
  id: z.string(),
  kind,
  status,
  screenedOn: z.string().describe('Tarama günü (YYYY-MM-DD)'),
  classes: z.array(z.object({ id: z.string(), name: z.string() })).describe('Hedef sınıflar'),
  performer: z
    .object({
      kind: z.enum(['staff', 'external']),
      membershipId: z.string().nullable(),
      name: z.string(),
    })
    .describe('Taramayı yapan: kurum personeli ya da dış sağlık personeli'),
  thresholds: thresholdsSchema,
  resultCount: z.number().int().describe('Girilmiş sonuç sayısı'),
  notificationCount: z.number().int().describe('"Gönderilecek" veli bildirim kaydı sayısı'),
  createdByUserId: z.string(),
  publishedAt: z.string().nullable(),
  publishedByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const healthScreeningResponse = dataResponse(sessionSchema)
export const healthScreeningListResponse = z.object({
  data: z.array(sessionSchema),
  meta: pageMetaSchema,
})

export const healthScreeningDetailResponse = dataResponse(
  sessionSchema.extend({
    students: z
      .array(
        z.object({
          studentId: z.string(),
          studentName: z.string().nullable(),
          classId: z.string(),
          className: z.string(),
          inTargetClass: z
            .boolean()
            .describe('Öğrenci bugün hedef sınıflardan birinde mi (değilse yalnız sonucu için)'),
          result: z
            .object({
              id: z.string(),
              outcome,
              measurement: measurementSchema,
              referralRecommended: z.boolean().describe('İleri değerlendirme önerilir'),
              thresholdExceeded: z.boolean().describe('Ölçüm kurumun eşiğini aşıyor mu'),
              note: z.string().nullable().describe('Kısa not (veliye görünür)'),
              notificationStatus,
              recordedByUserId: z.string(),
              recordedByName: z.string().nullable(),
              updatedAt: z.string(),
              version: z.number().int().describe('Düzeltmede `expectedVersion`'),
            })
            .nullable(),
        }),
      )
      .describe('Hızlı giriş tablosu: hedef sınıfların öğrencileri ve sonuçları'),
  }),
)

export const healthScreeningResultsResponse = dataResponse(
  z.object({
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int().describe('Değişmediği için yazılmayan satır'),
    session: sessionSchema,
  }),
)

const groupCounts = z.object({
  roster: z.number().int().describe('Bugünkü etkin öğrenci'),
  screened: z.number().int(),
  absent: z.number().int(),
  refused: z.number().int(),
  missing: z.number().int().describe('Sonucu girilmemiş öğrenci'),
  referral: z
    .number()
    .int()
    .nullable()
    .describe('İleri değerlendirme önerilen; küçük grupta gizli (`null`, K-516)'),
  referralSuppressed: z.boolean(),
})
export const healthScreeningReportResponse = dataResponse(
  z.object({
    sessionId: z.string(),
    kind,
    status,
    classes: z.array(groupCounts.extend({ classId: z.string(), className: z.string() })),
    total: groupCounts,
  }),
)

export const guardianScreeningResultListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      sessionId: z.string(),
      kind,
      screenedOn: z.string(),
      performerName: z.string(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      outcome,
      measurement: measurementSchema,
      referralRecommended: z.boolean(),
      note: z.string().nullable(),
      notificationStatus,
      publishedAt: z.string(),
    }),
  ),
  meta: pageMetaSchema,
})

export const healthScreeningStaffListResponse = z.object({
  data: z.array(
    z.object({
      membershipId: z.string(),
      name: z.string(),
      role: z.string().describe('`yonetici`, `ogretmen` ya da `onburo`'),
      active: z.boolean(),
    }),
  ),
  meta: pageMetaSchema,
})

export const healthScreeningClassListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      studentCount: z.number().int().describe('Bugünkü etkin öğrenci sayısı'),
    }),
  ),
  meta: pageMetaSchema,
})

export const healthScreeningListQuery = z
  .strictObject({
    ...pageQuerySchema.shape,
    status: status.optional(),
    kind: kind.optional(),
    from: daySchema.optional().describe('Tarama günü başlangıcı (YYYY-MM-DD)'),
    to: daySchema.optional().describe('Tarama günü sonu (dahil)'),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: 'Başlangıç günü bitişten sonra olamaz.',
    path: ['from'],
  })

export const guardianScreeningResultQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().trim().min(1).max(100).optional().describe('Çocuklardan biri'),
})

export const healthScreeningStaffQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

export const healthScreeningClassQuery = z.strictObject({ ...pageQuerySchema.shape })

export const healthScreeningParams = z.object({ sessionId: z.uuid('Tarama geçersiz.') })
