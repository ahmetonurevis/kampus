import { randomUUID } from 'node:crypto'

import {
  checklistProgress,
  DEFAULT_MENTORSHIP_CHECKLIST,
  MENTOR_LOAD_DEFAULT,
  mentorshipCompleteSchema,
  mentorshipContact,
  mentorshipCreateSchema,
  mentorshipEmptySchema,
  mentorshipEndSchema,
  mentorshipMeetingSchema,
  mentorshipOverdueBefore,
  mentorshipSettingsSchema,
  mentorshipSummary,
  planChecklistItemComplete,
  planChecklistItemReopen,
  planMentorship,
  planMentorshipComplete,
  planMentorshipEnd,
  planMentorshipMeeting,
  planMentorshipMeetingArchive,
} from '@kampus/school-core/lib/finance-teacher-mentorships.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  archiveMentorshipMeeting,
  bumpMentorship,
  countActiveForMentor,
  findMentorship,
  findMentorshipMember,
  findMentorshipOnboardingOffer,
  insertMentorship,
  insertMentorshipMeeting,
  listLinkableOnboardingOffers,
  listMentorships,
  listMentorshipStates,
  loadMentorshipChecklist,
  loadMentorshipMeetings,
  loadMentorshipSettings,
  menteeHasActive,
  mentorshipAggregates,
  mentorshipMeetingExists,
  saveMentorshipSettings,
  setChecklistItem,
  type MentorshipAggregate,
  type MentorshipQuery,
  type StoredMentorship,
} from '../db/finance-teacher-mentorships.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Yeni öğretmen mentorluğu (DOM-FIN-136; ON-219). Kural core `lib/finance-teacher-mentorships.ts`'
 * tedir; servis kurum kilidi altında eşleşmeyi, üyelikleri, mentor yükünü, işe başlama listesini
 * ve ayarı yükler, tek transaction'da yazar ve denetime alan adlarını yazar (not, sonraki adım
 * ve gerekçe yazılmaz). Takip (son görüşme, 30 gün, tamamlanma oranı) her okumada hesaplanır,
 * saklanmaz. Eşleşme okuması (liste ve ayrıntı) aynı transaction'da
 * `finance.teacher_mentorship.read` denetimine düşer (K-465). Rol ve modül denetimi rotadadır.
 */

const SETTINGS_ENTITY = 'teacher_mentorship_settings'
const ENTITY = 'teacher_mentorships'
const READ_ACTION = 'finance.teacher_mentorship.read'
/** Okuma denetimine yazılan kişisel alan adları (değer değil). */
const LIST_FIELDS = ['mentorName', 'menteeName', 'status', 'endReason']
const DETAIL_FIELDS = [...LIST_FIELDS, 'meetings', 'checklistItems']

const today = (ctx: ServiceContext) => dayKey(ctx.now)

// --- Ayar ----------------------------------------------------------------------------------------

export async function getMentorshipSettingsFor(ctx: ServiceContext) {
  const stored = await loadMentorshipSettings(ctx.db, ctx.institutionId)
  return {
    maxActivePerMentor: stored?.maxActivePerMentor ?? MENTOR_LOAD_DEFAULT,
    checklistItems:
      stored?.checklistItems ?? DEFAULT_MENTORSHIP_CHECKLIST.map((item) => ({ ...item })),
    isDefault: stored === null,
    updatedAt: stored?.updatedAt ?? null,
    version: stored?.version ?? null,
  }
}

/**
 * Ayar (K-463, K-465): bütünüyle yazılır. İlk yazma `If-Match` almaz (ayar varsa 409), sonrakiler
 * ayarın sürümünü ister. Açılmış eşleşmelerin listesi değişmez.
 */
export function updateMentorshipSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number | null,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS_ENTITY, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.teacher_mentorship_settings.update',
      collections: [],
      entity,
      load: async (tx) => {
        const stored = await loadMentorshipSettings(tx, ctx.institutionId)
        if ((stored?.version ?? null) !== expectedVersion) throw new ConflictError()
        const data = mentorshipSettingsSchema.parse(input)
        return { run: () => data }
      },
      after: async (tx, data) => {
        const saved = await saveMentorshipSettings(tx, ctx.institutionId, {
          ...data,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.teacher_mentorship_settings.update', entity, [
          'maxActivePerMentor',
          'checklistItems',
        ])
        body = { data: await getMentorshipSettingsFor({ ...ctx, db: tx }) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** İşe başlama listesi seçimi (K-463): kabul edilmiş, hesabı bağlı teklifler. */
export const listMentorshipOnboardingOptionsFor = (ctx: ServiceContext) =>
  listLinkableOnboardingOffers(ctx.db, ctx.institutionId)

// --- Okuma ---------------------------------------------------------------------------------------

const EMPTY_AGGREGATE: MentorshipAggregate = { meetingCount: 0, lastMeetingDate: null, items: [] }

function rowView(item: StoredMentorship, aggregate: MentorshipAggregate, day: string) {
  return {
    ...item,
    meetingCount: aggregate.meetingCount,
    ...mentorshipContact(item, aggregate.lastMeetingDate, day),
    checklist: checklistProgress(aggregate.items),
  }
}

async function rowViews(db: Database, ctx: ServiceContext, items: readonly StoredMentorship[]) {
  const aggregates = await mentorshipAggregates(
    db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  const day = today(ctx)
  return items.map((item) => rowView(item, aggregates.get(item.id) ?? EMPTY_AGGREGATE, day))
}

async function auditRead(
  tx: Database,
  ctx: ServiceContext,
  entityId: string | null,
  fields: string[],
  count: number,
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: READ_ACTION,
    entityType: ENTITY,
    entityId,
    // kvkk: değer değil, dönen kişisel alanların adı ve kayıt sayısı.
    changes: { fields, counts: { mentorships: count } },
    createdAt: ctx.now,
  })
}

/** Eşleşme listesi ve takip alanları (K-465); okuma aynı transaction'da denetime yazılır. */
export async function listMentorshipsFor(ctx: ServiceContext, query: MentorshipQuery) {
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listMentorships(
      tx,
      ctx.institutionId,
      query,
      mentorshipOverdueBefore(today(ctx)),
    )
    await auditRead(tx, ctx, null, LIST_FIELDS, items.length)
    return { items: await rowViews(tx, ctx, items), total }
  })
}

/** Kurum özeti (K-465): yalnız sayılar ve oran; kişisel alan taşımadığı için denetlenmez. */
export async function getMentorshipSummaryFor(ctx: ServiceContext) {
  const states = await listMentorshipStates(ctx.db, ctx.institutionId)
  const aggregates = await mentorshipAggregates(
    ctx.db,
    ctx.institutionId,
    states.map((state) => state.id),
  )
  const day = today(ctx)
  return mentorshipSummary(
    states.map((state) => {
      const aggregate = aggregates.get(state.id) ?? EMPTY_AGGREGATE
      return {
        status: state.status,
        overdue: mentorshipContact(state, aggregate.lastMeetingDate, day).overdue,
        checklist: checklistProgress(aggregate.items),
      }
    }),
  )
}

async function detail(db: Database, ctx: ServiceContext, id: string) {
  const mentorship = await findMentorship(db, ctx.institutionId, id)
  if (mentorship === null) return null
  const [meetings, checklistItems, aggregates] = await Promise.all([
    loadMentorshipMeetings(db, ctx.institutionId, id),
    loadMentorshipChecklist(db, ctx.institutionId, id),
    mentorshipAggregates(db, ctx.institutionId, [id]),
  ])
  return {
    ...rowView(mentorship, aggregates.get(id) ?? EMPTY_AGGREGATE, today(ctx)),
    meetings,
    checklistItems,
  }
}

/** Tek eşleşme, görüşmeleri ve maddeleri; başka kurumun eşleşmesi 404. Okuma denetime düşer. */
export async function getMentorshipFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const found = await detail(tx, ctx, id)
    if (found === null) throw new NotFoundError()
    await auditRead(tx, ctx, id, DETAIL_FIELDS, 1)
    return found
  })
}

async function detailBody(tx: Database, ctx: ServiceContext, id: string) {
  const found = await detail(tx, ctx, id)
  if (found === null) throw new Error('teacher mentorship was not written')
  return { data: found }
}

// --- Yazma ---------------------------------------------------------------------------------------

/**
 * Yeni eşleşme (K-463): mentor, yeni öğretmen, günler ve isteğe bağlı işe başlama listesi; kurum
 * ayarındaki maddeler kopyalanır (K-465). `Idempotency-Key` rotada zorunludur. 201.
 */
export function createMentorshipCommand(
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
      action: 'finance.teacher_mentorship.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mentorshipCreateSchema.parse(input)
        const { institutionId } = ctx
        const [mentor, mentee, hasActive, mentorActiveCount, onboarding, settings] =
          await Promise.all([
            findMentorshipMember(tx, institutionId, parsed.mentorMembershipId),
            findMentorshipMember(tx, institutionId, parsed.menteeMembershipId),
            menteeHasActive(tx, institutionId, parsed.menteeMembershipId),
            countActiveForMentor(tx, institutionId, parsed.mentorMembershipId),
            parsed.onboardingOfferId === null
              ? Promise.resolve(undefined)
              : findMentorshipOnboardingOffer(tx, institutionId, parsed.onboardingOfferId),
            getMentorshipSettingsFor({ ...ctx, db: tx }),
          ])
        return {
          run: () => ({
            parsed,
            checklist: planMentorship(parsed, {
              mentor,
              mentee,
              menteeHasActive: hasActive,
              mentorActiveCount,
              maxActivePerMentor: settings.maxActivePerMentor,
              onboarding,
              checklist: settings.checklistItems,
            }),
          }),
        }
      },
      after: async (tx, { parsed, checklist }) => {
        await insertMentorship(tx, ctx.institutionId, {
          id,
          ...parsed,
          checklist: checklist.map((item) => ({ id: randomUUID(), ...item })),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.teacher_mentorship.create', entity, [
          'mentorMembershipId',
          'menteeMembershipId',
          'startDate',
          'endDate',
          'checklistItems',
          ...(parsed.onboardingOfferId === null ? [] : ['onboardingOfferId']),
        ])
        body = await detailBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const mentorship = await findMentorship(tx, ctx.institutionId, id)
  if (mentorship === null) throw new NotFoundError()
  if (mentorship.version !== expectedVersion) throw new ConflictError()
  return mentorship
}

async function bumpOrConflict(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const saved = await bumpMentorship(tx, ctx.institutionId, { id, expectedVersion, now: ctx.now })
  if (!saved) throw new ConflictError()
}

/** Ortak çalıştırıcı: eşleşmenin `If-Match` sürümüyle yapılan alt işlemler. */
function mentorshipCommand<P>(
  ctx: ServiceContext,
  spec: {
    id: string
    action: string
    expectedVersion: number
    idempotency: IdempotencyRequest | null
    statusCode?: number
    /** Gerekeni yükler; dönen işlev core kuralını çalıştırır (kural reddi 422/409 eşlenir). */
    plan: (tx: Database, mentorship: StoredMentorship) => Promise<() => P>
    write: (tx: Database, plan: P) => Promise<string[]>
  },
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id: spec.id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: spec.action,
      collections: [],
      entity,
      load: async (tx) => {
        const mentorship = await loadForWrite(tx, ctx, spec.id, spec.expectedVersion)
        return { run: await spec.plan(tx, mentorship) }
      },
      after: async (tx, plan) => {
        const fields = await spec.write(tx, plan)
        await auditWork(tx, ctx, spec.action, entity, fields)
        body = await detailBody(tx, ctx, spec.id)
      },
    },
    () => ({ statusCode: spec.statusCode ?? 200, body }),
    spec.idempotency,
  )
}

/**
 * Görüşme kaydı (K-464): yalnız süren eşleşmeye; gün başlangıçla bugün arasında. Not ve sonraki
 * adım denetime yazılmaz. `Idempotency-Key` ve eşleşmenin `If-Match` sürümü zorunludur. 201.
 */
export function addMentorshipMeetingCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return mentorshipCommand(ctx, {
    id,
    action: 'finance.teacher_mentorship.meeting',
    expectedVersion,
    idempotency,
    statusCode: 201,
    plan: async (_tx, mentorship) => {
      const parsed = mentorshipMeetingSchema.parse(input)
      return () => {
        planMentorshipMeeting(mentorship, parsed, today(ctx))
        return parsed
      }
    },
    write: async (tx, meeting) => {
      await bumpOrConflict(tx, ctx, id, expectedVersion)
      await insertMentorshipMeeting(tx, ctx.institutionId, {
        id: randomUUID(),
        mentorshipId: id,
        ...meeting,
        userId: ctx.actor.userId,
        now: ctx.now,
      })
      return [
        'meetingDate',
        'durationMinutes',
        'topic',
        ...(meeting.note === null ? [] : ['note']),
        ...(meeting.nextStep === null ? [] : ['nextStep']),
      ]
    },
  })
}

/** Yanlış görüşme kaydının arşivi (K-464): süren eşleşmede; görüşme yoksa 404. */
export function archiveMentorshipMeetingCommand(
  ctx: ServiceContext,
  id: string,
  meetingId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return mentorshipCommand(ctx, {
    id,
    action: 'finance.teacher_mentorship.meeting_archive',
    expectedVersion,
    idempotency,
    plan: async (tx, mentorship) => {
      mentorshipEmptySchema.parse(input)
      if (!(await mentorshipMeetingExists(tx, ctx.institutionId, id, meetingId)))
        throw new NotFoundError()
      return () => planMentorshipMeetingArchive(mentorship)
    },
    write: async (tx) => {
      await bumpOrConflict(tx, ctx, id, expectedVersion)
      if (
        !(await archiveMentorshipMeeting(tx, ctx.institutionId, {
          mentorshipId: id,
          meetingId,
          now: ctx.now,
        }))
      )
        throw new NotFoundError()
      return ['meetings.archivedAt']
    },
  })
}

async function itemOf(tx: Database, ctx: ServiceContext, id: string, itemId: string) {
  const items = await loadMentorshipChecklist(tx, ctx.institutionId, id)
  const item = items.find((entry) => entry.id === itemId)
  if (item === undefined) throw new NotFoundError()
  return item
}

/** Madde işareti (K-465): süren eşleşmede; kim ve ne zaman yazılır. Eşleşmenin `If-Match`'i. */
export function setMentorshipChecklistItemCommand(
  ctx: ServiceContext,
  id: string,
  itemId: string,
  verb: 'complete' | 'reopen',
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return mentorshipCommand(ctx, {
    id,
    action: `finance.teacher_mentorship.item_${verb}`,
    expectedVersion,
    idempotency,
    plan: async (tx, mentorship) => {
      mentorshipEmptySchema.parse(input)
      const item = await itemOf(tx, ctx, id, itemId)
      return () =>
        verb === 'complete'
          ? planChecklistItemComplete(mentorship, item)
          : planChecklistItemReopen(mentorship, item)
    },
    write: async (tx) => {
      await bumpOrConflict(tx, ctx, id, expectedVersion)
      const saved = await setChecklistItem(tx, ctx.institutionId, {
        mentorshipId: id,
        itemId,
        completed: verb === 'complete' ? { userId: ctx.actor.userId } : null,
        now: ctx.now,
      })
      if (!saved) throw new NotFoundError()
      return ['checklistItems.completedAt', 'checklistItems.completedByUserId']
    },
  })
}

/**
 * Tamamlama (K-463, K-465): en az bir görüşme ve zorunlu maddelerin hepsi; gün başlangıçla bugün
 * arasında. Tamamlanan eşleşme değişmez.
 */
export function completeMentorshipCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return mentorshipCommand(ctx, {
    id,
    action: 'finance.teacher_mentorship.complete',
    expectedVersion,
    idempotency,
    plan: async (tx, mentorship) => {
      const { closedOn } = mentorshipCompleteSchema.parse(input)
      const aggregate =
        (await mentorshipAggregates(tx, ctx.institutionId, [id])).get(id) ?? EMPTY_AGGREGATE
      return () => {
        planMentorshipComplete(mentorship, aggregate, closedOn, today(ctx))
        return closedOn
      }
    },
    write: async (tx, closedOn) => {
      const saved = await bumpMentorship(tx, ctx.institutionId, {
        id,
        expectedVersion,
        now: ctx.now,
        close: { status: 'completed', closedOn, endReason: null, userId: ctx.actor.userId },
      })
      if (!saved) throw new ConflictError()
      return ['status', 'closedOn']
    },
  })
}

/** Erken sonlandırma (K-463): gerekçe zorunlu (denetime yazılmaz); sonra eşleşme değişmez. */
export function endMentorshipCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return mentorshipCommand(ctx, {
    id,
    action: 'finance.teacher_mentorship.end',
    expectedVersion,
    idempotency,
    plan: async (_tx, mentorship) => {
      const parsed = mentorshipEndSchema.parse(input)
      return () => {
        planMentorshipEnd(mentorship, parsed.closedOn, today(ctx))
        return parsed
      }
    },
    write: async (tx, parsed) => {
      const saved = await bumpMentorship(tx, ctx.institutionId, {
        id,
        expectedVersion,
        now: ctx.now,
        close: {
          status: 'ended_early',
          closedOn: parsed.closedOn,
          endReason: parsed.reason,
          userId: ctx.actor.userId,
        },
      })
      if (!saved) throw new ConflictError()
      return ['status', 'closedOn', 'endReason']
    },
  })
}
