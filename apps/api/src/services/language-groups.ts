import { randomUUID } from 'node:crypto'

import {
  coordinatorScopeOf,
  NO_COORDINATOR_SCOPE,
} from '@kampus/school-core/lib/coordinator-duties.ts'
import type { Course } from '@kampus/school-core/lib/courses.ts'
import {
  canReadGroup,
  createGroupSchema,
  groupStatus,
  groupView,
  planGroupCancellation,
  planGroupCreation,
  planGroupMerge,
  planGroupOpen,
  planGroupUpdate,
  suggestWaitlistOffers,
  waitlistQueue,
  isLiveOffer,
  mergeGroupSchema,
  type GroupMember,
  type GroupPlanningContext,
  type GroupReader,
  type GroupStatus,
  type LanguageGroup,
  type WaitlistEntry,
} from '@kampus/school-core/lib/language-groups.ts'

import type { Database } from '../db/client.ts'
import { activeDutiesOf } from '../db/coordinator-duties.ts'
import { loadCourses } from '../db/courses.ts'
import {
  insertGroup,
  loadGroupMembers,
  loadGroups,
  loadMembershipsOfStudents,
  loadTeacherMembershipIds,
  loadWaitlist,
  moveGroupMembers,
  moveGroupWaitlist,
  saveGroup,
  type StoredGroup,
} from '../db/language-groups.ts'
import { findStudentIdentity } from '../db/student-identities.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitution, listMembershipLinks } from './memberships.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Dil okulu grupları (IST-077; docs/domain/dil-okulu.md DOM-DIL-003, -008, -040…043). Kural core
 * `lib/language-groups.ts`'tedir; burada yükleme, okuma kapsamı, sürüm denetimi ve yazma vardır.
 * Yönetici ve kurun seviyesinin akademik koordinatörü planlar; ön büro okur; öğretmen kendi
 * grubunu, öğrenci ve veli kendi grubunu (üyelik bağlantılarından) daraltılmış okur. Her yazma tek
 * transaction ve kurum kilidi altındadır (`runCommand`); çakışma denetimi bu kilit sayesinde
 * yarışsızdır. Grubun `rowVersion`'ı iyimser kilittir (`If-Match`). Denetime yalnız alan adları
 * yazılır.
 */

const ENTITY = 'language_group'
const entity = (groupId: string) => ({ type: ENTITY, id: groupId })

const isLearner = (ctx: ServiceContext) => ctx.actor.role === 'ogrenci' || ctx.actor.role === 'veli'

/** Okuyanın kapsamı: öğretmende koordinatör görevi, öğrenci/velide bağlı öğrenci kayıtları. */
async function readerOf(ctx: ServiceContext): Promise<GroupReader> {
  const base = {
    role: ctx.actor.role,
    membershipId: ctx.actor.membershipId,
    coordination: NO_COORDINATOR_SCOPE,
    studentIds: [] as string[],
  }
  if (ctx.actor.role === 'ogretmen') {
    const duties = await activeDutiesOf(ctx.db, ctx.institutionId, ctx.actor.membershipId)
    return { ...base, coordination: coordinatorScopeOf(duties) }
  }
  if (!isLearner(ctx)) return base
  // Öğrenci kendisi, veli bağlı çocukları (OG-031 velayet kısıtı OG-032 ile bağlantıya yansır).
  const links = await listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  return {
    ...base,
    studentIds: links
      .filter((link) => link.kind === (ctx.actor.role === 'ogrenci' ? 'student' : 'child'))
      .map((link) => link.recordId),
  }
}

type ReadState = {
  reader: GroupReader
  courses: Map<string, Course>
  groups: StoredGroup[]
  members: readonly GroupMember[]
  waitlist: readonly WaitlistEntry[]
}

/** Okuma için yükleme: personelde doluluk için bütün kursiyerler, öğrenci/velide yalnız kendi üyelikleri. */
async function loadReadState(ctx: ServiceContext): Promise<ReadState> {
  const reader = await readerOf(ctx)
  const [courses, groups] = await Promise.all([
    loadCourses(ctx.db, ctx.institutionId),
    loadGroups(ctx.db, ctx.institutionId),
  ])
  const learner = isLearner(ctx)
  const [members, waitlist] = await Promise.all([
    learner
      ? loadMembershipsOfStudents(ctx.db, ctx.institutionId, reader.studentIds)
      : loadGroupMembers(ctx.db, ctx.institutionId),
    learner
      ? Promise.resolve([])
      : loadWaitlist(
          ctx.db,
          ctx.institutionId,
          courses.map((course) => course.id),
        ),
  ])
  return { reader, courses: new Map(courses.map((c) => [c.id, c])), groups, members, waitlist }
}

const visible = (state: ReadState) => (group: StoredGroup) => {
  const course = state.courses.get(group.courseId)
  return course !== undefined && canReadGroup(state.reader, group, course, state.members)
}

function view(
  ctx: ServiceContext,
  state: Pick<ReadState, 'members' | 'waitlist'>,
  group: LanguageGroup,
  course: Course,
  meta: { rowVersion: number; updatedAt: string },
) {
  const now = ctx.now.toISOString()
  const shown = groupView(group, course, ctx.actor.role, state.members, state.waitlist, now)
  return 'capacity' in shown ? { ...shown, ...meta } : shown
}

const metaOf = (group: StoredGroup) => ({
  rowVersion: group.rowVersion,
  updatedAt: group.updatedAt,
})

export interface GroupListInput {
  page: number
  pageSize: number
  courseId?: string | undefined
  status?: GroupStatus | undefined
  teacherMembershipId?: string | undefined
}

const byStart = (a: LanguageGroup, b: LanguageGroup) =>
  a.startDate.localeCompare(b.startDate) ||
  a.name.localeCompare(b.name, 'tr') ||
  a.id.localeCompare(b.id)

/**
 * Gruplar başlangıç tarihine, sonra ada göre (IST-077). İptal edilenler varsayılan olarak dışlanır,
 * `status=cancelled` ile okunur. Rol kapsamı core `canReadGroup`'tadır.
 */
export async function listGroups(ctx: ServiceContext, input: GroupListInput) {
  const state = await loadReadState(ctx)
  const now = ctx.now.toISOString()
  const items = state.groups
    .filter(visible(state))
    .filter((group) => {
      const status = groupStatus(group, now)
      return (
        (input.status === undefined ? status !== 'cancelled' : status === input.status) &&
        (input.courseId === undefined || group.courseId === input.courseId) &&
        (input.teacherMembershipId === undefined ||
          group.teacherMembershipId === input.teacherMembershipId)
      )
    })
    .sort(byStart)
  const start = (input.page - 1) * input.pageSize
  return {
    items: items.slice(start, start + input.pageSize).map((group) => {
      const course = state.courses.get(group.courseId) as Course
      return view(ctx, state, group, course, metaOf(group))
    }),
    total: items.length,
  }
}

/** Tek grup; olmayan, başka kurumun ya da rolün göremediği grup 404. Personele kursiyerler de döner. */
export async function getGroup(ctx: ServiceContext, groupId: string) {
  const state = await loadReadState(ctx)
  const group = state.groups.find((item) => item.id === groupId)
  const course = group === undefined ? undefined : state.courses.get(group.courseId)
  if (group === undefined || course === undefined || !visible(state)(group))
    throw new NotFoundError()
  const shown = view(ctx, state, group, course, metaOf(group))
  if (isLearner(ctx)) return shown
  return {
    ...shown,
    members: state.members
      .filter((member) => member.groupId === group.id)
      .map(({ studentId, status, joinedAt }) => ({ studentId, status, joinedAt })),
  }
}

/**
 * Grubun bekleme sırası (DOM-DIL-043): grubun ve kurun grupsuz bekleyenleri sırayla, ardından gruba
 * yapılmış süresi dolmamış ve dolmuş teklifler; core önerisi (`suggestWaitlistOffers`) birlikte
 * döner. Yalnız yönetici ve ön büro (rol uçta).
 */
export async function getGroupWaitlist(ctx: ServiceContext, groupId: string) {
  const state = await loadReadState(ctx)
  const group = state.groups.find((item) => item.id === groupId)
  if (group === undefined) throw new NotFoundError()
  const now = ctx.now.toISOString()
  const queue = waitlistQueue(group, state.waitlist)
  const offers = state.waitlist.filter(
    (entry) => entry.offerGroupId === group.id && entry.status === 'offered',
  )
  const strip = (entry: WaitlistEntry, position: number | null) => ({
    id: entry.id,
    courseId: entry.courseId,
    groupId: entry.groupId,
    studentId: entry.studentId,
    prospectId: entry.prospectId,
    requestedAt: entry.requestedAt,
    status: entry.status,
    position,
    offerGroupId: entry.offerGroupId,
    offeredAt: entry.offeredAt,
    offerExpiresAt: entry.offerExpiresAt,
  })
  return {
    entries: [
      ...queue.map((entry, index) => strip(entry, index + 1)),
      ...offers
        .sort((a, b) => Number(isLiveOffer(b, now)) - Number(isLiveOffer(a, now)))
        .map((entry) => strip(entry, null)),
    ],
    suggestion: suggestWaitlistOffers({
      group,
      members: state.members,
      waitlist: state.waitlist,
      now,
    }),
  }
}

type Planning = Omit<GroupPlanningContext, 'groups'> & { groups: StoredGroup[] }

/** İşlem bağlamı: kurum kilidi altında kurlar, gruplar, kursiyerler, bekleme sırası ve öğretmenler. */
async function planningContextOf(tx: Database, ctx: ServiceContext): Promise<Planning> {
  const [institution, courses, groups, members, teacherMembershipIds, duties] = await Promise.all([
    getInstitution(tx, ctx.institutionId),
    loadCourses(tx, ctx.institutionId),
    loadGroups(tx, ctx.institutionId),
    loadGroupMembers(tx, ctx.institutionId),
    loadTeacherMembershipIds(tx, ctx.institutionId),
    ctx.actor.role === 'ogretmen'
      ? activeDutiesOf(tx, ctx.institutionId, ctx.actor.membershipId)
      : Promise.resolve([]),
  ])
  if (institution === null) throw new NotFoundError()
  const waitlist = await loadWaitlist(
    tx,
    ctx.institutionId,
    courses.map((course) => course.id),
  )
  return {
    institutionType: institution.type,
    manager: {
      role: ctx.actor.role,
      coordination:
        ctx.actor.role === 'ogretmen' ? coordinatorScopeOf(duties) : NO_COORDINATOR_SCOPE,
    },
    courses,
    groups,
    members,
    waitlist,
    teacherMembershipIds,
    now: ctx.now.toISOString(),
  }
}

/** `after`'da yazılan yanıt gövdesini uç yanıtına çevirir. */
function respond(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('group was not written')
    return { statusCode, body: out.body }
  }
}

function responseView(
  ctx: ServiceContext,
  planning: Planning,
  group: LanguageGroup,
  rowVersion: number,
  members: readonly GroupMember[] = planning.members,
) {
  const course = planning.courses.find((item) => item.id === group.courseId) as Course
  return view(ctx, { members, waitlist: planning.waitlist }, group, course, {
    rowVersion,
    updatedAt: ctx.now.toISOString(),
  })
}

/** Gönderilen (tanımlı) alanların adları; değer denetime yazılmaz. */
const definedFields = (data: Record<string, unknown>) =>
  Object.keys(data).filter((key) => data[key] !== undefined)

/**
 * Yeni grup (IST-077): `planned` açılır, bitiş hesaplanır. Ad tekil 409; kur, kalıp, yasal saat,
 * kapasite ve çakışma 422; koordinatör kapsamı dışı 403. Başarı 201.
 */
export function createGroup(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<{ group: LanguageGroup; planning: Planning }>(
    ctx,
    {
      action: 'language_group.create',
      collections: [],
      entity: ({ group }) => entity(group.id),
      load: async (tx) => {
        const planning = await planningContextOf(tx, ctx)
        return {
          run: () => ({
            group: planGroupCreation({ ...planning, input, groupId: randomUUID() }),
            planning,
          }),
        }
      },
      after: async (tx, { group, planning }) => {
        await insertGroup(tx, ctx.institutionId, group, ctx.now)
        await auditWork(
          tx,
          ctx,
          'language_group.create',
          entity(group.id),
          definedFields(createGroupSchema.parse(input)),
        )
        out.body = { data: responseView(ctx, planning, group, 1) }
      },
    },
    respond(out, 201),
    idempotency,
  )
}

export interface GroupTarget {
  groupId: string
  expectedVersion: number
}

type GroupChange = {
  group: LanguageGroup
  fields: string[]
  /** Birleştirmede kapanan kaynak grup ve taşınan kursiyerler. */
  merge?: { source: StoredGroup & LanguageGroup; moved: GroupMember[] }
}

/**
 * Kursiyerlerin doğum tarihi kimlik satırından (`student_identities`, ADR 0006 karar 9); yoksa
 * `null` (core bilinmeyen doğum tarihini 21.00 sınırında reddeder). Grup en çok 18 kursiyerdir.
 */
async function birthDatesOf(
  tx: Database,
  ctx: ServiceContext,
  studentIds: readonly string[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    [...new Set(studentIds)].map(async (studentId) => {
      const identity = await findStudentIdentity(tx, ctx.institutionId, studentId)
      return [studentId, identity?.birthDate ?? null] as const
    }),
  )
  return Object.fromEntries(entries)
}

/**
 * Var olan gruba komut: kurum kilidi altında yükler; grup yoksa 404, `If-Match` tutmazsa 409
 * (plandan önce). Core planını çalıştırır, sürüm koşuluyla yazar ve denetime yazar.
 */
function runGroupCommand(
  ctx: ServiceContext,
  command: {
    action: string
    target: GroupTarget
    plan: (planning: Planning, learnerBirthDates: Record<string, string | null>) => GroupChange
    /** Doğum tarihi yüklenecek kursiyerler (birleştirmede taşınanlar; 21.00 sınırı). */
    learnersOf?: (planning: Planning) => string[]
  },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const { groupId, expectedVersion } = command.target
  return runCommand<GroupChange & { rowVersion: number; planning: Planning }>(
    ctx,
    {
      action: command.action,
      collections: [],
      entity: entity(groupId),
      load: async (tx) => {
        const planning = await planningContextOf(tx, ctx)
        const group = planning.groups.find((item) => item.id === groupId)
        if (!group) throw new NotFoundError()
        // Sıra 404 → (rol 403 uçta) → 409 sürüm → core kuralları (koordinatör 403, 409, 422).
        if (group.rowVersion !== expectedVersion) throw new ConflictError()
        const birthDates = await birthDatesOf(tx, ctx, command.learnersOf?.(planning) ?? [])
        return {
          run: () => ({
            ...command.plan(planning, birthDates),
            rowVersion: group.rowVersion,
            planning,
          }),
        }
      },
      after: async (tx, change) => {
        if (!(await saveGroup(tx, ctx.institutionId, change.group, change.rowVersion, ctx.now)))
          throw new ConflictError()
        let members = change.planning.members
        if (change.merge !== undefined) {
          const { source, moved } = change.merge
          if (!(await saveGroup(tx, ctx.institutionId, source, source.rowVersion, ctx.now)))
            throw new ConflictError()
          await moveGroupMembers(
            tx,
            ctx.institutionId,
            { sourceGroupId: source.id, targetGroupId: change.group.id, members: moved },
            ctx.now,
          )
          await moveGroupWaitlist(
            tx,
            ctx.institutionId,
            { sourceGroupId: source.id, targetGroupId: change.group.id },
            ctx.now,
          )
          await auditWork(tx, ctx, command.action, entity(source.id), [
            'state',
            'cancelledAt',
            'cancelReason',
            'mergedIntoGroupId',
          ])
          members = [
            ...members.filter((member) => member.groupId !== source.id),
            ...moved.map((member) => ({ ...member, groupId: change.group.id })),
          ]
        }
        await auditWork(tx, ctx, command.action, entity(groupId), change.fields)
        out.body = {
          data: responseView(ctx, change.planning, change.group, change.rowVersion + 1, members),
        }
      },
    },
    respond(out, 200),
    idempotency,
  )
}

/** Grubu değiştirir (IST-077); kursiyerli ya da başlamış grupta gün/saat 422 `group_schedule_locked`. */
export function updateGroup(
  ctx: ServiceContext,
  target: GroupTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runGroupCommand(
    ctx,
    {
      action: 'language_group.update',
      target,
      plan: (planning) => planGroupUpdate({ ...planning, groupId: target.groupId, input }),
    },
    idempotency,
  )
}

/** Grubu açar (DOM-DIL-042): açılış sayısı, öğretmen ve derslik. */
export function openGroup(
  ctx: ServiceContext,
  target: GroupTarget,
  idempotency: IdempotencyRequest | null,
) {
  return runGroupCommand(
    ctx,
    {
      action: 'language_group.open',
      target,
      plan: (planning) => ({
        group: planGroupOpen({ ...planning, groupId: target.groupId }),
        fields: ['state', 'openedAt'],
      }),
    },
    idempotency,
  )
}

/** Grubu gerekçeyle iptal eder (DOM-DIL-042). */
export function cancelGroup(
  ctx: ServiceContext,
  target: GroupTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runGroupCommand(
    ctx,
    {
      action: 'language_group.cancel',
      target,
      plan: (planning) => ({
        group: planGroupCancellation({ ...planning, groupId: target.groupId, input }),
        fields: ['state', 'cancelledAt', 'cancelReason'],
      }),
    },
    idempotency,
  )
}

/**
 * Kaynak grubu hedefe (`:groupId`) birleştirir (DOM-DIL-042): kaynak iptal edilir, kursiyerleri ve
 * bekleyenleri hedefe taşınır. `If-Match` hedefin, gövdedeki `sourceVersion` kaynağın sürümüdür;
 * ikisi de tutmalıdır (409 `version_conflict`). Taşınanların doğum tarihi 21.00 sınırı için yüklenir.
 */
export function mergeGroup(
  ctx: ServiceContext,
  target: GroupTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runGroupCommand(
    ctx,
    {
      action: 'language_group.merge',
      target,
      learnersOf: (planning) => {
        const parsed = mergeGroupSchema.safeParse(input)
        if (!parsed.success) return []
        return planning.members
          .filter((member) => member.groupId === parsed.data.sourceGroupId)
          .map((member) => member.studentId)
      },
      plan: (planning, learnerBirthDates) => {
        // Kaynağın okunan sürümü (`sourceVersion`) tutmazsa kurallardan önce 409: başkası kaynağı
        // değiştirmiştir. Geçersiz gövde ve bulunmayan kaynak core'da 400/404 olur.
        const body = mergeGroupSchema.safeParse(input)
        const current = body.success
          ? planning.groups.find((item) => item.id === body.data.sourceGroupId)
          : undefined
        if (body.success && current && current.rowVersion !== body.data.sourceVersion)
          throw new ConflictError()
        const result = planGroupMerge({
          ...planning,
          groupId: target.groupId,
          input,
          learnerBirthDates,
        })
        const stored = planning.groups.find((item) => item.id === result.source.id) as StoredGroup
        const moved = new Set(result.movedStudentIds)
        return {
          group: result.target,
          fields: ['members'],
          merge: {
            source: { ...stored, ...result.source },
            moved: planning.members.filter(
              (member) => member.groupId === result.source.id && moved.has(member.studentId),
            ),
          },
        }
      },
    },
    idempotency,
  )
}
