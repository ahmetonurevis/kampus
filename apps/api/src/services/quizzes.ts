import { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import type { BankQuestion } from '@kampus/school-core/lib/domain.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  archiveQuiz,
  canSeeQuizQuestions,
  createQuiz,
  isQuizClosed,
  isQuizStaff,
  quizAttemptView,
  quizQuestionsView,
  quizStatistics,
  startQuiz,
  submitQuiz,
  updateQuiz,
  type QuizAttemptReading,
  type QuizAttemptView,
  type QuizReading,
} from '@kampus/school-core/lib/quiz.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { CollectionName, RecordData } from '../db/collections.ts'
import {
  findRecord,
  loadRecords,
  loadRecordsByIds,
  type RecordFilter,
  type StoredRecord,
} from '../db/records.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { searchKey } from './collection-reads.ts'
import { environment } from './commands.ts'
import {
  runCommand,
  type CommandResponse,
  type ExpectedVersion,
  type IdempotencyRequest,
  type LoadScope,
  type OperationResult,
  type OperationTools,
} from './operation-runner.ts'
import { assertReadable, readScope, scopePrefilter } from './read-scope.ts'

/**
 * Quiz servisi (IST-095; docs/domain/akademik-olcme.md DOM-AKD-075…079). Quizler `quizzes`,
 * denemeler `quizAttempts` koleksiyonundadır (`records`, modül `learning`). Kural, rol ve kapsam
 * core'dadır (`lib/quiz.ts`, `requireAuthorized`); burada yalnız gereken kayıtların yüklenmesi,
 * görünüm ve tek transaction vardır.
 *
 * Okuma core kapsamıyladır (`scopeFor`): yönetici kurumun bütün quizlerini, öğretmen derse girdiği
 * sınıfların ve kendi hazırladığı quizleri, öğrenci ve veli kendi/çocuğunun sınıfının quizlerini
 * okur. Denemeleri yönetici, quizin öğretmeni (sınıftan ayrılmış olsa da) ve öğrencinin sınıf
 * rehber öğretmeni görür; aynı sınıfa başka dersle giren öğretmen görmez (`quizAttemptReader`).
 * Öğrenci yalnız kendisininkini, veli bağlı çocuğununkini görür (DOM-AKD-079). Görmediği quiz
 * olmayanla aynı 404.
 *
 * Cevap anahtarı (`answer`) ve çözüm açıklaması yalnız yönetici ve öğretmen yanıtına girer
 * (`answerKey`); öğrenci ve veli görünümü anahtarsız soruyu (`quizQuestionsView`) ve deneme
 * özetini (`quizAttemptView`) taşır, soru bazında doğru/yanlış yoktur. Öğrenci ve veli son tarih
 * geçene ya da quiz kapanana kadar yalnız puanı ve doğru sayısını görür; kendi cevapları ve konu
 * yüzdeleri sonra açılır (`quizReviewOpen`, DOM-AKD-078). Sonuç ve ortalama her okumada
 * cevaplardan hesaplanır, saklanan kopya okunmaz (`quizAttemptResult`, `quizStatistics`).
 *
 * Saklanan satırlar Zod'la okunur: core görünümünün kullandığı alanları tutmayan satır yoksayılır
 * ve yalnız sayısı loglanır (quiz için 404).
 *
 * Yazmalar kurumun bütün quiz ve denemelerini kurum kilidi altında yüklemez (`loadScope`):
 * hazırlarken quiz hiç, soru bankasından yalnız seçilen sorular; düzenlemede hedef quiz, denemeleri
 * ve yeni sorular; arşivde hedef quiz ve denemeleri; başlatma ve gönderimde hedef quiz, denemeleri
 * (sınıf mevcudu kadar) ve quizin soruları yüklenir. Cevaplar loglanmaz; denetim kaydına yalnız
 * değişen alan adları yazılır (işlem çalıştırıcı).
 */

const QUIZZES: CollectionName = 'quizzes'
const ATTEMPTS: CollectionName = 'quizAttempts'
const BANK: CollectionName = 'bank'
const NONE: LoadScope = { ids: [] }

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

// Saklanan satırların core görünümünün kullandığı alanları (kimlik satırdandır).
const quizRowSchema = z.object({
  questionIds: z.array(z.string()),
  dueDate: z.string().optional(),
}) satisfies z.ZodType<Omit<QuizReading, 'archived'>>
const attemptRowSchema = z.object({
  quizId: z.string(),
  studentId: z.string(),
  answers: z.record(z.string(), z.number()),
  score: z.number(),
  correct: z.number(),
  total: z.number(),
  topicScores: z.array(z.object({ topic: z.string(), score: z.number() })),
  date: z.string(),
  status: z.enum(['started', 'completed']).optional(),
  startedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  submittedAt: z.string().optional(),
}) satisfies z.ZodType<Omit<QuizAttemptReading, 'id'>>
// Puanlamanın ve anahtarın kullandığı soru alanları; örnek veri dışındaki soruda olmayan
// ders adı, düzey ve açıklama boş varsayılır.
const bankRowSchema = z.object({
  subjectId: z.string(),
  subject: z.string().default(''),
  minGrade: z.number().default(0),
  maxGrade: z.number().default(0),
  text: z.string(),
  options: z.array(z.string()),
  answer: z.number().int(),
  topic: z.string(),
  explanation: z.string().default(''),
}) satisfies z.ZodType<Omit<BankQuestion, 'id'>>

type QuizRow = QuizReading & { id: string; questionIds: string[] }
type AttemptRow = QuizAttemptReading

/** Satırları şemayla okur; tutmayan satır yoksayılır, yalnız sayısı loglanır. */
function parsed<T extends object>(
  ctx: ServiceContext,
  collection: CollectionName,
  rows: readonly StoredRecord[],
  schema: z.ZodType<T>,
): (T & { id: string })[] {
  const out: (T & { id: string })[] = []
  for (const row of rows) {
    const result = schema.safeParse(row.data)
    if (result.success) out.push({ ...result.data, id: row.id })
  }
  if (out.length < rows.length)
    ctx.log.warn({ event: 'quiz.row_invalid', collection, skipped: rows.length - out.length })
  return out
}
const quizOf = (ctx: ServiceContext, row: StoredRecord): QuizRow | undefined =>
  parsed(ctx, QUIZZES, [row], quizRowSchema)[0]

interface RowMeta {
  id: string
  version: number
  updatedAt: string
}

const metaOf = (row: StoredRecord): RowMeta => ({
  id: row.id,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
})

export type QuizStatus = 'open' | 'closed'

const statusAt = (dueDate: string | null, now: Date): QuizStatus =>
  dueDate !== null && isQuizClosed({ dueDate }, now.toISOString()) ? 'closed' : 'open'

/** Quizin yanıt görünümü (beyaz liste); soru kimlikleri öğrenciye anahtar taşımaz. */
function quizView(record: RecordData, meta: RowMeta, now: Date) {
  const dueDate = text(record.dueDate)
  const questionIds = texts(record.questionIds)
  return {
    id: meta.id,
    version: meta.version,
    classId: text(record.classId) ?? '',
    subjectId: text(record.subjectId) ?? '',
    subject: text(record.subject) ?? '',
    teacherId: text(record.teacherId) ?? '',
    title: text(record.title) ?? '',
    duration: typeof record.duration === 'number' ? record.duration : 0,
    dueDate,
    questionIds,
    questionCount: questionIds.length,
    status: statusAt(dueDate, now),
    createdAt: text(record.createdAt),
    updatedAt: meta.updatedAt,
  }
}

/**
 * Denemenin API görünümü (DOM-AKD-078): core `quizAttemptView`; doğru sayısı `correctCount`
 * adıyla döner, soru bazında doğru/yanlış alanı yoktur. Core görünümünde olmayan cevaplar ve konu
 * yüzdeleri (öğrenci ve velide inceleme açılmadan) yanıtta da yoktur.
 */
function attemptView(view: QuizAttemptView) {
  const { result, answers } = view
  return {
    id: view.id,
    quizId: view.quizId,
    studentId: view.studentId,
    status: view.status,
    startedAt: view.startedAt,
    expiresAt: view.expiresAt,
    submittedAt: view.submittedAt,
    ...(answers === undefined ? {} : { answers }),
    result:
      result === null
        ? null
        : {
            score: result.score,
            correctCount: result.correct,
            total: result.total,
            ...(result.topicScores === undefined
              ? {}
              : {
                  topicScores: result.topicScores.map((t) => ({ topic: t.topic, score: t.score })),
                }),
          },
  }
}

export type QuizAttemptResponse = ReturnType<typeof attemptView>

type Scope = Awaited<ReturnType<typeof readScope>>

async function readableScope(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  // Koleksiyonun modülü (`learning`) ve rol kuralı; kapalıysa 403, okuyamayan rol 403.
  assertReadable(ctx, scope, QUIZZES)
  assertReadable(ctx, scope, ATTEMPTS)
  return scope
}

/** Görünen denemeler (kapsam ön süzgeci + core `canRead`), quiz kimliğine göre. */
async function visibleAttempts(
  ctx: ServiceContext,
  scope: Scope,
  quizIds: readonly string[],
): Promise<AttemptRow[]> {
  if (quizIds.length === 0) return []
  const match: RecordFilter[] = [{ kind: 'equals', field: 'quizId', values: quizIds }]
  const prefilter = scopePrefilter(scope, ATTEMPTS)
  if (prefilter) match.push(prefilter)
  const rows = await loadRecords(ctx.db, ctx.institutionId, [ATTEMPTS], { match })
  return parsed(
    ctx,
    ATTEMPTS,
    rows.filter((row) => scope.canRead(ATTEMPTS, row.data)),
    attemptRowSchema,
  ).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

/**
 * Puanlama için soru bankası: yalnız quizlerin soruları. Sunucu içi okumadır; satırlar öğrenci ve
 * veliye dönmez (bankayı okuma kuralı yalnız yönetici ve öğretmendir, `platform/scope.ts`).
 */
async function quizBank(ctx: ServiceContext, quizzes: readonly QuizRow[]): Promise<BankQuestion[]> {
  const ids = [...new Set(quizzes.flatMap((quiz) => quiz.questionIds))]
  return parsed(
    ctx,
    BANK,
    await loadRecordsByIds(ctx.db, ctx.institutionId, BANK, ids),
    bankRowSchema,
  )
}

export interface QuizListInput {
  page: number
  pageSize: number
  classId?: string | undefined
  subjectId?: string | undefined
  /** Başlık araması; harf ve aksan duyarsız (`searchKey`). */
  q?: string | undefined
  status: QuizStatus | 'all'
}

/**
 * Quiz listesi: oluşturma anına göre yeniden eskiye, sonra kimliğe göre, sayfalı. Sınıf ve ders
 * süzgeci SQL'de, başlık araması (`q`) ve durum (`open`/`closed`, son tarih) okunabilir satırlar
 * üzerinde bellekte ana göre. Yönetici ve öğretmen
 * satırı deneme özetini (`statistics`, DOM-AKD-079), öğrenci ve veli satırı yalnız kendi/çocuğunun
 * denemesini (`attempts`) taşır; sınıf ortalaması açılmaz.
 */
export async function listQuizzes(ctx: ServiceContext, input: QuizListInput) {
  const scope = await readableScope(ctx)
  const match: RecordFilter[] = []
  if (input.classId) match.push({ kind: 'equals', field: 'classId', values: [input.classId] })
  if (input.subjectId) match.push({ kind: 'equals', field: 'subjectId', values: [input.subjectId] })
  const rows = await loadRecords(ctx.db, ctx.institutionId, [QUIZZES], { match })
  const now = ctx.now.toISOString()
  const needle = input.q === undefined ? null : searchKey(input.q.trim())
  const visible = rows
    .filter((row) => scope.canRead(QUIZZES, row.data))
    .filter((row) => needle === null || searchKey(text(row.data.title) ?? '').includes(needle))
    .filter((row) => {
      return input.status === 'all' || statusAt(text(row.data.dueDate), ctx.now) === input.status
    })
    .sort(
      (a, b) =>
        (text(b.data.createdAt) ?? '').localeCompare(text(a.data.createdAt) ?? '') ||
        a.id.localeCompare(b.id),
    )
  const start = (input.page - 1) * input.pageSize
  const page = visible.slice(start, start + input.pageSize)
  const quizzes = page.flatMap((row) => {
    const quiz = quizOf(ctx, row)
    return quiz ? [{ row, quiz }] : []
  })
  const [attempts, bank] = await Promise.all([
    visibleAttempts(
      ctx,
      scope,
      page.map((row) => row.id),
    ),
    quizBank(
      ctx,
      quizzes.map((item) => item.quiz),
    ),
  ])
  const role = ctx.actor.role
  const staff = isQuizStaff(role)
  return {
    items: quizzes.map(({ row, quiz }) => {
      const own = attempts.filter((attempt) => attempt.quizId === row.id)
      return {
        ...quizView(scope.redact(QUIZZES, row.data), metaOf(row), ctx.now),
        statistics: staff ? quizStatistics(quiz, own, bank, now) : null,
        attempts: staff
          ? []
          : own.map((a) => attemptView(quizAttemptView(a, quiz, bank, now, role))),
      }
    }),
    total: visible.length,
  }
}

/**
 * Anahtarsız sorular; bankada eksik (silinmiş) soru varsa okuma 422 değil `null`dır: eksik soruyla
 * deneme başlatılmaz (`quiz_question_unavailable`).
 */
function questionsOf(quiz: QuizRow, bank: readonly BankQuestion[]) {
  const known = new Set(bank.map((question) => question.id))
  return quiz.questionIds.every((id) => known.has(id)) ? quizQuestionsView(quiz, bank) : null
}

/** Yönetici ve öğretmen için cevap anahtarı (DOM-AKD-078): yalnız bankada bulunan sorular. */
function answerKeyOf(quiz: QuizRow, bank: readonly BankQuestion[]) {
  return quiz.questionIds.flatMap((id) => {
    const question = bank.find((q) => q.id === id)
    return question
      ? [{ questionId: id, answer: question.answer, explanation: question.explanation }]
      : []
  })
}

/** Deneme sahibi öğrencilerin adları (kapsamdaki öğrenci kaydından). */
async function studentNames(ctx: ServiceContext, scope: Scope, ids: readonly string[]) {
  const rows = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [...new Set(ids)])
  const names = new Map<string, string>()
  for (const row of rows)
    if (scope.canRead('students', row.data)) {
      const data = scope.redact('students', row.data)
      names.set(row.id, text(data.name) ?? '')
    }
  return names
}

/**
 * Tek quiz; olmayan, başka kurumun ya da görmediği quiz 404. Yönetici ve öğretmen soruları cevap
 * anahtarıyla (`answerKey`), görünen bütün denemeleri ve deneme özetini alır. Öğrenci soruları
 * denemeyi başlatınca, veli çocuğunun denemesi sonuçlanınca anahtarsız görür (`questions`, aksi
 * `null`); kendi/çocuğunun denemesi `attempts`'tedir (DOM-AKD-078, DOM-AKD-079).
 */
export async function getQuiz(ctx: ServiceContext, quizId: string) {
  const scope = await readableScope(ctx)
  const row = await findRecord(ctx.db, ctx.institutionId, QUIZZES, quizId)
  const quiz = row && scope.canRead(QUIZZES, row.data) ? quizOf(ctx, row) : undefined
  if (!row || !quiz) throw new NotFoundError()
  const now = ctx.now.toISOString()
  const role = ctx.actor.role
  const [attempts, bank] = await Promise.all([
    visibleAttempts(ctx, scope, [row.id]),
    quizBank(ctx, [quiz]),
  ])
  const views = attempts.map((attempt) =>
    attemptView(quizAttemptView(attempt, quiz, bank, now, role)),
  )
  const base = quizView(scope.redact(QUIZZES, row.data), metaOf(row), ctx.now)
  if (isQuizStaff(role)) {
    const names = await studentNames(
      ctx,
      scope,
      views.map((view) => view.studentId),
    )
    return {
      kind: 'staff' as const,
      data: {
        ...base,
        statistics: quizStatistics(quiz, attempts, bank, now),
        questions: questionsOf(quiz, bank),
        answerKey: answerKeyOf(quiz, bank),
        attempts: views.map((view) => ({
          ...view,
          studentName: names.get(view.studentId) ?? null,
        })),
      },
    }
  }
  const visibleQuestions = views.some((view) => canSeeQuizQuestions(role, view.status))
  return {
    kind: 'personal' as const,
    data: {
      ...base,
      statistics: null,
      questions: visibleQuestions ? questionsOf(quiz, bank) : null,
      attempts: views,
    },
  }
}

// --- Yazma -----------------------------------------------------------------------------------

type QuizAction = 'quiz.create' | 'quiz.update' | 'quiz.archive' | 'quiz.start' | 'quiz.submit'

/** Core işleminin sonucu: yanıtta dönecek kayıt. */
type Outcome =
  | { kind: 'quiz'; record: RecordData & { id: string }; statusCode: 200 | 201 }
  | {
      kind: 'attempt'
      record: RecordData & { id: string }
      /** Yanıt gövdesi işlem anında, bankadaki anahtarla hesaplanır (anahtarsız). */
      view: QuizAttemptResponse
      questions?: ReturnType<typeof quizQuestionsView>
      statusCode: 200 | 201
    }

interface QuizRun {
  action: QuizAction
  loadScope: Partial<Record<CollectionName, LoadScope>>
  expected: ExpectedVersion | null
  entity: (outcome: Outcome) => { type: string; id: string }
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType },
  ) => Outcome
}

/** Core kaydını saklanan biçimle aynı yapar (jsonb: `undefined` alan düşer). */
function stored<T extends { id: string }>(record: T): RecordData & { id: string } {
  const copy: RecordData = JSON.parse(JSON.stringify(record))
  return { ...copy, id: record.id }
}

function respond(ctx: ServiceContext, outcome: OperationResult<Outcome>, fallback: number) {
  const { result } = outcome
  if (result.kind === 'attempt')
    return {
      statusCode: result.statusCode,
      body: {
        data:
          result.questions === undefined
            ? result.view
            : { attempt: result.view, questions: result.questions },
      },
    }
  const written = outcome.changes.find(
    (change) => change.collection === QUIZZES && change.id === result.record.id,
  )
  const meta: RowMeta = {
    id: result.record.id,
    version: written?.version ?? fallback,
    updatedAt: ctx.now.toISOString(),
  }
  return {
    statusCode: result.statusCode,
    body: { data: quizView(result.record, meta, ctx.now) },
  }
}

/**
 * Quiz işlemini tek transaction'da çalıştırır (`runCommand`: kurum kilidi, fark, sürüm koşullu
 * yazma, denetim kaydı, `Idempotency-Key`). Sıra: olmayan hedef 404 → core yetki ve kapsam
 * (403/404) → sürüm 409 `version_conflict` → core kuralı (422, 409).
 */
function execute(
  ctx: ServiceContext,
  command: QuizRun,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS[command.action]
  return runCommand<Outcome>(
    ctx,
    {
      action: command.action,
      collections: spec.collections,
      loadScope: command.loadScope,
      ...(command.expected === null ? {} : { expectedVersions: [command.expected] }),
      entity: command.entity,
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType }),
        }
      },
    },
    (outcome) => respond(ctx, outcome, command.expected?.version ?? 1),
    idempotency,
  )
}

const quizEntity = (outcome: Outcome) => ({
  type: QUIZZES,
  id: outcome.kind === 'quiz' ? outcome.record.id : (text(outcome.record.quizId) ?? ''),
})

/** Gövdedeki soru kimlikleri (yalnız yükleme kapsamı için; doğrulama core şemasındadır). */
function bodyQuestionIds(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  return texts((input as { questionIds?: unknown }).questionIds).slice(0, 50)
}

const attemptsOfQuiz = (quizId: string): LoadScope => ({
  match: [{ kind: 'equals', field: 'quizId', values: [quizId] }],
})

export interface QuizTarget {
  quizId: string
  /** `If-Match`: quizin okunan sürümü. */
  expectedVersion: number
}

/** Yeni quiz (core `createQuiz`, DOM-AKD-075). 201. */
export function createQuizCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'quiz.create',
      loadScope: { quizzes: NONE, bank: { ids: bodyQuestionIds(input) } },
      expected: null,
      entity: quizEntity,
      run: (state, by, { now, makeId }, { institutionType }) => ({
        kind: 'quiz',
        record: stored(createQuiz(state, by, input, makeId, now, { institutionType })),
        statusCode: 201,
      }),
    },
    idempotency,
  )
}

/** Quizi kısmi düzenler (core `updateQuiz`, DOM-AKD-076); sınıf ve ders değişmez. */
export function updateQuizCommand(
  ctx: ServiceContext,
  target: QuizTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'quiz.update',
      loadScope: {
        quizzes: { ids: [target.quizId] },
        // Soru değişikliği yalnız denemesiz quizde serbesttir (`quiz_has_attempts`).
        quizAttempts: attemptsOfQuiz(target.quizId),
        bank: { ids: bodyQuestionIds(input) },
      },
      expected: { collection: QUIZZES, id: target.quizId, version: target.expectedVersion },
      entity: quizEntity,
      run: (state, by, { now }, { institutionType }) => ({
        kind: 'quiz',
        record: stored(updateQuiz(state, by, target.quizId, input, now, { institutionType })),
        statusCode: 200,
      }),
    },
    idempotency,
  )
}

/** Denemesiz quizi arşivler (core `archiveQuiz`, DOM-AKD-076); kayıt silinmez. */
export function archiveQuizCommand(
  ctx: ServiceContext,
  target: QuizTarget,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'quiz.archive',
      loadScope: {
        quizzes: { ids: [target.quizId] },
        quizAttempts: attemptsOfQuiz(target.quizId),
      },
      expected: { collection: QUIZZES, id: target.quizId, version: target.expectedVersion },
      entity: quizEntity,
      run: (state, by, _tools, { institutionType }) => ({
        kind: 'quiz',
        record: stored(archiveQuiz(state, by, target.quizId, { institutionType })),
        statusCode: 200,
      }),
    },
    idempotency,
  )
}

/**
 * Başlatma ve gönderimde yüklenecek sorular: quizin kurum kilidinden önce okunan soru kimlikleri.
 * Arada sorular değişirse eksik soru 422 `quiz_question_unavailable` verir (yanlış puan yazılmaz);
 * denemesi olan quizin soruları zaten değişmez (DOM-AKD-076).
 */
async function quizQuestionIds(ctx: ServiceContext, quizId: string): Promise<string[]> {
  const row = await findRecord(ctx.db, ctx.institutionId, QUIZZES, quizId)
  return row ? texts(row.data.questionIds) : []
}

const attemptOutcome = (
  state: State,
  by: Participant,
  quizId: string,
  attempt: QuizAttemptReading,
  now: string,
): QuizAttemptResponse => {
  const quiz = state.quizzes.find((q) => q.id === quizId)
  if (!quiz) throw new DomainError('quiz_not_found', 'Quiz bulunamadı.', { kind: 'not_found' })
  return attemptView(quizAttemptView(attempt, quiz, state.bank, now, by.role))
}

/**
 * Öğrenci denemeyi başlatır (core `startQuiz`, DOM-AKD-077): yeni deneme 201, süresi işleyen
 * deneme 200 (aynı deneme ve bitiş anı). Yanıt anahtarsız soruları taşır (DOM-AKD-078).
 */
export async function startQuizCommand(
  ctx: ServiceContext,
  quizId: string,
  idempotency: IdempotencyRequest | null,
) {
  const questionIds = await quizQuestionIds(ctx, quizId)
  return execute(
    ctx,
    {
      action: 'quiz.start',
      loadScope: {
        quizzes: { ids: [quizId] },
        quizAttempts: attemptsOfQuiz(quizId),
        bank: { ids: questionIds },
      },
      expected: null,
      entity: quizEntity,
      run: (state, by, { now, makeId }, { institutionType }) => {
        const outcome = startQuiz(state, by, quizId, makeId, now, { institutionType })
        return {
          kind: 'attempt',
          record: stored(outcome.attempt),
          view: attemptOutcome(state, by, quizId, outcome.attempt, now),
          questions: outcome.questions,
          statusCode: outcome.created ? 201 : 200,
        }
      },
    },
    idempotency,
  )
}

/**
 * Öğrenci cevaplarını gönderir (core `submitQuiz`, DOM-AKD-077, -078). Puan yalnız cevaplardan
 * sunucuda hesaplanır; gövdede puan alanı 400'dür. 200 ve sonuç; ikinci gönderim 409
 * `quiz_already_submitted`, süre geçtiyse 422 `quiz_time_expired`.
 */
export async function submitQuizCommand(
  ctx: ServiceContext,
  quizId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  const questionIds = await quizQuestionIds(ctx, quizId)
  return execute(
    ctx,
    {
      action: 'quiz.submit',
      loadScope: {
        quizzes: { ids: [quizId] },
        quizAttempts: attemptsOfQuiz(quizId),
        bank: { ids: questionIds },
      },
      expected: null,
      entity: quizEntity,
      run: (state, by, { now }, { institutionType }) => {
        const attempt = submitQuiz(state, by, quizId, input, now, { institutionType })
        return {
          kind: 'attempt',
          record: stored(attempt),
          view: attemptOutcome(state, by, quizId, attempt, now),
          statusCode: 200,
        }
      },
    },
    idempotency,
  )
}
