import { z } from 'zod'

import {
  LOST_ITEM_CATEGORIES,
  LOST_ITEM_DISPOSAL_OUTCOMES,
  LOST_ITEM_RECIPIENT_TYPES,
  LOST_ITEM_STATUSES,
  LOST_REPORT_STATUSES,
} from '@kampus/school-core/lib/finance-lost-items.ts'
import { GUARDIAN_RELATIONSHIP_KEYS } from '@kampus/school-core/lib/guardianship.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kayıp eşya şemaları (DOM-FIN-145; ON-171). */

const category = z
  .enum(LOST_ITEM_CATEGORIES)
  .describe(
    '`clothing` giysi, `electronics` elektronik, `stationery` kırtasiye, `valuable` değerli eşya, `other` diğer',
  )
const status = z
  .enum(LOST_ITEM_STATUSES)
  .describe(
    '`pending` bekliyor, `handed_over` teslim edildi, `donated` bağışlandı, `destroyed` imha edildi',
  )
const reportStatus = z
  .enum(LOST_REPORT_STATUSES)
  .describe(
    '`open` aranıyor, `matched` bulunan eşyayla eşlendi (teslim bekliyor), `returned` teslim edildi, `closed` kapatıldı',
  )
const recipientType = z
  .enum(LOST_ITEM_RECIPIENT_TYPES)
  .describe('`student` öğrenci, `guardian` veli, `other` başka kişi')

const itemRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  category,
  foundLocation: z.string(),
  foundOn: z.string().describe('Bulunduğu gün (YYYY-MM-DD)'),
  storageLocation: z.string(),
  status,
  finderMembershipId: z.string().nullable(),
  finderName: z.string().nullable().describe('Bulan personelin adı'),
  photoCount: z.number().int(),
  matchedReport: z
    .object({
      id: z.string(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      version: z.number().int(),
    })
    .nullable()
    .describe('Eşyayla eşlenmiş, teslim bekleyen kayıp bildirimi'),
  retentionDueOn: z.string().describe('Saklama süresinin dolduğu gün (bulunma günü + süre)'),
  retentionDue: z.boolean().describe('Bekliyor ve saklama süresi doldu'),
  recipientType: recipientType.nullable(),
  recipientName: z.string().nullable().describe('Teslim alanın adı (teslim anındaki kopya)'),
  handedOverAt: z.string().nullable(),
  disposedAt: z.string().nullable(),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const lostItemListResponse = z.object({ data: z.array(itemRowSchema), meta: pageMetaSchema })

const photoSchema = z.object({
  fileId: z.string(),
  contentType: z.string(),
  byteSize: z.number().int(),
  url: z
    .string()
    .nullable()
    .describe('Kısa ömürlü imzalı bağlantı; yazma yanıtlarında ve açılamayan dosyada boş'),
  expiresAt: z.string().nullable(),
})

const itemDetailSchema = itemRowSchema.extend({
  photos: z.array(photoSchema),
  recipientStudentId: z.string().nullable(),
  recipientStudentName: z.string().nullable(),
  recipientGuardianLinkId: z.string().nullable(),
  handedOverByName: z.string().nullable().describe('Teslim eden personel'),
  disposalReason: z.string().nullable(),
  disposedByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const lostItemResponse = dataResponse(itemDetailSchema)

export const lostItemSummaryResponse = dataResponse(
  z.object({
    date: z.string().describe('Bugün (Europe/Istanbul)'),
    pending: z.number().int().describe('Bekleyen eşya'),
    retentionDue: z.number().int().describe('Saklama süresi dolan bekleyen eşya'),
    openReports: z.number().int().describe('Aranan (eşlenmemiş) kayıp bildirimi'),
    matchedReports: z.number().int().describe('Eşlenmiş, teslim bekleyen bildirim'),
    retentionDays: z.number().int(),
  }),
)

export const lostItemFinderListResponse = z.object({
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

export const lostItemRecipientsResponse = dataResponse(
  z.object({
    studentId: z.string(),
    studentName: z.string().nullable(),
    guardians: z.array(
      z.object({
        guardianLinkId: z.string(),
        name: z.string().nullable(),
        relationship: z.enum(GUARDIAN_RELATIONSHIP_KEYS),
        canReceive: z.boolean().describe('İletişim kısıtı yok; teslim alabilir (DOM-ILT-072)'),
      }),
    ),
  }),
)

const reportRowSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  description: z.string(),
  category: category.nullable(),
  lostOn: z.string().describe('Kaybolduğu gün (YYYY-MM-DD)'),
  status: reportStatus,
  reporterRole: z.string().describe('Bildiren: `veli` ya da `ogrenci`'),
  createdAt: z.string(),
  returnedAt: z.string().nullable(),
  matchedItem: z
    .object({
      id: z.string(),
      description: z.string(),
      category,
      storageLocation: z.string(),
      status,
    })
    .nullable()
    .describe('Eşlenen eşya; yalnız personel yanıtında dolu'),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const lostReportListResponse = z.object({
  data: z.array(reportRowSchema),
  meta: pageMetaSchema,
})
export const lostReportResponse = dataResponse(reportRowSchema)

export const lostItemGalleryResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      category,
      foundOn: z.string(),
      photos: z.array(
        z.object({
          fileId: z.string(),
          url: z.string().nullable().describe('Kısa ömürlü imzalı bağlantı'),
          expiresAt: z.string().nullable(),
        }),
      ),
    }),
  ),
  meta: pageMetaSchema.extend({
    enabled: z.boolean().describe('Kurum aile galerisini açmış mı; kapalıysa liste boş'),
  }),
})

export const lostItemRetentionResponse = z.object({
  data: z.array(itemRowSchema),
  meta: pageMetaSchema.extend({
    retentionDays: z.number().int().describe('Kurumun saklama süresi (gün)'),
  }),
})

export const lostItemDisposalResponse = dataResponse(
  z.object({ disposedCount: z.number().int(), outcome: z.enum(LOST_ITEM_DISPOSAL_OUTCOMES) }),
)

export const lostItemSettingsResponse = dataResponse(
  z.object({
    retentionDays: z.number().int(),
    familyGalleryEnabled: z.boolean(),
    version: z.number().int().describe('`If-Match` sürümü; hiç kaydedilmediyse 1'),
  }),
)

const q = z.string().trim().min(2).max(100).optional()

export const lostItemListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Tanımda, bulunduğu ve saklandığı yerde arama'),
  status: status.optional(),
  category: category.optional(),
})

export const lostItemFinderQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Personel adında arama'),
})

export const lostItemRecipientQuery = z.strictObject({
  studentId: z.string().trim().min(1, 'Öğrenciyi seçin.').describe('Eşyanın sahibi öğrenci'),
})

export const lostReportListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Bildirim tanımında arama'),
  status: reportStatus.optional(),
})

export const lostItemGalleryQuery = z.strictObject({
  ...pageQuerySchema.shape,
  category: category.optional(),
})

export const lostItemRetentionQuery = z.strictObject({ ...pageQuerySchema.shape })

export const lostItemParams = z.object({ itemId: z.uuid('Eşya kaydı geçersiz.') })
export const lostItemPhotoParams = lostItemParams.extend({
  fileId: z.uuid('Fotoğraf geçersiz.'),
})
export const lostReportParams = z.object({ reportId: z.uuid('Bildirim geçersiz.') })
