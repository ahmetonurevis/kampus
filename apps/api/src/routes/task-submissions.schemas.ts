import { z } from 'zod'

import { resubmissionRequestSchema } from '@kampus/school-core/skills/assignment.ts'
import {
  appealDecisionSchema,
  appealInputSchema,
  APPEAL_OUTCOMES,
  BAND_MEANINGS,
  RATER_ROLES,
  rubricScoreInputSchema,
} from '@kampus/school-core/skills/rubric.ts'
import { SUBMISSION_TEXT_MAX } from '@kampus/school-core/skills/submission.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Beceri görevinin taslak ve teslim şemaları (ADR 0004 karar 6; DOM-BEC-023, 040, 044, 046,
 * 050…054; IST-047, IST-051). Gövde core `submissionVersionInputSchema` ve `draftInputSchema` biçimidir;
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

/** Taslaktan teslim gövdesi: boş ve katı; metin kaydedilmiş taslaktır (IST-047). */
export const taskDraftSubmitBodySchema = z.strictObject({})

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
  learnerName: z
    .string()
    .nullable()
    .describe(
      'Öğrencinin adı: yöneticide her öğrenci, öğretmende yalnız öğrenci kapsamındakiler ve okuduğu uyuşmazlıklı teslimin öğrencisi (koordinatör). Kapsam dışı öğrenci, öğrenci, veli ve bulunamayan kayıtta `null` (OG-213)',
    ),
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

const versionGradingSchema = z
  .object({
    status: z
      .enum(['unscored', 'pending', 'disagreement', 'settled'])
      .describe(
        'Sürümün puan sonucu (core `scoreResolution`): puanlanmadı, puan bekliyor, iki puan arasında birden fazla bant fark (DOM-BEC-024) veya kesinleşti',
      ),
    missing: z
      .enum(['first', 'second'])
      .nullable()
      .describe('`pending` iken beklenen puan; değilse `null`'),
    secondRatingRequested: z
      .boolean()
      .describe('Sürüm ikinci puanlama isteğinin (örneklem veya elle) kapsamında mı'),
    disagreementCriterionIds: z
      .array(z.string())
      .describe(
        'Uyuşmazlık kriterleri; bantlar yine yalnız kendi puanlayıcısına ve kapsamındaki koordinatöre görünür. Son puanı koordinatör verir (`final-scores`); o zamana kadar sonuç kursiyere kapalıdır',
      ),
    raterScores: z
      .array(
        z.object({
          raterRole: z
            .enum(Object.keys(RATER_ROLES) as [keyof typeof RATER_ROLES])
            .describe(
              '`first` ilk, `second` ikinci puan, `final` son puan (koordinatör veya itiraz)',
            ),
          score: taskScoreSchema,
        }),
      )
      .describe(
        'Kişinin görebildiği puanlar rolleriyle (core `scoresVisibleToRater`): öğretmen ve yönetici kendi puanını ve kesinleşen puanı; atamanın dersinin/seviyesinin koordinatörü hepsini, ama sürümü kendisi puanladıysa yalnız kendininkini (kör puanlama; DOM-BEC-024, DOM-YTK-027)',
      ),
    canResolve: z
      .boolean()
      .describe(
        'Kişi bu sürüme son puan verebilir mi: uyuşmazlık var, atamanın dersinin/seviyesinin koordinatörü ve iki puanlayıcıdan biri değil (DOM-BEC-024)',
      ),
    dueAt: instant
      .nullable()
      .describe(
        'Puanlamanın son anı (core `gradingDueAt`; son teslim + 7 gün). Örneklemli görevde süre örneklemin seçildiği andan başlar; örneklem seçilmeden `null` (süre işlemez)',
      ),
    overdue: z
      .boolean()
      .describe('Puanlama süresi aşıldı mı (core `gradingOverdue`); süre yokken `false`'),
  })
  .meta({ id: 'TaskVersionGrading' })
  .describe('Personelin gördüğü puanlama durumu (DOM-BEC-024, 025); kursiyer ve veliye `null`')

const taskAppealSchema = z
  .object({
    id,
    reason: z.string().describe('İtiraz gerekçesi'),
    filedAt: instant,
    outcome: z
      .enum(Object.keys(APPEAL_OUTCOMES) as [keyof typeof APPEAL_OUTCOMES])
      .nullable()
      .describe('Karar; beklerken `null`'),
    decidedAt: instant.nullable(),
    decisionReason: z.string().nullable().describe('Karar gerekçesi'),
  })
  .meta({ id: 'TaskAppeal' })
  .describe(
    'Sürümün itirazı (DOM-BEC-025); itiraz yalnız sonuç duyurusundan sonra açılır, yoksa `null`',
  )

const taskSubmissionFileSchema = z
  .object({
    id,
    purpose: z
      .enum(['submission', 'speaking_recording'])
      .describe('El yazısı teslimi veya konuşma kaydı'),
    contentType: z.string().describe('İçerikten tespit edilen tür'),
    byteSize: z.number().int().min(0),
    durationMs: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe('Sunucuda ölçülen süre; ölçülmediyse `null`. İmhadan sonra da kalır (DOM-BEC-052)'),
    status: z
      .enum(['processing', 'ready', 'deleted'])
      .describe(
        '`ready` dosya `GET /api/v1/files/{fileId}/url` ile açılır (konuşma kaydında DOM-BEC-053 erişimi); `deleted` saklama süresi dolup imha edildi',
      ),
  })
  .meta({ id: 'TaskSubmissionFile' })

const taskSubmissionDetailSchema = z
  .object({
    ...summaryShape,
    versions: z
      .array(
        z.object({
          ...versionShape,
          body: z.string().nullable().describe('Gönderilen metin; değişmez'),
          files: z
            .array(taskSubmissionFileSchema)
            .describe(
              'Dosyalı teslimin görüntüleri veya konuşma kaydı, gönderim sırasıyla; metin teslimde boş',
            ),
          score: taskScoreSchema.nullable(),
          grading: versionGradingSchema.nullable(),
          appealDeadline: instant
            .nullable()
            .describe(
              'İtirazın son anı (core `appealDeadline`: duyurudan sonra 5 iş günü, Europe/Istanbul gün sonu); yalnız değerlendirme türünde ve sonuç duyurulduysa, kursiyer ve veliye duyurudan önce `null`',
            ),
          appeal: taskAppealSchema.nullable(),
          resubmissionRequest: z
            .object({ dueAt: instant, requestedAt: instant })
            .nullable()
            .describe(
              'Bu sürüm için istenen yeniden teslim turu ve kendi son tarihi (DOM-BEC-040, IST-047); bir sonraki sürüm bu tarihe (geç kabulsüz) bağlıdır. Yeniden teslim geçmişi sürüm başına okunur; istenmediyse `null`',
            ),
        }),
      )
      .describe(
        'Değişmez sürümler, eskiden yeniye (DOM-BEC-040); her sürüm kendi geç bayrağı, geri bildirimi ve yeniden teslim turuyla. Taslak hiç dönmez',
      ),
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
  .extend({
    assignmentId: id.optional().describe('Atama süzgeci'),
    awaiting: z
      .enum(['first', 'second', 'resolution'])
      .optional()
      .describe(
        'Yalnız ilk puanı, yalnız ikinci puanı veya yalnız koordinatörün son puanını (uyuşmazlık) bekleyenler (DOM-BEC-024)',
      ),
    overdue: z
      .enum(['true', 'false'])
      .optional()
      .describe('`true` puanlama süresi aşılanlar, `false` aşılmayanlar (DOM-BEC-025)'),
  })
  .strict()

const gradingQueueItemSchema = z
  .object({
    ...summaryShape,
    assignmentTitle: z
      .string()
      .nullable()
      .describe(
        'Atanan içerik sürümünün başlığı; atamayı görmeyen koordinatör de okur (DOM-YTK-027). Sürüm bulunamazsa `null`',
      ),
    grading: z.object({
      awaiting: z
        .array(z.enum(['first', 'second']))
        .describe(
          'Son sürümün beklediği puanlar; kişinin puanladığı bekleyen sürüm kuyrukta yoktur. Uyuşmazlıkta boş',
        ),
      awaitingResolution: z
        .boolean()
        .describe(
          'İki puan uyuşmuyor, koordinatörün son puanı bekleniyor (DOM-BEC-024); yalnız iki puan da verildikten sonra `true`',
        ),
      samplePending: z
        .boolean()
        .describe(
          'Örneklemli görevde örneklem henüz seçilmedi; ilk puan örneklemden sonra verilir. Son tarihsiz görevde örneklem yoktur, `false`',
        ),
      dueAt: instant
        .nullable()
        .describe(
          'Puanlamanın son anı (core `gradingDueAt`); örneklemli görevde örneklem anından başlar, örneklem seçilmeden `null`',
        ),
      overdue: z
        .boolean()
        .describe('Puanlama süresi aşıldı mı (core `gradingOverdue`); süre yokken `false`'),
    }),
  })
  .meta({ id: 'GradingQueueItem' })

export const secondRatingRequestBodySchema = z.strictObject({
  versionNumber: z
    .number()
    .int()
    .min(1)
    .describe('İkinci puanlaması istenen sürüm; yalnız son sürüm'),
})

export const secondRatingSampleBodySchema = z.strictObject({})

export const secondRatingSampleResponseSchema = dataResponse(
  z
    .object({
      assignmentId: id,
      sampledAt: instant,
      percent: z.number().int().min(1).max(100),
      submissionCount: z.number().int().min(0).describe('Örneklem havuzu: sürümü olan teslimler'),
      submissionIds: z
        .array(id)
        .describe('İkinci puanlanacak teslimler: oranın yukarı yuvarlanmışı, en az bir'),
      rowVersion: z.number().int().min(1).describe('Atamanın yeni satır sürümü'),
    })
    .meta({ id: 'SecondRatingSample' }),
)

export const taskAppealParamsSchema = taskSubmissionParamsSchema.extend({
  appealId: id.describe('İtiraz kimliği'),
})

export const taskAppealBodySchema = z.strictObject({
  versionNumber: z.number().int().min(1).describe('İtiraz edilen sürüm'),
  ...appealInputSchema.shape,
})

const [upheldDecision, rejectedDecision] = appealDecisionSchema.options

/** İtiraz kararı (core `appealDecisionSchema`); kabulde yeni rubrik puanı. Fazladan alan 400. */
export const taskAppealDecisionBodySchema = z.discriminatedUnion('outcome', [
  upheldDecision.extend({ score: rubricScoreInputSchema.strict() }).strict(),
  rejectedDecision.strict(),
])

export const taskSubmissionListResponseSchema = pageResponse(taskSubmissionSchema)
export const gradingQueueResponseSchema = pageResponse(gradingQueueItemSchema)
export const taskSubmissionDetailResponseSchema = dataResponse(taskSubmissionDetailSchema)
export const taskDraftResponseSchema = dataResponse(taskDraftSchema)
export const taskDraftReadResponseSchema = dataResponse(
  taskDraftSchema.nullable().describe('Taslak yoksa `null`'),
)
