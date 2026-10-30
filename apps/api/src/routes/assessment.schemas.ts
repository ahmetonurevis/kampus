import { z } from 'zod'

import { automationSchemas } from '@kampus/school-core/lib/assessment-automation.ts'
import {
  ASSESSMENT_COMMANDS,
  type AssessmentCommand,
} from '@kampus/school-core/modules/commands.ts'

import { errorResponseSchema } from '../errors.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'
import { tutorAttendanceBodySchema, tutorCancelBodySchema } from './commands.schemas.ts'

/**
 * Optik değerlendirme ve otomatik etüt köprüsü (`POST /assessment/:command`). Her komut kendi
 * rotasıdır; tablo `satisfies Record<AssessmentCommand, …>` ile core komut listesine bağlıdır:
 * core komut ekleyince burada eklenmeden tip denetimi geçmez.
 *
 * `record`: komutun `:recordId` alıp almadığı (`optional`: kimliksiz oluşturur, kimlikle günceller).
 * `idempotency: 'required'`: sonuç kaydı (`evaluate`) ve etüt oluşturan (`plan`) komutlar; ağ
 * tekrarı sonuçları ve etütleri çoğaltmaz. Rol ve kapsam core'un kuralıdır (`runAssessment`:
 * yazma yalnız yönetici ve öğretmen, DOM-YTK-021; cevap anahtarı yalnız yönetici); rota her rolü
 * kabul eder, core reddi 403'tür. Modül ve yüklenecek koleksiyonlar core komut tablosundandır.
 */
export interface AssessmentRoute {
  record: 'none' | 'required' | 'optional'
  idempotency: 'required' | 'optional'
  summary: string
}

export const ASSESSMENT_ROUTES = {
  profile: {
    record: 'optional',
    idempotency: 'optional',
    summary: 'Optik profil ve cevap anahtarı oluştur veya güncelle',
  },
  evaluate: {
    record: 'none',
    idempotency: 'required',
    summary: 'Okuyucu dosyasını değerlendir ve sonuçları kaydet',
  },
  plan: {
    record: 'none',
    idempotency: 'required',
    summary: 'Etüt planını onayla',
  },
  slot: { record: 'none', idempotency: 'optional', summary: 'Öğretmen uygunluk saati ekle' },
  'slot-remove': {
    record: 'required',
    idempotency: 'optional',
    summary: 'Öğretmen uygunluk saatini kaldır',
  },
  cancel: {
    record: 'required',
    idempotency: 'optional',
    summary: 'Etüdü gerekçeyle iptal et',
  },
  attendance: {
    record: 'required',
    idempotency: 'optional',
    summary: 'Etüt yoklaması al',
  },
} as const satisfies Record<AssessmentCommand, AssessmentRoute>

/** Dosya metni üst sınırı (bayt, UTF-8); core `fileText` ile aynıdır: 1 MB. */
export const MAX_FILE_BYTES = 1024 * 1024
/**
 * Dosya taşıyan uçların gövde üst sınırı. JSON kaçışları (`\r\n` → 4 karakter) yüzünden 1 MB'lık
 * metin 1 MiB'lik küresel sınırı aşabilir; sınır dosya alanında ölçülür (413), gövde bu tavanla.
 */
export const FILE_BODY_LIMIT = 4 * 1024 * 1024

export const assessmentRecordParamsSchema = z.object({
  recordId: z
    .string()
    .min(1)
    .max(200)
    .describe('Komutun konusu: profil, uygunluk saati veya etüt kimliği'),
})

/** Önizlemede gösterilen planın özeti; onayda `expectedPlan` olarak geri gönderilir. */
const expectedPlan = z
  .string()
  .max(MAX_FILE_BYTES)
  .optional()
  .describe(
    'Önizlemedeki `expectedPlan` metni. Güncel plan farklıysa hiçbir şey yazılmaz: 409 `tutoring_plan_stale` ve `issues` içinde fark döner',
  )
const expectedDigest = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Özet geçersiz.')
  .optional()
  .describe(
    'Önizlemedeki `digest`. Güncel sonuç farklıysa hiçbir şey yazılmaz: 409 `evaluation_stale`',
  )

export const ASSESSMENT_BODIES = {
  profile: automationSchemas.profile,
  evaluate: automationSchemas.evaluate.extend({ expectedDigest }),
  plan: automationSchemas.plan.extend({ expectedPlan }),
  slot: automationSchemas.slot,
  'slot-remove': emptyCommandBodySchema,
  cancel: tutorCancelBodySchema,
  attendance: tutorAttendanceBodySchema,
} as const satisfies Record<AssessmentCommand, z.ZodType>

/** Dosya alanları (bayt sınırı denetlenir, 413). */
export const FILE_FIELDS = {
  profile: ['keyCsv'],
  evaluate: ['text'],
} as const satisfies Partial<Record<AssessmentCommand, readonly string[]>>

export const previewEvaluateBodySchema = automationSchemas.evaluate
export const previewPlanBodySchema = automationSchemas.plan

// --- Önizleme yanıtları -----------------------------------------------------------------

const tutorGroupFields = {
  examId: z.string(),
  branchId: z.string(),
  grade: z.number().int(),
  subjectId: z.string(),
  topic: z.string().describe('Eksik kazanım'),
  studentIds: z.array(z.string()),
  scores: z.array(z.object({ studentId: z.string(), percent: z.number().nullable() })),
}

export const plannedSessionSchema = z.object({
  ...tutorGroupFields,
  teacherId: z.string(),
  date: z.string().describe('Başlangıç anı, ISO 8601 UTC'),
  duration: z.number().int().describe('Dakika'),
  room: z.string(),
  roomClassId: z.string(),
  capacity: z
    .number()
    .int()
    .describe('Grup kapasitesi: en küçük(grup üst sınırı, derslik kapasitesi)'),
})

export const planPreviewSchema = z
  .object({
    input: z
      .object({
        examId: z.string(),
        threshold: z.number().int(),
        fromDate: z.string(),
        toDate: z.string(),
        duration: z.number().int(),
        maxGroupSize: z.number().int(),
        branchId: z.string(),
        subjectId: z.string(),
      })
      .describe('Çözümlenmiş plan girdisi'),
    sessions: z.array(plannedSessionSchema).describe('Önerilen etütler'),
    unresolved: z
      .array(z.object({ ...tutorGroupFields, reason: z.string() }))
      .describe(
        'Yerleşemeyen gruplar ve nedeni: kapasite, öğretmen, derslik, uygunluk veya çakışma uyarısı',
      ),
    covered: z
      .array(z.object({ studentId: z.string(), topic: z.string(), sessionId: z.string() }))
      .describe('Zaten planlanmış veya tamamlanmış etütle karşılanan öğrenci/kazanımlar'),
    evaluatedStudents: z.number().int(),
    summary: z.object({
      sessionCount: z.number().int(),
      plannedStudentCount: z.number().int(),
      unresolvedGroupCount: z.number().int(),
      unresolvedStudentCount: z.number().int(),
      coveredCount: z.number().int(),
    }),
    expectedPlan: z
      .string()
      .describe('Planın JSON metni; onay isteğinde `expectedPlan` olarak aynen geri gönderilir'),
  })
  .meta({ id: 'TutoringPlanPreview' })

const topicScoreSchema = z.object({
  topic: z.string(),
  total: z.number().int(),
  correct: z.number().int(),
  percent: z.number().nullable(),
})

export const evaluationPreviewRowSchema = z.object({
  examId: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  subjectId: z.string(),
  booklet: z.string(),
  profileId: z.string(),
  keyRevision: z.number().int(),
  correct: z.number().int(),
  wrong: z.number().int(),
  blank: z.number().int(),
  multiple: z.number().int(),
  cancelled: z.number().int(),
  net: z.number(),
  topicScores: z.array(topicScoreSchema),
  weakTopics: z.array(z.string()),
  replaces: z.boolean().describe('Aynı sınav/öğrenci/ders sonucunun üzerine yazar'),
})

export const evaluationPreviewSchema = z
  .object({
    rows: z.array(evaluationPreviewRowSchema),
    summary: z.object({
      rowCount: z.number().int(),
      studentCount: z.number().int(),
      replacesCount: z.number().int(),
    }),
    digest: z
      .string()
      .describe(
        'Önizlemenin SHA-256 özeti (hex); onay isteğinde `expectedDigest` olarak gönderilir',
      ),
  })
  .meta({ id: 'EvaluationPreview' })

export const planPreviewResponseSchema = z.object({ data: planPreviewSchema })
export const evaluationPreviewResponseSchema = z.object({ data: evaluationPreviewSchema })

export const previewErrors = {
  ...authenticatedErrors,
  404: errorResponseSchema,
  409: errorResponseSchema,
  413: errorResponseSchema,
  422: errorResponseSchema,
} as const

export const assessmentErrors = previewErrors

/** OpenAPI açıklaması: rol kuralı core'dadır. */
export function assessmentDescription(command: AssessmentCommand): string {
  return `school-core \`runAssessment('${command}')\`. Gövde core \`automationSchemas\` şemasıdır. Modül: \`${ASSESSMENT_COMMANDS[command].module}\`; kurum türünde olmayan modül 404, kapalı modül 403 \`module_disabled\`. Yazma yalnız \`yonetici\` ve \`ogretmen\` (öğretmen kendi kapsamında; cevap anahtarı yalnız yönetici); diğer roller 403 \`permission_denied\`. Yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.`
}
