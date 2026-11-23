import { randomUUID } from 'node:crypto'

import {
  authorizedPickups,
  dismissalDeparture,
  dismissalLessonEffects,
  earlyDismissalCancelSchema,
  earlyDismissalCreateSchema,
  earlyDismissalRejectSchema,
  earlyDismissalReleaseSchema,
  maskIdLast4,
  planEarlyDismissal,
  planEarlyDismissalApproval,
  planEarlyDismissalCancel,
  planEarlyDismissalRejection,
  planEarlyDismissalRelease,
  type DismissalScheduleLesson,
  type EarlyDismissalRequester,
  type EarlyDismissalStatus,
} from '@kampus/school-core/lib/finance-early-dismissals.ts'
import {
  emergencyViewerClasses,
  type EmergencyViewer,
} from '@kampus/school-core/lib/finance-emergency-summaries.ts'
import { addDays } from '@kampus/school-core/lib/finance-opening-watch.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { hasCustody, type GuardianLink } from '@kampus/school-core/lib/guardianship.ts'

import type { Database } from '../db/client.ts'
import {
  activeDismissalExists,
  dayStatusCounts,
  findEarlyDismissal,
  insertEarlyDismissal,
  listEarlyDismissals,
  loadDayDismissals,
  updateEarlyDismissal,
  type EarlyDismissalQuery,
  type StoredEarlyDismissal,
} from '../db/finance-early-dismissals.ts'
import { loadScheduleLessons } from '../db/finance-leave-requests.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadRecordsByIds } from '../db/records.ts'
import {
  loadGuardianAccounts,
  loadMembershipGuardians,
  loadStudentGuardians,
} from '../db/student-guardians.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { notify } from './notify.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Erken çıkış ve izinli ayrılış (DOM-FIN-161; ON-168; K-538…K-540). Kural core
 * `lib/finance-early-dismissals.ts`'tedir; servis kurum kilidi altında öğrenciyi, veli bağlarını
 * ve günün açık talebini yükler, tek transaction'da yazar ve denetime alan adlarını düşer (neden
 * açıklaması, teslim alanın adı, son dört hane ve gerekçeler yazılmaz). Teslim ve karar veliye
 * uygulama içi bildirimle gider (`notify`; SMS yok). Etkilenen dersler ders programından okumada
 * hesaplanır; yoklama kaydına yazılmaz. Veli bağları (`student_guardians`) yalnız okunur. Rol ve
 * modül denetimi rotadadır.
 */

const ENTITY = 'early_dismissals'
/** Ayrıntıda dönen kişisel alanlar; okuma denetimine alan adı olarak yazılır. */
const DETAIL_FIELDS = ['reasonNote', 'pickupName', 'pickupIdLast4', 'authorizedPickups']

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

// --- Ad ve bağ çözümü ----------------------------------------------------------------------------

interface StudentFact {
  name: string | null
  classId: string | null
  active: boolean
}

async function studentFacts(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(ids)], {
    includeArchived: true,
  })
  return new Map<string, StudentFact>(
    rows.map((row) => [
      row.id,
      {
        name: text(row.data.name),
        classId: text(row.data.classId),
        active: row.archivedAt === null && row.data.isActive !== false,
      },
    ]),
  )
}

type NamedLink = GuardianLink & { name: string }

/** Bağların görünen adı: veli kaydının adı, yoksa veli hesabının adı. */
async function nameLinks(db: Database, ctx: ServiceContext, links: readonly GuardianLink[]) {
  const parentIds = [...new Set(links.flatMap((link) => (link.parentId ? [link.parentId] : [])))]
  const [parents, accounts] = await Promise.all([
    loadRecordsByIds(db, ctx.institutionId, 'parents', parentIds, { includeArchived: true }),
    memberNames(
      db,
      ctx.institutionId,
      links.flatMap((link) => (link.membershipId ? [link.membershipId] : [])),
    ),
  ])
  const parentNames = new Map(parents.map((row) => [row.id, text(row.data.name)]))
  return links.map((link): NamedLink => ({
    ...link,
    name:
      (link.parentId ? parentNames.get(link.parentId) : null) ??
      (link.membershipId ? accounts.get(link.membershipId) : null) ??
      'Veli',
  }))
}

const pickupView = (link: NamedLink, ownMembershipId: string | null) => ({
  guardianLinkId: link.id,
  name: link.name,
  relationship: link.relationship,
  custody: link.custody,
  canPickUp: link.canPickUp,
  isSelf: ownMembershipId !== null && link.membershipId === ownMembershipId,
})

// --- Görünüm -------------------------------------------------------------------------------------

interface ViewContext {
  students: ReadonlyMap<string, StudentFact>
  links: ReadonlyMap<string, NamedLink>
  classNames: ReadonlyMap<string, string | null>
}

async function viewContext(
  db: Database,
  ctx: ServiceContext,
  rows: readonly StoredEarlyDismissal[],
) {
  const studentIds = rows.map((row) => row.studentId)
  const classIds = [...new Set(rows.flatMap((row) => (row.classId ? [row.classId] : [])))]
  const [students, accounts, classes] = await Promise.all([
    studentFacts(db, ctx, studentIds),
    loadGuardianAccounts(db, ctx.institutionId, [...new Set(studentIds)]),
    loadRecordsByIds(db, ctx.institutionId, 'classes', classIds, { includeArchived: true }),
  ])
  const named = await nameLinks(db, ctx, accounts)
  return {
    students,
    links: new Map(named.map((link) => [link.id, link])),
    classNames: new Map(classes.map((row) => [row.id, text(row.data.name)])),
  } satisfies ViewContext
}

/** Liste satırı: neden açıklaması ve son dört hane yok (ayrıntıda). */
function rowView(row: StoredEarlyDismissal, context: ViewContext) {
  const link =
    row.pickupGuardianLinkId === null ? undefined : context.links.get(row.pickupGuardianLinkId)
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: context.students.get(row.studentId)?.name ?? null,
    classId: row.classId,
    className: row.classId === null ? null : (context.classNames.get(row.classId) ?? null),
    dismissalOn: row.dismissalOn,
    plannedAt: row.plannedAt,
    reason: row.reason,
    pickupKind: row.pickupKind,
    pickupGuardianLinkId: row.pickupGuardianLinkId,
    pickupName: row.pickupKind === 'other' ? row.pickupName : (link?.name ?? null),
    pickupRelationship: row.pickupKind === 'other' ? row.pickupRelationship : null,
    status: row.status,
    source: row.source,
    decidedAt: row.decidedAt,
    releasedAt: row.releasedAt,
    releasedToName: row.releasedToName,
    version: row.version,
  }
}

async function rowsView(db: Database, ctx: ServiceContext, rows: readonly StoredEarlyDismissal[]) {
  const context = await viewContext(db, ctx, rows)
  return rows.map((row) => rowView(row, context))
}

async function scheduleOf(db: Database, ctx: ServiceContext, day: string) {
  const range = dayRange('date', day, day)
  if (range === null) return []
  const lessons = await loadScheduleLessons(db, ctx.institutionId, range)
  return lessons satisfies DismissalScheduleLesson[]
}

function effectOf(row: StoredEarlyDismissal, lessons: readonly DismissalScheduleLesson[]) {
  const departure = dismissalDeparture(row)
  if (departure === null) return null
  return {
    basis: departure.basis,
    departureAt: departure.at,
    ...dismissalLessonEffects(lessons, row.classId, row.dismissalOn, departure.at),
  }
}

async function detailView(db: Database, ctx: ServiceContext, row: StoredEarlyDismissal) {
  const [view] = await rowsView(db, ctx, [row])
  if (view === undefined) throw new NotFoundError()
  const [links, lessons] = await Promise.all([
    loadStudentGuardians(db, ctx.institutionId, row.studentId),
    scheduleOf(db, ctx, row.dismissalOn),
  ])
  const named = await nameLinks(db, ctx, authorizedPickups(links, row.studentId))
  return {
    ...view,
    reasonNote: row.reasonNote,
    pickupIdLast4: row.pickupIdLast4,
    maskedIdLast4: maskIdLast4(row.pickupIdLast4),
    rejectionReason: row.rejectionReason,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    releasedToKind: row.releasedToKind,
    authorizedPickups: named.map((link) => pickupView(link, null)),
    effect: effectOf(row, lessons),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function detailOf(db: Database, ctx: ServiceContext, id: string) {
  const row = await findEarlyDismissal(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return detailView(db, ctx, row)
}

/**
 * Talep görünümü (velinin listesi, açma ve iptal yanıtı): teslim yetkilisi listesi, tam son dört
 * hane ve ders etkisi yok; okul bunları ayrıntıdan okur.
 */
function guardianView(row: StoredEarlyDismissal, context: ViewContext) {
  return {
    ...rowView(row, context),
    reasonNote: row.reasonNote,
    maskedIdLast4: maskIdLast4(row.pickupIdLast4),
    rejectionReason: row.rejectionReason,
    cancelledAt: row.cancelledAt,
  }
}

// --- Kapsam --------------------------------------------------------------------------------------

/** Velinin velayetli ve iletişim kısıtı olmayan çocukları (DOM-ILT-070, DOM-ILT-074). */
async function custodialChildren(db: Database, ctx: ServiceContext) {
  const links = await loadMembershipGuardians(db, ctx.institutionId, ctx.actor.membershipId)
  return new Set(
    links
      .filter((link) => hasCustody(links, link.studentId, ctx.actor.membershipId))
      .map((link) => link.studentId),
  )
}

async function viewerOf(ctx: ServiceContext): Promise<EmergencyViewer> {
  const role = ctx.actor.role
  switch (role) {
    case 'yonetici':
    case 'onburo':
    case 'veli':
    case 'ogrenci':
      return { role }
    case 'ogretmen': {
      const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
      const teacherId = scope.teacher?.id
      if (teacherId === undefined) return { role, homeroomClassIds: [], teachingClassIds: [] }
      return {
        role,
        homeroomClassIds: source.classes.filter((c) => c.teacherId === teacherId).map((c) => c.id),
        teachingClassIds: source.assignments
          .filter((a) => a.teacherId === teacherId)
          .map((a) => a.classId),
      }
    }
    default:
      return role satisfies never
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listEarlyDismissalsFor(ctx: ServiceContext, query: EarlyDismissalQuery) {
  const { items, total } = await listEarlyDismissals(ctx.db, ctx.institutionId, query)
  return { items: await rowsView(ctx.db, ctx, items), total }
}

/** Günün durum sayıları (ön büro özeti). */
export async function earlyDismissalSummaryFor(ctx: ServiceContext, day: string | undefined) {
  const date = day ?? dayKey(ctx.now)
  return { date, counts: await dayStatusCounts(ctx.db, ctx.institutionId, date) }
}

/** Ayrıntı: neden açıklaması, son dört hane, teslim yetkilileri ve ders etkisi; okuma denetimde. */
export function getEarlyDismissalFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const detail = await detailOf(tx, ctx, id)
    await auditWork(tx, ctx, 'finance.early_dismissal.read', { type: ENTITY, id }, DETAIL_FIELDS)
    return detail
  })
}

/**
 * Velinin talepleri: velayetli olduğu çocukların son 30 günden bugüne ve ilerisine talepleri
 * (K-538). İletişim kısıtlı ya da velayetsiz bağ hiçbir satır vermez.
 */
export async function listGuardianEarlyDismissalsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; studentId?: string | undefined },
) {
  const children = await custodialChildren(ctx.db, ctx)
  const studentIds = [...children].filter(
    (id) => query.studentId === undefined || id === query.studentId,
  )
  const { items, total } = await listEarlyDismissals(ctx.db, ctx.institutionId, {
    page: query.page,
    pageSize: query.pageSize,
    studentIds,
    fromDate: addDays(dayKey(ctx.now), -30),
  })
  const context = await viewContext(ctx.db, ctx, items)
  return { items: items.map((row) => guardianView(row, context)), total }
}

/**
 * Teslim alabilecek kişiler (talep formu): öğrencinin teslim yetkilileri. Okul kurumdaki her
 * etkin öğrenciyi, veli yalnız velayetli olduğu çocuğunu sorar; kapsam dışı öğrenci 404.
 */
export async function listPickupOptionsFor(ctx: ServiceContext, studentId: string) {
  const own = ctx.actor.role === 'veli' ? ctx.actor.membershipId : null
  if (own !== null && !(await custodialChildren(ctx.db, ctx)).has(studentId))
    throw new NotFoundError()
  const facts = await studentFacts(ctx.db, ctx, [studentId])
  if (facts.get(studentId)?.active !== true) throw new NotFoundError()
  const links = await loadStudentGuardians(ctx.db, ctx.institutionId, studentId)
  const named = await nameLinks(ctx.db, ctx, authorizedPickups(links, studentId))
  return named.map((link) => pickupView(link, own))
}

/**
 * Yoklamaya yansıma (K-540): günün teslim edilmiş (gerçek çıkış) ve onaylı (planlanan saat)
 * talepleri, etkilenen ders saatleriyle. Öğretmen yalnız sınıf öğretmeni olduğu ve derse girdiği
 * sınıfları görür. Yoklama modülü bunu okur; yoklama kaydı burada yazılmaz.
 */
export async function listAttendanceEffectsFor(
  ctx: ServiceContext,
  query: { date?: string | undefined; classId?: string | undefined },
) {
  const day = query.date ?? dayKey(ctx.now)
  const visible = emergencyViewerClasses(await viewerOf(ctx))
  const statuses: EarlyDismissalStatus[] = ['approved', 'released']
  const rows = (await loadDayDismissals(ctx.db, ctx.institutionId, day, statuses)).filter(
    (row) =>
      (query.classId === undefined || row.classId === query.classId) &&
      (visible === 'all' || (row.classId !== null && visible.has(row.classId))),
  )
  const [lessons, students] = await Promise.all([
    scheduleOf(ctx.db, ctx, day),
    studentFacts(
      ctx.db,
      ctx,
      rows.map((row) => row.studentId),
    ),
  ])
  return {
    date: day,
    items: rows.flatMap((row) => {
      const effect = effectOf(row, lessons)
      if (effect === null) return []
      return [
        {
          dismissalId: row.id,
          studentId: row.studentId,
          studentName: students.get(row.studentId)?.name ?? null,
          classId: row.classId,
          // Yansıma yalnız onaylı ve teslim edilmiş talepte var (`dismissalDeparture`).
          status: row.status === 'released' ? ('released' as const) : ('approved' as const),
          ...effect,
        },
      ]
    }),
  }
}

// --- Yazma ---------------------------------------------------------------------------------------

/**
 * Talep (K-538): veli velayetli çocuğu için açar (onay bekler); yönetici ya da ön büro acil
 * durumda açar (onaylı doğar). Öğrenci, bağlar ve günün açık talebi kurum kilidi altında okunur.
 * Denetime alan adları. `Idempotency-Key` rotada zorunlu. 201.
 */
export function createEarlyDismissalCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  const requester: EarlyDismissalRequester =
    ctx.actor.role === 'veli'
      ? { kind: 'guardian', membershipId: ctx.actor.membershipId }
      : { kind: 'school' }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.early_dismissal.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = earlyDismissalCreateSchema.parse(input)
        const [facts, links, exists] = await Promise.all([
          studentFacts(tx, ctx, [parsed.studentId]),
          loadStudentGuardians(tx, ctx.institutionId, parsed.studentId),
          activeDismissalExists(tx, ctx.institutionId, parsed.studentId, parsed.date),
        ])
        const fact = facts.get(parsed.studentId)
        return {
          run: () => ({
            parsed,
            plan: planEarlyDismissal(parsed, {
              now: ctx.now,
              requester,
              student: fact === undefined ? null : { active: fact.active, classId: fact.classId },
              links,
              activeExists: exists,
            }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        await insertEarlyDismissal(tx, ctx.institutionId, {
          id,
          studentId: parsed.studentId,
          classId: plan.classId,
          dismissalOn: plan.dismissalOn,
          plannedAt: plan.plannedAt,
          reason: parsed.reason,
          reasonNote: parsed.reasonNote,
          pickupKind: plan.pickup.kind,
          pickupGuardianLinkId: plan.pickup.kind === 'guardian' ? plan.pickup.guardianLinkId : null,
          pickupName: plan.pickup.kind === 'other' ? plan.pickup.name : null,
          pickupIdLast4: plan.pickup.kind === 'other' ? plan.pickup.idLast4 : null,
          pickupRelationship: plan.pickup.kind === 'other' ? plan.pickup.relationship : null,
          status: plan.status,
          source: plan.source,
          requestedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.early_dismissal.create', entity, [
          'studentId',
          'dismissalOn',
          'plannedAt',
          'reason',
          ...(parsed.reasonNote === null ? [] : ['reasonNote']),
          'pickupKind',
          ...(plan.pickup.kind === 'guardian'
            ? ['pickupGuardianLinkId']
            : ['pickupName', 'pickupIdLast4', 'pickupRelationship']),
          'status',
          'source',
        ])
        const row = await findEarlyDismissal(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        body = { data: guardianView(row, await viewContext(tx, ctx, [row])) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Sürümlü komutun ortak yüklemesi: kayıt yoksa 404, sürüm tutmazsa 409. */
async function loadVersioned(tx: Database, ctx: ServiceContext, id: string, expected: number) {
  const row = await findEarlyDismissal(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  if (row.version !== expected) throw new ConflictError()
  return row
}

/** Veliye karar ve teslim bildirimi (yalnız talep kimliği; DOM-ILT-023). */
async function notifyGuardians(
  tx: Database,
  ctx: ServiceContext,
  type: 'early_dismissal_decided' | 'early_dismissal_released',
  row: Pick<StoredEarlyDismissal, 'id' | 'studentId'>,
) {
  await notify(tx, ctx, {
    type,
    recipients: { studentIds: [row.studentId] },
    data: { dismissalId: row.id },
    dedupeKey: `${type}:${row.id}`,
  })
}

/** Onay ya da ret (K-538). `If-Match` kayıt sürümü; veli talebinde veliye bildirim. */
export function decideEarlyDismissalCommand(
  ctx: ServiceContext,
  id: string,
  decision: 'approve' | 'reject',
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const action = `finance.early_dismissal.${decision}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const row = await loadVersioned(tx, ctx, id, expectedVersion)
        const reason = decision === 'reject' ? earlyDismissalRejectSchema.parse(input).reason : null
        return {
          run: () => {
            if (decision === 'approve') planEarlyDismissalApproval(row, ctx.now)
            else planEarlyDismissalRejection(row)
            return { row, reason }
          },
        }
      },
      after: async (tx, { row, reason }) => {
        const saved = await updateEarlyDismissal(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: reason === null ? 'approved' : 'rejected',
            decidedAt: ctx.now,
            decidedByUserId: ctx.actor.userId,
            ...(reason === null ? {} : { rejectionReason: reason }),
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, [
          'status',
          'decidedAt',
          ...(reason === null ? [] : ['rejectionReason']),
        ])
        if (row.source === 'guardian')
          await notifyGuardians(tx, ctx, 'early_dismissal_decided', row)
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * İptal: okul her talebi, veli yalnız velayetli olduğu çocuğun talebini iptal eder (başka
 * öğrencinin talebi veliye 404). Teslim edilmiş, reddedilmiş ya da iptal edilmiş talep 422.
 */
export function cancelEarlyDismissalCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const isGuardian = ctx.actor.role === 'veli'
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.early_dismissal.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await findEarlyDismissal(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        if (isGuardian && !(await custodialChildren(tx, ctx)).has(row.studentId))
          throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const parsed = earlyDismissalCancelSchema.parse(input)
        return {
          run: () => {
            planEarlyDismissalCancel(row)
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateEarlyDismissal(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'cancelled',
            cancelledAt: ctx.now,
            cancelledByUserId: ctx.actor.userId,
            cancelReason: parsed.reason,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.early_dismissal.cancel', entity, [
          'status',
          'cancelledAt',
          ...(parsed.reason === null ? [] : ['cancelReason']),
        ])
        const row = await findEarlyDismissal(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        body = { data: guardianView(row, await viewContext(tx, ctx, [row])) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Teslim (K-539): teslim alan kişi öğrencinin teslim anındaki yetkilisi ya da talepte onaylanan
 * kayıtlı olmayan kişidir (son dört hane eşleşmeli); kimlik görüldü işareti zorunlu. Teslim alanın
 * adı satıra kopyalanır, veliye bildirim gider. `If-Match` kayıt sürümü.
 */
export function releaseEarlyDismissalCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.early_dismissal.release',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await loadVersioned(tx, ctx, id, expectedVersion)
        const parsed = earlyDismissalReleaseSchema.parse(input)
        const links = await loadStudentGuardians(tx, ctx.institutionId, row.studentId)
        return {
          run: () => ({
            row,
            links,
            plan: planEarlyDismissalRelease(row, parsed, {
              now: ctx.now,
              links,
              studentId: row.studentId,
            }),
          }),
        }
      },
      after: async (tx, { row, links, plan }) => {
        let releasedToName = row.pickupName
        if (plan.releasedTo.kind === 'guardian') {
          const guardianLinkId = plan.releasedTo.guardianLinkId
          const [named] = await nameLinks(
            tx,
            ctx,
            links.filter((link) => link.id === guardianLinkId),
          )
          releasedToName = named?.name ?? null
        }
        // Core kuralı teslim alanı bulunmuş bağa ya da adlı onaylı kişiye indirger; ad hep doludur.
        if (releasedToName === null) throw new Error('early dismissal release name missing')
        const saved = await updateEarlyDismissal(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'released',
            releasedAt: new Date(plan.releasedAt),
            releasedByUserId: ctx.actor.userId,
            releasedToKind: plan.releasedTo.kind,
            releasedToGuardianLinkId:
              plan.releasedTo.kind === 'guardian' ? plan.releasedTo.guardianLinkId : null,
            releasedToName,
            releaseIdentityVerified: true,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.early_dismissal.release', entity, [
          'status',
          'releasedAt',
          'releasedToKind',
          ...(plan.releasedTo.kind === 'guardian' ? ['releasedToGuardianLinkId'] : []),
          'releasedToName',
          'releaseIdentityVerified',
        ])
        await notifyGuardians(tx, ctx, 'early_dismissal_released', row)
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
