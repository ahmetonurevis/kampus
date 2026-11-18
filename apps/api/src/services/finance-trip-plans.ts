import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  assertTripPlanTransition,
  checkTripPlan,
  planTripPlanApprove,
  planTripPlanCancel,
  planTripPlanComplete,
  planTripPlanNotice,
  planTripPlanSubmit,
  planTripPlanUpdate,
  sortTripStaff,
  TRIP_PLAN_ROLES,
  tripPlanActions,
  tripPlanNoteSchema,
  tripPlanNoticeSchema,
  tripPlanNumber,
  tripPlanReasonSchema,
  tripPlanSchema,
  tripStaffRatio,
  updateTripPlanSchema,
  type StoredTripPlanFields,
  type TripPlanEvent,
  type TripPlanStatus,
  type TripStaffMember,
} from '@kampus/school-core/lib/finance-trip-plans.ts'

import type { Database } from '../db/client.ts'
import { findFile } from '../db/files.ts'
import { loadUserNames } from '../db/finance-maintenance-requests.ts'
import {
  findStaffMemberships,
  findTripActivity,
  findTripPlan,
  insertTripPlan,
  insertTripPlanEvent,
  listTripActivityOptions,
  listTripPlanEvents,
  listTripPlans,
  listTripStaffOptions,
  loadTripPlanStaff,
  nextTripPlanSequence,
  replaceTripPlanStaff,
  tripPlanExists,
  updateTripPlan,
  type StoredTripPlan,
  type StoredTripPlanEvent,
  type StoredTripStaff,
  type TripPlanQuery,
  type TripPlanStateChanges,
} from '../db/finance-trip-plans.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Gezi planı ve onay dosyası (DOM-FIN-111; ON-155). Kural core `lib/finance-trip-plans.ts`'tedir;
 * servis kurum kilidi altında planı, görevli üyelikleri ve bağlanacak ücretli etkinliği yükler,
 * planı, görevli listesini ve geçmiş satırını aynı transaction'da yazar. Ulaşım belgesi platform
 * dosya altyapısıyla (`attachFile`, amaç `document`) bağlanır. Denetim kaydına alan adları yazılır;
 * metinler, kişiler ve telefonlar yazılmaz. Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'trip_plans'
/** Dosya bağ türü (ADR 0003 karar 5): ulaşım belgesi plana bağlanır. */
export const TRIP_PLAN_FILE_ATTACHMENT = 'trip_plan_transport'

// --- Görünümler ----------------------------------------------------------------------------------

function staffView(staff: readonly StoredTripStaff[]) {
  return sortTripStaff(staff).map((member) => ({
    membershipId: member.membershipId,
    name: member.name,
    role: member.role,
  }))
}

/** Liste satırı: kişisel veri (sürücü, acil iletişim) taşımaz. */
function listView(ctx: ServiceContext, plan: StoredTripPlan, staff: readonly StoredTripStaff[]) {
  return {
    id: plan.id,
    number: tripPlanNumber(plan.sequence),
    name: plan.name,
    departureAt: plan.departureAt,
    returnAt: plan.returnAt,
    expectedStudentCount: plan.expectedStudentCount,
    staffCount: staff.length,
    leadNames: staff
      .filter((member) => member.role === 'lead')
      .map((member) => member.name ?? 'Görevli'),
    ratioWarning: tripStaffRatio(plan.expectedStudentCount, staff.length).warning,
    paidActivity:
      plan.paidActivityId === null
        ? null
        : { id: plan.paidActivityId, name: plan.paidActivityName ?? '' },
    status: plan.status,
    authorityNotifiedOn: plan.authorityNotifiedOn,
    actions: tripPlanActions(plan.status, ctx.actor.role),
    version: plan.version,
  }
}

function eventView(event: StoredTripPlanEvent, names: ReadonlyMap<string, string>) {
  return {
    id: event.id,
    event: event.event,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note,
    actorName: names.get(event.actorUserId) ?? null,
    occurredAt: event.occurredAt,
  }
}

async function planOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findTripPlan(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

async function staffOf(db: Database, ctx: ServiceContext, planId: string) {
  return (await loadTripPlanStaff(db, ctx.institutionId, [planId])).get(planId) ?? []
}

/** Ayrıntı: bütün alanlar, görevliler, ulaşım belgesi, oran, onay bilgisi ve geçmiş. */
async function detailOf(db: Database, ctx: ServiceContext, id: string) {
  const plan = await planOf(db, ctx, id)
  const [staff, events] = await Promise.all([
    staffOf(db, ctx, id),
    listTripPlanEvents(db, ctx.institutionId, id),
  ])
  const names = await loadUserNames(db, ctx.institutionId, [
    plan.createdByUserId,
    ...(plan.approvedByUserId === null ? [] : [plan.approvedByUserId]),
    ...events.map((event) => event.actorUserId),
  ])
  const fileId = plan.transport.documentFileId
  const file = fileId === null ? null : await findFile(db, ctx.institutionId, fileId)
  return {
    ...listView(ctx, plan, staff),
    purpose: plan.purpose,
    stops: plan.stops,
    staff: staffView(staff),
    transport: {
      ...plan.transport,
      documentFile:
        file === null || file.status === 'deleted' || file.status === 'rejected'
          ? null
          : {
              id: file.id,
              name: file.originalName ?? 'ulasim-belgesi.pdf',
              byteSize: file.byteSize,
            },
    },
    risks: plan.risks,
    emergencyContacts: plan.emergencyContacts,
    paidActivity:
      plan.paidActivityId === null
        ? null
        : {
            id: plan.paidActivityId,
            name: plan.paidActivityName ?? '',
            kind: plan.paidActivityKind ?? 'trip',
            activityDate: plan.paidActivityDate ?? '',
            status: plan.paidActivityStatus ?? 'open',
          },
    ratio: tripStaffRatio(plan.expectedStudentCount, staff.length),
    submittedAt: plan.submittedAt,
    approvedAt: plan.approvedAt,
    approvedByName:
      plan.approvedByUserId === null ? null : (names.get(plan.approvedByUserId) ?? null),
    rejectedAt: plan.rejectedAt,
    rejectionReason: plan.rejectionReason,
    authorityReference: plan.authorityReference,
    completedAt: plan.completedAt,
    cancelledAt: plan.cancelledAt,
    cancelReason: plan.cancelReason,
    createdByName: names.get(plan.createdByUserId) ?? null,
    createdAt: plan.createdAt,
    events: events.map((event) => eventView(event, names)),
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listTripPlansFor(ctx: ServiceContext, query: TripPlanQuery) {
  const { items, total } = await listTripPlans(ctx.db, ctx.institutionId, query)
  const staff = await loadTripPlanStaff(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  return { items: items.map((item) => listView(ctx, item, staff.get(item.id) ?? [])), total }
}

export function getTripPlanFor(ctx: ServiceContext, id: string) {
  return detailOf(ctx.db, ctx, id)
}

/** Form seçenekleri: etkin öğretmen ve yöneticiler, bağlanabilir ücretli etkinlikler. */
export async function tripPlanOptionsFor(ctx: ServiceContext) {
  const [staff, activities] = await Promise.all([
    listTripStaffOptions(ctx.db, ctx.institutionId),
    listTripActivityOptions(ctx.db, ctx.institutionId, dayKey(ctx.now)),
  ])
  return { staff, activities }
}

// --- Yardımcılar ---------------------------------------------------------------------------------

const attachDocument = (tx: Database, ctx: ServiceContext, planId: string, fileId: string) =>
  attachFile(tx, ctx, {
    fileId,
    attachedType: TRIP_PLAN_FILE_ATTACHMENT,
    attachedId: planId,
    dataSubjectId: null,
  })

const detachDocument = (tx: Database, ctx: ServiceContext, planId: string, fileId: string) =>
  detachFile(tx, ctx, { fileId, attachedType: TRIP_PLAN_FILE_ATTACHMENT, attachedId: planId })

async function staffChecks(tx: Database, ctx: ServiceContext, staff: readonly TripStaffMember[]) {
  return findStaffMemberships(
    tx,
    ctx.institutionId,
    staff.map((member) => member.membershipId),
  )
}

function storedFields(
  plan: StoredTripPlan,
  staff: readonly StoredTripStaff[],
): StoredTripPlanFields {
  return {
    name: plan.name,
    purpose: plan.purpose,
    departureAt: plan.departureAt,
    returnAt: plan.returnAt,
    expectedStudentCount: plan.expectedStudentCount,
    stops: plan.stops,
    staff: staff.map((member) => ({ membershipId: member.membershipId, role: member.role })),
    transport: plan.transport,
    risks: plan.risks,
    emergencyContacts: plan.emergencyContacts,
    paidActivityId: plan.paidActivityId,
  }
}

/** Taslağa dönüşte silinen karar alanları (yeniden onay; K-367). */
const REOPEN: TripPlanStateChanges = {
  status: 'draft',
  submittedAt: null,
  approvedAt: null,
  approvedByUserId: null,
  rejectedAt: null,
  rejectionReason: null,
  authorityNotifiedOn: null,
  authorityReference: null,
}

// --- Komutlar ------------------------------------------------------------------------------------

/** Yeni plan taslak açılır (K-366). 201. */
export function createTripPlanCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'trip_plan.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = tripPlanSchema.parse(input)
        const staff = await staffChecks(tx, ctx, data.staff)
        const activity =
          data.paidActivityId === null
            ? undefined
            : await findTripActivity(tx, ctx.institutionId, data.paidActivityId, null)
        return {
          run: () => {
            checkTripPlan(data, {
              now: ctx.now,
              staff,
              ...(activity === undefined ? {} : { activity }),
            })
            return data
          },
        }
      },
      after: async (tx, data) => {
        // Dosya satırı yabancı anahtardır: önce bağlanır (başkasının ya da başka kurumun dosyası
        // 422 `file_unavailable`), sonra plan yazılır.
        if (data.transport.documentFileId !== null)
          await attachDocument(tx, ctx, id, data.transport.documentFileId)
        await insertTripPlan(tx, ctx.institutionId, {
          ...data,
          id,
          sequence: await nextTripPlanSequence(tx, ctx.institutionId),
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await replaceTripPlanStaff(tx, ctx.institutionId, {
          planId: id,
          staff: data.staff,
          now: ctx.now,
          ids: randomUUID,
        })
        await insertTripPlanEvent(tx, ctx.institutionId, {
          id: randomUUID(),
          planId: id,
          event: 'created',
          fromStatus: null,
          toStatus: 'draft',
          note: null,
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'trip_plan.create', entity, [
          'name',
          'purpose',
          'departureAt',
          'returnAt',
          'expectedStudentCount',
          'stops',
          'staff',
          'transport',
          ...(data.risks.length === 0 ? [] : ['risks']),
          ...(data.emergencyContacts.length === 0 ? [] : ['emergencyContacts']),
          ...(data.paidActivityId === null ? [] : ['paidActivityId']),
        ])
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Düzeltme (K-367): değişen alanlar yazılır, birleşik plan bütün olarak denetlenir. Taslak dışındaki
 * plan taslağa döner; onay, ret ve bildirim işareti düşer, geçmişe "yeniden açıldı" yazılır.
 */
export function updateTripPlanCommand(
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
      action: 'trip_plan.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await planOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const currentStaff = await staffOf(tx, ctx, id)
        const changes = updateTripPlanSchema.parse(input)
        const fields = storedFields(current, currentStaff)
        const staff =
          changes.staff === undefined ? new Map() : await staffChecks(tx, ctx, changes.staff)
        const activityId =
          changes.paidActivityId === undefined ? current.paidActivityId : changes.paidActivityId
        const datesChange = changes.departureAt !== undefined || changes.returnAt !== undefined
        const activity =
          activityId !== null && (changes.paidActivityId !== undefined || datesChange)
            ? await findTripActivity(tx, ctx.institutionId, activityId, id)
            : undefined
        return {
          run: () => {
            const plan = planTripPlanUpdate({ ...fields, status: current.status }, changes)
            const staffChanged = plan.changed.includes('staff')
            const activityChecked =
              plan.changed.includes('paidActivityId') ||
              plan.changed.includes('departureAt') ||
              plan.changed.includes('returnAt')
            // Değişmeyen görevli ve etkinlik yeniden denetlenmez: sonradan pasifleşen görevli ya da
            // iptal edilen etkinlik başka alanın düzeltilmesini engellemez.
            checkTripPlan(
              {
                ...plan.next,
                staff: staffChanged ? plan.next.staff : [],
                paidActivityId: activityChecked ? plan.next.paidActivityId : null,
              },
              {
                now: ctx.now,
                allowPastDeparture: !plan.changed.includes('departureAt'),
                staff,
                ...(activity === undefined ? {} : { activity }),
              },
            )
            return { plan, current }
          },
        }
      },
      after: async (tx, { plan, current }) => {
        const { changed, next, reopens } = plan
        if (changed.includes('transport')) {
          const before = current.transport.documentFileId
          const after = next.transport.documentFileId
          if (before !== after) {
            if (before !== null) await detachDocument(tx, ctx, id, before)
            if (after !== null) await attachDocument(tx, ctx, id, after)
          }
        }
        const content: Record<string, unknown> = {}
        for (const key of changed) if (key !== 'staff') content[key] = next[key]
        const saved = await updateTripPlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          content,
          ...(reopens ? { changes: REOPEN } : {}),
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        if (changed.includes('staff'))
          await replaceTripPlanStaff(tx, ctx.institutionId, {
            planId: id,
            staff: next.staff,
            now: ctx.now,
            ids: randomUUID,
          })
        if (reopens)
          await insertTripPlanEvent(tx, ctx.institutionId, {
            id: randomUUID(),
            planId: id,
            event: 'reopened',
            fromStatus: current.status,
            toStatus: 'draft',
            note: null,
            actorUserId: ctx.actor.userId,
            now: ctx.now,
          })
        await auditWork(tx, ctx, 'trip_plan.update', entity, [
          ...changed,
          ...(reopens ? ['status'] : []),
        ])
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

interface TransitionPlan {
  changes: TripPlanStateChanges & { status: TripPlanStatus }
  event: TripPlanEvent
  note: string | null
  fields: string[]
}

/** Planlayıcı yüklemede gövdeyi ayrıştırır, dönen fonksiyon kuralı çalıştırır. */
type Planner = (current: StoredTripPlan) => () => TransitionPlan

/**
 * Durum geçişi (K-367): plan yüklenir, sürüm `If-Match` ile karşılaştırılır, core kuralı çalışır;
 * plan ve geçmiş satırı aynı transaction'da yazılır.
 */
function transitionCommand(
  ctx: ServiceContext,
  id: string,
  action: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
  planner: Planner,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const auditAction = `trip_plan.${action}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action: auditAction,
      collections: [],
      entity,
      load: async (tx) => {
        const current = await planOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const plan = planner(current)
        return { run: () => ({ current, planned: plan() }) }
      },
      after: async (tx, { current, planned }) => {
        const saved = await updateTripPlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: planned.changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await insertTripPlanEvent(tx, ctx.institutionId, {
          id: randomUUID(),
          planId: id,
          event: planned.event,
          fromStatus: current.status,
          toStatus: planned.changes.status,
          note: planned.note,
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, auditAction, entity, planned.fields)
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

type Command = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => Promise<CommandResponse>

const withNote = (fields: string[], note: string | null) =>
  note === null ? fields : [...fields, 'note']

/** Onaya gönderme (K-366, K-367): risk, acil iletişim ve kara yolu ulaşım bilgisi tamam olmalı. */
export const submitTripPlanCommand: Command = (ctx, id, input, version, idempotency) => {
  return transitionCommand(ctx, id, 'submit', version, idempotency, (current) => {
    const parsed = tripPlanNoteSchema.parse(input ?? {})
    return () => {
      planTripPlanSubmit(current, ctx.now)
      return {
        changes: { status: 'submitted', submittedAt: ctx.now },
        event: 'submitted',
        note: parsed.note,
        fields: withNote(['status'], parsed.note),
      }
    }
  })
}

/** Onay (K-367): yalnız yönetici; çıkış geçmişse onaylanmaz. */
export const approveTripPlanCommand: Command = (ctx, id, input, version, idempotency) => {
  return transitionCommand(ctx, id, 'approve', version, idempotency, (current) => {
    const parsed = tripPlanNoteSchema.parse(input ?? {})
    return () => {
      planTripPlanApprove(current, ctx.now)
      return {
        changes: { status: 'approved', approvedAt: ctx.now, approvedByUserId: ctx.actor.userId },
        event: 'approved',
        note: parsed.note,
        fields: withNote(['status', 'approvedAt'], parsed.note),
      }
    }
  })
}

/** Ret (K-367): gerekçe zorunlu; gerekçe denetim kaydına yazılmaz. */
export const rejectTripPlanCommand: Command = (ctx, id, input, version, idempotency) => {
  return transitionCommand(ctx, id, 'reject', version, idempotency, (current) => {
    const parsed = tripPlanReasonSchema.parse(input)
    return () => {
      assertTripPlanTransition(current.status, 'reject')
      return {
        changes: { status: 'rejected', rejectedAt: ctx.now, rejectionReason: parsed.reason },
        event: 'rejected',
        note: parsed.reason,
        fields: ['status', 'rejectionReason'],
      }
    }
  })
}

/** Tamamlama (K-367): onaylanmış plan dönüş anından sonra. */
export const completeTripPlanCommand: Command = (ctx, id, input, version, idempotency) => {
  return transitionCommand(ctx, id, 'complete', version, idempotency, (current) => {
    const parsed = tripPlanNoteSchema.parse(input ?? {})
    return () => {
      planTripPlanComplete(current, ctx.now)
      return {
        changes: { status: 'completed', completedAt: ctx.now },
        event: 'completed',
        note: parsed.note,
        fields: withNote(['status', 'completedAt'], parsed.note),
      }
    }
  })
}

/** İptal (K-367): gerekçe zorunlu; ön büro yalnız taslak ve reddedilmiş planı iptal eder. */
export const cancelTripPlanCommand: Command = (ctx, id, input, version, idempotency) => {
  return transitionCommand(ctx, id, 'cancel', version, idempotency, (current) => {
    const parsed = tripPlanReasonSchema.parse(input)
    return () => {
      planTripPlanCancel(current.status, ctx.actor.role)
      return {
        changes: { status: 'cancelled', cancelledAt: ctx.now, cancelReason: parsed.reason },
        event: 'cancelled',
        note: parsed.reason,
        fields: ['status', 'cancelReason'],
      }
    }
  })
}

/** Millî eğitim bildirimi işareti (K-368): gün ve isteğe bağlı evrak sayısı; durum değişmez. */
export const noticeTripPlanCommand: Command = (ctx, id, input, version, idempotency) => {
  return transitionCommand(ctx, id, 'authority_notice', version, idempotency, (current) => {
    const parsed = tripPlanNoticeSchema.parse(input)
    return () => {
      planTripPlanNotice(current, parsed.notifiedOn, ctx.now)
      return {
        changes: {
          status: current.status,
          authorityNotifiedOn: parsed.notifiedOn,
          authorityReference: parsed.reference,
        },
        event: 'authority_notified',
        note:
          parsed.reference === null
            ? parsed.notifiedOn
            : `${parsed.notifiedOn} · ${parsed.reference}`,
        fields: [
          'authorityNotifiedOn',
          ...(parsed.reference === null ? [] : ['authorityReference']),
        ],
      }
    }
  })
}

/**
 * Plana bağlı ulaşım belgesi planı okuyabilene açılır (ADR 0003 karar 6): yönetici ve ön büro,
 * `finance` modülü açıkken ve plan arşivlenmemişken. PGlite tek bağlantılıdır: okuma işlemin
 * bağlantısıyla (`tx`) yapılır.
 */
defineFileAttachment(TRIP_PLAN_FILE_ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, planId) => {
    if (!(TRIP_PLAN_ROLES as readonly string[]).includes(ctx.actor.role)) return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    return tripPlanExists(tx, ctx.institutionId, planId)
  },
})
