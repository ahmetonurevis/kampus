import { z } from 'zod'

import { dataResponse } from './common.schemas.ts'

/**
 * Video izleme ilerlemesi uç şemaları (IST-041; docs/domain/kaynak-platformu.md DOM-KYN-005).
 * Gövde core işlem şemasıdır (`lib/video-progress.ts` `recordVideoProgressSchema`, katı).
 */

export const videoProgressParamsSchema = z.object({
  videoId: z.string().min(1).max(200).describe('Video kimliği'),
})

export const videoProgressResponseSchema = dataResponse(
  z.object({
    videoId: z.string(),
    progress: z.number().int().min(0).max(100).describe('İzlenen en yüksek yüzde (geri gitmez)'),
    positionSeconds: z.number().int().min(0).describe('Son konum (saniye)'),
    durationSeconds: z.number().int().min(1).describe('Son bildirilen video süresi (saniye)'),
  }),
)
