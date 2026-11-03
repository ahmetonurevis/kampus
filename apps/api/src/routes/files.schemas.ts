import { z } from 'zod'

import { FILE_PURPOSES, type FilePurpose } from '@kampus/school-core/content/taxonomy.ts'

import { errorResponseSchema } from '../errors.ts'
import { FILE_STATUSES } from '../db/schema/files.ts'
import { commandErrors } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'
import { readErrors } from './communication.schemas.ts'

const instant = z.iso.datetime()

export const filePurposeSchema = z
  .enum(Object.keys(FILE_PURPOSES) as [FilePurpose, ...FilePurpose[]])
  .describe('Dosyanın amacı; tür ve boyut sınırı amaca göredir (ADR 0003 karar 3)')

/**
 * `multipart/form-data` gövdesi. Belge ve istemci tipi içindir: multipart akış ayrıştırılmadan
 * tüketildiği için Fastify'ın gördüğü gövde boştur (`null`); alanları rota doğrular.
 * `purpose` alanı dosyadan önce gönderilir.
 */
export const fileUploadBodySchema = z
  .object({
    purpose: filePurposeSchema,
    file: z.file().describe('Tek dosya; alan adı `file`'),
  })
  .meta({ id: 'FileUploadBody' })
  .nullish()

export const fileParamsSchema = z.object({ fileId: z.uuid().describe('Dosya kimliği') })

const fileSchema = z
  .object({
    id: z.uuid(),
    purpose: filePurposeSchema,
    status: z
      .enum(FILE_STATUSES)
      .describe(
        '`pending` yüklendi, denetim bekliyor; `processing` taranıyor/dönüştürülüyor (bağlantı verilmez); `ready` kullanıma hazır; `rejected`/`deleted` görünmez',
      ),
    contentType: z.string().describe('İçerikten tespit edilen kanonik MIME türü'),
    byteSize: z.number().int().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    durationMs: z.number().int().min(0).nullable().describe('Sunucuda ölçülen süre; yoksa `null`'),
    originalName: z.string().nullable().describe('Temizlenmiş özgün ad; yalnız gösterim için'),
    attached: z.boolean().describe('Dosya bir kayda bağlandı mı (ADR 0003 karar 5)'),
    createdAt: instant,
    rowVersion: z.number().int().min(1),
  })
  .meta({ id: 'File' })

export const fileResponseSchema = dataResponse(fileSchema)

export const fileUrlResponseSchema = dataResponse(
  z
    .object({
      url: z.url().describe('Kısa ömürlü imzalı GET bağlantısı'),
      expiresAt: instant.describe('Bağlantının geçerlilik sonu'),
      listening: z
        .object({
          attemptId: z.uuid().describe('Hakkın düştüğü süren deneme'),
          limit: z.number().int().min(1).max(2).describe('Atamanın dinleme hakkı (DOM-BEC-005)'),
          used: z.number().int().min(0).describe('Bu deneme ve kayıtta sayılan dinleme'),
          remaining: z.number().int().min(0),
          counted: z
            .boolean()
            .describe('Bu istek yeni dinleme saydı mı; yeniden bağlantı penceresinde `false`'),
        })
        .nullable()
        .describe(
          'Dinleme hakkı sayımı (IST-045): yalnız öğrencinin süren denemesinde sınırlı dinleme kaydında dolu, diğerlerinde `null`',
        ),
    })
    .meta({ id: 'FileUrl' }),
)

export const fileUrlQuerySchema = z.object({
  attemptId: z
    .uuid()
    .optional()
    .describe(
      'Dinleme hakkının düşeceği deneme (öğrenci; Sabah kararı 54). Kendi denemesi değilse 404, ataması bu kaydı bağlamıyorsa 422 `listening_attempt_mismatch`, deneme sürmüyorsa 422 `listening_attempt_closed`. Verilmezse süren denemelerden seçilir; personel ve velide yok sayılır.',
    ),
})

export const fileDownloadQuerySchema = z.strictObject({
  token: z.string().min(1).max(4096).describe('İmzalı bağlantı belirteci'),
})

export const uploadErrors = {
  ...commandErrors,
  413: errorResponseSchema,
  415: errorResponseSchema,
} as const

export const fileReadErrors = { ...readErrors, 409: errorResponseSchema } as const
export const fileUrlErrors = { ...fileReadErrors, 422: errorResponseSchema } as const

export const downloadErrors = {
  400: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const
