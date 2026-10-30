import { z } from 'zod'

import { errorResponseSchema } from '../errors.ts'

/** Tekil başarı zarfı: `{ data }`. */
export function dataResponse<T extends z.ZodType>(data: T) {
  return z.object({ data })
}

export const pageMetaSchema = z
  .object({
    page: z.number().int().min(1).describe('Sayfa numarası (1’den başlar)'),
    pageSize: z.number().int().min(1).max(100).describe('Sayfa boyutu'),
    total: z.number().int().min(0).describe('Filtre uygulanmış toplam kayıt sayısı'),
  })
  .meta({ id: 'PageMeta' })

/** Sayfalı liste zarfı: `{ data: [...], meta: { page, pageSize, total } }`. */
export function pageResponse<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: pageMetaSchema })
}

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).describe('Sayfa numarası'),
  pageSize: z.coerce.number().int().min(1).max(100).default(25).describe('Sayfa boyutu (≤ 100)'),
})

/** Kimlikli rotaların ortak hata yanıtları. */
export const authenticatedErrors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const
