import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  archiveHomework,
  assignHomework,
  gradeSubmission,
  isHomeworkClosed,
  isLateSubmission,
  submitHomework,
  submitHomeworkSchema,
  updateHomework,
} from '@kampus/school-core/lib/homework.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName, RecordData } from '../db/collections.ts'
import { findFile } from '../db/files.ts'
import { findRecord, loadRecords, type RecordFilter, type StoredRecord } from '../db/records.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { searchKey } from './collection-reads.ts'
import { environment } from './commands.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile } from './files.ts'
import { dayRange } from './list-filters.ts'
import { notify } from './notify.ts'
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
 * Ödev ve teslim servisi (IST-095; docs/domain/akademik-olcme.md DOM-AKD-070…074). Ödevler
 * `homework`, teslimler `submissions` koleksiyonundadır (`records`, modül `learning`). Kural, rol
 * ve kapsam core'dadır (`lib/homework.ts`, `requireAuthorized`); burada yalnız gereken kayıtların
 * yüklenmesi, dosya bağlama, bildirim ve tek transaction vardır.
 *
 * Okuma core kapsamıyladır (`scopeFor`): yönetici kurumun bütün ödevlerini, öğretmen derse girdiği
 * sınıfların ve kendi verdiği ödevleri, öğrenci ve veli kendi/çocuğunun sınıfının ödevlerini okur.
 * Teslimleri öğrenci yalnız kendisininkini, veli bağlı çocuğununkini, öğretmen yalnız kendi verdiği
 * ödevin ve rehberi olduğu sınıfın öğrencilerinin teslimlerini görür (core `submissionReader`,
 * DOM-AKD-074); aynı sınıfa başka dersle giren öğretmen satırda teslim sayısı görmez. Görmediği
 * ödev ya da teslim olmayanla aynı 404'tür.
 *
 * Yazmalar kurumun bütün ödev ve teslimlerini kurum kilidi altında yüklemez (`loadScope`): ödev
 * verirken hiçbirini, düzenlemede hedef ödevi, arşivde ve teslimde hedef ödevin teslimlerini
 * (sınıf mevcudu kadar), puanlamada hedef teslimi yükler. Teslim metni ve geri bildirim loglanmaz;
 * denetim kaydına yalnız değişen alan adları yazılır (işlem çalıştırıcı).
 */

const HOMEWORK: CollectionName = 'homework'
const SUBMISSIONS: CollectionName = 'submissions'
/** Teslime bağlanan dosyaların kayıt türü (ADR 0003 karar 5). */
export const SUBMISSION_ATTACHMENT = 'homework_submission'
const NONE: LoadScope = { ids: [] }

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const score = (value: unknown): number | null => (typeof value === 'number' ? value : null)

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

export type HomeworkStatus = 'open' | 'closed'
/** Liste sıralaması; eksi azalan (route şemasındaki `HOMEWORK_SORTS` ile aynı küme). */
export type HomeworkSort = 'dueDate' | '-dueDate' | 'title' | '-title' | 'createdAt' | '-createdAt'

const statusAt = (dueDate: string, now: Date): HomeworkStatus =>
  isHomeworkClosed({ dueDate }, now.toISOString()) ? 'closed' : 'open'

/** Ödevin yanıt görünümü (beyaz liste). */
function homeworkView(record: RecordData, meta: RowMeta, now: Date) {
  const dueDate = text(record.dueDate) ?? ''
  return {
    id: meta.id,
    version: meta.version,
    classId: text(record.classId) ?? '',
    subjectId: text(record.subjectId) ?? '',
    subject: text(record.subject) ?? '',
    teacherId: text(record.teacherId) ?? '',
    title: text(record.title) ?? '',
    description: text(record.description) ?? '',
    dueDate,
    // Alanı olmayan eski kayıt geç teslimi kabul eder (core `acceptsLate`).
    allowLate: record.allowLate !== false,
    status: statusAt(dueDate, now),
    createdAt: text(record.createdAt),
    updatedAt: meta.updatedAt,
  }
}

/** Teslimin yanıt görünümü; geç teslim kayıttaki karardır, eski kayıtta son tarihten türer. */
function submissionView(record: RecordData, meta: RowMeta, dueDate: string) {
  const submittedAt = text(record.submittedAt) ?? ''
  const late = typeof record.late === 'boolean' ? record.late : undefined
  return {
    id: meta.id,
    version: meta.version,
    homeworkId: text(record.homeworkId) ?? '',
    studentId: text(record.studentId) ?? '',
    note: text(record.note) ?? '',
    fileIds: texts(record.fileIds),
    fileName: text(record.fileName) ?? '',
    submittedAt,
    late: isLateSubmission({ submittedAt, ...(late === undefined ? {} : { late }) }, { dueDate }),
    score: score(record.score),
    feedback: text(record.feedback) ?? '',
    gradedAt: text(record.gradedAt),
    updatedAt: meta.updatedAt,
  }
}

async function readableScope(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  // Koleksiyonun modülü (`learning`) ve rol kuralı; kapalıysa 403, okuyamayan rol 403.
  assertReadable(ctx, scope, HOMEWORK)
  assertReadable(ctx, scope, SUBMISSIONS)
  return scope
}

type Scope = Awaited<ReturnType<typeof readScope>>

/** Görünen teslimler (kapsam ön süzgeci + core `canRead`), ödev kimliğine göre. */
async function visibleSubmissions(
  ctx: ServiceContext,
  scope: Scope,
  homeworkIds: readonly string[],
): Promise<StoredRecord[]> {
  if (homeworkIds.length === 0) return []
  const match: RecordFilter[] = [{ kind: 'equals', field: 'homeworkId', values: homeworkIds }]
  const prefilter = scopePrefilter(scope, SUBMISSIONS)
  if (prefilter) match.push(prefilter)
  const rows = await loadRecords(ctx.db, ctx.institutionId, [SUBMISSIONS], { match })
  return rows.filter((row) => scope.canRead(SUBMISSIONS, row.data))
}

function counts(submissions: readonly StoredRecord[], dueDate: string) {
  let graded = 0
  let late = 0
  for (const row of submissions) {
    if (score(row.data.score) !== null) graded += 1
    const lateFlag = typeof row.data.late === 'boolean' ? row.data.late : undefined
    if (
      isLateSubmission(
        {
          submittedAt: text(row.data.submittedAt) ?? '',
          ...(lateFlag === undefined ? {} : { late: lateFlag }),
        },
        { dueDate },
      )
    )
      late += 1
  }
  return { submitted: submissions.length, graded, late }
}

export interface HomeworkListInput {
  page: number
  pageSize: number
  classId?: string | undefined
  subjectId?: string | undefined
  /** Başlık araması; harf ve aksan duyarsız (`searchKey`). */
  q?: string | undefined
  sort: HomeworkSort
  status: HomeworkStatus | 'all'
  dateFrom?: string | undefined
  dateTo?: string | undefined
}

/** Sıralama anahtarı: son teslim ve oluşturma anı metin (ISO), başlık Türkçe sırayla. */
function compareHomework(sort: HomeworkSort, a: StoredRecord, b: StoredRecord): number {
  const field = sort.replace(/^-/, '') as 'dueDate' | 'title' | 'createdAt'
  const left = text(a.data[field]) ?? ''
  const right = text(b.data[field]) ?? ''
  const order = field === 'title' ? left.localeCompare(right, 'tr') : left.localeCompare(right)
  return (sort.startsWith('-') ? -order : order) || a.id.localeCompare(b.id)
}

/**
 * Ödev listesi: `sort` sırasıyla (varsayılan son teslim anına göre yeniden eskiye), eşitlikte
 * kimliğe göre, sayfalı; süzgeç ve sıralama sayfalamadan önce uygulanır. Süzgeçler SQL'de (sınıf,
 * ders, son teslim günü aralığı); başlık araması (`q`) ve durum (`open`/`closed`) okunabilir
 * satırlar üzerinde bellekte (kayıtlar JSON; parametreli, ham SQL yok).
 * Her satır görünen teslimlerin sayılarını taşır (öğrenci ve velide yalnız kendi teslimi).
 */
export async function listHomework(ctx: ServiceContext, input: HomeworkListInput) {
  const scope = await readableScope(ctx)
  const match: RecordFilter[] = []
  if (input.classId) match.push({ kind: 'equals', field: 'classId', values: [input.classId] })
  if (input.subjectId) match.push({ kind: 'equals', field: 'subjectId', values: [input.subjectId] })
  const range = dayRange('dueDate', input.dateFrom, input.dateTo)
  if (range) match.push(range)
  // Kapsam ön süzgeci: öğretmen, öğrenci ve velide yalnız kapsamdaki sınıfların ve öğretmenin
  // kendi ödevleri yüklenir; karar yine core `canRead`'dedir.
  const prefilter = scopePrefilter(scope, HOMEWORK)
  if (prefilter) match.push(prefilter)
  const rows = await loadRecords(ctx.db, ctx.institutionId, [HOMEWORK], { match })
  const now = ctx.now.toISOString()
  const needle = input.q === undefined ? null : searchKey(input.q.trim())
  const visible = rows
    .filter((row) => scope.canRead(HOMEWORK, row.data))
    .filter((row) => needle === null || searchKey(text(row.data.title) ?? '').includes(needle))
    .filter((row) => {
      if (input.status === 'all') return true
      const closed = isHomeworkClosed({ dueDate: text(row.data.dueDate) ?? '' }, now)
      return input.status === 'closed' ? closed : !closed
    })
    .sort((a, b) => compareHomework(input.sort, a, b))
  const start = (input.page - 1) * input.pageSize
  const page = visible.slice(start, start + input.pageSize)
  const submissions = await visibleSubmissions(
    ctx,
    scope,
    page.map((row) => row.id),
  )
  return {
    items: page.map((row) => {
      const view = homeworkView(scope.redact(HOMEWORK, row.data), metaOf(row), ctx.now)
      const own = submissions.filter((sub) => sub.data.homeworkId === row.id)
      return { ...view, submissionCounts: counts(own, view.dueDate) }
    }),
    total: visible.length,
  }
}

/** Tek ödev ve görünen teslimleri; olmayan, başka kurumun ya da görmediği ödev 404. */
export async function getHomework(ctx: ServiceContext, homeworkId: string) {
  const scope = await readableScope(ctx)
  const row = await findRecord(ctx.db, ctx.institutionId, HOMEWORK, homeworkId)
  if (!row || !scope.canRead(HOMEWORK, row.data)) throw new NotFoundError()
  const view = homeworkView(scope.redact(HOMEWORK, row.data), metaOf(row), ctx.now)
  const submissions = (await visibleSubmissions(ctx, scope, [row.id])).sort(
    (a, b) =>
      (text(a.data.submittedAt) ?? '').localeCompare(text(b.data.submittedAt) ?? '') ||
      a.id.localeCompare(b.id),
  )
  return {
    ...view,
    submissionCounts: counts(submissions, view.dueDate),
    submissions: submissions.map((sub) =>
      submissionView(scope.redact(SUBMISSIONS, sub.data), metaOf(sub), view.dueDate),
    ),
  }
}

// --- Yazma -----------------------------------------------------------------------------------

type HomeworkAction =
  'homework.assign' | 'homework.update' | 'homework.archive' | 'homework.submit' | 'homework.grade'

/** Core işleminin sonucu: yanıtta dönecek kayıt ve (teslimde) bağlanacak dosyalar. */
interface Outcome {
  collection: CollectionName
  record: RecordData & { id: string }
  /** Teslimin ödevinin son teslim anı (teslim görünümü için). */
  dueDate: string
  statusCode: 200 | 201
  attach?: readonly string[]
  /** Yeniden teslimde kayıttan düşen, bağı kaldırılacak dosyalar. */
  detach?: readonly string[]
}

interface HomeworkRun {
  action: HomeworkAction
  loadScope: Partial<Record<CollectionName, LoadScope>>
  expected: ExpectedVersion | null
  entity: (outcome: Outcome) => { type: string; id: string }
  /** Kurum kilidinden sonra, core işleminden önce okunan ek veri (dosya adları). */
  prepare?: (tx: Database) => Promise<{ fileNames?: ReadonlyMap<string, string> }>
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType; fileNames?: ReadonlyMap<string, string> },
  ) => Outcome
  after?: (tx: Database, outcome: Outcome) => Promise<void>
}

/** Core kaydını saklanan biçimle aynı yapar (jsonb: `undefined` alan düşer). */
function stored<T extends { id: string }>(record: T): RecordData & { id: string } {
  const copy: RecordData = JSON.parse(JSON.stringify(record))
  return { ...copy, id: record.id }
}

function respond(ctx: ServiceContext, outcome: OperationResult<Outcome>, fallback: number) {
  const { result } = outcome
  const written = outcome.changes.find(
    (change) => change.collection === result.collection && change.id === result.record.id,
  )
  const meta: RowMeta = {
    id: result.record.id,
    version: written?.version ?? fallback,
    updatedAt: ctx.now.toISOString(),
  }
  return {
    statusCode: result.statusCode,
    body: {
      data:
        result.collection === HOMEWORK
          ? homeworkView(result.record, meta, ctx.now)
          : submissionView(result.record, meta, result.dueDate),
    },
  }
}

/**
 * Ödev işlemini tek transaction'da çalıştırır (`runCommand`: kurum kilidi, fark, sürüm koşullu
 * yazma, denetim kaydı, `Idempotency-Key`). Sıra: olmayan hedef 404 → core yetki ve kapsam
 * (403/404) → sürüm 409 `version_conflict` → core kuralı (422, 409) → dosya bağlama ve bildirim
 * (aynı transaction; hata hepsini geri alır).
 */
function execute(
  ctx: ServiceContext,
  command: HomeworkRun,
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
        const extra = command.prepare ? await command.prepare(tx) : {}
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType, ...extra }),
        }
      },
      ...(command.after === undefined ? {} : { after: command.after }),
    },
    (outcome) => respond(ctx, outcome, command.expected?.version ?? 1),
    idempotency,
  )
}

const homeworkEntity = (outcome: Outcome) => ({
  type: HOMEWORK,
  id: outcome.collection === HOMEWORK ? outcome.record.id : (text(outcome.record.homeworkId) ?? ''),
})

export interface HomeworkTarget {
  homeworkId: string
  /** `If-Match`: ödevin okunan sürümü. */
  expectedVersion: number
}

/** Yeni ödev (core `assignHomework`, DOM-AKD-070). 201. */
export function createHomework(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'homework.assign',
      loadScope: { homework: NONE, submissions: NONE },
      expected: null,
      entity: homeworkEntity,
      run: (state, by, { now, makeId }, { institutionType }) => {
        const homework = assignHomework(state, by, input, makeId, now, { institutionType })
        return {
          collection: HOMEWORK,
          record: stored(homework),
          dueDate: homework.dueDate,
          statusCode: 201,
        }
      },
    },
    idempotency,
  )
}

/** Ödevi kısmi düzenler (core `updateHomework`, DOM-AKD-071); sınıf ve ders değişmez. */
export function editHomework(
  ctx: ServiceContext,
  target: HomeworkTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'homework.update',
      loadScope: { homework: { ids: [target.homeworkId] }, submissions: NONE },
      expected: { collection: HOMEWORK, id: target.homeworkId, version: target.expectedVersion },
      entity: homeworkEntity,
      run: (state, by, { now }, { institutionType }) => {
        const homework = updateHomework(state, by, target.homeworkId, input, now, {
          institutionType,
        })
        return {
          collection: HOMEWORK,
          record: stored(homework),
          dueDate: homework.dueDate,
          statusCode: 200,
        }
      },
    },
    idempotency,
  )
}

/** Teslim almamış ödevi arşivler (core `archiveHomework`, DOM-AKD-071); kayıt silinmez. */
export function removeHomework(
  ctx: ServiceContext,
  target: HomeworkTarget,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'homework.archive',
      loadScope: {
        homework: { ids: [target.homeworkId] },
        // Arşiv kararı yalnız bu ödevin teslimlerine bakar (`homework_has_submissions`).
        submissions: {
          match: [{ kind: 'equals', field: 'homeworkId', values: [target.homeworkId] }],
        },
      },
      expected: { collection: HOMEWORK, id: target.homeworkId, version: target.expectedVersion },
      entity: homeworkEntity,
      run: (state, by, _tools, { institutionType }) => {
        const homework = archiveHomework(state, by, target.homeworkId, { institutionType })
        return {
          collection: HOMEWORK,
          record: stored(homework),
          dueDate: homework.dueDate,
          statusCode: 200,
        }
      },
    },
    idempotency,
  )
}

/**
 * Kişinin bağlayabileceği dosyaların adları (eski görünümlerin `fileName` alanı). Yalnız aynı
 * kurumda ve kişinin kendi yüklediği dosya okunur; başkasının dosyası ad vermez, bağlamada 422
 * `file_unavailable` alır (`attachFile`).
 */
async function ownFileNames(
  tx: Database,
  ctx: ServiceContext,
  input: unknown,
): Promise<ReadonlyMap<string, string>> {
  const parsed = submitHomeworkSchema.safeParse(input)
  const names = new Map<string, string>()
  if (!parsed.success) return names
  for (const fileId of parsed.data.fileIds ?? []) {
    const row = await findFile(tx, ctx.institutionId, fileId)
    if (row && row.uploadedByUserId === ctx.actor.userId) names.set(fileId, row.originalName ?? '')
  }
  return names
}

/**
 * Öğrenci ödevi teslim eder (core `submitHomework`, DOM-AKD-072): ilk teslim 201, puanlanmamış
 * teslimin yenilenmesi 200. Yeni eklenen dosyalar aynı transaction'da teslime bağlanır (ADR 0003
 * karar 5): başkasının, başka kurumun ya da olmayan dosyası 422 `file_unavailable`, hazır olmayan
 * 422 `file_not_ready`, başka kayda bağlı 409 `file_already_attached`; hiçbir kayıt değişmez.
 * Yeniden teslimde listeden düşen dosyanın bağı kalkar (`detachFile`).
 */
export function submitHomeworkCommand(
  ctx: ServiceContext,
  homeworkId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'homework.submit',
      loadScope: {
        homework: { ids: [homeworkId] },
        // Öğrencinin önceki teslimi bu ödevin teslimleri arasındadır (sınıf mevcudu kadar).
        submissions: { match: [{ kind: 'equals', field: 'homeworkId', values: [homeworkId] }] },
      },
      expected: null,
      entity: (outcome) => ({ type: SUBMISSIONS, id: outcome.record.id }),
      prepare: async (tx) => ({ fileNames: await ownFileNames(tx, ctx, input) }),
      run: (state, by, { now, makeId }, { institutionType, fileNames }) => {
        const outcome = submitHomework(state, by, homeworkId, input, makeId, now, {
          institutionType,
          ...(fileNames === undefined ? {} : { fileNames }),
        })
        const homework = state.homework.find((item) => item.id === homeworkId)
        return {
          collection: SUBMISSIONS,
          record: stored(outcome.submission),
          dueDate: homework?.dueDate ?? '',
          statusCode: outcome.created ? 201 : 200,
          attach: outcome.attach,
          detach: outcome.detach,
        }
      },
      after: async (tx, outcome) => {
        const attachment = { attachedType: SUBMISSION_ATTACHMENT, attachedId: outcome.record.id }
        // Kayıttan düşen dosya artık teslimle okunmaz (DOM-AKD-072); yeniden eklenebilir.
        for (const fileId of outcome.detach ?? [])
          await detachFile(tx, ctx, { fileId, ...attachment })
        for (const fileId of outcome.attach ?? []) {
          // Bu teslime zaten bağlı dosya (bağı düzeltmeden önce düşürülmüş eski kayıt) yeniden
          // bağlanmaz; başka kayda bağlı dosya `attachFile`'da 409 alır.
          const row = await findFile(tx, ctx.institutionId, fileId)
          if (row?.attachedType === SUBMISSION_ATTACHMENT && row.attachedId === outcome.record.id)
            continue
          await attachFile(tx, ctx, {
            fileId,
            ...attachment,
            dataSubjectId: text(outcome.record.studentId),
          })
        }
      },
    },
    idempotency,
  )
}

export interface SubmissionTarget {
  homeworkId: string
  submissionId: string
  /** `If-Match`: teslimin okunan sürümü. */
  expectedVersion: number
}

/**
 * Öğretmen teslimi puanlar (core `gradeSubmission`, DOM-AKD-073). Aynı transaction'da öğrenciye
 * ve 18 yaş altında veliye `homework_graded` bildirimi yazılır; yeniden puanlama da bildirir.
 * Puan resmî not değildir (DOM-AKD-060).
 */
export function gradeSubmissionCommand(
  ctx: ServiceContext,
  target: SubmissionTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'homework.grade',
      loadScope: {
        homework: { ids: [target.homeworkId] },
        submissions: { ids: [target.submissionId] },
      },
      expected: {
        collection: SUBMISSIONS,
        id: target.submissionId,
        version: target.expectedVersion,
      },
      entity: (outcome) => ({ type: SUBMISSIONS, id: outcome.record.id }),
      run: (state, by, { now }, { institutionType }) => {
        const submission = gradeSubmission(
          state,
          by,
          target.homeworkId,
          target.submissionId,
          input,
          now,
          { institutionType },
        )
        const homework = state.homework.find((item) => item.id === target.homeworkId)
        return {
          collection: SUBMISSIONS,
          record: stored(submission),
          dueDate: homework?.dueDate ?? '',
          statusCode: 200,
        }
      },
      after: async (tx, outcome) => {
        const studentId = text(outcome.record.studentId)
        // Öğrenme ya da iletişim modülü kapalıysa `notify` yazmadan döner (DOM-YTK-040).
        if (studentId !== null)
          await notify(tx, ctx, {
            type: 'homework_graded',
            recipients: { studentIds: [studentId] },
            data: { homeworkId: target.homeworkId },
          })
      },
    },
    idempotency,
  )
}

/**
 * Teslime bağlı dosya, teslimi okuyabilene açılır (ADR 0003 karar 6): yönetici, öğrenci kendisi,
 * veli çocuğu, öğretmen yalnız kendi ödevi ya da rehberi olduğu sınıfın öğrencisi (DOM-AKD-074;
 * kural core `submissions` kapsamındadır). PGlite tek bağlantılıdır: kapsam
 * işlemin bağlantısıyla (`tx`) okunur.
 */
defineFileAttachment(SUBMISSION_ATTACHMENT, {
  purposes: ['submission'],
  canRead: async (tx, ctx, submissionId) => {
    const scope = await readScope({ ...ctx, db: tx })
    if (!scope.access(SUBMISSIONS).allowed) return false
    const row = await findRecord(tx, ctx.institutionId, SUBMISSIONS, submissionId)
    return row !== null && scope.canRead(SUBMISSIONS, row.data)
  },
})
