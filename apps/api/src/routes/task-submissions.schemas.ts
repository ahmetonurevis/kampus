import { z } from 'zod'

import { SUBMISSION_TEXT_MAX } from '@kampus/school-core/skills/submission.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Yazma görevinin taslak ve teslim şemaları (ADR 0004 karar 6; DOM-BEC-023, 040, 044, 046;
 * IST-047, IST-051). Gövde core `submissionVersionInputSchema` ve `draftInputSchema` biçimidir;
 * katıdır: istemcinin gönderdiği puan, sürüm numarası veya teslim anı 400 alır. Yazma otomatik
 * puanlanmaz; yanıtlarda puan alanı yoktur (rubrik puanlaması F4b3b).
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
  latestVersion: z.object(versionShape).nullable(),
  rowVersion: z.number().int().min(1).describe('Teslim kaydının satır sürümü'),
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
            '`canSubmit: false` ise neden. Kursiyer ve veli, öğretmen geri bildirimi açılmadan `graded` yerine genel `locked` alır (DOM-BEC-045)',
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

export const taskSubmissionListResponseSchema = pageResponse(taskSubmissionSchema)
export const taskSubmissionDetailResponseSchema = dataResponse(taskSubmissionDetailSchema)
export const taskDraftResponseSchema = dataResponse(taskDraftSchema)
export const taskDraftReadResponseSchema = dataResponse(
  taskDraftSchema.nullable().describe('Taslak yoksa `null`'),
)
