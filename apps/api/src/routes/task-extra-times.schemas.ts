import { z } from 'zod'

import { enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import {
  EXTRA_TIME_REASONS,
  extraTimeGrantSchema,
  extraTimeSchema,
} from '@kampus/school-core/skills/extra-time.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Bireysel ek süre uçlarının şemaları (OG-248; DOM-BEC-043). Gövde core `extraTimeGrantSchema`
 * (verme) ve `extraTimeSchema`'dır (değiştirme); gerekçe kategoridir, serbest metin yoktur.
 */

const id = z.uuid()
const instant = z.iso.datetime()
const reason = z
  .enum(enumKeys(EXTRA_TIME_REASONS))
  .describe('Gerekçe kategorisi: `accommodation` (bireysel uyarlama), `technical_issue`, `other`')

export const extraTimeListParamsSchema = z.object({
  assignmentId: id.describe('Atama kimliği'),
})

export const extraTimeParamsSchema = extraTimeListParamsSchema.extend({
  learnerId: z.string().min(1).max(200).describe('Kursiyerin (öğrenci) kimliği'),
})

export const extraTimeGrantBodySchema = extraTimeGrantSchema
export const extraTimeChangeBodySchema = extraTimeSchema

const historyEntrySchema = z
  .object({
    sequence: z.number().int().min(1).describe('Kayıt sırası; son kaydınki ek sürenin sürümüdür'),
    minutes: z.number().int().min(0).describe('Ek süre, dakika; 0 kaldırmadır'),
    reason: reason
      .nullable()
      .optional()
      .describe(
        'Gerekçe; kaldırmada `null`. Yalnız yazma yetkisi olana (atayan öğretmen, yönetici) döner; yalnız okuyan öğretmende alan yoktur (kvkk: Ç)',
      ),
    grantedAt: instant,
    grantedByUserId: z.string(),
  })
  .meta({ id: 'TaskExtraTimeHistoryEntry' })

const learnerExtraTimeSchema = z
  .object({
    learnerId: z.string(),
    learnerName: z
      .string()
      .nullable()
      .describe(
        'Öğrencinin adı: yöneticide her öğrenci, öğretmende yalnız öğrenci kapsamındakiler',
      ),
    current: z
      .object({
        minutes: z.number().int().min(1),
        reason: reason
          .optional()
          .describe('Yalnız yazma yetkisi olana döner; yalnız okuyan öğretmende alan yoktur'),
        grantedAt: instant,
        grantedByUserId: z.string(),
      })
      .nullable()
      .describe('Güncel ek süre; hiç verilmediyse ya da kaldırıldıysa `null`'),
    version: z
      .number()
      .int()
      .min(0)
      .describe('Ek sürenin sürümü (`If-Match`): son kaydın sırası, kayıt yoksa 0'),
    history: z
      .array(historyEntrySchema)
      .describe('Kayıt geçmişi, yeniden eskiye (DOM-BEC-043: gerekçesiyle görünür)'),
  })
  .meta({ id: 'TaskExtraTimeLearner' })

const extraTimeListSchema = z
  .object({
    assignmentId: id,
    timeLimitMinutes: z
      .number()
      .int()
      .nullable()
      .describe('Atamanın süresi; `null` süresiz (ek süre tanımlanamaz)'),
    canManage: z.boolean().describe('Kişi ek süre verebilir mi (atayan öğretmen veya yönetici)'),
    learners: z.array(learnerExtraTimeSchema),
  })
  .meta({ id: 'TaskExtraTimeList' })

export const extraTimeListResponseSchema = dataResponse(extraTimeListSchema)
export const extraTimeWriteResponseSchema = dataResponse(learnerExtraTimeSchema)
