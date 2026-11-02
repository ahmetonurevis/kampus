import { z } from 'zod'

import {
  answerKeySchema,
  attributionSchema as coreAttributionSchema,
  RESOURCE_STATUSES,
  resourceContentSchema,
  resourceFileIdsSchema,
  resourceLicenseSchema,
  resourceTagsSchema,
  resourceVersionInputSchema,
  transitionReasonSchema,
} from '@kampus/school-core/content/resource.ts'
import { RESOURCE_FILE_SHOWN_STATUSES } from '@kampus/school-core/content/resource-files.ts'
import { shareTargetsSchema } from '@kampus/school-core/content/visibility.ts'
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
  SUBSKILLS,
} from '@kampus/school-core/content/taxonomy.ts'

import { RESOURCE_SORTS } from '../db/resources.ts'
import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'
import { filePurposeSchema } from './files.schemas.ts'

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
export const licenseKind = z.enum(enumKeys(LICENSE_KINDS)).nullable()

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
    subskill: z
      .enum(enumKeys(SUBSKILLS))
      .nullable()
      .describe('Anlama sorusunun alt becerisi (DOM-BEC-006); yalnız soruda dolar'),
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

export const attributionSchema = z
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

/**
 * Sürüm dosyasının meta verisi (DOM-KYN-006); içerik `GET /files/:fileId/url` ile, dosyayı açan
 * sürümün okuma kuralından geçerek indirilir. Yükleyen ve depo anahtarı yanıta girmez.
 */
const resourceFileSchema = z
  .object({
    id,
    name: z.string().nullable().describe('Temizlenmiş özgün ad; yalnız gösterim için'),
    contentType: z.string().describe('İçerikten tespit edilen MIME türü'),
    byteSize: z.number().int().min(1),
    purpose: filePurposeSchema,
    durationMs: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe('Ses/video süresi; ölçülmediyse `null`'),
    status: z
      .enum(RESOURCE_FILE_SHOWN_STATUSES)
      .describe(
        '`processing` dönüştürülüyor (bağlantı verilmez); `deleted` saklama sonunda silindi',
      ),
  })
  .meta({ id: 'ResourceFile' })

/** Sürüm dosyasının yanıttaki meta verisi; servis görünümü bu şemadan türer. */
export type ResourceFile = z.output<typeof resourceFileSchema>

const filesSchema = z
  .array(resourceFileSchema)
  .describe('Sürümün dosyaları, `fileIds` sırasıyla; kaldırılan sürümde boş (DOM-KYN-051)')

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
    files: filesSchema,
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
    files: filesSchema,
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

const staffResourceSchema = z
  .object({
    ...resourceSummaryShape,
    sharedStudentIds: z.array(z.string()),
    sharedClassIds: z.array(z.string()),
    archivedAt: instant
      .nullable()
      .describe('Bütün sürümleri arşivlenince veya kaynak kaldırılınca dolar (DOM-KYN-051)'),
    rowVersion: z
      .number()
      .int()
      .min(1)
      .describe('Kaynak satırının iyimser kilit sürümü (paylaşım ve kaldırmada `If-Match`)'),
  })
  .meta({ id: 'StaffResource' })

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
        resource: staffResourceSchema,
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

// --- Yazma uçları -------------------------------------------------------------------------

/** Yeni kaynak: core `resourceVersionInputSchema` (taslak eksik kaydedilebilir). */
export const resourceCreateBodySchema = resourceVersionInputSchema

/**
 * Taslak düzenleme: verilen alanlar sürümdeki değerin yerine geçer, verilmeyenler aynen kalır.
 * Alan şemaları core'undur; birleşmiş taslak core `planDraftUpdate` ile yeniden doğrulanır.
 */
export const draftPatchBodySchema = z
  .strictObject({
    title: resourceVersionInputSchema.shape.title.optional(),
    content: resourceContentSchema.optional().describe('Tür başına içerik; tür değiştirilemez'),
    answerKey: answerKeySchema.nullable().optional(),
    tags: resourceTagsSchema.optional().describe('Etiketler bütün olarak değişir'),
    license: resourceLicenseSchema.nullable().optional(),
    attributions: z.array(coreAttributionSchema).max(30).optional(),
    fileIds: resourceFileIdsSchema
      .optional()
      .describe(
        'Sürümün sıralı dosya listesi, bütün olarak değişir; içerikteki dosya listede bulunmalıdır (DOM-KYN-006)',
      ),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'En az bir alanı değiştirin.')

/** Gövdesiz komutlar: istemci `{}` gönderir; bilinmeyen alan 400. */
export const emptyBodySchema = z.strictObject({})

/** Yeni sürüm: dosya listesi verilmezse temel sürümün listesi aynen kalır (DOM-KYN-006, 032). */
export const newVersionBodySchema = z.strictObject({
  fileIds: resourceFileIdsSchema
    .optional()
    .describe('Yeni sürümün sıralı dosya listesi; temel sürümün dosyaları yeniden denetlenmez'),
})

export const transitionBodySchema = z.strictObject({
  reason: z.string().max(1000).optional().describe('Kullanılmaz; yalnız ret ve telif bildiriminde'),
})

/** Ret, telif bildirimi ve kaldırma gerekçesi; boş gerekçe 422 `reason_required` (core). */
export const reasonBodySchema = z.strictObject({
  // kvkk: K — serbest metin; loglanmaz, denetim kaydına yazılmaz.
  reason: z
    .string()
    .max(transitionReasonSchema.maxLength ?? 1000)
    .describe('Gerekçe (5–1000 karakter, kırpılır)'),
})

export const resourceShareBodySchema = shareTargetsSchema

export const resourceWriteResponseSchema = dataResponse(
  z
    .object({ resource: staffResourceSchema, version: staffVersionSchema })
    .meta({ id: 'ResourceWriteResult' }),
)

export const shareResponseSchema = dataResponse(
  z.object({ resource: staffResourceSchema }).meta({ id: 'ResourceShareResult' }),
)

export const removalResponseSchema = dataResponse(
  z
    .object({
      resource: staffResourceSchema,
      versionIds: z.array(id).describe('Kaldırılan sürümler'),
      affectedCopyIds: z
        .array(id)
        .describe('Bu sürümlerden türetilmiş kopyalar; yönetici ayrıca inceler (DOM-KYN-050)'),
      affectedContainerVersionIds: z
        .array(id)
        .describe('Kaldırılan soruyu içeren quiz/alıştırma seti sürümleri'),
    })
    .meta({ id: 'ResourceRemovalResult' }),
)
