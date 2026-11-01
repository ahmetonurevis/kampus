import { z } from 'zod'

import { resubmissionRequestSchema } from '@kampus/school-core/skills/assignment.ts'
import { BAND_MEANINGS, rubricScoreInputSchema } from '@kampus/school-core/skills/rubric.ts'
import { SUBMISSION_TEXT_MAX } from '@kampus/school-core/skills/submission.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Yazma görevinin taslak ve teslim şemaları (ADR 0004 karar 6; DOM-BEC-023, 040, 044, 046;
 * IST-047, IST-051). Gövde core `submissionVersionInputSchema` ve `draftInputSchema` biçimidir;
 * katıdır: istemcinin gönderdiği puan, sürüm numarası veya teslim anı 400 alır. Yazma otomatik
 * puanlanmaz (DOM-BEC-023); puan öğretmenin rubrik puanıdır (F4b3b1), her okumada kriter
 * bantlarından hesaplanır ve kursiyere geri bildirim açılınca görünür (DOM-BEC-045).
 */

const id = z.uuid()
const instant = z.iso.datetime()
const text = z.string().max(SUBMISSION_TEXT_MAX, 'Metin en fazla 50.000 karakter olabilir.')

export const taskSubmissionParamsSchema = z.object({
  submissionId: id.describe('Teslim kimliği'),
})

export const taskSubmissionAssignmentParamsSchema = z.object({
  assignmentId: id.describe('Atama kimliği'),
})

export const taskSubmissionListQuerySchema = pageQuerySchema
  .extend({
    assignmentId: id.describe('Atama (zorunlu)'),
    learnerId: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Kursiyer süzgeci; okuma kapsamı dışındaki kursiyer boş liste verir'),
  })
  .strict()

export const taskSubmissionBodySchema = z.discriminatedUnion('submissionKind', [
  z.strictObject({
    submissionKind: z.literal('text'),
    body: text.describe('Teslim metni; boş olamaz, gönderildikten sonra değişmez'),
  }),
  z.strictObject({
    submissionKind: z.literal('file'),
    fileIds: z.array(z.string().min(1).max(100)).min(1).max(10),
  }),
  z.strictObject({
    submissionKind: z.literal('audio'),
    recordingFileId: z.string().min(1).max(100),
  }),
])

export const taskDraftBodySchema = z.strictObject({
  body: text.describe('Taslak metni; boş olabilir'),
})

const wordCountSchema = z
  .object({
    count: z.number().int().min(0),
    status: z.enum(['ok', 'below', 'above']),
    warning: z
      .string()
      .nullable()
      .describe('Sözcük sınırı dışındaysa uyarı; teslim reddedilmez (DOM-BEC-046)'),
  })
  .meta({ id: 'TaskWordCount' })

const scoreBriefShape = {
  settled: z
    .boolean()
    .describe(
      'Puan kesinleşti mi (core `scoreResolution`); kesinleşmemiş puanı yalnız personel görür',
    ),
  rubricVersionId: id.describe(
    'Puanın verildiği rubrik sürümü (atamanın sabitlediği; DOM-BEC-022)',
  ),
  total: z.number().int().min(0).describe('Ağırlıklı bant toplamı; saklanmaz, okunurken'),
  max: z.number().int().min(1).describe('Azami ağırlıklı bant toplamı'),
  percent: z.number().int().min(0).max(100).describe('100 üzerinden puan (DOM-BEC-021)'),
  scoredAt: instant,
}

const taskScoreBriefSchema = z
  .object(scoreBriefShape)
  .meta({ id: 'TaskScoreBrief' })
  .describe(
    'Son sürümün puan özeti; kursiyer ve veliye geri bildirim açılmadan `null` (DOM-BEC-045)',
  )

const taskScoreSchema = z
  .object({
    ...scoreBriefShape,
    criteria: z.array(
      z.object({
        criterionId: z.string(),
        band: z.number().int().min(0).max(5),
        weight: z.number().int().min(1),
        weighted: z.number().int().min(0),
        meaning: z.enum(Object.keys(BAND_MEANINGS) as [keyof typeof BAND_MEANINGS]),
        comment: z.string().nullable(),
      }),
    ),
    overallComment: z.string().describe('Öğretmenin genel geri bildirimi'),
  })
  .meta({ id: 'TaskScore' })
  .describe(
    'Sürümün rubrik puanı ve geri bildirimi; puanlanmamışsa ya da kursiyer ve veliye henüz açılmadıysa `null` (DOM-BEC-045)',
  )

const versionShape = {
  id,
  number: z.number().int().min(1),
  submittedAt: instant,
  late: z.boolean().describe('Sürümün süresinden sonra, geç kabul içinde gönderildi (DOM-BEC-044)'),
  wordCount: wordCountSchema.nullable().describe('Yazmada sözcük sayısı; saklanmaz, okunurken'),
}

const summaryShape = {
  id,
  assignmentId: id,
  learnerId: z.string(),
  status: z
    .enum(['pending', 'submitted', 'late', 'not_submitted'])
    .describe('Son sürüme göre teslim durumu (DOM-BEC-044)'),
  versionCount: z.number().int().min(0),
  latestVersion: z.object({ ...versionShape, score: taskScoreBriefSchema.nullable() }).nullable(),
  resubmission: z
    .object({ versionNumber: z.number().int().min(1), dueAt: instant })
    .nullable()
    .describe('Son yeniden teslim isteği: puanlanan sürüm ve kendi son tarihi (DOM-BEC-040)'),
  rowVersion: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe(
      'Teslim kaydının satır sürümü; puanlama ve yeniden teslim isteğinde `If-Match`. Puan ve istek sürümü artırdığı için kursiyer ve veliye `null` (DOM-BEC-045)',
    ),
}

const taskSubmissionSchema = z.object(summaryShape).meta({ id: 'TaskSubmission' })

const taskSubmissionDetailSchema = z
  .object({
    ...summaryShape,
    versions: z
      .array(
        z.object({
          ...versionShape,
          body: z.string().nullable().describe('Gönderilen metin; değişmez'),
          score: taskScoreSchema.nullable(),
        }),
      )
      .describe('Değişmez sürümler, eskiden yeniye (DOM-BEC-040); taslak hiç dönmez'),
    allowance: z
      .object({
        limit: z.number().int().min(1),
        used: z.number().int().min(0),
        remaining: z.number().int().min(0),
        resubmissionOpen: z.boolean(),
        canSubmit: z.boolean(),
        blockedBy: z
          .enum(['limit', 'graded', 'locked'])
          .nullable()
          .describe(
            '`canSubmit: false` ise neden. Kursiyer ve veli geri bildirimi açılmamış puanı görmez: hak, son sürüm puanlanmamış gibi hesaplanır (DOM-BEC-045); onlara `locked` yalnız sıradaki sürümün teslim penceresi kapandığında döner',
          ),
      })
      .nullable()
      .describe('Yeni sürüm hakkı (core `versionAllowance`)'),
  })
  .meta({ id: 'TaskSubmissionDetail' })

const taskDraftSchema = z
  .object({
    assignmentId: id,
    body: z.string(),
    revision: z
      .number()
      .int()
      .min(1)
      .describe('Taslağın iyimser kilit sürümü; sonraki kayıtta `If-Match` olarak gönderilir'),
    savedAt: instant,
    wordCount: wordCountSchema.nullable(),
  })
  .meta({ id: 'TaskDraft' })

/**
 * Rubrik puanı gövdesi (DOM-BEC-021): core `rubricScoreInputSchema` ve puanlanan sürüm numarası.
 * Katıdır: istemcinin toplamı, yüzdesi, rubrik sürümü veya puanlayıcı rolü 400 alır; kriter
 * satırı da katıdır (core 2.22.0), fazladan alan (ör. `weighted`) 400. Toplam sunucuda hesaplanır.
 */
export const taskScoreBodySchema = z.strictObject({
  versionNumber: z.number().int().min(1).describe('Puanlanan sürüm; yalnız son sürüm puanlanır'),
  ...rubricScoreInputSchema.shape,
})

/** Yeniden teslim isteği gövdesi: core `resubmissionRequestSchema` (DOM-BEC-040), katı. */
export const taskResubmissionBodySchema = z.strictObject({ ...resubmissionRequestSchema.shape })

export const gradingQueueQuerySchema = pageQuerySchema
  .extend({ assignmentId: id.optional().describe('Atama süzgeci') })
  .strict()

export const taskSubmissionListResponseSchema = pageResponse(taskSubmissionSchema)
export const gradingQueueResponseSchema = pageResponse(taskSubmissionSchema)
export const taskSubmissionDetailResponseSchema = dataResponse(taskSubmissionDetailSchema)
export const taskDraftResponseSchema = dataResponse(taskDraftSchema)
export const taskDraftReadResponseSchema = dataResponse(
  taskDraftSchema.nullable().describe('Taslak yoksa `null`'),
)
