import { z } from 'zod'

import { REPORT_GROUPINGS } from '@kampus/school-core/cefr/skill-report.ts'
import { CEFR_LEVELS, enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import { PROGRESS_SKILLS } from '@kampus/school-core/skills/progress.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Beceri ve CEFR raporu (OG-100; IST-118; DOM-BEC-037). Yanıt her okumada hesaplanır, saklanmaz;
 * kişi adı ya da kişi puanı taşımaz. Sorgu katıdır: bilinmeyen parametre 400.
 */

export const skillReportQuerySchema = z.strictObject({
  groupBy: z
    .enum(REPORT_GROUPINGS)
    .default('class')
    .describe('Satırlar: `class` dil grubu, `level` kur seviyesi (CEFR)'),
})

const level = z.enum(enumKeys(CEFR_LEVELS))

const skillSchema = z.object({
  skill: z.enum(PROGRESS_SKILLS),
  label: z.string(),
  average: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe('Kanıtı olan kursiyer ortalamalarının ortalaması, bir ondalık; kanıt yoksa `null`'),
  evidenceCount: z.number().int().min(0).describe('Sayılan görev sonucu sayısı'),
  studentCount: z.number().int().min(0).describe('Bu beceride kanıtı olan kursiyer sayısı'),
})

const levelShareSchema = z.object({
  level,
  label: z.string(),
  count: z.number().int().min(1).describe('Güncel genel seviyesi bu olan kursiyer sayısı'),
})

const summary = {
  studentCount: z.number().int().min(0).describe('Etkin kursiyer sayısı'),
  skills: z.array(skillSchema).describe('Okuma, dinleme, yazma ve konuşma; her zaman dördü'),
  levels: z.array(levelShareSchema).describe('Güncel seviye dağılımı, seviye sırasıyla'),
  noLevelCount: z.number().int().min(0).describe('Genel seviye kararı olmayan kursiyer sayısı'),
}

const groupSchema = z.object({
  id: z.string().describe('`class`: dil grubu kimliği; `level`: seviye anahtarı'),
  name: z.string(),
  level: level.nullable().describe('Grubun kur seviyesi; seviye satırında satırın kendisi'),
  ...summary,
})

export const skillReportResponseSchema = dataResponse(
  z
    .object({
      groupBy: z.enum(REPORT_GROUPINGS),
      computedAt: z.iso.datetime(),
      groups: z.array(groupSchema),
      totals: z
        .object(summary)
        .describe('Raporun bütün kursiyerleri; her kursiyer bir kez sayılır'),
    })
    .meta({ id: 'SkillReport' }),
)
