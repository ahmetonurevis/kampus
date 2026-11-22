import { z } from 'zod'

import { INCIDENT_KINDS, INCIDENT_STATUSES } from '@kampus/school-core/lib/finance-incidents.ts'
import {
  TRIP_REPORT_LIST_STATUSES,
  TRIP_REPORT_PHOTO_VISIBILITIES,
  TRIP_REPORT_STATUSES,
} from '@kampus/school-core/lib/finance-trip-reports.ts'
import { TRIP_PLAN_STATUSES } from '@kampus/school-core/lib/finance-trip-plans.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Gezi sonrası rapor şemaları (DOM-FIN-158; ON-158; K-529…K-531). Personel görünümü raporu, kaza
 * tutanağı bağlarını (yalnız an, tür, yer, durum), fotoğrafları (etiket ve rıza var/yok, yayım
 * durumu) ve değerlendirme özetini taşır; özet küçük grupta gizlidir, yorum ad taşımaz. Aile
 * görünümü yalnız yayımlanmış fotoğrafları (etiketsiz) ve kendi değerlendirmesini taşır.
 */

export const tripReportParams = z.object({ planId: z.uuid('Gezi planı kimliği geçersiz.') })
export const tripReportPhotoParams = tripReportParams.extend({
  photoId: z.uuid('Fotoğraf kimliği geçersiz.'),
})
export const tripReportListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z
    .enum(TRIP_REPORT_LIST_STATUSES)
    .optional()
    .describe('Rapor durumu; `missing` raporu yazılmamış biten gezi'),
})

const incidentSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  kind: z.enum(INCIDENT_KINDS),
  location: z.string(),
  status: z.enum(INCIDENT_STATUSES),
})

const photoSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  caption: z.string().nullable(),
  noStudentsVisible: z.boolean(),
  shareWithFamilies: z.boolean(),
  position: z.number().int(),
  contentType: z.string(),
  byteSize: z.number().int(),
  students: z
    .array(
      z.object({
        studentId: z.string(),
        studentName: z.string(),
        consent: z.boolean().describe('Geçerli `photo_video_sharing` rızası var (okuma anında)'),
      }),
    )
    .describe('Etiketli öğrenciler, ada göre'),
  visibility: z
    .enum(TRIP_REPORT_PHOTO_VISIBILITIES)
    .describe(
      '`internal` yayım istenmedi, `consent_missing` etiketli birinin rızası yok, `awaiting_approval` rapor onaylanınca yayımlanır, `published` ailelere açık',
    ),
  url: z.string().nullable().describe('İmzalı geçici bağlantı (yalnız okuma uçlarında)'),
  expiresAt: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için fotoğrafın sürümü'),
})

const attendanceSchema = z.object({
  source: z.enum(['trip_day', 'none']).describe('`none`: gezi günü yoklaması yapılmadı'),
  rosterCount: z.number().int(),
  attendedCount: z.number().int(),
  absentCount: z.number().int(),
  frozen: z.boolean().describe('Gönderimde dondurulan sayılar; düzeltilebilir raporda canlı'),
})

const evaluationSummarySchema = z.object({
  responses: z.number().int(),
  hidden: z.boolean().describe('5’ten az yanıt: ortalama, dağılım ve yorumlar gizli (K-531)'),
  average: z.number().nullable(),
  distribution: z.array(z.number().int()).nullable().describe('1–5 puan sayıları'),
  comments: z.array(z.string()).nullable().describe('Yorumlar, ad ve rol olmadan'),
})

export const tripReportResponse = dataResponse(
  z.object({
    plan: z.object({
      id: z.string(),
      number: z.string(),
      name: z.string(),
      status: z.enum(TRIP_PLAN_STATUSES),
      departureAt: z.string(),
      returnAt: z.string(),
    }),
    tripFinished: z.boolean().describe('Gezi bitti; rapor yazılabilir'),
    canCreate: z.boolean(),
    report: z
      .object({
        id: z.string(),
        status: z.enum(TRIP_REPORT_STATUSES),
        summary: z.string().nullable(),
        incidentNote: z.string().nullable(),
        outcomeNote: z.string().nullable(),
        incidents: z.array(incidentSchema).describe('Bağlı kaza tutanakları; ayrıntı yok'),
        createdByName: z.string().nullable(),
        createdAt: z.string(),
        submittedAt: z.string().nullable(),
        submittedByName: z.string().nullable(),
        decidedAt: z.string().nullable(),
        decidedByName: z.string().nullable(),
        returnReason: z.string().nullable(),
        canEdit: z.boolean(),
        canDecide: z.boolean(),
        version: z.number().int().describe('`If-Match` için raporun sürümü'),
        photos: z.array(photoSchema),
      })
      .nullable(),
    attendance: attendanceSchema,
    evaluations: evaluationSummarySchema,
    options: z
      .object({
        students: z.array(
          z.object({
            studentId: z.string(),
            studentName: z.string(),
            className: z.string().nullable(),
            attended: z.boolean().nullable().describe('Kapanan turda var; yoklama yoksa boş'),
            consent: z.boolean(),
          }),
        ),
        studentTotal: z.number().int(),
        incidents: z.array(incidentSchema).describe('Gezi süresinde yazılmış kaza tutanakları'),
      })
      .nullable()
      .describe('Etiket ve tutanak seçenekleri; yalnız raporu yazabilen role, düzeltilebilirken'),
  }),
)

export const tripReportListResponse = pageResponse(
  z.object({
    planId: z.string(),
    planNumber: z.string(),
    planName: z.string(),
    planStatus: z.enum(TRIP_PLAN_STATUSES),
    departureAt: z.string(),
    returnAt: z.string(),
    reportId: z.string().nullable(),
    status: z.enum(TRIP_REPORT_LIST_STATUSES),
    authorName: z.string().nullable(),
    submittedAt: z.string().nullable(),
    decidedAt: z.string().nullable(),
    photoCount: z.number().int(),
    responseCount: z.number().int(),
  }),
)

const ownEvaluationSchema = z.object({
  studentId: z.string(),
  score: z.number().int(),
  comment: z.string().nullable(),
  createdAt: z.string(),
})

export const myTripReportsResponse = dataResponse(
  z.array(
    z.object({
      planId: z.string(),
      planName: z.string(),
      departureAt: z.string(),
      returnAt: z.string(),
      students: z
        .array(z.object({ studentId: z.string(), studentName: z.string() }))
        .describe('Geziye katılan kapsamdaki öğrenciler'),
      reportApproved: z.boolean(),
      photos: z
        .array(
          z.object({
            id: z.string(),
            caption: z.string().nullable(),
            contentType: z.string(),
            url: z.string().nullable(),
            expiresAt: z.string().nullable(),
          }),
        )
        .describe('Yayımlanmış fotoğraflar (rıza okuma anında); etiket ve rıza durumu yok'),
      evaluation: z.object({
        open: z.boolean().describe('Değerlendirme verilebilir'),
        closesAt: z.string(),
        mine: ownEvaluationSchema.nullable(),
      }),
    }),
  ),
)

export const tripEvaluationResponse = dataResponse(
  ownEvaluationSchema.extend({ id: z.string(), planId: z.string() }),
)
