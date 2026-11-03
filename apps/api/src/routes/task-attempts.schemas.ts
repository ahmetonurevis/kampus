import { z } from 'zod'

import { answerKeySchema, questionBodySchema } from '@kampus/school-core/content/resource.ts'
import { CEFR_LEVELS, enumKeys, SUBSKILLS } from '@kampus/school-core/content/taxonomy.ts'
import { answersSchema } from '@kampus/school-core/skills/scoring.ts'

import { attributionSchema } from './resources.schemas.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Otomatik puanlı görev denemelerinin şemaları (ADR 0004 karar 5, 6; DOM-BEC-010, 042…045).
 * Cevap gövdesi core `answersSchema`'dır. Gövdeler katıdır: istemcinin gönderdiği puan, teslim
 * anı veya durum alanı 400 alır; puan sunucuda cevaplardan hesaplanır ve saklanmaz.
 */

const id = z.uuid()
const instant = z.iso.datetime()

export const taskAttemptParamsSchema = z.object({
  attemptId: id.describe('Deneme kimliği'),
})

export const taskAttemptAssignmentParamsSchema = z.object({
  assignmentId: id.describe('Atama kimliği'),
})

export const taskAttemptListQuerySchema = pageQuerySchema
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

export const taskAttemptStartBodySchema = z.strictObject({})

export const taskAttemptAnswersBodySchema = z.strictObject({
  answers: answersSchema.describe('Kaydedilecek cevaplar; yalnız gönderilen sorular güncellenir'),
})

export const taskAttemptSubmitBodySchema = z.strictObject({
  answers: answersSchema
    .optional()
    .describe('Teslimle birlikte kaydedilecek son cevaplar; süre dolduysa alınmaz'),
})

const itemScoreSchema = z
  .object({
    questionVersionId: z.string(),
    parts: z.number().int(),
    correctParts: z.number().int(),
    answered: z.boolean(),
    points: z.number(),
    earned: z.number(),
  })
  .meta({ id: 'TaskAttemptItemScore' })

const subskill = z.enum(enumKeys(SUBSKILLS))

const subskillScoreSchema = z
  .object({
    subskill,
    items: z.number().int().min(1).describe('Bu alt beceriyle etiketli madde sayısı'),
    earned: z.number().describe('Kazanılan puan (iki ondalık)'),
    possible: z.number(),
    percent: z.number().int().describe('100 üzerinden puan'),
  })
  .meta({ id: 'TaskAttemptSubskillScore' })

const resultSchema = z
  .object({
    earned: z.number().describe('Kazanılan puan (iki ondalık)'),
    possible: z.number(),
    percent: z.number().int().describe('100 üzerinden puan'),
    items: z
      .array(itemScoreSchema)
      .nullable()
      .describe('Madde sonuçları; kursiyer ve veli yalnız anahtar açılınca görür (DOM-BEC-045)'),
    subskills: z
      .array(subskillScoreSchema)
      .nullable()
      .describe(
        'Alt beceri dökümü (IST-042, DOM-BEC-006): madde puanlarından hesaplanır, saklanmaz; yalnız etiketli alt beceriler, sözlük sırasıyla. Madde sonuçlarıyla aynı anda açılır',
      ),
    answerKey: z
      .array(z.object({ questionVersionId: z.string(), answerKey: answerKeySchema }))
      .nullable()
      .describe(
        'Doğru cevaplar ve açıklamalar; yalnız anahtar açılınca (DOM-BEC-045) ve içerik kapalı değilse (DOM-KYN-025, 051; ayrıntıdaki `contentUnavailable` kuralı)',
      ),
  })
  .meta({ id: 'TaskAttemptResult' })

const attemptShape = {
  id,
  assignmentId: id,
  learnerId: z.string(),
  learnerName: z
    .string()
    .nullable()
    .describe(
      'Öğrencinin adı: yöneticide her öğrenci, öğretmende yalnız öğrenci kapsamındakiler. Kapsam dışı öğrenci, öğrenci, veli ve bulunamayan kayıtta `null` (OG-213)',
    ),
  attemptNumber: z.number().int().min(1),
  status: z
    .enum(['in_progress', 'submitted', 'expired'])
    .describe('Süren, teslim edilmiş veya süresi dolmuş (kaydedilmiş cevaplarla teslim sayılır)'),
  startedAt: instant,
  endsAt: instant.nullable().describe('Süre ve teslim kapanışından erken olanı; yoksa `null`'),
  remainingMs: z.number().int().nullable(),
  completedAt: instant.nullable(),
  autoSubmitted: z.boolean().describe('Süre dolduğu için kaydedilmiş cevaplarla teslim sayıldı'),
  late: z.boolean().describe('Son teslimden sonra, geç kabul süresinde tamamlandı'),
  counted: z.boolean().describe('Sayılan deneme (DOM-BEC-042); alıştırmada hep `false`'),
  answers: answersSchema,
  result: resultSchema
    .nullable()
    .describe(
      'Süren denemede ve kursiyer görünümünde tamamlanmadan `null`; kaldırılan içerikte cevap anahtarı silindiği için puan hesaplanamıyorsa da `null` (puan saklanmaz, DOM-BEC-010)',
    ),
  contentRemoved: z
    .boolean()
    .describe(
      'Görevin içeriği (sabitlenen sürüm, puanlama sürümü, sorularından biri, okuma parçası ya da dinleme kaydı) kaldırıldı (DOM-KYN-051): deneme kaydı ve cevaplar korunur, metin ve anahtar dönmez; arayüz "Bu içerik kaldırıldı" der. Telif askısı ve lisans bitişi kaldırma değildir (`contentUnavailable`)',
    ),
  rowVersion: z
    .number()
    .int()
    .min(1)
    .describe('Deneme satırının iyimser kilit sürümü (cevap kaydı ve teslimde `If-Match`)'),
}

const taskAttemptSchema = z.object(attemptShape).meta({ id: 'TaskAttempt' })

const taskAttemptDetailSchema = z
  .object({
    ...attemptShape,
    questions: z
      .array(
        z.object({
          questionVersionId: z.string(),
          points: z.number(),
          subskill: subskill.nullable().describe('Sorunun alt becerisi (DOM-BEC-006)'),
          question: questionBodySchema,
        }),
      )
      .describe(
        'Denemenin soruları; anahtar ve açıklama yoktur, seçenekler denemeye göre karışık. İçerik kapalıysa (`contentUnavailable`) boş',
      ),
    passage: z
      .object({
        versionId: id.describe('Okuma parçası sürümü'),
        title: z.string(),
        body: z.string(),
        wordCount: z.number().int().min(0).describe('Sistem hesaplar (DOM-KYN-002)'),
        cefrLevel: z.enum(enumKeys(CEFR_LEVELS)).nullable(),
        glossary: z
          .array(
            z.object({ term: z.string(), meaning: z.string(), example: z.string().nullable() }),
          )
          .describe('Sözlükçe, yazarın sırasıyla'),
        attributions: z.array(attributionSchema).describe('Kaynak gösterimi (DOM-KYN-024)'),
      })
      .nullable()
      .describe(
        'Okuma-anlama etkinliğinin metni (IST-042): quiz/alıştırma seti okuma parçasına bağlı değilse, parça kaldırıldıysa ya da içerik kapalıysa (`contentUnavailable`) `null`. Sorular gibi yalnız denemede döner',
      ),
    listeningRecording: z
      .object({
        versionId: id.describe('Dinleme kaydının ses sürümü'),
        title: z.string(),
        fileId: id.describe(
          'Kaydın dosyası (`listening_audio`); bağlantısı `GET /files/:fileId/url` ile açılır ve süren denemede hak sayılır',
        ),
        cefrLevel: z.enum(enumKeys(CEFR_LEVELS)).nullable(),
        transcript: z
          .string()
          .nullable()
          .describe('Döküm; `transcriptShown` `false` iken `null` (DOM-BEC-005)'),
        captionsVtt: z.string().nullable().describe('Zaman kodlu altyazı; dökümle aynı kural'),
        transcriptShown: z
          .boolean()
          .describe(
            'Döküm bu yanıtta açık mı: personelde hep; kursiyer ve velide görev kapanınca (son teslim ve geç kabul geçti) ya da alıştırmada `showTranscript` ayarıyla (DOM-BEC-005)',
          ),
        attributions: z.array(attributionSchema).describe('Kaynak gösterimi (DOM-KYN-024)'),
      })
      .nullable()
      .describe(
        'Dinleme etkinliğinin kaydı (IST-045): quiz/alıştırma seti dinleme kaydına bağlı değilse, kayıt kaldırıldıysa ya da içerik kapalıysa (`contentUnavailable`) `null`. Kalan hak `listening`tedir',
      ),
    contentUnavailable: z
      .enum(['license_expired', 'unavailable'])
      .nullable()
      .describe(
        'Soru ve parça metni gösterilmiyorsa neden (DOM-KYN-021, 025, 051): kaldırılmış içerik herkese ve her denemede; öğrenci ve velide ayrıca telif bildirimiyle incelemedeki içerik ya da lisansı dolmuş içerik (yalnız kursiyerin bu görevde süren denemesi yoksa; Sabah kararı 47) ve kitap sahibi sınırı. Kapalıyken `result.answerKey` de `null`; cevaplar, madde sonucu ve puan görünür kalır',
      ),
    listening: z
      .object({
        limit: z.number().int().min(1).max(2).describe('Atamanın dinleme hakkı (DOM-BEC-005)'),
        media: z
          .array(
            z.object({
              fileId: id.describe('Dinleme kaydı (`listening_audio`)'),
              used: z.number().int().min(0).describe('Bu denemede sayılan dinleme'),
              remaining: z.number().int().min(0).describe('Kalan dinleme hakkı'),
            }),
          )
          .describe(
            'Dinleme kaydının dosyası ve bu denemede sayılmış dinlemeler (kayıt kaldırıldıysa da), kimlik sırasıyla',
          ),
      })
      .nullable()
      .describe(
        'Dinleme hakkı (IST-045): hak deneme × kayıt başına sayılır; sınırsız, dinleme görevi değil ya da sayacak dinleme kaydı yoksa `null`. Hak bitince kaydın bağlantısı 422 `listening_plays_exhausted`, süren deneme yokken açık görevde 422 `listening_attempt_required`',
      ),
  })
  .meta({ id: 'TaskAttemptDetail' })

export const taskAttemptListResponseSchema = pageResponse(taskAttemptSchema)
export const taskAttemptDetailResponseSchema = dataResponse(taskAttemptDetailSchema)
