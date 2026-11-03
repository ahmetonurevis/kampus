import { randomUUID } from 'node:crypto'

import { licenseExpired } from '@kampus/school-core/content/taxonomy.ts'
import { canReadVersion, type ContentViewer } from '@kampus/school-core/content/visibility.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import type { AuthorizationSource } from '@kampus/school-core/lib/authorize.ts'
import {
  coordinatesArea,
  coordinatorScopeOf,
  type CoordinatorScope,
} from '@kampus/school-core/lib/coordinator-duties.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { SCOPE_SOURCE_COLLECTIONS, type Actor } from '@kampus/school-core/lib/scope.ts'
import type { ResourceContent } from '@kampus/school-core/content/resource.ts'
import {
  planAssignment,
  planAssignmentBatch,
  planAssignmentChange,
  recordingVersionId,
  type AssignmentBatchInput,
  type AssignmentInput,
  type AssignmentPlan,
  type ExistingAssignment,
} from '@kampus/school-core/skills/assignment.ts'
import type { RubricVersionRow } from '@kampus/school-core/skills/rubric.ts'
import { isClosed } from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import { activeDutiesOf } from '../db/coordinator-duties.ts'
import { loadFilesByIds } from '../db/files.ts'
import {
  asCoreVersion,
  findResource,
  listResourceVersions,
  loadVersionPairs,
} from '../db/resources.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import {
  assignmentContentRefs,
  findAssignment,
  findRubricVersion,
  insertAssignment,
  latestSecondRatingRequestAt,
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
 * arşivli rubrik sürümü 409 (core `rubric_version_not_assignable`). İstisna: lisansı dolmuş içerik
 * (atayan zaten görebildiği için sızıntı yoktur) core planından önce 409 `resource_license_expired`
 * alır. Olmayan hedef veya rubrik sürümü 404 `not_found` mesaj ve `issues` yoluyla döner.
 * Değişiklikte görünmeyen atama 404, görünür ama atayan olmayan öğretmen 403, sürüm 409.
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
// sürümlerine eşleme kuralı tanımsız (core bunu servise bırakıyor), (2) kursiyer ve veliye
// bildirim (DOM-KYN-033) altyapısı yok. Deneme uçları (F4b3a, `services/task-attempts.ts`) puanı
// her okumada `scoringVersionId`'den hesapladığı için yeniden puanlama yalnız bu sürümü değiştirir.
// TODO(F4b-atama-arsiv): Atama arşivi veya iptali için core planı yok; açık teslim ve denemeler
// varken ne olacağı domain'de tanımlı değil. Core kuralı gelince `DELETE /task-assignments/:id`.

/** Atamanın sınıf/grup hedefi `classes` kaydıdır (core `TARGET_KINDS`). */
const CLASS_TARGETS = new Set(['class', 'group'])

// --- Okuyucu ------------------------------------------------------------------------------

// TODO(core-atama-yetki): Okuma kapsamı (`visible`, `listFilter`) ve "atayan veya yönetici
// değiştirir" kuralı burada; core'da `canReadAssignment`/`canManageAssignment` yok. Web ve mobil
// aynı kuralı çalıştırsın diye core'a taşınır (semver + CHANGELOG); bu görevin kapsamı dışında.

export type Viewer =
  | { kind: 'admin' }
  | {
      kind: 'teacher'
      userId: string
      /** Öğretmen kapsamı (`readScope`): ders verdiği sınıflar ve onların güncel öğrencileri. */
      classIds: ReadonlySet<string>
      studentIds: ReadonlySet<string>
      /**
       * Zümre başkanı/akademik koordinatör kapsamı (DOM-YTK-027); görevi yoksa boş. Atama
       * görünürlüğünü genişletmez: yalnız uyuşmazlıklı teslimlerin okunması ve son puan içindir.
       */
      coordination: CoordinatorScope
    }
  | {
      kind: 'learner'
      /** Okuma ikisinde aynıdır; deneme ve teslim yazması yalnız `ogrenci`'dedir. */
      role: 'ogrenci' | 'veli'
      /** Kapsamdaki öğrenci → güncel sınıf/grup (öğrencide kendisi, velide çocukları). */
      classOf: ReadonlyMap<string, string>
    }

export async function viewerOf(ctx: ServiceContext): Promise<Viewer> {
  const { role, userId } = ctx.actor
  switch (role) {
    case 'yonetici':
      return { kind: 'admin' }
    case 'ogretmen': {
      const [scope, duties] = await Promise.all([
        readScope(ctx),
        activeDutiesOf(ctx.db, ctx.institutionId, ctx.actor.membershipId),
      ])
      return {
        kind: 'teacher',
        userId,
        classIds: scope.classIds,
        studentIds: scope.studentIds,
        coordination: coordinatorScopeOf(duties),
      }
    }
    case 'ogrenci':
    case 'veli': {
      const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
      return {
        kind: 'learner',
        role,
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
 * atamalarını görür, eski sınıfınınkini görmez (ADR 0004 karar 4 uygulama notu, F4b2b). Eski
 * sınıfta yaptığı denemeyi, teslimi ve puanı görmeye devam eder: deneme ve teslim okuması hedefe
 * değil kayıt sahipliğine bakar; personel atamayı görüyorsa atamanın bütün deneme ve teslimlerini
 * görür (`services/task-work.ts` `readableLearners`, F4b3a). Yeni deneme ve teslim yalnız
 * hedeflenen kursiyere açıktır.
 */
export function targetedLearners(
  classOf: ReadonlyMap<string, string>,
  assignment: StoredAssignment,
) {
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
export function teacherReaches(
  viewer: Extract<Viewer, { kind: 'teacher' }>,
  target: StoredAssignment['targets'][number],
): boolean {
  return CLASS_TARGETS.has(target.kind)
    ? viewer.classIds.has(target.id)
    : viewer.studentIds.has(target.id)
}

export function visible(viewer: Viewer, assignment: StoredAssignment): boolean {
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

/**
 * Kişi atamanın dersinin zümre başkanı veya seviyesinin akademik koordinatörü mü (DOM-YTK-027).
 * Atama görünürlüğü vermez; uyuşmazlıklı teslimin okunması ve son puan bununla açılır.
 */
export function coordinates(viewer: Viewer, assignment: StoredAssignment): boolean {
  return viewer.kind === 'teacher' && coordinatesArea(viewer.coordination, assignment.area)
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

/**
 * Atamanın içerik başlığı ve türü. Sürüm satırı yabancı anahtarla korunur; bulunamaması veri
 * bütünlüğü sorunudur: yanıt boş başlıkla döner, olay loglanır (kimlik ve başlık loglanmaz).
 */
function contentOf(
  ctx: ServiceContext,
  refs: ReadonlyMap<string, AssignmentContentRef>,
  assignment: StoredAssignment,
): AssignmentContentRef {
  const ref = refs.get(assignment.resourceVersionId)
  if (ref) return ref
  ctx.log.warn({ event: 'task_assignment.content_missing' })
  return UNKNOWN_CONTENT
}

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
    secondRatingSampledAt: assignment.secondRatingSampledAt,
    assignedByUserId: assignment.assignedByUserId,
    targets: assignment.targets,
    updatedAt: assignment.updatedAt,
    archivedAt: assignment.archivedAt,
    rowVersion: assignment.rowVersion,
  }
}

type StaffViewer = Exclude<Viewer, { kind: 'learner' }>
type LearnerViewer = Extract<Viewer, { kind: 'learner' }>

function staffViewOf(
  viewer: StaffViewer,
  assignment: StoredAssignment,
  content: AssignmentContentRef,
) {
  if (viewer.kind === 'admin' || assignment.assignedByUserId === viewer.userId)
    return staffView(assignment, content)
  // Atayan olmayan öğretmen kapsamı dışındaki sınıf ve öğrenci kimliklerini görmez (DOM-YTK-022).
  const targets = assignment.targets.filter((target) => teacherReaches(viewer, target))
  return staffView({ ...assignment, targets }, content)
}

function learnerViewOf(
  viewer: LearnerViewer,
  assignment: StoredAssignment,
  content: AssignmentContentRef,
) {
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

/**
 * Rol kapsamlı, sayfalı atama listesinin satırları ve içerik başlıkları (IST-034). Yanıt biçimi
 * `assignmentView` ile kurulur; kursiyer görünümüne durum özeti `services/task-progress.ts`'te
 * eklenir.
 */
export async function loadTaskAssignmentPage(ctx: ServiceContext, input: TaskAssignmentListInput) {
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
  return { viewer, total, rows: shown, refs }
}

/** Tek atama; kapsam dışı, olmayan veya başka kurumun ataması 404 (varlığı sızmaz). */
export async function loadTaskAssignment(ctx: ServiceContext, assignmentId: string) {
  const viewer = await viewerOf(ctx)
  const assignment = await findAssignment(ctx.db, ctx.institutionId, assignmentId)
  if (!assignment || !visible(viewer, assignment)) throw new NotFoundError()
  const refs = await assignmentContentRefs(ctx.db, ctx.institutionId, [
    assignment.resourceVersionId,
  ])
  return { viewer, assignment, refs }
}

/** Atamanın personel yanıt biçimi (yönetici, öğretmen). */
export function staffAssignmentView(
  ctx: ServiceContext,
  viewer: StaffViewer,
  assignment: StoredAssignment,
  refs: ReadonlyMap<string, AssignmentContentRef>,
) {
  return staffViewOf(viewer, assignment, contentOf(ctx, refs, assignment))
}

/** Atamanın kursiyer ve veli yanıt biçimi; durum özeti `services/task-progress.ts`'te eklenir. */
export function learnerAssignmentView(
  ctx: ServiceContext,
  viewer: LearnerViewer,
  assignment: StoredAssignment,
  refs: ReadonlyMap<string, AssignmentContentRef>,
) {
  return learnerViewOf(viewer, assignment, contentOf(ctx, refs, assignment))
}

// --- Yazma --------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function readBack(tx: Database, ctx: ServiceContext, assignmentId: string) {
  const assignment = await findAssignment(tx, ctx.institutionId, assignmentId)
  if (!assignment) throw new Error('task assignment disappeared after write')
  const refs = await assignmentContentRefs(tx, ctx.institutionId, [assignment.resourceVersionId])
  return staffView(assignment, contentOf(ctx, refs, assignment))
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

const LISTENING_UNAVAILABLE_MESSAGE =
  'Dinleme hakkı yalnız dinleme kaydına bağlı quiz ve alıştırma setinde sınırlanır; dinleme hakkını boş bırakın.'

/**
 * Atanan içeriğin hakkı sayılabilen dinleme kaydı var mı (IST-045; ADR 0004 karar 6 uygulama
 * notu): quiz/alıştırma seti `listeningVersionId` ile içeriği silinmemiş bir ses sürümüne bağlı ve
 * sesin dosyası dinleme kaydı amacıyla (`listening_audio`) yüklenmiş. Hak yalnız bu dosyanın
 * bağlantısında sayılır (`services/listening-plays.ts`); `material` amaçlı ses sayılmaz.
 */
async function hasCountableRecording(
  tx: Database,
  institutionId: string,
  content: ResourceContent | null,
): Promise<boolean> {
  const recordingId = recordingVersionId(content)
  if (recordingId === null) return false
  const recording = (await loadVersionPairs(tx, institutionId, [recordingId])).get(recordingId)
  const audio = recording?.version.content
  if (audio?.type !== 'audio') return false
  const [file] = await loadFilesByIds(tx, institutionId, [audio.fileId])
  return file?.purpose === 'listening_audio'
}

/**
 * Dinleme hakkı (DOM-BEC-005) yalnız sayılabilir kayda bağlı içerikte sınırlanır. Hak
 * gönderilmezse kayda bağlı etkinlikte core varsayılanı (2) uygulanır, kaydı olmayan içerikte
 * sınırsız (`null`) saklanır: sayılacak kayıt yokken sınır kursiyeri sessizce sınırsız bırakırdı.
 */
function listeningInput(input: AssignmentInput, countable: boolean): AssignmentInput {
  if (countable || input.settings?.listeningPlays !== undefined) return input
  return { ...input, settings: { ...input.settings, listeningPlays: null } }
}

/** Kaydı olmayan dinleme görevine açıkça seçilen 1 veya 2 hak 422 `listening_plays_unavailable`. */
function assertListeningCountable(plan: AssignmentPlan, countable: boolean): void {
  if (countable || plan.assignment.listeningPlays === null) return
  throw new RuleViolationError('listening_plays_unavailable', LISTENING_UNAVAILABLE_MESSAGE, {
    issues: [
      {
        path: ['settings', 'listeningPlays'],
        code: 'listening_plays_unavailable',
        message: LISTENING_UNAVAILABLE_MESSAGE,
      },
    ],
  })
}

/**
 * Core'un 404'ü (olmayan hedef veya rubrik sürümü) mesajı ve alan yoluyla döner; kapsam dışı hedef
 * 403 olduğundan varlık sızmaz. Kod `not_found` kalır. Diğer hatalar olduğu gibi geçer.
 */
function withNotFoundPath(error: unknown): unknown {
  if (!(error instanceof DomainError) || error.kind !== 'not_found') return error
  return new AppError(404, 'not_found', error.message, {
    ...(error.path === undefined
      ? {}
      : { issues: [{ path: [...error.path], code: error.code, message: error.message }] }),
    cause: error,
  })
}

type StaffContentViewer = Extract<ContentViewer, { kind: 'staff' }>

/** Atama planlamasının kurum kilidi altında yüklenen girdileri (tek ve toplu atama ortak). */
interface Planning {
  institution: NonNullable<Awaited<ReturnType<typeof getInstitutionModules>>>
  resource: NonNullable<Awaited<ReturnType<typeof findResource>>>
  version: ReturnType<typeof asCoreVersion>
  rubricVersions: ReadonlyMap<string, RubricVersionRow>
  others: StoredAssignment[]
  countable: boolean
  actor: Actor
}

/**
 * İçerik sürümü, rubrik sürümleri, aynı içeriğin atamaları ve dinleme kaydı; atayanın göremediği
 * veya olmayan içerik 404 (varlığı sızmaz).
 */
async function loadPlanning(
  tx: Database,
  ctx: ServiceContext,
  viewer: StaffContentViewer,
  resourceVersionId: string,
  rubricVersionIds: readonly (string | null | undefined)[],
): Promise<Planning> {
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  if (!institution) throw new Error('institution disappeared during assignment command')
  const links = await listMembershipLinks(tx, ctx.institutionId, ctx.actor.membershipId)
  const resourceId = await resourceIdOfVersion(tx, ctx.institutionId, resourceVersionId)
  const resource =
    resourceId === null ? null : await findResource(tx, ctx.institutionId, resourceId)
  const [stored] = resource
    ? await listResourceVersions(tx, ctx.institutionId, resource.id, [resourceVersionId])
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
  const rubricVersions = new Map<string, RubricVersionRow>()
  for (const id of new Set(rubricVersionIds)) {
    if (typeof id !== 'string' || !UUID.test(id)) continue
    const found = await findRubricVersion(tx, ctx.institutionId, id)
    if (found) rubricVersions.set(id, found)
  }
  const others = await loadResourceAssignments(tx, ctx.institutionId, resource.id)
  const countable = await hasCountableRecording(tx, ctx.institutionId, version.content)
  const actor: Actor = { role: ctx.actor.role, links, userId: ctx.actor.userId }
  return { institution, resource, version, rubricVersions, others, countable, actor }
}

/**
 * Hedef kapsamının kaynağı ve aynı içeriğin açık atamaları (kursiyerleri hedeflerden çözülmüş);
 * ardından lisans (DOM-KYN-021): `isAssignable`'ın lisans koşulu core planından önce denetlenir,
 * yoksa dolmuş lisans çakışma (`assignment_duplicate`) veya ayar hatasının ardında kalırdı.
 */
function planningSource(ctx: ServiceContext, state: State, planning: Planning) {
  const source: AuthorizationSource = {
    students: state.students,
    teachers: state.teachers,
    classes: state.classes,
    assignments: state.assignments,
    clubs: state.clubs,
    mockExams: state.mockExams,
    modules: planning.institution.modules,
  }
  const byClass = new Map<string, string[]>()
  for (const student of source.students)
    byClass.set(student.classId, [...(byClass.get(student.classId) ?? []), student.id])
  const existing: ExistingAssignment[] = planning.others.map((other) => ({
    id: other.id,
    resourceId: other.resourceId,
    deadline: other.deadline,
    archivedAt: other.archivedAt,
    learnerIds: other.targets.flatMap((target) =>
      target.kind === 'student' ? [target.id] : (byClass.get(target.id) ?? []),
    ),
  }))
  if (licenseExpired(planning.version.license, ctx.now))
    throw new AppError(
      409,
      'resource_license_expired',
      'Bu içeriğin lisans süresi dolmuş; atanamaz.',
    )
  return {
    resource: planning.resource,
    version: planning.version,
    actor: planning.actor,
    source,
    institutionType: planning.institution.type,
    existing,
    now: ctx.now,
  }
}

const ASSIGNMENT_AUDIT_FIELDS = (plan: AssignmentPlan) => [
  'resourceVersionId',
  'scoringVersionId',
  ...(plan.assignment.rubricVersionId === null ? [] : ['rubricVersionId']),
  'settings',
  'targets',
]

async function writeAssignment(
  tx: Database,
  ctx: ServiceContext,
  assignmentId: string,
  plan: AssignmentPlan,
) {
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
  await audit(tx, ctx, 'task_assignment.create', assignmentId, ASSIGNMENT_AUDIT_FIELDS(plan))
}

/** Atayanın içerik görünümü; personel değilse 403. */
async function staffContentViewer(ctx: ServiceContext): Promise<StaffContentViewer> {
  // Kişinin içerik görünümü transaction'dan önce: PGlite tek bağlantılıdır (resource-commands.ts).
  const reader = await contentReader(ctx)
  if (reader.viewer.kind !== 'staff') throw new ForbiddenError()
  return reader.viewer
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
  const viewer = await staffContentViewer(ctx)
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
        const planning = await loadPlanning(tx, ctx, viewer, input.resourceVersionId, [
          input.settings?.rubricVersionId,
        ])
        return {
          run: (state) => {
            const common = planningSource(ctx, state, planning)
            const rubricVersionId = input.settings?.rubricVersionId ?? null
            let plan: AssignmentPlan
            try {
              plan = planAssignment({
                ...common,
                rubricVersion:
                  rubricVersionId === null
                    ? null
                    : (planning.rubricVersions.get(rubricVersionId) ?? null),
                input: listeningInput(input, planning.countable),
              })
            } catch (error) {
              throw withNotFoundPath(error)
            }
            assertListeningCountable(plan, planning.countable)
            return plan
          },
        }
      },
      after: async (tx, plan) => {
        await writeAssignment(tx, ctx, assignmentId, plan)
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
 * Toplu atama (DOM-BEC-049, IST-034): aynı içerik sürümü her öğede kendi hedefleri ve son tarihiyle
 * ayrı atama olur. Bütün öğeler tek atamanın kurallarıyla (core `planAssignmentBatch`) tek
 * transaction'da planlanır; bir öğe reddedilirse hata o öğenin yoluyla (`items.<sıra>.…`) döner ve
 * hiçbir atama yazılmaz. Dinleme hakkı kuralı (IST-045) her öğede ayrı uygulanır. Denetim kaydı
 * atama başınadır (`task_assignment.create`).
 */
export async function createTaskAssignmentBatch(
  ctx: ServiceContext,
  input: AssignmentBatchInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await staffContentViewer(ctx)
  const [first] = input.items
  if (first === undefined) throw new Error('empty batch passed schema validation')
  const assignmentIds = input.items.map(() => randomUUID())
  const out: { body?: unknown } = {}
  return runCommand<AssignmentPlan[]>(
    ctx,
    {
      action: 'task_assignment.create_batch',
      collections: SCOPE_SOURCE_COLLECTIONS,
      entity: { type: 'task_assignment', id: assignmentIds[0] ?? '' },
      load: async (tx) => {
        const planning = await loadPlanning(
          tx,
          ctx,
          viewer,
          first.resourceVersionId,
          input.items.map((item) => item.settings?.rubricVersionId),
        )
        return {
          run: (state) => {
            const common = planningSource(ctx, state, planning)
            let plans: AssignmentPlan[]
            try {
              plans = planAssignmentBatch({
                ...common,
                rubricVersions: planning.rubricVersions,
                input: {
                  items: input.items.map((item) => listeningInput(item, planning.countable)),
                },
              })
            } catch (error) {
              throw withNotFoundPath(error)
            }
            plans.forEach((plan, index) => {
              try {
                assertListeningCountable(plan, planning.countable)
              } catch (error) {
                throw inBatchIssues(error, index)
              }
            })
            return plans
          },
        }
      },
      after: async (tx, plans) => {
        const data = []
        for (const [index, plan] of plans.entries()) {
          const id = assignmentIds[index]
          if (id === undefined) throw new Error('batch assignment id missing')
          await writeAssignment(tx, ctx, id, plan)
          data.push(await readBack(tx, ctx, id))
        }
        out.body = { data }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('task assignment batch was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
}

/** Toplu atamada API kuralının `issues` yolu öğenin yerine taşınır (`items.<sıra>.…`). */
function inBatchIssues(error: unknown, index: number): unknown {
  if (!(error instanceof AppError) || error.issues === undefined) return error
  return new AppError(error.statusCode, error.code, error.message, {
    issues: error.issues.map((issue) => ({
      ...issue,
      path: ['items', String(index), ...issue.path],
    })),
    cause: error,
  })
}

/**
 * Atama değişikliği (core `planAssignmentChange`; DOM-BEC-041, 042, 044, 045): yalnız son teslim ve
 * geç kabul uzar; sabitlenen sürüm ve ayarlar 409 `assignment_setting_frozen`; değerlendirmenin
 * cevap anahtarı açıldıysa (teslim kapandı) uzatma 409 `answer_key_released`. Değiştiren atayan veya
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
        // Kilit: örneklem seçildi ya da pencere kapandıktan sonra ikinci puan istendi. Pencere
        // açıkken yapılan elle istek yalnız sürüm hakkı dolmuş teslim içindir (`task-grading.ts`
        // `assertLearnerCannotSubmit`); süre uzasa da o kursiyer yeni sürüm gönderemez, yanıtı
        // değişmez (DOM-BEC-045). Bu yüzden sınıfın son tarih uzatmasını engellemez.
        const lastRequestAt = await latestSecondRatingRequestAt(
          tx,
          ctx.institutionId,
          assignment.id,
        )
        const secondRatingStarted =
          assignment.secondRatingSampledAt !== null ||
          (lastRequestAt !== null && isClosed(assignment.deadline, lastRequestAt))
        return {
          run: (_state, tools) => {
            // Yetki (403): görünür ama değiştiremeyen kişi (yalnız atayan ve yönetici).
            const manages =
              viewer.kind === 'admin' ||
              (viewer.kind === 'teacher' && assignment.assignedByUserId === viewer.userId)
            if (!manages) throw new ForbiddenError()
            // Sürüm (409).
            if (assignment.rowVersion !== input.expectedVersion) throw new ConflictError()
            const { deadline } = planAssignmentChange({
              assignment,
              patch: input.patch,
              now: tools.now,
            })
            // İkinci puanlama, kursiyer yeni sürüm gönderemezken başlar (DOM-BEC-024, 045;
            // `task-grading.ts`); pencere yeniden açılsa açılmamış puan yeni sürüm reddinden
            // sızardı. Bu yüzden ikinci puanlama başladıktan sonra teslim penceresi değişmez.
            if (secondRatingStarted && windowChanged(assignment.deadline, deadline))
              throw new AppError(
                409,
                'second_rating_started',
                'İkinci puanlama başladı; son teslim tarihi artık değiştirilemez.',
              )
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

/** Teslim penceresi (son teslim veya geç kabul) değişti mi. */
function windowChanged(before: StoredAssignment['deadline'], after: StoredAssignment['deadline']) {
  const at = (value: string | null) => (value === null ? null : Date.parse(value))
  return (
    at(before.dueAt) !== at(after.dueAt) || before.lateAcceptanceDays !== after.lateAcceptanceDays
  )
}
