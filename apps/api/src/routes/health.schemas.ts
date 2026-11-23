import { z } from 'zod'

import { dataResponse } from './common.schemas.ts'

export const healthSchema = z
  .object({
    status: z.literal('ok').describe('Sunucu çalışıyor'),
    database: z.literal('ok').describe('Veritabanı bağlantısı sağlıklı'),
  })
  .meta({ id: 'Health' })

export const healthResponseSchema = dataResponse(healthSchema)
