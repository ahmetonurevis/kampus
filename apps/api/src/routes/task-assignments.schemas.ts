import { z } from 'zod'

import { CONTENT_TYPES, enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import {
  assignmentInputSchema,
  assignmentSettingsSchema,
  TARGET_KINDS,
} from '@kampus/school-core/skills/assignment.ts'
import {
  attemptRulesSchema,
  deadlineSchema,
  TASK_KINDS,
} from '@kampus/school-core/skills/scoring.ts'
import { submissionSettingsSchema } from '@kampus/school-core/skills/submission.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Görev atama uçlarının şemaları (ADR 0004 karar 4; DOM-KYN-032, DOM-BEC-041, 042, 044;
 * IST-034). Oluşturma gövdesi core `assignmentInputSchema`'dır; değişiklik gövdesi core
 * `planAssignmentChange`'e olduğu gibi gider (yalnız `deadline` değişir, diğer alanlar 409
 * `assignment_setting_frozen`). Yanıt kişiye göre iki biçimdir: personel (`staff`) bütün sabit
 * alanları, kursiyer ve veli (`learner`) yalnız görevin kendisini görür.
 */

const id = z.uuid()
const instant = z.iso.datetime()
const taskKind = z.enum(enumKeys(TASK_KINDS))

export const taskAssignmentParamsSchema = z.object({
  assignmentId: id.describe('Atama kimliği'),
})

export const taskAssignmentListQuerySchema = pageQuerySchema
  .extend({
    resourceId: id.optional().describe('Atanan içerik (aynı içeriğin ayrı atamaları, IST-034)'),
    kind: taskKind.optional().describe('Görev türü: değerlendirme veya alıştırma'),
  })
  .strict()

/**
 * Yeni atama: core `assignmentInputSchema` (içerik sürümü, ayarlar, hedefler). Tek fark dinleme
 * hakkının varsayılanıdır: core değerlendirmede 2 verir (DOM-BEC-005), ama API dinleme sayısını
 * `attempt_media_plays` gelene kadar tutamaz. Gönderilmeyen hak sınırsız (`null`) saklanır; dolu
 * hak (1 veya 2) serviste 422 `listening_plays_unavailable` alır (ADR 0004 karar 6 uygulama notu).
 */
// TODO(F3c2-files): `attempt_media_plays` gelince core varsayılanına (2) dönülür.
export const taskAssignmentBodySchema = assignmentInputSchema.extend({
  settings: assignmentSettingsSchema
    .safeExtend({
      listeningPlays: z
        .union([z.literal(1), z.literal(2)])
        .nullable()
        .default(null)
        .describe(
          'Dinleme hakkı; gönderilmezse sınırsız. Dinleme sayımı açılana kadar yalnız sınırsız kabul edilir.',
        ),
    })
    .prefault({}),
})

/**
 * Değişiklik: yalnız `deadline` (son teslim ve geç kabul) uzatılır. Bilinmeyen alanlar core'a
 * gider ve 409 `assignment_setting_frozen` alır; sabit sürüm alanları hiçbir yolla değişmez.
 */
export const taskAssignmentPatchSchema = z
  .looseObject({
    deadline: deadlineSchema
      .optional()
      .describe('Yeni son teslim ve geç kabul; yalnız uzatılabilir (DOM-BEC-044)'),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'En az bir alanı değiştirin.')

const sharedShape = {
  id,
  resourceId: id,
  resourceVersionId: id.describe('Atamada sabitlenen içerik sürümü (DOM-KYN-032)'),
  title: z.string().describe('Atanan sürümün başlığı'),
  contentType: z.enum(enumKeys(CONTENT_TYPES)),
  scoringMode: z.enum(['auto', 'teacher']).describe('Otomatik puanlı veya öğretmen puanlı'),
  kind: taskKind,
  attempts: attemptRulesSchema.describe('Deneme hakkı ve sayım politikası (DOM-BEC-042)'),
  deadline: deadlineSchema.describe('Son teslim ve geç kabul (DOM-BEC-044)'),
  timeLimitMinutes: z.number().int().nullable(),
  listeningPlays: z
    .union([z.literal(1), z.literal(2)])
    .nullable()
    .describe('Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005)'),
  showTranscript: z.boolean(),
  submission: submissionSettingsSchema.nullable().describe('Öğretmen puanlı görevin teslim ayarı'),
  createdAt: instant,
}

const staffAssignmentSchema = z
  .object({
    view: z.literal('staff'),
    ...sharedShape,
    scoringVersionId: id.describe(
      'Puanlamanın okunduğu sürüm; başta içerik sürümüdür, yalnız yeniden puanlama değiştirir',
    ),
    rubricVersionId: id.nullable().describe('Sabitlenen yayındaki rubrik sürümü (DOM-BEC-022)'),
    highStakes: z.boolean(),
    secondRatingPercent: z.number().int().min(0).max(100),
    assignedByUserId: z.string(),
    targets: z
      .array(z.object({ kind: z.enum(enumKeys(TARGET_KINDS)), id: z.string() }))
      .describe('Sınıf/şube, dil grubu veya öğrenci hedefleri'),
    updatedAt: instant,
    archivedAt: instant.nullable(),
    rowVersion: z
      .number()
      .int()
      .min(1)
      .describe('Atama satırının iyimser kilit sürümü (değişiklikte `If-Match`)'),
  })
  .meta({ id: 'TaskAssignmentStaff' })

const learnerAssignmentSchema = z
  .object({
    view: z.literal('learner'),
    ...sharedShape,
    learnerIds: z
      .array(z.string())
      .describe('Görevin hedeflediği kişinin kendisi veya velinin çocukları'),
  })
  .meta({ id: 'TaskAssignmentLearner' })

const taskAssignmentSchema = z
  .discriminatedUnion('view', [staffAssignmentSchema, learnerAssignmentSchema])
  .meta({ id: 'TaskAssignment' })

export const taskAssignmentListResponseSchema = pageResponse(taskAssignmentSchema)
export const taskAssignmentDetailResponseSchema = dataResponse(taskAssignmentSchema)
export const taskAssignmentWriteResponseSchema = dataResponse(staffAssignmentSchema)
