import { createHash } from 'node:crypto'

import { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import {
  planTutoring,
  previewOptical,
  runAssessment,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  ASSESSMENT_COMMANDS,
  type AssessmentCommand,
} from '@kampus/school-core/modules/commands.ts'

import type { CollectionName } from '../db/collections.ts'
import { AppError, RuleViolationError, type Issue } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  auditedEntity,
  auditEntity,
  environment,
  execute,
  type CommandOptions,
} from './commands.ts'
import { runOperation } from './operation-runner.ts'
import type { CommandResponse } from './operation-runner.ts'

/**
 * Optik değerlendirme ve otomatik etüt köprüsünün servisi (`POST /assessment/:command`): core
 * `runAssessment` işlem çalıştırıcıyla tek transaction'da yürütülür; rol, modül, kapsam ve
 * kurallar core'dadır (DOM-YTK-021, DOM-YTK-040). Önizleme (`previewPlan`, `previewEvaluation`)
 * saf işlemdir: aynı core hesabını çalıştırır ve hiçbir şey yazmaz.
 */

/** `If-Match` sürümünün karşılaştırılacağı koleksiyon (kayıtlı komutlarda). */
const RECORD_COLLECTION = {
  profile: 'opticalProfiles',
  'slot-remove': 'availability',
  cancel: 'tutorSessions',
  attendance: 'tutorSessions',
} as const satisfies Partial<Record<AssessmentCommand, CollectionName>>

function hasRecordCollection(
  command: AssessmentCommand,
): command is keyof typeof RECORD_COLLECTION {
  return Object.hasOwn(RECORD_COLLECTION, command)
}

/** Dosya içeriğinden doğan core hataları: satır numarası `issues` yoluna taşınır. */
const FILE_ERROR_CODE =
  /^(csv_|answer_key_(?!admin_only)|optical_(student_(unmatched|out_of_scope|duplicate)|level_mismatch|booklet_unknown|answer_count_mismatch|answer_invalid|row_too_short|row_count_invalid))/
const LINE_IN_MESSAGE = /(\d+)\. satır/
const MAX_ISSUES = 50

/** Dosya hatasını 422 ve `issues` (yol: `[alan, 'line', satır]`) olarak çevirir; ötekiler olduğu gibi. */
function withFileIssues(error: unknown, field: 'text' | 'keyCsv'): unknown {
  if (!(error instanceof DomainError) || error.kind !== 'rule' || !FILE_ERROR_CODE.test(error.code))
    return error
  const line = LINE_IN_MESSAGE.exec(error.message)?.[1]
  const issue: Issue = {
    path: line === undefined ? [field] : [field, 'line', Number(line)],
    code: error.code,
    message: error.message,
  }
  return new RuleViolationError(error.code, error.message, { issues: [issue], cause: error })
}

function omit(input: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)))
}

function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const comparablePlan = z.object({
  sessions: z.array(
    z.object({
      teacherId: z.string(),
      date: z.string(),
      roomClassId: z.string(),
      subjectId: z.string(),
      topic: z.string(),
      studentIds: z.array(z.string()),
    }),
  ),
  unresolved: z.array(z.unknown()),
})

const sessionKey = (item: z.infer<typeof comparablePlan>['sessions'][number]) =>
  JSON.stringify([item.teacherId, item.date, item.roomClassId, item.subjectId, item.topic])

/**
 * Önizlemedeki plan ile güncel plan arasındaki fark (409 `issues`): yeni, kalkan ve öğrenci
 * listesi değişen etütler. Yol `current` (güncel) veya `expected` (önizleme) ve etüt sırasıdır;
 * mesajlar kişisel veri taşımaz (yalnız kazanım adı).
 */
export function planDifference(current: unknown, expectedText: string): Issue[] {
  let expected: unknown
  try {
    expected = JSON.parse(expectedText)
  } catch {
    return [
      {
        path: ['expectedPlan'],
        code: 'plan_expected_invalid',
        message: 'Önizleme planı okunamadı.',
      },
    ]
  }
  const before = comparablePlan.safeParse(expected)
  const after = comparablePlan.safeParse(current)
  if (!before.success || !after.success)
    return [
      {
        path: ['expectedPlan'],
        code: 'plan_expected_invalid',
        message: 'Önizleme planı okunamadı.',
      },
    ]
  const issues: Issue[] = []
  const oldByKey = new Map(before.data.sessions.map((item, index) => [sessionKey(item), index]))
  const newByKey = new Map(after.data.sessions.map((item, index) => [sessionKey(item), index]))
  after.data.sessions.forEach((item, index) => {
    const previous = oldByKey.get(sessionKey(item))
    if (previous === undefined)
      issues.push({
        path: ['current', 'sessions', index],
        code: 'plan_session_added',
        message: `Planda yeni etüt var: ${item.topic}.`,
      })
    else if (
      JSON.stringify([...(before.data.sessions[previous]?.studentIds ?? [])].sort()) !==
      JSON.stringify([...item.studentIds].sort())
    )
      issues.push({
        path: ['current', 'sessions', index],
        code: 'plan_session_students_changed',
        message: `Etütteki öğrenci listesi değişti: ${item.topic}.`,
      })
  })
  before.data.sessions.forEach((item, index) => {
    if (!newByKey.has(sessionKey(item)))
      issues.push({
        path: ['expected', 'sessions', index],
        code: 'plan_session_removed',
        message: `Önizlemedeki etüt artık planda yok: ${item.topic}.`,
      })
  })
  if (before.data.unresolved.length !== after.data.unresolved.length)
    issues.push({
      path: ['unresolved'],
      code: 'plan_unresolved_changed',
      message: 'Yerleşemeyen grup sayısı değişti.',
    })
  if (issues.length === 0)
    issues.push({
      path: ['expectedPlan'],
      code: 'plan_details_changed',
      message: 'Plan ayrıntıları değişti.',
    })
  return issues.slice(0, MAX_ISSUES)
}

export interface AssessmentInput {
  command: AssessmentCommand
  /** Ham gövde: core şemayı kendisi uygular (dönüşümler iki kez uygulanmasın). */
  input: unknown
  recordId: string | undefined
}

function inputObject(input: unknown): Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : {}
}

function fileField(command: AssessmentCommand): 'text' | 'keyCsv' | null {
  return command === 'evaluate' ? 'text' : command === 'profile' ? 'keyCsv' : null
}

/**
 * Komutu çalıştırır. `plan` ve `evaluate` sonuç kaydı/etüt oluşturduğu için çağıran
 * `Idempotency-Key` ister (rota). `plan` güncel planı yeniden hesaplar; `expectedPlan` verilmiş
 * ve fark varsa hiçbir şey yazılmaz, 409 `tutoring_plan_stale` farkı `issues`'ta döner.
 * `evaluate` `expectedDigest` ile önizlemeye bağlanabilir (409 `evaluation_stale`).
 */
export async function executeAssessmentCommand(
  ctx: ServiceContext,
  assessment: AssessmentInput,
  options: CommandOptions,
): Promise<CommandResponse> {
  const { command, recordId } = assessment
  const spec = ASSESSMENT_COMMANDS[command]
  const raw = inputObject(assessment.input)
  const field = fileField(command)
  return execute(
    ctx,
    {
      action: `assessment.${command}`,
      collections: spec.collections,
      ...(recordId !== undefined && options.expectedVersion !== null && hasRecordCollection(command)
        ? {
            expectedVersions: [
              {
                collection: RECORD_COLLECTION[command],
                id: recordId,
                version: options.expectedVersion,
              },
            ],
          }
        : {}),
      entity: auditEntity(recordId ?? command),
      load: async (tx) => {
        const { session, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state, { now, makeId }) => {
            try {
              const expectedDigest = raw.expectedDigest
              const input = omit(raw, ['expectedDigest', 'expectedPreview'])
              if (command === 'evaluate' && typeof expectedDigest === 'string')
                assertEvaluationCurrent(state, session, input, expectedDigest)
              try {
                runAssessment(state, session, command, input, makeId, recordId ?? '', now)
              } catch (error) {
                if (command === 'plan' && isStalePlan(error))
                  throw stalePlan(
                    error,
                    planDifference(
                      planTutoring(state, session, input, now),
                      String(input.expectedPlan),
                    ),
                  )
                throw error
              }
            } catch (error) {
              throw field === null ? error : withFileIssues(error, field)
            }
            return auditedEntity(state, command)
          },
        }
      },
    },
    options,
  )
}

function isStalePlan(error: unknown): error is DomainError {
  return error instanceof DomainError && error.code === 'tutoring_plan_stale'
}

function stalePlan(error: DomainError, issues: Issue[]): AppError {
  return new AppError(409, error.code, error.message, { issues, cause: error })
}

function assertEvaluationCurrent(
  state: State,
  session: Session,
  input: Readonly<Record<string, unknown>>,
  expectedDigest: string,
) {
  if (digestOf(previewOptical(state, session, input)) !== expectedDigest)
    throw new AppError(
      409,
      'evaluation_stale',
      'Değerlendirme değişmiş. Sonuçları yeniden önizleyin.',
      {
        issues: [
          {
            path: ['expectedDigest'],
            code: 'evaluation_changed',
            message: 'Sonuçlar önizlemeden sonra değişti.',
          },
        ],
      },
    )
}

/** Önizleme transaction'ı sonuçla birlikte geri alınır; yazma hiçbir koşulda kalıcı olmaz. */
class PreviewRollback extends Error {
  constructor() {
    super('preview rollback')
    this.name = 'PreviewRollback'
  }
}

/**
 * Saf önizleme: çalıştırıcının yükleme ve kapsam hattı aynıdır, sonuç `after` kancasında
 * transaction'ı geri alarak çıkarılır. Core işlemi State'i bozsa bile (olmaması gerekir) hiçbir
 * satır, denetim kaydı veya sürüm kalıcı olmaz.
 */
async function preview<T>(
  ctx: ServiceContext,
  command: 'plan' | 'evaluate',
  compute: (state: State, session: Session, now: string) => T,
): Promise<T> {
  const spec = ASSESSMENT_COMMANDS[command]
  let outcome: { value: T } | undefined
  try {
    await runOperation<T>(ctx, {
      action: `assessment.${command}.preview`,
      collections: spec.collections,
      entity: { type: 'workflow', id: command },
      load: async (tx) => {
        const { session, scalars } = await environment(tx, ctx, spec)
        return { scalars, run: (state, { now }) => compute(state, session, now) }
      },
      after: (_tx, result) => {
        outcome = { value: result }
        return Promise.reject(new PreviewRollback())
      },
    })
  } catch (error) {
    if (error instanceof PreviewRollback && outcome !== undefined) return outcome.value
    throw error
  }
  throw new AppError(500, 'internal_error', 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', {
    cause: new Error('preview did not complete'),
  })
}

/** Etüt planı önizlemesi: core `planTutoring`; yerleşemeyen gruplar nedenleriyle döner. */
export async function previewPlan(ctx: ServiceContext, input: unknown) {
  const body = omit(inputObject(input), ['expectedPlan'])
  return preview(ctx, 'plan', (state, session, now) => {
    const plan = planTutoring(state, session, body, now)
    return {
      ...plan,
      summary: {
        sessionCount: plan.sessions.length,
        plannedStudentCount: plan.sessions.reduce((sum, item) => sum + item.studentIds.length, 0),
        unresolvedGroupCount: plan.unresolved.length,
        unresolvedStudentCount: plan.unresolved.reduce(
          (sum, item) => sum + item.studentIds.length,
          0,
        ),
        coveredCount: plan.covered.length,
      },
      expectedPlan: JSON.stringify(plan),
    }
  })
}

/**
 * Optik değerlendirme önizlemesi: core `previewOptical`. Soru bazında ayrıntı (`questionResults`)
 * yanıta girmez; özet ve kazanım başarıları döner. Dosya hatası satır numarasıyla 422'dir.
 */
export async function previewEvaluation(ctx: ServiceContext, input: unknown) {
  const body = omit(inputObject(input), ['expectedDigest', 'expectedPreview'])
  return preview(ctx, 'evaluate', (state, session) => {
    try {
      const rows = previewOptical(state, session, body)
      return {
        rows: rows.map((row) => ({
          examId: row.examId,
          studentId: row.studentId,
          studentName: row.studentName,
          subjectId: row.subjectId,
          booklet: row.booklet,
          profileId: row.profileId,
          keyRevision: row.keyRevision,
          correct: row.correct,
          wrong: row.wrong,
          blank: row.blank,
          multiple: row.multiple,
          cancelled: row.cancelled,
          net: row.net,
          topicScores: row.topicScores,
          weakTopics: row.weakTopics,
          replaces: row.replaces,
        })),
        summary: {
          rowCount: rows.length,
          studentCount: new Set(rows.map((row) => row.studentId)).size,
          replacesCount: rows.filter((row) => row.replaces).length,
        },
        digest: digestOf(rows),
      }
    } catch (error) {
      // Çalıştırıcı hatayı çevirmeden önce: dosya hatası satır numarasıyla `issues`'a girer.
      throw withFileIssues(error, 'text')
    }
  })
}
