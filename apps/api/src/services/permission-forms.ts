import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import {
  archivePermissionForm,
  closePermissionForm,
  createPermissionForm,
  decidePermission,
  decidePermissionSchema,
  isAdultLearner,
  isPermissionFormOpen,
  permissionCounts,
  permissionDeadlineEndsAt,
  permissionStatus,
  PERMISSION_FORM_TOPIC_KEYS,
  updatePermissionForm,
  type PermissionDecisionRecord,
  type PermissionFormTopic,
  type PermissionStatus,
} from '@kampus/school-core/lib/permission-forms.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName, RecordData } from '../db/collections.ts'
import {
  findRecord,
  loadRecords,
  loadRecordsByIds,
  type RecordFilter,
  type StoredRecord,
} from '../db/records.ts'
import { studentIdentities } from '../db/schema/student-identities.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
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
import { assertReadable, readScope } from './read-scope.ts'

/**
 * Dijital veli onayı ve izin formu servisi (OG-055; IST-067, docs/domain/iletisim-ve-veli.md
 * DOM-ILT-030, -031, -036…039). Formlar `permissionForms`, kararlar `permissionDecisions`
 * koleksiyonundadır (`records`, modül `communication`). Kural, rol ve kapsam core'dadır
 * (`lib/permission-forms.ts`, `requireAuthorized`, `platform/scope.ts`); burada yalnız gereken
 * kayıtların yüklenmesi, görünümün okuyana göre daraltılması, bildirim ve tek transaction vardır.
 *
 * Okuma core kapsamıyladır: yönetici bütün formları, öğretmen açtığı ve sınıflarına ya da
 * öğrencilerine açılmış formları, veli ve öğrenci hedefinde çocuğu/kendisi olan formları görür;
 * ön büro okumaz (403). Formun hedef öğrencilerinden yönetici ve formun öğretmeni hepsini, öbür
 * öğretmen kapsamındakileri, veli çocuğunu, öğrenci kendisini görür. Öğrencinin durumu formun
 * bütün kararlarından hesaplanır (saklanmaz, DOM-ILT-037): veli öbür velinin kararını ve notunu
 * görmez ama reddi durumda görür. Yaş kimlik satırındaki doğum tarihinden (`student_identities`,
 * ADR 0006 karar 9), yoksa öğrenci kaydından okunur; bilinmiyorsa öğrenci 18 yaş altıdır.
 *
 * Yazmalar kurumun bütün formlarını kurum kilidi altında yüklemez: açarken hiçbirini, diğer
 * işlemlerde hedef formu ve (gerekiyorsa) kararlarını yükler. Karar notu loglanmaz (pino
 * `redact` `note`); denetime yalnız değişen alan adları yazılır (işlem çalıştırıcı).
 */

const FORMS: CollectionName = 'permissionForms'
const DECISIONS: CollectionName = 'permissionDecisions'
const NONE: LoadScope = { ids: [] }

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

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

type FormStatus = 'open' | 'closed'

const topicOf = (value: unknown): PermissionFormTopic =>
  PERMISSION_FORM_TOPIC_KEYS.find((topic) => topic === value) ?? 'other'
const deadlineOf = (record: RecordData) => text(record.deadline) ?? ''
const storedStatus = (record: RecordData): FormStatus =>
  record.status === 'closed' ? 'closed' : 'open'
const accepting = (record: RecordData, now: Date) =>
  isPermissionFormOpen(
    { deadline: deadlineOf(record), status: storedStatus(record) },
    now.toISOString(),
  )

/**
 * Formun yanıt görünümü (beyaz liste). `studentIds` okuyanın gördüğü hedef öğrencilerdir;
 * `visible` verilmezse hepsi (yazma yanıtı: yazan yönetici ya da formun öğretmenidir).
 */
function formView(
  record: RecordData,
  meta: RowMeta,
  now: Date,
  visible?: (studentId: string) => boolean,
) {
  const deadline = deadlineOf(record)
  const open = accepting(record, now)
  const studentIds = texts(record.studentIds)
  return {
    id: meta.id,
    version: meta.version,
    topic: topicOf(record.topic),
    title: text(record.title) ?? '',
    description: text(record.description) ?? '',
    deadline,
    deadlineEndsAt: permissionDeadlineEndsAt(deadline),
    classIds: texts(record.classIds),
    studentIds: visible ? studentIds.filter(visible) : studentIds,
    teacherId: text(record.teacherId),
    status: open ? ('open' as const) : ('closed' as const),
    closedAt: text(record.closedAt),
    acceptingDecisions: open,
    createdAt: text(record.createdAt) ?? meta.updatedAt,
    updatedAt: meta.updatedAt,
  }
}

type Scope = Awaited<ReturnType<typeof readScope>>

async function readableScope(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  // Modül (`communication`) ve rol kuralı; kapalıysa 403 `module_disabled`, ön büro 403.
  assertReadable(ctx, scope, FORMS)
  assertReadable(ctx, scope, DECISIONS)
  return scope
}

/** Okuyanın formda gördüğü hedef öğrenciler (DOM-ILT-037). */
function studentVisibility(scope: Scope, record: RecordData): (studentId: string) => boolean {
  const role = scope.actor.role
  const owner = scope.teacher !== undefined && text(record.teacherId) === scope.teacher.id
  if (role === 'yonetici' || (role === 'ogretmen' && owner)) return () => true
  return (studentId) => scope.studentIds.has(studentId)
}

/**
 * Öğrencilerin doğum tarihleri: kimlik satırı (ADR 0006 karar 9), yoksa öğrenci kaydındaki alan;
 * ikisi de yoksa `null`. Kişisel veri; yalnız yaş hesabında kullanılır, yanıta girmez.
 */
async function birthDatesOf(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(studentIds)]
  const result = new Map<string, string | null>(ids.map((id) => [id, null]))
  if (ids.length === 0) return result
  for (const row of await loadRecordsByIds(db, institutionId, 'students', ids)) {
    const birthDate = text(row.data.birthDate)
    if (birthDate !== null) result.set(row.id, birthDate)
  }
  const identities = await identityBirthDates(db, institutionId, ids)
  for (const [studentId, birthDate] of identities) result.set(studentId, birthDate)
  return result
}

async function identityBirthDates(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map()
  const rows = await db
    .select({ studentId: studentIdentities.studentId, birthDate: studentIdentities.birthDate })
    .from(studentIdentities)
    .where(
      and(
        eq(studentIdentities.institutionId, institutionId),
        inArray(studentIdentities.studentId, [...studentIds]),
        isNull(studentIdentities.archivedAt),
      ),
    )
  return new Map(rows.map((row) => [row.studentId, row.birthDate]))
}

/** Formların bütün kararları (kapsamsız; durum hesabı için), form kimliğine göre. */
async function decisionsOf(
  ctx: ServiceContext,
  formIds: readonly string[],
): Promise<Map<string, StoredRecord[]>> {
  const byForm = new Map<string, StoredRecord[]>(formIds.map((id) => [id, []]))
  if (formIds.length === 0) return byForm
  const rows = await loadRecords(ctx.db, ctx.institutionId, [DECISIONS], {
    match: [{ kind: 'equals', field: 'formId', values: formIds }],
  })
  for (const row of rows) byForm.get(text(row.data.formId) ?? '')?.push(row)
  return byForm
}

type DecisionFacts = Pick<
  PermissionDecisionRecord,
  'decidedByUserId' | 'decidedAt' | 'decision' | 'relation'
>

const factsOf = (data: RecordData): DecisionFacts => ({
  decidedByUserId: text(data.decidedByUserId) ?? '',
  decidedAt: text(data.decidedAt) ?? '',
  decision: data.decision === 'rejected' ? 'rejected' : 'approved',
  relation: data.relation === 'self' ? 'self' : 'guardian',
})

interface FormSummary {
  record: RecordData
  meta: RowMeta
  visibleStudents: string[]
  statuses: Map<string, PermissionStatus>
  decisions: StoredRecord[]
}

/** Formların görünen öğrencileri ve onların geçerli durumları (DOM-ILT-031, -037). */
async function summarize(
  ctx: ServiceContext,
  scope: Scope,
  rows: readonly StoredRecord[],
): Promise<FormSummary[]> {
  const decisions = await decisionsOf(
    ctx,
    rows.map((row) => row.id),
  )
  const visible = rows.map((row) =>
    texts(row.data.studentIds).filter(studentVisibility(scope, row.data)),
  )
  const birthDates = await birthDatesOf(ctx.db, ctx.institutionId, visible.flat())
  const now = ctx.now.toISOString()
  const adult = (studentId: string) =>
    isAdultLearner({ birthDate: birthDates.get(studentId) ?? undefined }, now)
  return rows.map((row, index) => {
    const formDecisions = decisions.get(row.id) ?? []
    const visibleStudents = visible[index] ?? []
    const statuses = new Map(
      visibleStudents.map((studentId) => [
        studentId,
        permissionStatus(
          formDecisions.filter((d) => d.data.studentId === studentId).map((d) => factsOf(d.data)),
          adult(studentId),
        ),
      ]),
    )
    return {
      record: row.data,
      meta: metaOf(row),
      visibleStudents,
      statuses,
      decisions: formDecisions,
    }
  })
}

function listItem(ctx: ServiceContext, scope: Scope, summary: FormSummary) {
  const visible = new Set(summary.visibleStudents)
  return {
    ...formView(scope.redact(FORMS, summary.record), summary.meta, ctx.now, (id) =>
      visible.has(id),
    ),
    counts: permissionCounts(summary.statuses.values()),
  }
}

export interface PermissionFormListInput {
  page: number
  pageSize: number
  status: FormStatus | 'all'
  topic?: string | undefined
}

/**
 * İzin formu listesi: son güne göre yeniden eskiye, sonra kimliğe göre, sayfalı. Konu süzgeci
 * SQL'de, durum (`open`/`closed`) bellekte ana göre. Her satır okuyanın gördüğü öğrencilerin
 * bekleyen, onay ve ret sayılarını taşır.
 */
export async function listPermissionForms(ctx: ServiceContext, input: PermissionFormListInput) {
  const scope = await readableScope(ctx)
  const match: RecordFilter[] = []
  if (input.topic) match.push({ kind: 'equals', field: 'topic', values: [input.topic] })
  const rows = await loadRecords(ctx.db, ctx.institutionId, [FORMS], { match })
  const visible = rows
    .filter((row) => scope.canRead(FORMS, row.data))
    .filter((row) => {
      if (input.status === 'all') return true
      const open = accepting(row.data, ctx.now)
      return input.status === 'open' ? open : !open
    })
    .sort(
      (a, b) => deadlineOf(b.data).localeCompare(deadlineOf(a.data)) || a.id.localeCompare(b.id),
    )
  const start = (input.page - 1) * input.pageSize
  const summaries = await summarize(ctx, scope, visible.slice(start, start + input.pageSize))
  return { items: summaries.map((summary) => listItem(ctx, scope, summary)), total: visible.length }
}

/**
 * Tek form ve okuyanın gördüğü öğrencilerin durumları ile görebildiği kararlar (veli yalnız kendi
 * kararını görür). Olmayan, başka kurumun ya da görmediği form 404.
 */
export async function getPermissionForm(ctx: ServiceContext, formId: string) {
  const scope = await readableScope(ctx)
  const row = await findRecord(ctx.db, ctx.institutionId, FORMS, formId)
  if (!row || !scope.canRead(FORMS, row.data)) throw new NotFoundError()
  const [summary] = await summarize(ctx, scope, [row])
  if (!summary) throw new NotFoundError()
  const readable = summary.decisions
    .filter((decision) => scope.canRead(DECISIONS, decision.data))
    .sort(
      (a, b) =>
        (text(a.data.decidedAt) ?? '').localeCompare(text(b.data.decidedAt) ?? '') ||
        a.id.localeCompare(b.id),
    )
  return {
    ...listItem(ctx, scope, summary),
    students: summary.visibleStudents.map((studentId) => ({
      studentId,
      status: summary.statuses.get(studentId) ?? 'pending',
      decisions: readable
        .filter((decision) => decision.data.studentId === studentId)
        .map((decision) => {
          const shown = scope.redact(DECISIONS, decision.data)
          return {
            id: decision.id,
            decision: factsOf(decision.data).decision,
            note: text(shown.note) ?? '',
            relation: factsOf(decision.data).relation,
            decidedAt: text(decision.data.decidedAt) ?? '',
            // Ham kayıttan: kimlik yanıtta yöneticiye döner, `mine` herkese.
            mine: text(decision.data.decidedByUserId) === ctx.actor.userId,
            decidedByUserId: text(shown.decidedByUserId),
          }
        }),
    })),
  }
}

// --- Yazma -----------------------------------------------------------------------------------

type PermissionAction =
  | 'permissionForm.create'
  | 'permissionForm.update'
  | 'permissionForm.close'
  | 'permissionForm.archive'
  | 'permissionForm.decide'

type Outcome =
  | {
      collection: 'permissionForms'
      record: RecordData & { id: string }
      statusCode: 200 | 201
      /** Bildirim gidecek öğrenciler (açılış ya da hedefe yeni giren). */
      notifyStudentIds: readonly string[]
    }
  | {
      collection: 'permissionDecisions'
      record: RecordData & { id: string }
      statusCode: 200 | 201
      studentStatus: PermissionStatus
    }

interface PermissionRun {
  action: PermissionAction
  loadScope: Partial<Record<CollectionName, LoadScope>>
  expected: ExpectedVersion | null
  /** Kurum kilidinden sonra, core işleminden önce okunan doğum tarihi (karar). */
  prepare?: (tx: Database) => Promise<{ birthDate?: string }>
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType; birthDate?: string },
  ) => Outcome
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
  if (result.collection === 'permissionForms')
    return { statusCode: result.statusCode, body: { data: formView(result.record, meta, ctx.now) } }
  const { record } = result
  const facts = factsOf(record)
  return {
    statusCode: result.statusCode,
    body: {
      data: {
        id: record.id,
        version: meta.version,
        formId: text(record.formId) ?? '',
        studentId: text(record.studentId) ?? '',
        decision: facts.decision,
        note: text(record.note) ?? '',
        relation: facts.relation,
        decidedAt: facts.decidedAt,
        studentStatus: result.studentStatus,
      },
    },
  }
}

/**
 * İzin formu işlemini tek transaction'da çalıştırır (`runCommand`: kurum kilidi, fark, sürüm
 * koşullu yazma, denetim kaydı, `Idempotency-Key`). Sıra: olmayan hedef 404 → core yetki ve
 * kapsam (403/404) → sürüm 409 `version_conflict` → core kuralı (422, 409) → bildirim (aynı
 * transaction; hata hepsini geri alır).
 */
function execute(
  ctx: ServiceContext,
  command: PermissionRun,
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
      entity: (outcome) => ({
        type: FORMS,
        id:
          outcome.collection === 'permissionForms'
            ? outcome.record.id
            : (text(outcome.record.formId) ?? ''),
      }),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        const extra = command.prepare ? await command.prepare(tx) : {}
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType, ...extra }),
        }
      },
      after: async (tx, outcome) => {
        if (outcome.collection !== 'permissionForms' || outcome.notifyStudentIds.length === 0)
          return
        // İletişim modülü kapalıysa `notify` yazmadan döner (DOM-YTK-040). Aynı form aynı
        // öğrenciye ikinci kez bildirilmez (`dedupeKey`): hedeften çıkıp geri giren öğrenci.
        await notify(tx, ctx, {
          type: 'permission_form_opened',
          recipients: { studentIds: outcome.notifyStudentIds },
          data: { formId: outcome.record.id },
          dedupeKey: outcome.record.id,
        })
      },
    },
    (outcome) => respond(ctx, outcome, command.expected?.version ?? 1),
    idempotency,
  )
}

const formOutcome = (
  form: { id: string },
  statusCode: 200 | 201,
  notifyStudentIds: readonly string[] = [],
): Outcome => ({
  collection: 'permissionForms',
  record: stored(form),
  statusCode,
  notifyStudentIds,
})

const decisionsOfForm = (formId: string): LoadScope => ({
  match: [{ kind: 'equals', field: 'formId', values: [formId] }],
})

export interface PermissionFormTarget {
  formId: string
  /** `If-Match`: formun okunan sürümü. */
  expectedVersion: number
}

const expectedForm = (target: PermissionFormTarget): ExpectedVersion => ({
  collection: FORMS,
  id: target.formId,
  version: target.expectedVersion,
})

/** Yeni izin formu (core `createPermissionForm`, DOM-ILT-036); hedef öğrencilere bildirim. 201. */
export function createPermissionFormCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'permissionForm.create',
      loadScope: { permissionForms: NONE, permissionDecisions: NONE },
      expected: null,
      run: (state, by, { now, makeId }, { institutionType }) => {
        const form = createPermissionForm(state, by, input, makeId, now, { institutionType })
        return formOutcome(form, 201, form.studentIds)
      },
    },
    idempotency,
  )
}

/**
 * İzin formunu düzenler (core `updatePermissionForm`, DOM-ILT-038); hedefe yeni giren öğrencilere
 * bildirim. Kararı olan formun daraltılması kararlara bakar: formun kararları yüklenir.
 */
export function editPermissionForm(
  ctx: ServiceContext,
  target: PermissionFormTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'permissionForm.update',
      loadScope: {
        permissionForms: { ids: [target.formId] },
        permissionDecisions: decisionsOfForm(target.formId),
      },
      expected: expectedForm(target),
      run: (state, by, { now }, { institutionType }) => {
        const { form, addedStudentIds } = updatePermissionForm(
          state,
          by,
          target.formId,
          input,
          now,
          { institutionType },
        )
        return formOutcome(form, 200, addedStudentIds)
      },
    },
    idempotency,
  )
}

/** İzin formunu kapatır (core `closePermissionForm`, DOM-ILT-038); kararlar korunur. */
export function closePermissionFormCommand(
  ctx: ServiceContext,
  target: PermissionFormTarget,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'permissionForm.close',
      loadScope: { permissionForms: { ids: [target.formId] }, permissionDecisions: NONE },
      expected: expectedForm(target),
      run: (state, by, { now }, { institutionType }) =>
        formOutcome(closePermissionForm(state, by, target.formId, now, { institutionType }), 200),
    },
    idempotency,
  )
}

/** Kararsız izin formunu arşivler (core `archivePermissionForm`); kararlı form 409. */
export function archivePermissionFormCommand(
  ctx: ServiceContext,
  target: PermissionFormTarget,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'permissionForm.archive',
      loadScope: {
        permissionForms: { ids: [target.formId] },
        permissionDecisions: decisionsOfForm(target.formId),
      },
      expected: expectedForm(target),
      run: (state, by, _tools, { institutionType }) =>
        formOutcome(archivePermissionForm(state, by, target.formId, { institutionType }), 200),
    },
    idempotency,
  )
}

/**
 * Veli ya da 18 yaşını doldurmuş öğrenci kararı (core `decidePermission`, DOM-ILT-030, -031,
 * -037): yeni karar 201, son kararla aynı karar ve not 200 (yeni satır yok). Yaş kimlik
 * satırındaki doğum tarihinden okunur (ADR 0006 karar 9); yoksa öğrenci kaydından.
 */
export function decidePermissionCommand(
  ctx: ServiceContext,
  formId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'permissionForm.decide',
      loadScope: {
        permissionForms: { ids: [formId] },
        permissionDecisions: decisionsOfForm(formId),
      },
      expected: null,
      prepare: async (tx) => {
        const parsed = decidePermissionSchema.safeParse(input)
        if (!parsed.success) return {}
        const identity = await identityBirthDates(tx, ctx.institutionId, [parsed.data.studentId])
        const birthDate = identity.get(parsed.data.studentId)
        return birthDate === undefined ? {} : { birthDate }
      },
      run: (state, by, { now, makeId }, { institutionType, birthDate }) => {
        const outcome = decidePermission(state, by, formId, input, makeId, now, {
          institutionType,
          ...(birthDate === undefined ? {} : { birthDate }),
        })
        const { studentId, relation } = outcome.decision
        const studentStatus = permissionStatus(
          state.permissionDecisions.filter((d) => d.formId === formId && d.studentId === studentId),
          relation === 'self',
        )
        return {
          collection: 'permissionDecisions',
          record: stored(outcome.decision),
          statusCode: outcome.created ? 201 : 200,
          studentStatus,
        }
      },
    },
    idempotency,
  )
}
