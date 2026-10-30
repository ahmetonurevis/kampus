import { z } from 'zod'

import { RESOURCE_STATUSES } from '@kampus/school-core/content/resource.ts'
import {
  ACTIVITY_MODES,
  CEFR_LEVELS,
  CONTENT_TYPES,
  DIFFICULTIES,
  enumKeys,
  GRADE_LEVEL_RANGE,
  INTERACTION_CHANNELS,
  LICENSE_KINDS,
  MEDIATION_SKILLS,
  OUTCOME_SOURCES,
  PRIMARY_SKILLS,
  SHARE_SCOPES,
  SKILLS,
} from '@kampus/school-core/content/taxonomy.ts'

import { RESOURCE_SORTS } from '../db/resources.ts'
import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * İçerik havuzu okuma uçlarının şemaları. İçerik, cevap anahtarı ve lisans ayrıntısı tür başına
 * core şemasıdır (`resourceContentSchema`, `answerKeySchema`, `resourceLicenseSchema`); burada
 * nesne olarak geçer. Öğrenci/veli şemasında cevap anahtarı ve lisans ayrıntısı alanı yoktur:
 * şemada olmayan alan yanıta girmez.
 */

const id = z.uuid()
const instant = z.iso.datetime()
const contentType = z.enum(enumKeys(CONTENT_TYPES))
const status = z.enum(enumKeys(RESOURCE_STATUSES))
const licenseKind = z.enum(enumKeys(LICENSE_KINDS)).nullable()

export const resourceParamsSchema = z.object({
  resourceId: id.describe('Kaynak kimliği'),
})
export const resourceVersionParamsSchema = resourceParamsSchema.extend({
  versionId: id.describe('Sürüm kimliği'),
})

export const resourceListQuerySchema = pageQuerySchema
  .extend({
    q: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Başlık, metin ve kaynak gösteriminde önek araması. Türkçe harf, büyük/küçük harf ve uyumluluk biçimleri (NFKD) duyarsız; en fazla 8 terim, hepsi eşleşmeli. Cevap anahtarı ve dinleme dökümü aranmaz',
      ),
    contentType: contentType.optional().describe('İçerik türü'),
    cefrLevel: z.enum(enumKeys(CEFR_LEVELS)).optional().describe('CEFR seviyesi'),
    primarySkill: z.enum(PRIMARY_SKILLS).optional().describe('Birincil beceri'),
    skill: z.enum(enumKeys(SKILLS)).optional().describe('Beceri listesinde bulunan beceri'),
    subjectId: z.string().min(1).max(200).optional().describe('Ders kimliği'),
    gradeLevel: z.coerce
      .number()
      .int()
      .min(GRADE_LEVEL_RANGE.min)
      .max(GRADE_LEVEL_RANGE.max)
      .optional()
      .describe('Sınıf düzeyi'),
    status: status
      .optional()
      .describe(
        'Baş sürümün durumu. Verilmezse arşivli ve kaldırılan kaynaklar dışlanır (DOM-KYN-051). Yalnız personel; öğrenci ve velide 400 `staff_only_filter`',
      ),
    ownerUserId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Kaynak sahibi. Yalnız personel; öğrenci ve velide 400 `staff_only_filter`'),
    sort: z
      .enum(RESOURCE_SORTS)
      .default('-updatedAt')
      .describe('Sıralama; eksi azalan. Eşitlikte kaynak kimliği'),
  })
  .strict()

const tagsSchema = z
  .object({
    subjectId: z.string().nullable(),
    gradeLevels: z.array(z.number().int()),
    cefrLevel: z.enum(enumKeys(CEFR_LEVELS)).nullable(),
    primarySkill: z.enum(PRIMARY_SKILLS).nullable(),
    skills: z.array(z.enum(enumKeys(SKILLS))),
    activityMode: z.enum(enumKeys(ACTIVITY_MODES)).nullable(),
    interactionChannel: z.enum(enumKeys(INTERACTION_CHANNELS)).nullable(),
    mediation: z
      .object({ sourceSkill: z.enum(MEDIATION_SKILLS), targetSkill: z.enum(MEDIATION_SKILLS) })
      .nullable(),
    durationMinutes: z.number().int().nullable(),
    difficulty: z.enum(enumKeys(DIFFICULTIES)).nullable(),
    outcomes: z.array(
      z.object({ outcomeId: z.string(), outcomeSource: z.enum(enumKeys(OUTCOME_SOURCES)) }),
    ),
  })
  .meta({ id: 'ResourceTags' })

const attributionSchema = z
  .object({
    work: z.string(),
    author: z.string(),
    source: z.string(),
    year: z.number().int().nullable(),
  })
  .meta({ id: 'ResourceAttribution' })

const contentSchema = z
  .record(z.string(), z.unknown())
  .describe('Tür başına içerik (school-core `resourceContentSchema`; `type` alanı türdür)')

const versionSummarySchema = z
  .object({
    id,
    versionNumber: z.number().int().min(1),
    status,
    title: z.string(),
    authorUserId: z.string(),
    tags: tagsSchema,
    licenseKind: licenseKind.describe('Lisans türü; seçilmemişse `null`'),
    createdAt: instant,
    updatedAt: instant,
    publishedAt: instant.nullable(),
    archivedAt: instant.nullable().describe('Arşivlendiği an; arşivli sürüm geçmişte okunur'),
    removedAt: instant.nullable(),
  })
  .meta({ id: 'ResourceVersionSummary' })

const staffVersionSchema = versionSummarySchema
  .extend({
    content: contentSchema.nullable().describe('Kaldırılan sürümde `null` (DOM-KYN-051)'),
    answerKey: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Cevap anahtarı (school-core `answerKeySchema`); yalnız personel'),
    license: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Lisans ayrıntısı (school-core `resourceLicenseSchema`); yalnız personel'),
    attributions: z.array(attributionSchema),
    submittedAt: instant.nullable(),
    reviewedByUserId: z.string().nullable(),
    reviewedAt: instant.nullable(),
    rejectionReason: z.string().nullable(),
    removalReason: z.string().nullable(),
    rowVersion: z.number().int().min(1).describe('İyimser kilit sürümü (`If-Match`)'),
  })
  .meta({ id: 'ResourceVersion' })

const learnerVersionSchema = z
  .object({
    id,
    resourceId: id,
    title: z.string(),
    content: contentSchema.describe(
      'Öğrenci görünümü: seçenekler kişiye sabit karıştırılır, dinleme görevinde döküm gizlidir',
    ),
    tags: tagsSchema,
    attributions: z.array(attributionSchema),
    licenseKind,
  })
  .meta({ id: 'LearnerResourceVersion' })

const resourceSummaryShape = {
  id,
  contentType,
  ownerUserId: z.string(),
  shareScope: z.enum(enumKeys(SHARE_SCOPES)),
  currentVersionId: id.nullable().describe('Güncel yayındaki sürüm; hiç yayımlanmadıysa `null`'),
  derivedFromVersionId: id.nullable().describe('Kopyalandığı sürüm'),
  createdAt: instant,
  updatedAt: instant,
}

const staffListItemSchema = z
  .object({
    view: z.literal('staff'),
    ...resourceSummaryShape,
    version: versionSummarySchema.describe('Okunabilir baş sürüm'),
  })
  .meta({ id: 'StaffResourceListItem' })

const learnerListItemSchema = z
  .object({
    view: z.literal('learner'),
    id,
    contentType,
    version: z.object({ id, title: z.string(), tags: tagsSchema, licenseKind }),
  })
  .meta({ id: 'LearnerResourceListItem' })

export const resourceListResponseSchema = pageResponse(
  z.discriminatedUnion('view', [staffListItemSchema, learnerListItemSchema]),
)

const publicationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.array(z.string()),
})

export const resourceDetailResponseSchema = dataResponse(
  z.discriminatedUnion('view', [
    z
      .object({
        view: z.literal('staff'),
        resource: z.object({
          ...resourceSummaryShape,
          sharedStudentIds: z.array(z.string()),
          sharedClassIds: z.array(z.string()),
        }),
        versions: z
          .array(versionSummarySchema)
          .describe('Okunabilir sürümler, numaraya göre artan'),
        head: staffVersionSchema,
        publicationIssues: z
          .array(publicationIssueSchema)
          .describe(
            'Açık sürümde (taslak, incelemede, reddedildi) yayım eksikleri; diğerlerinde boş',
          ),
      })
      .meta({ id: 'StaffResourceDetail' }),
    z
      .object({
        view: z.literal('learner'),
        resource: z.object({ id, contentType }),
        version: learnerVersionSchema,
      })
      .meta({ id: 'LearnerResourceDetail' }),
  ]),
)

export const resourceVersionResponseSchema = dataResponse(
  z.discriminatedUnion('view', [
    z.object({ view: z.literal('staff'), version: staffVersionSchema }),
    z.object({ view: z.literal('learner'), version: learnerVersionSchema }),
  ]),
)
