import type { State } from '@kampus/school-core/data/seed.ts'
import { runWorkflow } from '@kampus/school-core/lib/school-workflows.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { RecordData } from '../db/collections.ts'
import { findRecord, loadRecords, type RecordFilter } from '../db/records.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
import { dayRange } from './list-filters.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope, scopePrefilter } from './read-scope.ts'

/**
 * Ders programı servisi (IST-094; docs/domain/yetki-ve-kapsam.md DOM-YTK-068, DOM-YTK-069).
 * Dersler `records` deposunda `schedule` koleksiyonudur. Kural tek yerdedir: yazmalar core iş
 * akışını (`runWorkflow`: `lesson`, `substitute`, `lesson-cancel`) çalıştırır; köprü
 * (`/workflows/<komut>`) aynı kuralı çalıştırır. Çakışma denetimi (öğretmen, sınıf, derslik;
 * öğretmenin randevusu, etüdü ve etkinliği) core `validateLesson`'dadır; bu yüzden yazma çakışma
 * koleksiyonlarının hepsini kurum kilidi altında yükler (core komut tablosu).
 *
 * Okuma core kapsamıyladır (`scopeFor`): yönetici ve ön büro kurumun bütün programını, öğretmen
 * kendi (asıl ya da yedek olduğu) derslerini, öğrenci ve veli kendi/çocuğunun sınıfını okur;
 * görmediği ders olmayan dersle aynı 404'tür. İptal ve görevlendirme gerekçesi (`cancelReason`,
 * `substitutions`) yalnız yöneticiye döner; öğretmen, ön büro, öğrenci ve veli yalnız durumu ve
 * yedek öğretmeni görür (core `PLATFORM_HIDDEN_FIELDS`, `scope.hiddenFields`). Gerekçe
 * loglanmaz; denetim kaydının `reason` kolonuna yazılır.
 */

export type LessonStatus = 'planned' | 'substituted' | 'cancelled'

export interface LessonListInput {
  page: number
  pageSize: number
  dateFrom?: string | undefined
  dateTo?: string | undefined
  classId?: string | undefined
  teacherId?: string | undefined
  room?: string | undefined
  cancelled: 'true' | 'false' | 'all'
}

const COLLECTION = 'schedule'

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
/** Derslik karşılaştırması core çakışma kuralıyla aynıdır (`trim` + Türkçe küçük harf). */
const roomKey = (value: unknown) => (text(value) ?? '').trim().toLocaleLowerCase('tr')

function statusOf(record: RecordData): LessonStatus {
  if (record.cancelledAt) return 'cancelled'
  return record.originalTeacherId ? 'substituted' : 'planned'
}

/**
 * Yanıt görünümü: kayıt rolün ayıklanmış hâlidir. Gerekçe alanlarını gören rol (core kapsamının
 * `hiddenFields` listesi; yalnız yönetici) onları her zaman alır (boşsa `null`/boş liste); diğer
 * rollere bu alanlar hiç eklenmez.
 */
function lessonView(
  hidden: readonly string[],
  record: RecordData,
  meta: { id: string; version: number; updatedAt: string },
) {
  const date = text(record.date) ?? ''
  const base = {
    id: meta.id,
    version: meta.version,
    classId: text(record.classId) ?? '',
    subjectId: text(record.subjectId) ?? '',
    title: text(record.title) ?? text(record.subject),
    teacherId: text(record.teacherId) ?? '',
    originalTeacherId: text(record.originalTeacherId),
    date,
    duration: typeof record.duration === 'number' ? record.duration : 0,
    room: text(record.room) ?? '',
    status: statusOf(record),
    cancelledAt: text(record.cancelledAt),
    updatedAt: meta.updatedAt,
  }
  return {
    ...base,
    ...(hidden.includes('cancelReason') ? {} : { cancelReason: text(record.cancelReason) }),
    ...(hidden.includes('substitutions')
      ? {}
      : { substitutions: Array.isArray(record.substitutions) ? record.substitutions : [] }),
  }
}

async function readableScope(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  // Koleksiyonun kendi modülü (`academic`) ve rol kuralı; kapalıysa 403, rolsüz 403.
  assertReadable(ctx, scope, COLLECTION)
  return scope
}

/**
 * Ders listesi: başlangıca göre, sonra kimliğe göre sıralı, sayfalı. Süzgeçler SQL'de
 * (sınıf, öğretmen, iptal, gün aralığı; öğrenci ve velide kapsam ön süzgeci), derslik bellekte
 * core kuralıyla eşlenir. Satır kararı core `canRead`'dir.
 */
export async function listLessons(ctx: ServiceContext, input: LessonListInput) {
  const scope = await readableScope(ctx)
  const match: RecordFilter[] = []
  const prefilter = scopePrefilter(scope, COLLECTION)
  if (prefilter) match.push(prefilter)
  if (input.classId) match.push({ kind: 'equals', field: 'classId', values: [input.classId] })
  if (input.teacherId) match.push({ kind: 'equals', field: 'teacherId', values: [input.teacherId] })
  if (input.cancelled !== 'all')
    match.push({
      kind: 'set',
      field: 'cancelledAt',
      set: input.cancelled === 'true',
      rule: 'truthy',
    })
  const range = dayRange('date', input.dateFrom, input.dateTo)
  if (range) match.push(range)
  const rows = await loadRecords(ctx.db, ctx.institutionId, [COLLECTION], { match })
  const room = input.room === undefined ? null : roomKey(input.room)
  const visible = rows
    .filter((row) => scope.canRead(COLLECTION, row.data))
    .filter((row) => room === null || roomKey(row.data.room) === room)
    .sort(
      (a, b) =>
        (text(a.data.date) ?? '').localeCompare(text(b.data.date) ?? '') ||
        a.id.localeCompare(b.id),
    )
  const start = (input.page - 1) * input.pageSize
  return {
    items: visible.slice(start, start + input.pageSize).map((row) =>
      lessonView(scope.hiddenFields(COLLECTION), scope.redact(COLLECTION, row.data), {
        id: row.id,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      }),
    ),
    total: visible.length,
  }
}

/** Tek ders; olmayan, başka kurumun ya da aktörün göremediği ders 404 (iptal edilmiş olsa da). */
export async function getLesson(ctx: ServiceContext, lessonId: string) {
  const scope = await readableScope(ctx)
  const row = await findRecord(ctx.db, ctx.institutionId, COLLECTION, lessonId)
  if (!row || !scope.canRead(COLLECTION, row.data)) throw new NotFoundError()
  return lessonView(scope.hiddenFields(COLLECTION), scope.redact(COLLECTION, row.data), {
    id: row.id,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  })
}

export interface LessonTarget {
  lessonId: string
  /** `If-Match`: dersin okunan sürümü. */
  expectedVersion: number
}

type LessonCommand = 'lesson' | 'substitute' | 'lesson-cancel'

interface LessonOperation {
  command: LessonCommand
  target: LessonTarget | null
  /** Core girdisi; düzenlemede mevcut dersin alanlarıyla birleştirilir. */
  input: (state: State) => unknown
  /** Denetim kaydının gerekçesi (iptal, görevlendirme). */
  reason?: string
  statusCode: 200 | 201
}

/**
 * Ders iş akışını tek transaction'da çalıştırır (`runCommand`: kurum kilidi, fark, sürüm
 * koşullu yazma, denetim kaydı, `Idempotency-Key`). Sıra: olmayan ders 404 → core yetki ve
 * kapsam (403/404) → sürüm 409 `version_conflict` → core kuralı (422, 409). Yanıt dersin yeni
 * hâlidir; okuma uçlarıyla aynı alan ayıklamasıyla döner (yazan yalnız yönetici).
 */
async function runLesson(
  ctx: ServiceContext,
  operation: LessonOperation,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const spec = WORKFLOW_COMMANDS[operation.command]
  const { target } = operation
  const hidden = (await readScope(ctx)).hiddenFields(COLLECTION)
  return runCommand<RecordData & { id: string }>(
    ctx,
    {
      action: `workflow.${operation.command}`,
      collections: spec.collections,
      ...(target === null
        ? {}
        : {
            expectedVersions: [
              { collection: COLLECTION, id: target.lessonId, version: target.expectedVersion },
            ],
          }),
      entity: (lesson) => ({ type: COLLECTION, id: lesson.id }),
      ...(operation.reason === undefined ? {} : { auditReason: operation.reason }),
      load: async (tx) => {
        const { session, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state, { now, makeId }) => {
            const result = runWorkflow(
              state,
              session,
              operation.command,
              operation.input(state),
              makeId,
              target?.lessonId,
              now,
            )
            // Yanıt saklanan biçimle aynı olsun (jsonb: `undefined` alan düşer).
            const lesson: unknown = JSON.parse(JSON.stringify(result))
            if (typeof lesson !== 'object' || lesson === null || !('id' in lesson))
              throw new Error('lesson workflow returned no record')
            return { ...(lesson as RecordData), id: String(lesson.id) }
          },
        }
      },
    },
    (outcome) => {
      const written = outcome.changes.find(
        (change) => change.collection === COLLECTION && change.id === outcome.result.id,
      )
      const version = written?.version ?? target?.expectedVersion ?? 1
      return {
        statusCode: operation.statusCode,
        body: {
          data: lessonView(hidden, outcome.result, {
            id: outcome.result.id,
            version,
            updatedAt: ctx.now.toISOString(),
          }),
        },
      }
    },
    idempotency,
  )
}

/** Yeni ders (core `lesson`): çakışmasız, gelecekte, sınıfın kampüsünde branş öğretmeniyle. 201. */
export function createLesson(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runLesson(
    ctx,
    { command: 'lesson', target: null, input: () => input, statusCode: 201 },
    idempotency,
  )
}

/** Düzenlenen alanlar mevcut dersin alanlarına eklenir; core dersi bütün olarak doğrular. */
const LESSON_FIELDS = ['classId', 'teacherId', 'subjectId', 'date', 'duration', 'room'] as const

/** Dersi kısmi düzenler (core `lesson` + kayıt kimliği); başlamış veya iptal ders düzenlenmez. */
export function updateLesson(
  ctx: ServiceContext,
  target: LessonTarget,
  patch: Readonly<Record<string, unknown>>,
  idempotency: IdempotencyRequest | null,
) {
  return runLesson(
    ctx,
    {
      command: 'lesson',
      target,
      input: (state) => {
        const lesson = state.schedule.find((item) => item.id === target.lessonId)
        // Ders yoksa core 404 verir; birleştirilecek alan yoktur.
        if (!lesson) return patch
        const current = Object.fromEntries(LESSON_FIELDS.map((field) => [field, lesson[field]]))
        return { ...current, ...patch }
      },
      statusCode: 200,
    },
    idempotency,
  )
}

/** Tek derse yedek öğretmen (core `substitute`); kalıcı branş ataması değişmez. */
export function substituteLesson(
  ctx: ServiceContext,
  target: LessonTarget,
  input: { teacherId: string; reason: string },
  idempotency: IdempotencyRequest | null,
) {
  return runLesson(
    ctx,
    {
      command: 'substitute',
      target,
      input: () => input,
      reason: input.reason,
      statusCode: 200,
    },
    idempotency,
  )
}

/** Dersi gerekçeyle iptal eder (core `lesson-cancel`); kayıt silinmez, geçmiş korunur. */
export function cancelLesson(
  ctx: ServiceContext,
  target: LessonTarget,
  input: { reason: string },
  idempotency: IdempotencyRequest | null,
) {
  return runLesson(
    ctx,
    {
      command: 'lesson-cancel',
      target,
      input: () => input,
      reason: input.reason,
      statusCode: 200,
    },
    idempotency,
  )
}
