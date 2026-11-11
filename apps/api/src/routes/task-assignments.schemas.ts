import { z } from 'zod'

import { CONTENT_TYPES, enumKeys, SUBMISSION_KINDS } from '@kampus/school-core/content/taxonomy.ts'
import {
  assignmentBatchInputSchema,
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
import { attributionSchema, licenseKind } from './resources.schemas.ts'

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
 * Yeni atama: core `assignmentInputSchema` (içerik sürümü, ayarlar, hedefler). Dinleme hakkı
 * (DOM-BEC-005) gönderilmezse dinleme görevinde core varsayılanı (2) uygulanır; ama hak yalnız
 * dinleme kaydına (`listening_audio` dosyalı ses sürümü) bağlı quiz/alıştırma setinde sayılabilir
 * (IST-045). Kaydı olmayan dinleme görevinde gönderilmeyen hak sınırsız (`null`) saklanır, dolu
 * hak (1 veya 2) serviste 422 `listening_plays_unavailable` alır (ADR 0004 karar 6 uygulama notu).
 */
export const taskAssignmentBodySchema = assignmentInputSchema.extend({
  // Yalnız OpenAPI açıklaması eklenir; doğrulama core'unkiyle aynıdır (`safeExtend` core'un
  // `superRefine`'ını korur).
  settings: assignmentSettingsSchema
    .safeExtend({
      listeningPlays: assignmentSettingsSchema.shape.listeningPlays.describe(
        'Dinleme hakkı (DOM-BEC-005, IST-045): 1, 2 veya `null` (sınırsız). Gönderilmezse kayda bağlı etkinlikte (quiz/alıştırma seti `listeningVersionId` → `listening_audio` dosyalı ses sürümü) 2, kaydı olmayanda sınırsız; kaydı olmayanda 1 veya 2 422 `listening_plays_unavailable`.',
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
    secondRatingSampledAt: instant
      .nullable()
      .describe(
        'İkinci puanlama örnekleminin seçildiği an (DOM-BEC-024); seçilmediyse veya örneklem yoksa `null`. Yalnız personel görür',
      ),
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

/**
 * Kursiyerin (öğrencide kendisi, velide her çocuğu) görevdeki durumu (IST-051). Deneme ve teslim
 * uçlarının kurallarıyla hesaplanır; açılmamış puan, ikinci puanlama, örneklem, uyuşmazlık ve
 * itiraz durumu hiçbir alandan çıkarılamaz, satır sürümü yoktur (DOM-BEC-045).
 */
const learnerProgressSchema = z
  .object({
    learnerId: z.string(),
    status: z
      .enum(['pending', 'in_progress', 'submitted', 'late', 'not_submitted'])
      .describe(
        'Başlanmadı/teslim bekleniyor, süren deneme, zamanında veya geç tamamlandı/teslim edildi, pencere kapandı ve yapılmadı (DOM-BEC-044)',
      ),
    resubmissionRequested: z
      .boolean()
      .describe('Öğretmen yeniden teslim istedi ve yeni sürüm henüz gelmedi (DOM-BEC-040)'),
    attemptId: id
      .nullable()
      .describe('Otomatik puanlı: süren deneme, yoksa gösterilen (sayılan veya son) deneme'),
    submissionId: id.nullable().describe('Öğretmen puanlı: teslim kaydı'),
    lastActivityAt: instant
      .nullable()
      .describe('Gösterilen denemenin tamamlandığı veya son sürümün gönderildiği an'),
    used: z.number().int().min(0).describe('Kullanılan deneme veya gönderilen sürüm sayısı'),
    limit: z.number().int().min(1).nullable().describe('Deneme veya sürüm hakkı; `null` sınırsız'),
    remaining: z.number().int().min(0).nullable().describe('Kalan hak; `null` sınırsız'),
    canAct: z.boolean().describe('Şu an yeni deneme başlatılabilir veya yeni sürüm gönderilebilir'),
    actionableUntil: instant
      .nullable()
      .describe(
        'Şu anki işlem durumunun yalnız zamanla değişeceği an: süren denemenin bitişi (süre veya pencere), yoksa `canAct` iken yeni deneme veya sürüm penceresinin kapanışı (istenen yeniden teslimin son tarihi dahil). Bu andan sonra özet eskidir; istemci yeniden okur. Puan açılma anı burada yoktur (DOM-BEC-045)',
      ),
    blockedBy: z
      .enum([
        'in_progress',
        'content_unavailable',
        'license_expired',
        'locked',
        'limit',
        'graded',
        'unavailable',
      ])
      .nullable()
      .describe(
        '`canAct` değilse neden: süren deneme, içerik kursiyere kapalı (yazma uçlarının 422 `content_unavailable` vereceği durum: kaldırılmış içerik, süren işi olmayana telif askısı, kitap sahibi olmayan; DOM-KYN-021, 025, 051; diğer engellerden önce gelir), içerik lisansı doldu (DOM-KYN-021), pencere kapandı, hak doldu, teslim değerlendirildi (yalnız geri bildirim açıldıysa) veya görev okunamıyor',
      ),
    score: z
      .object({
        earned: z.number(),
        possible: z.number(),
        percent: z.number(),
      })
      .nullable()
      .describe(
        'Açılmış puan: otomatik puanlıda gösterilen denemenin toplamı, öğretmen puanlıda geri bildirimi açılmış son sürümün rubrik toplamı (DOM-BEC-045)',
      ),
  })
  .meta({ id: 'TaskAssignmentLearnerProgress' })

const learnerShape = {
  view: z.literal('learner'),
  ...sharedShape,
  learnerIds: z
    .array(z.string())
    .describe('Görevin hedeflediği kişinin kendisi veya velinin çocukları'),
  hasListening: z
    .boolean()
    .describe(
      'Görev dinleme kaydı ya da dinleme içeriği taşıyabilir mi (DOM-BEC-005, IST-045): sabitlenen sürüm birincil becerisi dinleme olan içerik ya da dinleme kaydına bağlı quiz/alıştırma seti; tek soruda `false`. Sunucuda hesaplanır, saklanmaz; telefonda açılabilirliği belirler.',
    ),
  progress: z.array(learnerProgressSchema).describe('`learnerIds` sırasıyla her kişinin durumu'),
}

const learnerAssignmentSchema = z.object(learnerShape).meta({ id: 'TaskAssignmentLearner' })

const fileRef = z.string().describe('Dosya kimliği')
const textBody = z.string()
const questionCount = z.number().int().min(1).describe('Soru sayısı; sorular denemede gelir')
const textLike = <T extends 'text' | 'worksheet'>(type: T) =>
  z.object({ type: z.literal(type), body: textBody.nullable(), fileId: fileRef.nullable() })
const media = <T extends 'audio' | 'video'>(type: T) =>
  z.object({
    type: z.literal(type),
    fileId: fileRef,
    transcript: textBody
      .nullable()
      .describe('Dinleme görevinde atamanın `showTranscript` ayarına bağlıdır (DOM-KYN-003)'),
    captionsVtt: textBody.nullable(),
  })
const counted = <T extends 'question' | 'quiz' | 'exercise_set'>(type: T) =>
  z.object({ type: z.literal(type), questionCount })

/**
 * Tür başına kursiyer içeriği (school-core `learnerView`): her türün yalnız burada sayılan alanları
 * yanıta girer, şemada olmayan alan (ileride eklenecek öğretmen notu gibi) süzülür. Cevap anahtarı
 * hiçbir türde yoktur; yazma şablonunun değerlendirme ölçütü ve rubrik bağı çıkarılır; soru, quiz
 * ve alıştırma setinde yalnız soru sayısı vardır (süre denemeyle başlar, DOM-BEC-043).
 */
const learnerBodySchema = z
  .discriminatedUnion('type', [
    textLike('text'),
    textLike('worksheet'),
    z.object({ type: z.literal('reading_passage'), body: textBody }),
    media('audio'),
    media('video'),
    z.object({ type: z.literal('file'), fileId: fileRef }),
    z.object({ type: z.literal('link'), url: z.string(), provider: z.string().nullable() }),
    z.object({
      type: z.literal('book_reference'),
      publisher: z.string(),
      bookTitle: z.string(),
      edition: z.string().nullable(),
      isbn: z.string().nullable(),
      pages: z.string(),
      note: z.string().nullable(),
    }),
    counted('question'),
    counted('quiz'),
    counted('exercise_set'),
    z.object({
      type: z.literal('homework_template'),
      instructions: textBody,
      submissionKinds: z.array(z.enum(enumKeys(SUBMISSION_KINDS))),
    }),
  ])
  .meta({ id: 'TaskAssignmentLearnerBody' })

const learnerContentSchema = z
  .object({
    versionId: id.describe('Atamada sabitlenen içerik sürümü'),
    title: z.string(),
    body: learnerBodySchema,
    attributions: z.array(attributionSchema).describe('Kaynak gösterimi (DOM-KYN-024)'),
    licenseKind,
  })
  .meta({ id: 'TaskAssignmentLearnerContent' })

const learnerAssignmentDetailSchema = z
  .object({
    ...learnerShape,
    content: learnerContentSchema.nullable(),
    contentUnavailable: z
      .enum(['license_expired', 'unavailable'])
      .nullable()
      .describe(
        '`content` boşsa neden: lisans doldu ve süren iş yok (DOM-KYN-021) veya içerik kapalı: sürüm kaldırıldı/yayında değil, kitap sahibi değil ya da telif bildirimiyle incelemede ve süren iş (süren deneme, taslak, teslim) yok (DOM-KYN-025, Sabah kararı 47)',
      ),
  })
  .meta({ id: 'TaskAssignmentLearnerDetail' })

const taskAssignmentSchema = z
  .discriminatedUnion('view', [staffAssignmentSchema, learnerAssignmentSchema])
  .meta({ id: 'TaskAssignment' })

const taskAssignmentDetailSchema = z
  .discriminatedUnion('view', [staffAssignmentSchema, learnerAssignmentDetailSchema])
  .meta({ id: 'TaskAssignmentDetail' })

export const taskAssignmentListResponseSchema = pageResponse(taskAssignmentSchema)
export const taskAssignmentDetailResponseSchema = dataResponse(taskAssignmentDetailSchema)
export const taskAssignmentWriteResponseSchema = dataResponse(staffAssignmentSchema)

/**
 * Toplu atama gövdesi (DOM-BEC-049, IST-034): core `assignmentBatchInputSchema`. Her öğe tek
 * atamanın gövdesidir; içerik sürümü bütün öğelerde aynı, hedef öğeler arasında tekil, en çok
 * `ASSIGNMENT_BATCH_MAX` öğe.
 */
export const taskAssignmentBatchBodySchema = assignmentBatchInputSchema
export const taskAssignmentBatchResponseSchema = dataResponse(
  z.array(staffAssignmentSchema).describe('Açılan atamalar, gövdedeki öğe sırasıyla'),
)

export const contentResultsParamsSchema = z.object({
  resourceId: id.describe('İçerik kimliği'),
})

const resultTallyShape = {
  learners: z.number().int().min(0).describe('Hedefteki kursiyer sayısı'),
  completed: z
    .number()
    .int()
    .min(0)
    .describe('Tamamlanmış denemesi ya da gönderilmiş teslimi olan kursiyer'),
  scored: z.number().int().min(0).describe('Puanı olan kursiyer'),
  averagePercent: z
    .number()
    .nullable()
    .describe('Puanı olanların ortalama yüzdesi, bir ondalık; puan yoksa `null`'),
}
const resultTally = z.object(resultTallyShape).meta({ id: 'ContentResultTally' })

const contentResultsSchema = z
  .object({
    resourceId: id,
    computedAt: instant,
    assignments: z.array(
      z.object({
        assignmentId: id,
        title: z.string().describe('Atanan sürümün başlığı'),
        kind: taskKind,
        scoringMode: z.enum(['auto', 'teacher']),
        deadline: deadlineSchema,
        createdAt: instant,
        targets: z.array(
          z.object({
            kind: z.enum(enumKeys(TARGET_KINDS)),
            id: z.string(),
            name: z
              .string()
              .nullable()
              .describe('Öğrenci hedefinin adı; kişinin okuyamadığı öğrencide ve sınıfta `null`'),
            ...resultTallyShape,
          }),
        ),
        totals: resultTally,
      }),
    ),
    totals: resultTally.describe(
      'Yanıttaki atamaların atama-kursiyer çiftleri üzerinden toplamı (`truncated` iken yalnız en yeni 100 atama)',
    ),
    truncated: z.boolean().describe('En yeni 100 atamadan fazlası var'),
  })
  .meta({ id: 'ContentAssignmentResults' })

export const contentResultsResponseSchema = dataResponse(contentResultsSchema)
