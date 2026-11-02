import { randomUUID } from 'node:crypto'

import { licenseExpired } from '@kampus/school-core/content/taxonomy.ts'
import { canReadVersion } from '@kampus/school-core/content/visibility.ts'
import type { AuthorizationSource } from '@kampus/school-core/lib/authorize.ts'
import {
  coordinatesArea,
  coordinatorScopeOf,
  type CoordinatorScope,
} from '@kampus/school-core/lib/coordinator-duties.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { SCOPE_SOURCE_COLLECTIONS, type Actor } from '@kampus/school-core/lib/scope.ts'
import {
  planAssignment,
  planAssignmentChange,
  type AssignmentInput,
  type AssignmentPlan,
  type ExistingAssignment,
} from '@kampus/school-core/skills/assignment.ts'
import { isClosed } from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import { activeDutiesOf } from '../db/coordinator-duties.ts'
import { asCoreVersion, findResource, listResourceVersions } from '../db/resources.ts'
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

/**
 * Geçici API sınırı (ADR 0004 karar 6 uygulama notu, OG-049): dinleme hakkı sayılamaz, çünkü sayım
 * altyapısı (`services/listening-plays.ts`) hazır olsa da core içerik modeli dinleme kaydını
 * atanabilen türlere bağlamaz. Aksi hâlde kursiyerin hakkı sessizce sınırsız olurdu. Dinleme
 * görevi yine atanır: gövde şeması gönderilmeyen hakkı sınırsız (`null`) yapar; yalnız açıkça
 * seçilen 1 veya 2 reddedilir. Dosyalı ve sesli teslim OG-048 ile açıktır
 * (`services/task-submission-files.ts`).
 */
function assertSupportedByApi(plan: AssignmentPlan): void {
  // TODO(dinleme-icerik-bagi): core ses kaydını atanabilir türe bağlayınca bu sınır kalkar.
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
            // Lisans (DOM-KYN-021): `isAssignable`'ın lisans koşulu core planından önce denetlenir;
            // yoksa dolmuş lisans çakışma (`assignment_duplicate`) veya ayar hatasının ardında
            // kalırdı. Yayın ve güncel sürüm koşulunu core `planAssignment` hedeften sonra denetler.
            if (licenseExpired(version.license, ctx.now))
              throw new AppError(
                409,
                'resource_license_expired',
                'Bu içeriğin lisans süresi dolmuş; atanamaz.',
              )
            let plan: AssignmentPlan
            try {
              plan = planAssignment({
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
            } catch (error) {
              throw withNotFoundPath(error)
            }
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
