import { z } from 'zod'

import { enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import {
  bandAlignmentSchema,
  RUBRIC_KINDS,
  RUBRIC_SKILLS,
  RUBRIC_VERSION_STATUSES,
  rubricVersionInputSchema,
} from '@kampus/school-core/skills/rubric.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Rubrik uçlarının şemaları (ADR 0004 karar 7; DOM-BEC-020, 022). Gövde core
 * `rubricVersionInputSchema`'dır; taslak düzenlemede verilen alanlar sürümdeki değerin yerine
 * geçer ve birleşmiş içerik core `planRubricDraftUpdate` ile yeniden doğrulanır.
 */

const id = z.uuid()
const instant = z.iso.datetime()
const kind = z.enum(enumKeys(RUBRIC_KINDS))
const skill = z.enum(RUBRIC_SKILLS)
const status = z.enum(enumKeys(RUBRIC_VERSION_STATUSES))

export const rubricParamsSchema = z.object({ rubricId: id.describe('Rubrik kimliği') })
export const rubricVersionParamsSchema = rubricParamsSchema.extend({
  versionId: id.describe('Rubrik sürümü kimliği'),
})

export const rubricListQuerySchema = pageQuerySchema
  .extend({
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional()
      .describe(
        'Baş sürümün başlığında arama (IST-048). Türkçe harf ve büyük/küçük harf duyarsız, joker yok',
      ),
    skill: skill.optional().describe('Baş sürümün becerisi'),
    kind: kind.optional().describe('Baş sürümün türü: analitik veya bütüncül'),
    status: status.optional().describe('Baş sürümün durumu'),
    ownerUserId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Rubrik sahibi (ör. "Benim rubriklerim")'),
  })
  .strict()

const rubricSchema = z
  .object({
    id,
    ownerUserId: z.string(),
    createdAt: instant,
    canManage: z
      .boolean()
      .describe('Kişi rubriği düzenleyebilir mi (core `canManageRubric`: sahip veya yönetici)'),
  })
  .meta({ id: 'Rubric' })

const versionSummaryShape = {
  id,
  rubricId: id,
  versionNumber: z.number().int().min(1),
  status,
  title: z.string(),
  kind,
  skill,
  createdAt: instant,
  updatedAt: instant,
  publishedAt: instant.nullable(),
  archivedAt: instant.nullable(),
  rowVersion: z
    .number()
    .int()
    .min(1)
    .describe('Sürüm satırının iyimser kilit sürümü (düzenleme, yayım ve arşivde `If-Match`)'),
}

const rubricVersionSummarySchema = z
  .object(versionSummaryShape)
  .meta({ id: 'RubricVersionSummary' })

const criterionSchema = z.object({
  id: z.string(),
  aspect: z.string().describe('CEFR-CV niteliksel yönü; bütüncül rubrikte `overall`'),
  weight: z.number().int(),
  bands: z.array(
    z.object({
      band: z.number().int().min(0).max(5),
      description: z.string().describe('Kurumun kendi cümlesi (DOM-BEC-004)'),
      alignment: bandAlignmentSchema,
    }),
  ),
})

const rubricVersionSchema = z
  .object({
    ...versionSummaryShape,
    criteria: z.array(criterionSchema),
    usage: z
      .object({
        assignmentCount: z.number().int().min(0),
        scoreCount: z.number().int().min(0),
      })
      .describe(
        'Sürümün sabitlendiği atama ve verilmiş puan sayısı; kullanılmış sürüm değişmez (DOM-BEC-022)',
      ),
  })
  .meta({ id: 'RubricVersion' })

export const rubricListResponseSchema = pageResponse(
  z
    .object({
      rubric: rubricSchema,
      head: rubricVersionSummarySchema.describe('En yüksek numaralı sürüm'),
      publishedVersionId: id
        .nullable()
        .describe('Yayındaki sürüm; yeni atamada yalnız bu kullanılır (DOM-BEC-022)'),
    })
    .meta({ id: 'RubricListItem' }),
)

export const rubricVersionIdParamsSchema = z.object({
  versionId: id.describe('Rubrik sürümü kimliği'),
})

/** Tek rubrik sürümü (atamanın sabitlediği sürüm; puanlama paneli kimlikle okur). */
export const rubricVersionResponseSchema = dataResponse(rubricVersionSchema)

export const rubricDetailResponseSchema = dataResponse(
  z
    .object({
      rubric: rubricSchema,
      versions: z.array(rubricVersionSchema).describe('Bütün sürümler, numaraya göre artan'),
    })
    .meta({ id: 'RubricDetail' }),
)

export const rubricWriteResponseSchema = dataResponse(
  z
    .object({ rubric: rubricSchema, version: rubricVersionSchema })
    .meta({ id: 'RubricWriteResult' }),
)

/** Yeni rubrik ve yeni sürüm: core `rubricVersionInputSchema`. */
export const rubricBodySchema = rubricVersionInputSchema

/**
 * Taslak düzenleme: verilen alanlar sürümdeki değerin yerine geçer (`criteria` bütün olarak);
 * birleşmiş içerik core şemasıyla yeniden doğrulanır.
 */
const fields = rubricVersionInputSchema.shape
export const rubricDraftPatchSchema = z
  .strictObject({
    title: fields.title.optional(),
    kind: fields.kind.optional(),
    skill: fields.skill.optional(),
    criteria: fields.criteria.optional().describe('Kriterler bütün olarak değişir'),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'En az bir alanı değiştirin.')

/** Gövdesiz komutlar: istemci `{}` gönderir; bilinmeyen alan 400. */
export const rubricCommandBodySchema = z.strictObject({})
