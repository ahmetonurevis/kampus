import { randomUUID } from 'node:crypto'

import { isAssignable, canReadVersion } from '@kampus/school-core/content/visibility.ts'
import type { AuthorizationSource } from '@kampus/school-core/lib/authorize.ts'
import { SCOPE_SOURCE_COLLECTIONS, type Actor } from '@kampus/school-core/lib/scope.ts'
import {
  planAssignment,
  planAssignmentChange,
  type AssignmentInput,
  type AssignmentPlan,
  type ExistingAssignment,
} from '@kampus/school-core/skills/assignment.ts'

import type { Database } from '../db/client.ts'
import { asCoreVersion, findResource, listResourceVersions } from '../db/resources.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import {
  assignmentContentRefs,
  findAssignment,
  findRubricVersion,
  insertAssignment,
  listAssignments,
  loadResourceAssignments,
  resourceIdOfVersion,
  updateAssignmentDeadline,
  type AssignmentContentRef,
  type AssignmentListQuery,
  type StoredAssignment,
} from '../db/skills.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RuleViolationError,
} from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { listMembershipLinks } from './memberships.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'
import { contentReader } from './resources.ts'

/**
 * Görev atama uçlarının servisi (ADR 0004 karar 4; docs/domain/beceri-gelisimi.md DOM-BEC-041,
 * 042, 044; kaynak-platformu.md DOM-KYN-032; IST-034). Kural core `skills/assignment.ts`'tedir:
 * ayarların içerikle birleşip sabitlenmesi (`resolveAssignmentSettings`), hedef kapsamı
 * (`resolveTargets`: öğretmen yalnız ders verdiği sınıfa ve derse, yönetici kurumda), aynı içeriğin
 * açık atamalarıyla çakışma (`assertNoOverlappingAssignment`) ve sonradan yalnız son teslimin
 * uzaması (`planAssignmentChange`). Burada yükleme, sıra, geçici API sınırları ve yazma vardır.
 *
 * Sıra (api-tasarimi.md §6): kapsam → yetki → sürüm. Oluşturmada atayanın göremediği veya olmayan
 * içerik sürümü 404; görünür içerikte kapsam dışı hedef 403 (core `target_scope_denied`); yayında
 * olmayan veya güncel olmayan sürüm 409 (core `resource_version_not_assignable`), taslak veya
 * arşivli rubrik sürümü 409 (core `rubric_version_not_assignable`). Değişiklikte görünmeyen atama
 * 404, görünür ama atayan olmayan öğretmen 403, sürüm 409.
 *
 * Okuma kapsamı (yetki-ve-kapsam.md DOM-YTK-028): yönetici kurumun bütün atamalarını; öğretmen
 * kendi atamalarını, kapsamındaki (ders verdiği veya rehberi olduğu) sınıfı/grubu hedefleyenleri
 * ve o sınıfların güncel öğrencilerine hedeflenenleri (F4b3'te teslimi sınıfın öğretmeni puanlar);
 * öğrenci kendisine (öğrenci hedefi veya güncel sınıfı/grubu) hedeflenenleri, veli çocuklarına
 * hedeflenenleri görür.
 * Öğretmen kapsamı `readScope` (`scope.classIds`, `scope.studentIds`; DOM-YTK-022) ile gelir.
 * Atayan olmayan öğretmen hedef listesinde yalnız kendi kapsamındaki hedefleri görür. Değiştirme
 * yalnız atayan ve yöneticidedir: görünür ama atayan olmayan öğretmen 403 alır.
 * Öğrenci ve veli görünümünde hedef listesi, puanlama ve rubrik sürümü, ikinci puanlama oranı,
 * atayan ve satır sürümü yoktur; cevap anahtarı hiçbir atama yanıtında yoktur (DOM-BEC-045).
 *
 * Log ve denetim: içerik başlığı, öğrenci kimliği ve hedef listesi loglanmaz; denetim kaydına
 * yalnız alan adları yazılır (`task_assignment.create`, `task_assignment.update`).
 */

// TODO(F4b-rescore): `POST /task-assignments/:id/rescore` açılmadı. Core önizlemesi
// (`previewRescore`/`planRescore`) hazır, ama (1) yeni sürümün sorularını eski cevaplardaki soru
// sürümlerine eşleme kuralı tanımsız (core bunu servise bırakıyor), (2) deneme uçları (F4b3) yok,
// (3) kursiyer ve veliye bildirim (DOM-KYN-033) altyapısı yok. Deneme uçlarıyla birlikte açılır.
// TODO(F4b-atama-arsiv): Atama arşivi veya iptali için core planı yok; açık teslim ve denemeler
// varken ne olacağı domain'de tanımlı değil. Core kuralı gelince `DELETE /task-assignments/:id`.

/** Atamanın sınıf/grup hedefi `classes` kaydıdır (core `TARGET_KINDS`). */
const CLASS_TARGETS = new Set(['class', 'group'])

// --- Okuyucu ------------------------------------------------------------------------------

// TODO(core-atama-yetki): Okuma kapsamı (`visible`, `listFilter`) ve "atayan veya yönetici
// değiştirir" kuralı burada; core'da `canReadAssignment`/`canManageAssignment` yok. Web ve mobil
// aynı kuralı çalıştırsın diye core'a taşınır (semver + CHANGELOG); bu görevin kapsamı dışında.

type Viewer =
  | { kind: 'admin' }
  | {
      kind: 'teacher'
      userId: string
      /** Öğretmen kapsamı (`readScope`): ders verdiği sınıflar ve onların güncel öğrencileri. */
      classIds: ReadonlySet<string>
      studentIds: ReadonlySet<string>
    }
  | {
      kind: 'learner'
      /** Kapsamdaki öğrenci → güncel sınıf/grup (öğrencide kendisi, velide çocukları). */
      classOf: ReadonlyMap<string, string>
    }

async function viewerOf(ctx: ServiceContext): Promise<Viewer> {
  const { role, userId } = ctx.actor
  switch (role) {
    case 'yonetici':
      return { kind: 'admin' }
    case 'ogretmen': {
      const scope = await readScope(ctx)
      return { kind: 'teacher', userId, classIds: scope.classIds, studentIds: scope.studentIds }
    }
    case 'ogrenci':
    case 'veli': {
      const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
      return {
        kind: 'learner',
        classOf: new Map(
          source.students
            .filter((student) => scope.studentIds.has(student.id))
            .map((student) => [student.id, student.classId]),
        ),
      }
    }
    case 'onburo':
      throw new ForbiddenError()
    default:
      return role satisfies never
  }
}

/**
 * Atamanın kapsamdaki kursiyerleri (öğrenci hedefi veya güncel sınıfı/grubu hedefte). Sınıf/şube
 * hedefli atama o sınıfın güncel öğrencilerine görünür: sınıf değiştiren öğrenci yeni sınıfının
 * atamalarını görür, eski sınıfınınkini görmez (ADR 0004 karar 4 uygulama notu, F4b2b).
 */
// TODO(F4b3-sinif-degisimi): Eski sınıfta teslim etmiş öğrenci kendi teslimini ve puanını F4b3
// deneme/teslim uçlarında görür; atama görünürlüğü hedefin güncel sınıfla eşleşmesi olarak kalır.
function targetedLearners(classOf: ReadonlyMap<string, string>, assignment: StoredAssignment) {
  const students = new Set(assignment.targets.filter((t) => t.kind === 'student').map((t) => t.id))
  const classes = new Set(
    assignment.targets.filter((t) => CLASS_TARGETS.has(t.kind)).map((t) => t.id),
  )
  return [...classOf]
    .filter(([studentId, classId]) => students.has(studentId) || classes.has(classId))
    .map(([studentId]) => studentId)
    .sort()
}

/** Hedef öğretmenin kapsamında mı: sınıf/grup hedefi kapsamdaki sınıf, öğrenci hedefi öğrencisi. */
function teacherReaches(
  viewer: Extract<Viewer, { kind: 'teacher' }>,
  target: StoredAssignment['targets'][number],
): boolean {
  return CLASS_TARGETS.has(target.kind)
    ? viewer.classIds.has(target.id)
    : viewer.studentIds.has(target.id)
}

function visible(viewer: Viewer, assignment: StoredAssignment): boolean {
  switch (viewer.kind) {
    case 'admin':
      return true
    case 'teacher':
      return (
        assignment.assignedByUserId === viewer.userId ||
        assignment.targets.some((target) => teacherReaches(viewer, target))
      )
    case 'learner':
      return (
        assignment.archivedAt === null && targetedLearners(viewer.classOf, assignment).length > 0
      )
    default:
      return viewer satisfies never
  }
}

function listFilter(
  viewer: Viewer,
): Pick<AssignmentListQuery, 'assignedByUserId' | 'learnerTargets'> {
  switch (viewer.kind) {
    case 'admin':
      return {}
    case 'teacher':
      // Depo iki koşulu "veya" ile birleştirir: kendi ataması veya kapsamdaki hedef.
      return {
        assignedByUserId: viewer.userId,
        learnerTargets: { studentIds: [...viewer.studentIds], classIds: [...viewer.classIds] },
      }
    case 'learner':
      return {
        learnerTargets: {
          studentIds: [...viewer.classOf.keys()],
          classIds: [...new Set(viewer.classOf.values())],
        },
      }
    default:
      return viewer satisfies never
  }
}

// --- Yanıt biçimleri ----------------------------------------------------------------------

const UNKNOWN_CONTENT: AssignmentContentRef = { title: '', contentType: 'text' }

/** Kursiyerin ve personelin ortak alanları: görevin ayarları ve atanan içerik. */
function sharedView(assignment: StoredAssignment, content: AssignmentContentRef) {
  return {
    id: assignment.id,
    resourceId: assignment.resourceId,
    resourceVersionId: assignment.resourceVersionId,
    title: content.title,
    contentType: content.contentType,
    scoringMode: assignment.scoringMode,
    kind: assignment.kind,
    attempts: assignment.attempts,
    deadline: assignment.deadline,
    timeLimitMinutes: assignment.timeLimitMinutes,
    listeningPlays: assignment.listeningPlays,
    showTranscript: assignment.showTranscript,
    submission: assignment.submission,
    createdAt: assignment.createdAt,
  }
}

function staffView(assignment: StoredAssignment, content: AssignmentContentRef) {
  return {
    view: 'staff' as const,
    ...sharedView(assignment, content),
    scoringVersionId: assignment.scoringVersionId,
    rubricVersionId: assignment.rubricVersionId,
    highStakes: assignment.highStakes,
    secondRatingPercent: assignment.secondRatingPercent,
    assignedByUserId: assignment.assignedByUserId,
    targets: assignment.targets,
    updatedAt: assignment.updatedAt,
    archivedAt: assignment.archivedAt,
    rowVersion: assignment.rowVersion,
  }
}

function viewOf(viewer: Viewer, assignment: StoredAssignment, content: AssignmentContentRef) {
  if (viewer.kind === 'admin') return staffView(assignment, content)
  if (viewer.kind === 'teacher') {
    if (assignment.assignedByUserId === viewer.userId) return staffView(assignment, content)
    // Atayan olmayan öğretmen kapsamı dışındaki sınıf ve öğrenci kimliklerini görmez (DOM-YTK-022).
    const targets = assignment.targets.filter((target) => teacherReaches(viewer, target))
    return staffView({ ...assignment, targets }, content)
  }
  return {
    view: 'learner' as const,
    ...sharedView(assignment, content),
    learnerIds: targetedLearners(viewer.classOf, assignment),
  }
}

// --- Okuma --------------------------------------------------------------------------------

export type TaskAssignmentListInput = Omit<
  AssignmentListQuery,
  'assignedByUserId' | 'learnerTargets'
>

/** Rol kapsamlı, sayfalı atama listesi (IST-034). */
export async function listTaskAssignments(ctx: ServiceContext, input: TaskAssignmentListInput) {
  const viewer = await viewerOf(ctx)
  const { rows, total } = await listAssignments(ctx.db, ctx.institutionId, {
    ...input,
    ...listFilter(viewer),
  })
  // SQL yalnız adayları daraltır; satır yine kapsam kuralıyla doğrulanır.
  const shown = rows.filter((row) => visible(viewer, row))
  if (shown.length !== rows.length)
    ctx.log.warn({
      event: 'task_assignment.visibility_mismatch',
      dropped: rows.length - shown.length,
    })
  const refs = await assignmentContentRefs(
    ctx.db,
    ctx.institutionId,
    shown.map((row) => row.resourceVersionId),
  )
  return {
    total,
    items: shown.map((row) =>
      viewOf(viewer, row, refs.get(row.resourceVersionId) ?? UNKNOWN_CONTENT),
    ),
  }
}

/** Tek atama; kapsam dışı, olmayan veya başka kurumun ataması 404 (varlığı sızmaz). */
export async function getTaskAssignment(ctx: ServiceContext, assignmentId: string) {
  const viewer = await viewerOf(ctx)
  const assignment = await findAssignment(ctx.db, ctx.institutionId, assignmentId)
  if (!assignment || !visible(viewer, assignment)) throw new NotFoundError()
  const refs = await assignmentContentRefs(ctx.db, ctx.institutionId, [
    assignment.resourceVersionId,
  ])
  return viewOf(viewer, assignment, refs.get(assignment.resourceVersionId) ?? UNKNOWN_CONTENT)
}

// --- Yazma --------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function readBack(tx: Database, ctx: ServiceContext, assignmentId: string) {
  const assignment = await findAssignment(tx, ctx.institutionId, assignmentId)
  if (!assignment) throw new Error('task assignment disappeared after write')
  const refs = await assignmentContentRefs(tx, ctx.institutionId, [assignment.resourceVersionId])
  return staffView(assignment, refs.get(assignment.resourceVersionId) ?? UNKNOWN_CONTENT)
}

async function audit(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  assignmentId: string,
  fields: string[],
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: 'task_assignment',
    entityId: assignmentId,
    changes: { fields },
    createdAt: ctx.now,
  })
}

/**
 * Geçici API sınırları (ADR 0004 karar 6 uygulama notu, F4b2): dosyalı ve sesli teslim `files`
 * gelene kadar saklanamaz; dinleme hakkı `attempt_media_plays` gelene kadar sayılamaz. Aksi hâlde
 * kursiyer teslim edemeyeceği veya hakkı denetlenmeyen görev alır. Dinleme görevi yine atanır:
 * gövde şeması gönderilmeyen hakkı sınırsız (`null`) yapar; yalnız açıkça seçilen 1 veya 2 reddedilir.
 */
function assertSupportedByApi(plan: AssignmentPlan): void {
  const kind = plan.assignment.submission?.submissionKind
  // TODO(F3c2-files): `files` gelince dosyalı ve sesli teslim açılır.
  if (kind === 'file' || kind === 'audio')
    throw new RuleViolationError(
      'submission_kind_unavailable',
      'Dosyalı ve sesli teslim henüz açık değil; metin teslimi seçin.',
      {
        issues: [
          {
            path: ['settings', 'submission', 'submissionKind'],
            code: 'submission_kind_unavailable',
            message: 'Dosyalı ve sesli teslim henüz açık değil; metin teslimi seçin.',
          },
        ],
      },
    )
  // TODO(F3c2-files): `attempt_media_plays` gelince dinleme hakkı sayılır ve bu sınır kalkar.
  if (plan.assignment.listeningPlays !== null)
    throw new RuleViolationError(
      'listening_plays_unavailable',
      'Dinleme hakkı sınırı henüz uygulanamıyor; dinleme hakkını boş bırakın, görev sınırsız dinlemeyle atanır.',
      {
        issues: [
          {
            path: ['settings', 'listeningPlays'],
            code: 'listening_plays_unavailable',
            message:
              'Dinleme hakkı sınırı henüz uygulanamıyor; dinleme hakkını boş bırakın, görev sınırsız dinlemeyle atanır.',
          },
        ],
      },
    )
}

/**
 * Yeni atama (ADR 0004 karar 4; DOM-KYN-032, DOM-BEC-041, 042; IST-034): içerik sürümü, ayarlar ve
 * rubrik sürümü sabitlenir; `scoringVersionId` başta içerik sürümüdür. Hedefler ve kursiyer
 * listesi kurum kilidinden sonra aynı transaction'da yüklenen kapsam kaynağıyla çözülür.
 */
export async function createTaskAssignment(
  ctx: ServiceContext,
  input: AssignmentInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  // Kişinin içerik görünümü transaction'dan önce: PGlite tek bağlantılıdır (resource-commands.ts).
  const reader = await contentReader(ctx)
  if (reader.viewer.kind !== 'staff') throw new ForbiddenError()
  const viewer = reader.viewer
  const assignmentId = randomUUID()
  const out: { body?: unknown } = {}
  return runCommand<AssignmentPlan>(
    ctx,
    {
      action: 'task_assignment.create',
      // Hedef kapsamı core `resolveTargets`'in kaynağıdır; kurum kilidinden sonra okunur.
      collections: SCOPE_SOURCE_COLLECTIONS,
      entity: { type: 'task_assignment', id: assignmentId },
      load: async (tx) => {
        const institution = await getInstitutionModules(tx, ctx.institutionId)
        if (!institution) throw new Error('institution disappeared during assignment command')
        const links = await listMembershipLinks(tx, ctx.institutionId, ctx.actor.membershipId)
        const resourceId = await resourceIdOfVersion(tx, ctx.institutionId, input.resourceVersionId)
        const resource =
          resourceId === null ? null : await findResource(tx, ctx.institutionId, resourceId)
        const [stored] = resource
          ? await listResourceVersions(tx, ctx.institutionId, resource.id, [
              input.resourceVersionId,
            ])
          : []
        const version = stored ? asCoreVersion(stored) : null
        // Kapsam: atayanın göremediği içerik yok sayılır (404, varlığı sızmaz).
        if (
          !resource ||
          !version ||
          !canReadVersion(viewer, {
            institutionType: institution.type,
            resource,
            version,
            now: ctx.now,
          })
        )
          throw new NotFoundError()
        const rubricVersionId = input.settings?.rubricVersionId ?? null
        const rubricVersion =
          rubricVersionId !== null && UUID.test(rubricVersionId)
            ? await findRubricVersion(tx, ctx.institutionId, rubricVersionId)
            : null
        const others = await loadResourceAssignments(tx, ctx.institutionId, resource.id)
        const actor: Actor = { role: ctx.actor.role, links, userId: ctx.actor.userId }
        return {
          run: (state) => {
            const source: AuthorizationSource = {
              students: state.students,
              teachers: state.teachers,
              classes: state.classes,
              assignments: state.assignments,
              clubs: state.clubs,
              mockExams: state.mockExams,
              modules: institution.modules,
            }
            const byClass = new Map<string, string[]>()
            for (const student of source.students)
              byClass.set(student.classId, [...(byClass.get(student.classId) ?? []), student.id])
            const existing: ExistingAssignment[] = others.map((other) => ({
              id: other.id,
              resourceId: other.resourceId,
              deadline: other.deadline,
              archivedAt: other.archivedAt,
              learnerIds: other.targets.flatMap((target) =>
                target.kind === 'student' ? [target.id] : (byClass.get(target.id) ?? []),
              ),
            }))
            const plan = planAssignment({
              resource,
              version,
              actor,
              source,
              institutionType: institution.type,
              rubricVersion,
              existing,
              input,
              now: ctx.now,
            })
            // Core yayındaki güncel sürümü denetler; lisans süresi `isAssignable`'dadır (DOM-KYN-021).
            if (!isAssignable(resource, version, ctx.now))
              throw new AppError(
                409,
                'resource_version_not_assignable',
                'Lisans süresi dolmuş içerik atanamaz.',
              )
            assertSupportedByApi(plan)
            return plan
          },
        }
      },
      after: async (tx, plan) => {
        await insertAssignment(
          tx,
          ctx.institutionId,
          {
            id: assignmentId,
            assignedByUserId: ctx.actor.userId,
            assignment: plan.assignment,
            targets: plan.targets,
          },
          ctx.now,
        )
        await audit(tx, ctx, 'task_assignment.create', assignmentId, [
          'resourceVersionId',
          'scoringVersionId',
          ...(plan.assignment.rubricVersionId === null ? [] : ['rubricVersionId']),
          'settings',
          'targets',
        ])
        out.body = { data: await readBack(tx, ctx, assignmentId) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('task assignment was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
}

/**
 * Atama değişikliği (core `planAssignmentChange`; DOM-BEC-041, 042, 044): yalnız son teslim ve geç
 * kabul uzar; sabitlenen sürüm ve ayarlar 409 `assignment_setting_frozen`. Değiştiren atayan veya
 * yöneticidir (DOM-YTK-028): kapsam dışı atama 404, ders verdiği sınıfı hedeflediği için görünen
 * ama başkasının ataması 403, ardından sürüm 409. `If-Match` atamanın `rowVersion`'ıdır.
 */
export async function updateTaskAssignment(
  ctx: ServiceContext,
  input: { assignmentId: string; patch: Record<string, unknown>; expectedVersion: number },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Change = { assignment: StoredAssignment; deadline: StoredAssignment['deadline'] }
  return runCommand<Change>(
    ctx,
    {
      action: 'task_assignment.update',
      collections: [],
      entity: { type: 'task_assignment', id: input.assignmentId },
      load: async (tx) => {
        const assignment = await findAssignment(tx, ctx.institutionId, input.assignmentId)
        // Kapsam (404): olmayan, başka kurumun, görünmeyen veya arşivli atama.
        if (!assignment || assignment.archivedAt !== null || !visible(viewer, assignment))
          throw new NotFoundError()
        return {
          run: () => {
            // Yetki (403): görünür ama değiştiremeyen kişi (yalnız atayan ve yönetici).
            const manages =
              viewer.kind === 'admin' ||
              (viewer.kind === 'teacher' && assignment.assignedByUserId === viewer.userId)
            if (!manages) throw new ForbiddenError()
            // Sürüm (409).
            if (assignment.rowVersion !== input.expectedVersion) throw new ConflictError()
            const { deadline } = planAssignmentChange({ assignment, patch: input.patch })
            return { assignment, deadline }
          },
        }
      },
      after: async (tx, { assignment, deadline }) => {
        await updateAssignmentDeadline(tx, ctx.institutionId, assignment, deadline, ctx.now)
        await audit(tx, ctx, 'task_assignment.update', assignment.id, Object.keys(input.patch))
        out.body = { data: await readBack(tx, ctx, assignment.id) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('task assignment was not updated')
      return { statusCode: 200, body: out.body }
    },
    idempotency,
  )
}
