import { z } from 'zod'

import { enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import { PROGRESS_SKILLS, TRENDS } from '@kampus/school-core/skills/progress.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Beceri ilerleme panosu (OG-080; IST-057, DOM-BEC-035). Yanıt her okumada puanlardan hesaplanır,
 * saklanmaz; her nokta görev sonucunun kimliklerini taşır.
 */

const instant = z.iso.datetime()
const percent = z.number().int().min(0).max(100)

export const skillProgressParamsSchema = z.object({
  studentId: z.string().min(1).max(200).describe('Öğrenci kaydı kimliği'),
})

const pointSchema = z.object({
  assignmentId: z.uuid().describe('Görev ataması'),
  attemptId: z.uuid().nullable().describe('Otomatik puanlı görevde sayılan deneme'),
  submissionId: z.uuid().nullable().describe('Öğretmen puanlı görevde teslim kaydı'),
  title: z.string().describe('Atanan içeriğin başlığı'),
  performedAt: instant.describe('Denemenin tamamlandığı ya da puanlanan sürümün gönderildiği an'),
  percent: percent.describe('Puan yüzdesi'),
})

const curveSchema = z.object({
  skill: z.enum(PROGRESS_SKILLS),
  label: z.string(),
  points: z.array(pointSchema).describe('Tarih sırasıyla noktalar'),
  latest: percent.nullable().describe('Son noktanın yüzdesi'),
  trend: z
    .enum(enumKeys(TRENDS))
    .nullable()
    .describe('Eğilim: son nokta, önceki en çok üç noktanın ortalamasına göre (±5 puan)'),
})

export const skillProgressResponseSchema = dataResponse(
  z
    .object({
      studentId: z.string(),
      computedAt: instant,
      skills: z.array(curveSchema).describe('Okuma, dinleme, yazma ve konuşma; her zaman dördü'),
    })
    .meta({ id: 'SkillProgress' }),
)
