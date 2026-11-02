import { randomUUID } from 'node:crypto'

import {
  coordinatorScopeOf,
  NO_COORDINATOR_SCOPE,
} from '@kampus/school-core/lib/coordinator-duties.ts'
import {
  courseView,
  courseVisibleTo,
  createCourseSchema,
  orderedCourses,
  planCourseActivation,
  planCourseArchive,
  planCourseCreation,
  planCourseEOzelRecord,
  planCourseUpdate,
  type Course,
  type CourseLanguage,
  type CourseManager,
  type CourseStatus,
} from '@kampus/school-core/lib/courses.ts'
import type { CefrLevel } from '@kampus/school-core/content/taxonomy.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { Database } from '../db/client.ts'
import { activeDutiesOf } from '../db/coordinator-duties.ts'
import { insertCourse, loadCourses, saveCourse, type StoredCourse } from '../db/courses.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitution } from './memberships.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Dil okulu kur programı (IST-076; docs/domain/dil-okulu.md DOM-DIL-005…007). Kural core
 * `lib/courses.ts`'tedir; burada yükleme, sürüm denetimi ve yazma vardır. Beş rol okur (öğrenci ve
 * veli yalnız etkin kurları daraltılmış görür, `courseView`); yönetici ve seviyenin akademik
 * koordinatörü yönetir, e-Özel kaydını yönetici işaretler. Her yazma tek transaction ve kurum
 * kilidi altındadır (`runCommand`); kurun `rowVersion`'ı iyimser kilittir (`If-Match`). Denetime
 * yalnız alan adları yazılır.
 */

const ENTITY = 'course'
const entity = (courseId: string) => ({ type: ENTITY, id: courseId })

type Meta = { rowVersion: number; updatedAt: string }

/** Rolün görünümü; personelde sürüm ve son değişiklik anı da döner. */
function view(ctx: ServiceContext, course: Course, meta: Meta, all: readonly Course[]) {
  const shown = courseView(course, ctx.actor.role, all)
  return 'status' in shown ? { ...shown, ...meta } : shown
}

const storedView = (ctx: ServiceContext, course: StoredCourse, all: readonly Course[]) =>
  view(ctx, course, { rowVersion: course.rowVersion, updatedAt: course.updatedAt }, all)

export interface CourseListInput {
  page: number
  pageSize: number
  status?: CourseStatus | undefined
  level?: CefrLevel | undefined
  language?: CourseLanguage | undefined
}

/**
 * Kurlar seviye sırasıyla, sonra ada göre (DOM-DIL-005). Arşiv varsayılan olarak dışlanır,
 * `status=archived` ile okunur. Öğrenci ve veli yalnız etkin kurları görür; durum süzgeci onlarda
 * da uygulanır (etkin dışı süzgeç boş döner).
 */
export async function listCourses(ctx: ServiceContext, input: CourseListInput) {
  const all = await loadCourses(ctx.db, ctx.institutionId)
  const items = orderedCourses(
    all.filter(
      (course) =>
        courseVisibleTo(course, ctx.actor.role) &&
        (input.status === undefined
          ? course.status !== 'archived'
          : course.status === input.status) &&
        (input.level === undefined || course.level === input.level) &&
        (input.language === undefined || course.language === input.language),
    ),
  )
  const start = (input.page - 1) * input.pageSize
  return {
    items: items.slice(start, start + input.pageSize).map((course) => storedView(ctx, course, all)),
    total: items.length,
  }
}

/** Tek kur; olmayan, başka kurumun ya da rolün göremediği kur 404. */
export async function getCourse(ctx: ServiceContext, courseId: string) {
  const all = await loadCourses(ctx.db, ctx.institutionId)
  const course = all.find((item) => item.id === courseId)
  if (!course || !courseVisibleTo(course, ctx.actor.role)) throw new NotFoundError()
  return storedView(ctx, course, all)
}

async function institutionTypeOf(tx: Database, ctx: ServiceContext): Promise<InstitutionType> {
  const institution = await getInstitution(tx, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  return institution.type
}

/** Aktörün yönetim kapsamı: öğretmende etkin akademik koordinatör görevleri (DOM-YTK-027). */
async function managerOf(tx: Database, ctx: ServiceContext): Promise<CourseManager> {
  if (ctx.actor.role !== 'ogretmen')
    return { role: ctx.actor.role, coordination: NO_COORDINATOR_SCOPE }
  const duties = await activeDutiesOf(tx, ctx.institutionId, ctx.actor.membershipId)
  return { role: ctx.actor.role, coordination: coordinatorScopeOf(duties) }
}

/** `after`'da yazılan yanıt gövdesini uç yanıtına çevirir. */
function respond(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('course was not written')
    return { statusCode, body: out.body }
  }
}

/** Gönderilen (tanımlı) alanların adları; değer denetime yazılmaz. */
const definedFields = (data: Record<string, unknown>) =>
  Object.keys(data).filter((key) => data[key] !== undefined)

/**
 * Yeni kur (DOM-DIL-005): taslak açılır. Ad tekil 409 `course_name_exists`; alanlar arası kurallar
 * ve sonraki kur 422; koordinatör kapsamı dışı seviye 403 `course_coordinator_required`. Başarı 201.
 */
export function createCourse(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<{ course: Course; all: StoredCourse[] }>(
    ctx,
    {
      action: 'course.create',
      collections: [],
      entity: ({ course }) => entity(course.id),
      load: async (tx) => {
        const [all, institutionType, manager] = await Promise.all([
          loadCourses(tx, ctx.institutionId),
          institutionTypeOf(tx, ctx),
          managerOf(tx, ctx),
        ])
        return {
          run: () => ({
            course: planCourseCreation({
              institutionType,
              manager,
              courses: all,
              input,
              courseId: randomUUID(),
            }),
            all,
          }),
        }
      },
      after: async (tx, { course, all }) => {
        await insertCourse(tx, ctx.institutionId, course, ctx.now)
        await auditWork(
          tx,
          ctx,
          'course.create',
          entity(course.id),
          definedFields(createCourseSchema.parse(input)),
        )
        out.body = {
          data: view(ctx, course, { rowVersion: 1, updatedAt: ctx.now.toISOString() }, [
            ...all,
            course,
          ]),
        }
      },
    },
    respond(out, 201),
    idempotency,
  )
}

type CourseChange = { course: Course; fields: string[] }

type CourseCommand = {
  action: string
  courseId: string
  expectedVersion: number
  plan: (input: {
    all: StoredCourse[]
    institutionType: InstitutionType
    manager: CourseManager
  }) => CourseChange
}

export interface CourseTarget {
  courseId: string
  expectedVersion: number
}

/**
 * Var olan kura komut: kurum kilidi altında yükler; kur yoksa 404, `If-Match` tutmazsa 409 (plandan önce). Core
 * planını çalıştırır, sürüm koşuluyla yazar ve denetime yazar. Yanıt kurun yeni hâlidir.
 */
function runCourseCommand(
  ctx: ServiceContext,
  command: CourseCommand,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<CourseChange & { rowVersion: number; all: StoredCourse[] }>(
    ctx,
    {
      action: command.action,
      collections: [],
      entity: entity(command.courseId),
      load: async (tx) => {
        const [all, institutionType, manager] = await Promise.all([
          loadCourses(tx, ctx.institutionId),
          institutionTypeOf(tx, ctx),
          managerOf(tx, ctx),
        ])
        const course = all.find((item) => item.id === command.courseId)
        // Arşivli kur da yüklenir: core 409 `course_archived` döner (404 değil).
        if (!course) throw new NotFoundError()
        // Sıra 404 → (rol 403 uçta) → 409 sürüm → core kuralları (koordinatör 403, 409, 422).
        if (course.rowVersion !== command.expectedVersion) throw new ConflictError()
        return {
          run: () => ({
            ...command.plan({ all, institutionType, manager }),
            rowVersion: course.rowVersion,
            all,
          }),
        }
      },
      after: async (tx, change) => {
        if (!(await saveCourse(tx, ctx.institutionId, change.course, change.rowVersion, ctx.now)))
          throw new ConflictError()
        await auditWork(tx, ctx, command.action, entity(command.courseId), change.fields)
        const all = change.all.map((item) => (item.id === change.course.id ? change.course : item))
        out.body = {
          data: view(
            ctx,
            change.course,
            { rowVersion: change.rowVersion + 1, updatedAt: ctx.now.toISOString() },
            all,
          ),
        }
      },
    },
    respond(out, 200),
    idempotency,
  )
}

/** Kuru değiştirir (DOM-DIL-005…007); etkin kurun program alanları 422 `course_active_locked`. */
export function updateCourse(
  ctx: ServiceContext,
  target: CourseTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runCourseCommand(
    ctx,
    {
      action: 'course.update',
      ...target,
      plan: ({ all, institutionType, manager }) =>
        planCourseUpdate({
          institutionType,
          manager,
          courses: all,
          courseId: target.courseId,
          input,
        }),
    },
    idempotency,
  )
}

/** Taslak kuru etkinleştirir (DOM-DIL-005, -006). */
export function activateCourse(
  ctx: ServiceContext,
  target: CourseTarget,
  idempotency: IdempotencyRequest | null,
) {
  return runCourseCommand(
    ctx,
    {
      action: 'course.activate',
      ...target,
      plan: ({ all, institutionType, manager }) => ({
        course: planCourseActivation({
          institutionType,
          manager,
          courses: all,
          courseId: target.courseId,
          now: ctx.now.toISOString(),
        }),
        fields: ['status', 'activatedAt'],
      }),
    },
    idempotency,
  )
}

/** Kuru arşivler (DOM-DIL-005, -007); arşiv son durumdur. */
export function archiveCourse(
  ctx: ServiceContext,
  target: CourseTarget,
  idempotency: IdempotencyRequest | null,
) {
  return runCourseCommand(
    ctx,
    {
      action: 'course.archive',
      ...target,
      plan: ({ all, institutionType, manager }) => ({
        course: planCourseArchive({
          institutionType,
          manager,
          courses: all,
          courseId: target.courseId,
          now: ctx.now.toISOString(),
        }),
        fields: ['status', 'archivedAt'],
      }),
    },
    idempotency,
  )
}

/** e-Özel kaydını işaretler (DOM-DIL-006); iz işaretleyen ve an olarak yazılır. */
export function recordCourseEOzel(
  ctx: ServiceContext,
  target: CourseTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runCourseCommand(
    ctx,
    {
      action: 'course.e_ozel_record',
      ...target,
      plan: ({ all, institutionType }) => ({
        course: planCourseEOzelRecord({
          institutionType,
          courses: all,
          courseId: target.courseId,
          input,
          actorUserId: ctx.actor.userId,
          now: ctx.now.toISOString(),
        }),
        fields: ['eOzel.programCode', 'eOzel.approval', 'eOzel.recordedAt'],
      }),
    },
    idempotency,
  )
}
