import { z } from 'zod'

import { PERFORMANCE_PERIOD_STATUSES } from '@kampus/school-core/lib/finance-performance.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Performans dönemi şemaları (DOM-FIN-124; ON-211). Yalnız yöneticiye döner (K-429). */

const periodSchema = z.object({
  id: z.string(),
  name: z.string().describe('Dönem adı'),
  startDate: z.string().describe('Dönemin ilk günü (YYYY-MM-DD)'),
  endDate: z.string().describe('Dönemin son günü (YYYY-MM-DD, dahil)'),
  status: z
    .enum(PERFORMANCE_PERIOD_STATUSES)
    .describe(
      'Aşama: `planning` planlama, `active` yürürlükte, `interim` ara görüşme, `evaluation` değerlendirme, `closed` kapandı (kilitli)',
    ),
  closedAt: z.string().nullable().describe('Kapanış anı (ISO 8601 UTC)'),
  createdAt: z.string(),
  reviewCount: z.number().int().describe('Dönemdeki personel kaydı sayısı'),
  scoredCount: z.number().int().describe('Bütün hedefleri puanlanmış kayıt sayısı'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (aşama geçişi)'),
})

export const periodResponse = dataResponse(periodSchema)
export const periodListResponse = z.object({
  data: z.array(periodSchema),
  meta: pageMetaSchema,
})
export const periodListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Dönem adında arama'),
  status: z.enum(PERFORMANCE_PERIOD_STATUSES).optional().describe('Aşama süzgeci'),
})

const goalSchema = z.object({
  title: z.string(),
  criterion: z.string(),
  weight: z.number().int().describe('Ağırlık, yüzde'),
  score: z.number().int().nullable().describe('Dönem sonu puanı (1–5); girilmediyse boş'),
})

const reviewSchema = z.object({
  id: z.string(),
  periodId: z.string(),
  membershipId: z.string().describe('Değerlendirilen personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı'),
  staffRole: z.string().describe('Personelin rolü'),
  // kvkk: K
  goals: z.array(goalSchema).describe('Hedefler (sırasıyla)'),
  overallScore: z
    .number()
    .nullable()
    .describe('Genel puan: ağırlıklı ortalama, iki ondalık; puanı eksikse boş'),
  scored: z.boolean().describe('Bütün hedefler puanlandı mı'),
  // kvkk: K (serbest metin)
  interimNote: z.string().nullable().describe('Ara görüşme notu'),
  interimDate: z.string().nullable().describe('Ara görüşme günü'),
  // kvkk: K
  evaluatorName: z.string().nullable().describe('Puanı son yazan yönetici'),
  evaluatedAt: z.string().nullable().describe('Puanın son yazıldığı an'),
  // kvkk: K (serbest metin)
  staffComment: z.string().nullable().describe('Personelin görüşü (yönetici personel adına girer)'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const reviewResponse = dataResponse(reviewSchema)
export const reviewListResponse = z.object({
  data: z.array(reviewSchema),
  meta: pageMetaSchema,
})
export const reviewListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

export const periodParams = z.object({ periodId: z.uuid('Dönem geçersiz.') })
export const reviewParams = z.object({ reviewId: z.uuid('Kayıt geçersiz.') })
