import type { FastifyBaseLogger } from 'fastify'

import type { State } from '@kampus/school-core/data/seed.ts'
import type { Participant } from '@kampus/school-core/lib/communication.ts'
import { isCustodial } from '@kampus/school-core/lib/guardianship.ts'
import { notificationEnabled, type LearnerAgeFacts } from '@kampus/school-core/lib/notifications.ts'
import {
  archivePermissionForm,
  cancelPermissionForm,
  closePermissionForm,
  createPermissionForm,
  currentDecisions,
  decidePermission,
  decidePermissionSchema,
  isCurrentDecision,
  isPermissionFormOpen,
  permissionCancelStudents,
  permissionCounts,
  permissionDeadlineEndsAt,
  permissionDecider,
  permissionReaskStudents,
  permissionReminders,
  permissionStatus,
  PERMISSION_FORM_TOPIC_KEYS,
  updatePermissionForm,
  type PermissionDecider,
  type PermissionDecisionRecord,
  type PermissionDeciders,
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
  lockInstitution,
  type RecordFilter,
  type StoredRecord,
} from '../db/records.ts'
import { loadGuardianAccounts } from '../db/student-guardians.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { searchKey } from './collection-reads.ts'
import { environment } from './commands.ts'
import { GRADUATION_RENEWALS } from './roster-scope.ts'
import { learnerFactsOf } from './learner-age.ts'
import { getInstitutionModules } from './modules.ts'
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
 * öğretmen kapsamındakileri, veli 18 yaş altındaki çocuğunu, öğrenci kendisini görür; yetişkin
 * öğrencinin formu veliye görünmez ve bildirimi veliye gitmez. Öğrencinin durumu formun bugün
 * sayılan kararlarından hesaplanır (saklanmaz, DOM-ILT-037, DOM-ILT-071): yetişkinde kendisi,
 * 18 yaş altında bugün velayetli ve kısıtsız veliler (`student_guardians`). Veli öbür velinin
 * kararını ve notunu görmez ama reddi durumda görür. Karar satırını ve notu yönetici, rehber
 * öğretmen, kararı veren veli ve öğrenci görür; derse giren öğretmen yalnız durumu görür. Karar
 * veren taraf tek kaynaktandır (core `permissionDecider`): kimlik satırındaki doğum tarihi
 * (`student_identities`, ADR 0006 karar 9), yoksa dil okulunda adayın 18 yaş seçimi.
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
/** Etkinlik ayrıntısı sürümü (core `permissionFormRevision`); alanı olmayan kayıt 0. */
const revisionOf = (record: RecordData) =>
  typeof record.detailsRevision === 'number' ? record.detailsRevision : 0
const fee = (value: unknown) => (typeof value === 'number' ? value : null)
const storedStatus = (record: RecordData): FormStatus =>
  record.status === 'closed' ? 'closed' : 'open'
const accepting = (record: RecordData, now: Date) =>
  isPermissionFormOpen(
    { deadline: deadlineOf(record), status: storedStatus(record) },
    now.toISOString(),
  )

/**
 * Formun yanıt görünümü (beyaz liste). `studentIds` okuyanın gördüğü hedef öğrencilerdir;
 * `visible` verilmezse hepsi (yazma yanıtı: yazan yönetici ya da formun öğretmenidir). Veli ve
 * öğrenci (`personal`) hedef sınıfları ve formu açan öğretmeni görmez: başka sınıfların ve
 * öğretmenin kimliği onlara gerekmez. Formu yönetene (`manage`: yönetici ve formun öğretmeni)
 * düzenleme için tek tek hedeflenen öğrenciler (`targetStudentIds`) ve formda herhangi bir karar
 * satırı olup olmadığı (`hasDecisions`, DOM-ILT-038: hedef daraltma ve arşiv kilidi) döner.
 * `targetStudentIds` form açılışından beri (OG-055) core kaydında ayrı alandır; alanı olmayan kayıt
 * boş liste (yalnız sınıf hedefi) sayılır.
 */
function formView(
  record: RecordData,
  meta: RowMeta,
  now: Date,
  view: {
    visible?: (studentId: string) => boolean
    personal?: boolean
    manage?: { hasDecisions: boolean }
  } = {},
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
    // Etkinlik ayrıntısı (DOM-ILT-032): karar bu ayrıntıya verilir, karar verenler de görür.
    eventDate: text(record.eventDate),
    eventTime: text(record.eventTime),
    location: text(record.location),
    transport: text(record.transport),
    fee: fee(record.fee),
    detailsRevision: revisionOf(record),
    ...(view.personal ? {} : { classIds: texts(record.classIds) }),
    studentIds: view.visible ? studentIds.filter(view.visible) : studentIds,
    ...(view.manage
      ? {
          targetStudentIds: texts(record.targetStudentIds),
          hasDecisions: view.manage.hasDecisions,
        }
      : {}),
    ...(view.personal ? {} : { teacherId: text(record.teacherId) }),
    status: open ? ('open' as const) : ('closed' as const),
    closedAt: text(record.closedAt),
    cancelledAt: text(record.cancelledAt),
    acceptingDecisions: open,
    createdAt: text(record.createdAt) ?? meta.updatedAt,
    updatedAt: meta.updatedAt,
  }
}

type Scope = Awaited<ReturnType<typeof readScope>>

/** Öğrencilerin kararını kim verir (core `permissionDecider`); bilinmeyen öğrenci veliyle. */
async function decidersFor(
  db: Database,
  institutionId: string,
  institutionType: InstitutionType,
  studentIds: readonly string[],
  now: Date,
): Promise<Map<string, PermissionDecider>> {
  const facts = await learnerFactsOf(db, institutionId, studentIds)
  const at = now.toISOString()
  return new Map(
    [...facts].map(([id, learner]) => [
      id,
      permissionDecider(learner, { institutionType, now: at }),
    ]),
  )
}

/**
 * Öğrencilerin bugün velayetli ve iletişim kısıtı olmayan velilerinin kullanıcı kimlikleri
 * (`student_guardians`, core `isCustodial`; DOM-ILT-070…072). Hesabı olmayan veli karar veremez.
 */
async function custodialUserIds(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>(studentIds.map((id) => [id, new Set<string>()]))
  for (const link of await loadGuardianAccounts(db, institutionId, [...new Set(studentIds)]))
    if (link.userId !== null && isCustodial(link)) result.get(link.studentId)?.add(link.userId)
  return result
}

/** Öğrencilerin bugün kararı sayılanları (DOM-ILT-037, DOM-ILT-071). */
async function decidersOf(
  db: Database,
  institutionId: string,
  institutionType: InstitutionType,
  studentIds: readonly string[],
  now: Date,
): Promise<Map<string, PermissionDeciders>> {
  const deciders = await decidersFor(db, institutionId, institutionType, studentIds, now)
  const guardians = await custodialUserIds(db, institutionId, studentIds)
  return new Map(
    [...deciders].map(([id, decider]) => [
      id,
      { decider, guardianUserIds: guardians.get(id) ?? new Set<string>() },
    ]),
  )
}

const NOBODY: PermissionDeciders = { decider: 'guardians', guardianUserIds: new Set() }

/**
 * Okuyan: kapsam, kurum türü ve veli için kararı velilerce verilen (18 yaş altı) çocukları.
 * Yetişkin öğrencinin formu veliye görünmez (DOM-ILT-037).
 */
interface Reader {
  scope: Scope
  institutionType: InstitutionType
  /** Veli: kararını verdiği çocuklar; diğer roller `null`. */
  guarded: ReadonlySet<string> | null
}

async function readerOf(ctx: ServiceContext): Promise<Reader> {
  const scope = await readScope(ctx)
  // Modül (`communication`) ve rol kuralı; kapalıysa 403 `module_disabled`, ön büro 403.
  assertReadable(ctx, scope, FORMS)
  assertReadable(ctx, scope, DECISIONS)
  const institutionType = (await getInstitutionModules(ctx.db, ctx.institutionId))?.type ?? 'school'
  if (scope.actor.role !== 'veli') return { scope, institutionType, guarded: null }
  const children = [...scope.studentIds]
  const deciders = await decidersFor(ctx.db, ctx.institutionId, institutionType, children, ctx.now)
  return {
    scope,
    institutionType,
    guarded: new Set(children.filter((id) => deciders.get(id) === 'guardians')),
  }
}

const personalRole = (reader: Reader) =>
  reader.scope.actor.role === 'veli' || reader.scope.actor.role === 'ogrenci'

/** Formu yönetiyor mu: yönetici ya da formu açan öğretmen (DOM-ILT-038). */
function manages(reader: Reader, record: RecordData): boolean {
  const { scope } = reader
  if (scope.actor.role === 'yonetici') return true
  return (
    scope.actor.role === 'ogretmen' &&
    scope.teacher !== undefined &&
    text(record.teacherId) === scope.teacher.id
  )
}

/** Okuyanın formda gördüğü hedef öğrenciler (DOM-ILT-037). */
function studentVisibility(reader: Reader, record: RecordData): (studentId: string) => boolean {
  const { scope, guarded } = reader
  if (manages(reader, record)) return () => true
  if (guarded !== null) return (studentId) => guarded.has(studentId)
  return (studentId) => scope.studentIds.has(studentId)
}

/** Form okuyana görünür mü: core kapsamı ve velide 18 yaş altı bir çocuğun hedefte olması. */
const formReadable = (reader: Reader, record: RecordData) =>
  reader.scope.canRead(FORMS, record) &&
  (reader.guarded === null || texts(record.studentIds).some((id) => reader.guarded?.has(id)))

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
> & { formRevision: number }

const factsOf = (data: RecordData): DecisionFacts => ({
  decidedByUserId: text(data.decidedByUserId) ?? '',
  decidedAt: text(data.decidedAt) ?? '',
  decision: data.decision === 'rejected' ? 'rejected' : 'approved',
  relation: data.relation === 'self' ? 'self' : 'guardian',
  formRevision: typeof data.formRevision === 'number' ? data.formRevision : 0,
})

interface FormSummary {
  record: RecordData
  meta: RowMeta
  visibleStudents: string[]
  statuses: Map<string, PermissionStatus>
  /** Görünen öğrencilerin kararını kim verir (core `permissionDecider`). */
  deciders: ReadonlyMap<string, PermissionDecider>
  /** Formun bütün karar satırları (kapsamsız). */
  decisions: StoredRecord[]
}

/** Formların görünen öğrencileri ve onların geçerli durumları (DOM-ILT-031, -037). */
async function summarize(
  ctx: ServiceContext,
  reader: Reader,
  rows: readonly StoredRecord[],
): Promise<FormSummary[]> {
  const decisions = await decisionsOf(
    ctx,
    rows.map((row) => row.id),
  )
  const visible = rows.map((row) =>
    texts(row.data.studentIds).filter(studentVisibility(reader, row.data)),
  )
  const deciders = await decidersOf(
    ctx.db,
    ctx.institutionId,
    reader.institutionType,
    visible.flat(),
    ctx.now,
  )
  return rows.map((row, index) => {
    const formDecisions = decisions.get(row.id) ?? []
    const visibleStudents = visible[index] ?? []
    const statuses = new Map(
      visibleStudents.map((studentId) => [
        studentId,
        permissionStatus(
          // Etkinlik ayrıntısı değişince düşen (eski sürüm) karar sayılmaz (DOM-ILT-032).
          currentDecisions(
            { detailsRevision: revisionOf(row.data) },
            formDecisions.filter((d) => d.data.studentId === studentId).map((d) => factsOf(d.data)),
          ),
          deciders.get(studentId) ?? NOBODY,
        ),
      ]),
    )
    return {
      record: row.data,
      meta: metaOf(row),
      visibleStudents,
      statuses,
      deciders: new Map(
        visibleStudents.map((studentId) => [
          studentId,
          (deciders.get(studentId) ?? NOBODY).decider,
        ]),
      ),
      decisions: formDecisions,
    }
  })
}

/**
 * Okuyan bu öğrenci için karar veren taraf mı (core `permissionDecider` sonucundan; kuralı ikinci
 * kez yazmaz): veli 18 yaş altındaki çocuğu, öğrenci 18 yaşını doldurduysa kendisi için. Personel
 * karar vermez. Formun karar alıp almadığı ayrıdır (`acceptingDecisions`).
 */
function canDecideFor(reader: Reader, decider: PermissionDecider | undefined): boolean {
  if (reader.scope.actor.role === 'veli') return decider === 'guardians'
  if (reader.scope.actor.role === 'ogrenci') return decider === 'self'
  return false
}

/**
 * Görünen öğrencilerin durumları, okuyanın görebildiği kararları (core kapsamı: veli yalnız kendi
 * kararını, derse giren öğretmen hiçbirini görmez; DOM-ILT-037) ve okuyanın karar verip
 * veremeyeceği.
 */
function studentEntries(ctx: ServiceContext, reader: Reader, summary: FormSummary) {
  const { scope } = reader
  const readable = summary.decisions
    .filter((decision) => scope.canRead(DECISIONS, decision.data))
    .sort(
      (a, b) =>
        (text(a.data.decidedAt) ?? '').localeCompare(text(b.data.decidedAt) ?? '') ||
        a.id.localeCompare(b.id),
    )
  return summary.visibleStudents.map((studentId) => ({
    studentId,
    status: summary.statuses.get(studentId) ?? 'pending',
    canDecide: canDecideFor(reader, summary.deciders.get(studentId)),
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
          // Düşmüş karar (eski sürüm) satır olarak görünür ama durumu etkilemez (DOM-ILT-032).
          current: isCurrentDecision(
            { detailsRevision: revisionOf(summary.record) },
            factsOf(decision.data),
          ),
          // Ham kayıttan: kimlik yanıtta yöneticiye döner, `mine` herkese.
          mine: text(decision.data.decidedByUserId) === ctx.actor.userId,
          decidedByUserId: text(shown.decidedByUserId),
        }
      }),
  }))
}

/**
 * Liste satırı. Veli ve öğrenci satırı kartın ihtiyacı olan öğrenci satırlarını da (`students`)
 * taşır: aile ekranı her form için ayrı ayrıntı isteği atmaz.
 */
function listItem(ctx: ServiceContext, reader: Reader, summary: FormSummary) {
  const visible = new Set(summary.visibleStudents)
  const personal = personalRole(reader)
  return {
    ...formView(reader.scope.redact(FORMS, summary.record), summary.meta, ctx.now, {
      visible: (id) => visible.has(id),
      personal,
      ...(manages(reader, summary.record)
        ? { manage: { hasDecisions: summary.decisions.length > 0 } }
        : {}),
    }),
    counts: permissionCounts(summary.statuses.values()),
    ...(personal ? { students: studentEntries(ctx, reader, summary) } : {}),
  }
}

export interface PermissionFormListInput {
  page: number
  pageSize: number
  status: FormStatus | 'all'
  topic?: string | undefined
  /** Başlık araması; harf ve aksan duyarsız (`searchKey`). */
  q?: string | undefined
}

/**
 * İzin formu listesi: son güne göre yeniden eskiye, sonra kimliğe göre, sayfalı. Konu süzgeci
 * SQL'de, başlık araması (`q`) ve durum (`open`/`closed`) okunabilir satırlar üzerinde bellekte
 * ana göre. Her satır okuyanın gördüğü öğrencilerin bekleyen, onay ve ret sayılarını taşır.
 */
export async function listPermissionForms(ctx: ServiceContext, input: PermissionFormListInput) {
  const reader = await readerOf(ctx)
  const match: RecordFilter[] = []
  if (input.topic) match.push({ kind: 'equals', field: 'topic', values: [input.topic] })
  const rows = await loadRecords(ctx.db, ctx.institutionId, [FORMS], { match })
  const needle = input.q === undefined ? null : searchKey(input.q.trim())
  const visible = rows
    .filter((row) => formReadable(reader, row.data))
    .filter((row) => needle === null || searchKey(text(row.data.title) ?? '').includes(needle))
    .filter((row) => {
      if (input.status === 'all') return true
      const open = accepting(row.data, ctx.now)
      return input.status === 'open' ? open : !open
    })
    .sort(
      (a, b) => deadlineOf(b.data).localeCompare(deadlineOf(a.data)) || a.id.localeCompare(b.id),
    )
  const start = (input.page - 1) * input.pageSize
  const summaries = await summarize(ctx, reader, visible.slice(start, start + input.pageSize))
  return {
    items: summaries.map((summary) => listItem(ctx, reader, summary)),
    total: visible.length,
  }
}

/**
 * Tek form ve okuyanın gördüğü öğrencilerin durumları ile görebildiği kararlar (core kapsamı:
 * veli yalnız kendi kararını, derse giren öğretmen hiçbirini görmez; DOM-ILT-037). Olmayan,
 * başka kurumun ya da görmediği form 404.
 */
export async function getPermissionForm(ctx: ServiceContext, formId: string) {
  const reader = await readerOf(ctx)
  const row = await findRecord(ctx.db, ctx.institutionId, FORMS, formId)
  if (!row || !formReadable(reader, row.data)) throw new NotFoundError()
  const [summary] = await summarize(ctx, reader, [row])
  if (!summary) throw new NotFoundError()
  return {
    ...listItem(ctx, reader, summary),
    students: studentEntries(ctx, reader, summary),
  }
}

// --- Yazma -----------------------------------------------------------------------------------

type PermissionAction =
  | 'permissionForm.create'
  | 'permissionForm.update'
  | 'permissionForm.close'
  | 'permissionForm.cancel'
  | 'permissionForm.archive'
  | 'permissionForm.decide'

type Outcome =
  | {
      collection: 'permissionForms'
      record: RecordData & { id: string }
      statusCode: 200 | 201
      /** Bildirim gidecek öğrenciler (açılış ya da hedefe yeni giren). */
      notifyStudentIds: readonly string[]
      /**
       * İzni düşüren değişiklik (DOM-ILT-032): kararı düşenlere yeniden izin bildirimi gider.
       * `decisions` değişiklikten önceki sürümün karar satırlarıdır (satırlar silinmez).
       */
      dropped?: { revision: number; decisions: readonly PermissionDecisionRecord[] }
      /** İptal (DOM-ILT-032): izin vermiş ve bekleyen öğrencilere iptal bildirimi gider. */
      cancelled?: { decisions: readonly PermissionDecisionRecord[] }
      /** Formda karar satırı var mı (yanıttaki `hasDecisions`). */
      hasDecisions: boolean
    }
  | {
      collection: 'permissionDecisions'
      record: RecordData & { id: string }
      statusCode: 200 | 201
      studentStatus: PermissionStatus
    }

interface Prepared {
  learner?: LearnerAgeFacts
  guardianUserIds?: ReadonlySet<string>
}

interface PermissionRun {
  action: PermissionAction
  loadScope: Partial<Record<CollectionName, LoadScope>>
  expected: ExpectedVersion | null
  /**
   * Kurum kilidinden sonra, core işleminden önce okunanlar (karar): öğrencinin yaş bilgileri ve
   * bugün velayetli velilerinin kullanıcı kimlikleri.
   */
  prepare?: (tx: Database) => Promise<Prepared>
  run: (
    state: State,
    by: Participant,
    tools: OperationTools,
    options: { institutionType: InstitutionType } & Prepared,
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
  // Yazan yönetici ya da formun öğretmenidir (core yetkisi): yanıt yöneten görünümüdür.
  if (result.collection === 'permissionForms')
    return {
      statusCode: result.statusCode,
      body: {
        data: formView(result.record, meta, ctx.now, {
          manage: { hasDecisions: result.hasDecisions },
        }),
      },
    }
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
 * Etkinlik değişikliği ve iptal bildirimleri (DOM-ILT-032), yazmayla aynı transaction'da. Durum
 * bugün velayetli ve kısıtsız veliler üzerinden hesaplanır (`decidersOf`, DOM-ILT-037): velayeti
 * kalkan velinin kararı sayılmadığı için o öğrenci "kararı düştü" sayılmaz. Düşen karar:
 * onay ya da ret vermiş öğrenciye `permission_form_reconsent`; iptal: izin vermiş ve bekleyen
 * öğrenciye `permission_form_cancelled`, reddedene gitmez. Bildirim kitlesi (veli ya da
 * kursiyer) kararı veren taraftan gelir; yalnız form kimliği taşınır (DOM-ILT-023). `dedupeKey`
 * sürüm ya da iptale bağlıdır: aynı olay aynı alıcıya ikinci kez yazılmaz.
 */
async function notifyChange(
  tx: Database,
  ctx: ServiceContext,
  institutionType: InstitutionType,
  outcome: Extract<Outcome, { collection: 'permissionForms' }>,
): Promise<void> {
  const { dropped, cancelled } = outcome
  if (!dropped && !cancelled) return
  const formId = outcome.record.id
  const studentIds = texts(outcome.record.studentIds)
  const deciders = await decidersOf(tx, ctx.institutionId, institutionType, studentIds, ctx.now)
  const minor = new Map(
    [...deciders].map(([id, entry]) => [id, entry.decider === 'guardians'] as const),
  )
  const statuses = (decisions: readonly PermissionDecisionRecord[], revision: number) =>
    new Map(
      studentIds.map((studentId) => [
        studentId,
        permissionStatus(
          currentDecisions(
            { detailsRevision: revision },
            decisions.filter((d) => d.studentId === studentId),
          ),
          deciders.get(studentId) ?? NOBODY,
        ),
      ]),
    )
  if (dropped) {
    const recipients = permissionReaskStudents(statuses(dropped.decisions, dropped.revision))
    if (recipients.length > 0)
      await notify(tx, ctx, {
        type: 'permission_form_reconsent',
        recipients: { studentIds: recipients, minor },
        data: { formId },
        dedupeKey: `${formId}:rev${dropped.revision + 1}`,
      })
  }
  if (cancelled) {
    const recipients = permissionCancelStudents(
      statuses(cancelled.decisions, revisionOf(outcome.record)),
    )
    if (recipients.length > 0)
      await notify(tx, ctx, {
        type: 'permission_form_cancelled',
        recipients: { studentIds: recipients, minor },
        data: { formId },
        dedupeKey: `${formId}:cancelled`,
      })
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
  let institutionType: InstitutionType = 'school'
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
        const env = await environment(tx, ctx, spec)
        const { actor, scalars } = env
        institutionType = env.institutionType
        const by: Participant = { ...actor, userId: ctx.actor.userId }
        const extra = command.prepare ? await command.prepare(tx) : {}
        return {
          scalars,
          run: (state, tools) => command.run(state, by, tools, { institutionType, ...extra }),
        }
      },
      after: async (tx, outcome) => {
        if (outcome.collection !== 'permissionForms') return
        await notifyChange(tx, ctx, institutionType, outcome)
        if (outcome.notifyStudentIds.length === 0) return
        // Kitle kararı verenle aynı kaynaktan (`permissionDecider`): 18 yaş altında veliye,
        // kendisi karar veren öğrenciye; yetişkin öğrencinin formu veliye bildirilmez. İletişim
        // modülü kapalıysa `notify` yazmadan döner (DOM-YTK-040). Aynı form aynı öğrenciye ikinci
        // kez bildirilmez (`dedupeKey`): hedeften çıkıp geri giren öğrenci.
        const deciders = await decidersFor(
          tx,
          ctx.institutionId,
          institutionType,
          outcome.notifyStudentIds,
          ctx.now,
        )
        await notify(tx, ctx, {
          type: 'permission_form_opened',
          recipients: {
            studentIds: outcome.notifyStudentIds,
            minor: new Map([...deciders].map(([id, decider]) => [id, decider === 'guardians'])),
          },
          data: { formId: outcome.record.id },
          dedupeKey: outcome.record.id,
        })
      },
    },
    (outcome) => respond(ctx, outcome, command.expected?.version ?? 1),
    idempotency,
  )
}

/**
 * Form yazma sonucu. `hasDecisions` State'teki karar satırlarındandır: açarken karar yoktur,
 * diğer işlemler formun kararlarını yükler (`decisionsOfForm`).
 */
const formOutcome = (
  state: State,
  form: { id: string },
  statusCode: 200 | 201,
  notifyStudentIds: readonly string[] = [],
  extra: Pick<Extract<Outcome, { collection: 'permissionForms' }>, 'dropped' | 'cancelled'> = {},
): Outcome => ({
  collection: 'permissionForms',
  record: stored(form),
  statusCode,
  notifyStudentIds,
  hasDecisions: state.permissionDecisions.some((decision) => decision.formId === form.id),
  ...extra,
})

const decisionsInState = (state: State, formId: string) =>
  state.permissionDecisions.filter((decision) => decision.formId === formId)

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
      loadScope: {
        renewals: GRADUATION_RENEWALS,
        permissionForms: NONE,
        permissionDecisions: NONE,
      },
      expected: null,
      run: (state, by, { now, makeId }, { institutionType }) => {
        const form = createPermissionForm(state, by, input, makeId, now, { institutionType })
        return formOutcome(state, form, 201, form.studentIds)
      },
    },
    idempotency,
  )
}

/**
 * İzin formunu düzenler (core `updatePermissionForm`, DOM-ILT-038); hedefe yeni giren öğrencilere
 * bildirim. Etkinlik ayrıntısı (gün, saat, yer, ulaşım, ücret) değişirse alınmış kararlar düşer ve
 * kararı düşen öğrencilere aynı işlemde `permission_form_reconsent` yazılır (DOM-ILT-032). Kararı
 * olan formun daraltılması kararlara bakar: formun kararları yüklenir.
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
        renewals: GRADUATION_RENEWALS,
        permissionForms: { ids: [target.formId] },
        permissionDecisions: decisionsOfForm(target.formId),
      },
      expected: expectedForm(target),
      run: (state, by, { now }, { institutionType }) => {
        const { form, addedStudentIds, droppedFields, previousRevision } = updatePermissionForm(
          state,
          by,
          target.formId,
          input,
          now,
          { institutionType },
        )
        return formOutcome(
          state,
          form,
          200,
          addedStudentIds,
          droppedFields.length > 0
            ? {
                dropped: {
                  revision: previousRevision,
                  decisions: decisionsInState(state, form.id),
                },
              }
            : {},
        )
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
      // Kararlar yalnız yanıttaki `hasDecisions` için okunur; kapatma kararlara bakmaz.
      loadScope: {
        permissionForms: { ids: [target.formId] },
        permissionDecisions: decisionsOfForm(target.formId),
      },
      expected: expectedForm(target),
      run: (state, by, { now }, { institutionType }) =>
        formOutcome(
          state,
          closePermissionForm(state, by, target.formId, now, { institutionType }),
          200,
        ),
    },
    idempotency,
  )
}

/**
 * Etkinliği iptal eder (core `cancelPermissionForm`, DOM-ILT-032): form kapanır, kararlar
 * korunur; izin vermiş ve bekleyen öğrencilere aynı işlemde `permission_form_cancelled` yazılır.
 */
export function cancelPermissionFormCommand(
  ctx: ServiceContext,
  target: PermissionFormTarget,
  idempotency: IdempotencyRequest | null,
) {
  return execute(
    ctx,
    {
      action: 'permissionForm.cancel',
      // Kararlar iptal bildiriminin kitlesi (izin vermiş ve bekleyen) için okunur.
      loadScope: {
        permissionForms: { ids: [target.formId] },
        permissionDecisions: decisionsOfForm(target.formId),
      },
      expected: expectedForm(target),
      run: (state, by, { now }, { institutionType }) => {
        const form = cancelPermissionForm(state, by, target.formId, now, { institutionType })
        return formOutcome(state, form, 200, [], {
          cancelled: { decisions: decisionsInState(state, form.id) },
        })
      },
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
        formOutcome(
          state,
          archivePermissionForm(state, by, target.formId, { institutionType }),
          200,
        ),
    },
    idempotency,
  )
}

/**
 * Veli ya da 18 yaşını doldurmuş öğrenci kararı (core `decidePermission`, DOM-ILT-030, -031,
 * -037): yeni karar 201, son kararla aynı karar ve not 200 (yeni satır yok). Karar veren taraf
 * `permissionDecider`'dandır (kimlik satırının doğum tarihi, ADR 0006 karar 9; dil okulunda
 * adayın 18 yaş seçimi); yanıttaki durum bugün velayetli velilerin kararlarından hesaplanır.
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
        const { studentId } = parsed.data
        const facts = await learnerFactsOf(tx, ctx.institutionId, [studentId])
        const guardians = await custodialUserIds(tx, ctx.institutionId, [studentId])
        return {
          learner: facts.get(studentId) ?? {},
          guardianUserIds: guardians.get(studentId) ?? new Set<string>(),
        }
      },
      run: (state, by, { now, makeId }, { institutionType, learner, guardianUserIds }) => {
        const outcome = decidePermission(state, by, formId, input, makeId, now, {
          institutionType,
          learner: learner ?? {},
        })
        const { studentId, relation } = outcome.decision
        const form = state.permissionForms.find((item) => item.id === formId)
        const studentStatus = permissionStatus(
          currentDecisions(
            { detailsRevision: form?.detailsRevision },
            state.permissionDecisions.filter(
              (d) => d.formId === formId && d.studentId === studentId,
            ),
          ),
          {
            decider: relation === 'self' ? 'self' : 'guardians',
            guardianUserIds: guardianUserIds ?? new Set<string>(),
          },
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

// --- Zamanlanmış hatırlatma ------------------------------------------------------------------

export interface PermissionReminderResult {
  /** Bugün hatırlatma günü olan açık form sayısı (kararlara bakmadan). */
  forms: number
  /** Kararı beklenen öğrencisi olan, hatırlatılan form sayısı. */
  reminded: number
  created: number
  deduplicated: number
  skipped: 'module_disabled' | 'institution_missing' | null
}

/**
 * İzin formu hatırlatması (DOM-ILT-039; `permission-forms.remind` işi, her sabah 08:00
 * Europe/Istanbul, kurum başına). Takvim ve kimin bekleneceği core `permissionReminders`'tadır:
 * açık formda son güne iki gün kala ve son gün, kararı beklenen (`pending`) öğrenci için kararı
 * veren tarafa (`permissionDecider`: 18 yaş altında veliler, yetişkinde kendisi) bir
 * `permission_form_reminder` bildirimi yazılır. Karar verenler ve durum okumalarla aynı
 * kaynaktandır (`decidersOf`: kimlik satırı, aday seçimi, bugün velayetli ve kısıtsız veliler).
 *
 * Önce kararlara bakmadan bugün hatırlatma günü olan formlar bulunur (core takvimiyle); yalnız
 * onların kararları ve öğrencileri yüklenir. Bildirim `dedupeKey` (form + son gün + kalan gün)
 * ile yazılır: iş aynı gün yeniden çalışsa da ikinci bildirim çıkmaz. İletişim modülü kapalıysa
 * hiçbir şey okunmaz ve yazılmaz (DOM-YTK-040). Tek transaction ve kurum kilidi altında çalışır;
 * aktörsüzdür (denetim satırında aktör yok). Yalnız sayılar döner; öğrenci kimliği loglanmaz.
 */
export async function sendPermissionReminders(input: {
  db: Database
  institutionId: string
  now: Date
  log: FastifyBaseLogger
}): Promise<PermissionReminderResult> {
  const { institutionId, now, log } = input
  const result: PermissionReminderResult = {
    forms: 0,
    reminded: 0,
    created: 0,
    deduplicated: 0,
    skipped: null,
  }
  return input.db.transaction(async (tx) => {
    await lockInstitution(tx, institutionId)
    const institution = await getInstitutionModules(tx, institutionId)
    if (institution === null) return { ...result, skipped: 'institution_missing' }
    if (!notificationEnabled('permission_form_reminder', institution.modules))
      return { ...result, skipped: 'module_disabled' }

    const at = now.toISOString()
    const forms = (await loadRecords(tx, institutionId, [FORMS])).map((row) => ({
      id: row.id,
      deadline: deadlineOf(row.data),
      status: storedStatus(row.data),
      studentIds: texts(row.data.studentIds),
      detailsRevision: revisionOf(row.data),
    }))
    const due = permissionReminders({ forms, decisions: [], deciders: () => NOBODY, now: at })
    result.forms = due.length
    if (due.length === 0) return result

    const dueIds = due.map((item) => item.formId)
    const decisions = (
      await loadRecords(tx, institutionId, [DECISIONS], {
        match: [{ kind: 'equals', field: 'formId', values: dueIds }],
      })
    ).map((row) => ({
      formId: text(row.data.formId) ?? '',
      studentId: text(row.data.studentId) ?? '',
      ...factsOf(row.data),
    }))
    const deciders = await decidersOf(
      tx,
      institutionId,
      institution.type,
      [...new Set(due.flatMap((item) => item.studentIds))],
      now,
    )
    const reminders = permissionReminders({
      forms: forms.filter((form) => dueIds.includes(form.id)),
      decisions,
      deciders: (studentId) => deciders.get(studentId) ?? NOBODY,
      now: at,
    })
    const ctx = { institutionId, now, log, actor: null }
    for (const reminder of reminders) {
      const sent = await notify(tx, ctx, {
        type: 'permission_form_reminder',
        recipients: {
          studentIds: reminder.studentIds,
          minor: new Map(
            reminder.studentIds.map((id) => [id, deciders.get(id)?.decider !== 'self']),
          ),
        },
        data: { formId: reminder.formId },
        dedupeKey: reminder.dedupeKey,
      })
      result.reminded += 1
      result.created += sent.created.length
      result.deduplicated += sent.deduplicated
    }
    return result
  })
}
