import { randomUUID } from 'node:crypto'

import { subjects as curriculumSubjects } from '@kampus/school-core/data/curriculum.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  assertDecision,
  assertFinalize,
  assertFollowUp,
  assertMeetingDateFitsDecisions,
  assertMeetingEditable,
  assertMeetingPerson,
  departmentDecisionFollowUpSchema,
  departmentDecisionInputSchema,
  departmentMeetingFinalizeSchema,
  departmentMeetingInputSchema,
  isDecisionOverdue,
  mergeAgenda,
  numberDecisions,
  overdueDays,
  type DepartmentDecisionStatus,
  type DepartmentMeetingInput,
  type StoredAgendaItem,
} from '@kampus/school-core/lib/finance-department-meetings.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findDecision,
  findMeeting,
  findMeetingStaff,
  insertDecision,
  insertMeeting,
  listAttendees,
  listDecisions,
  listMeetingDecisions,
  listMeetings,
  syncAttendees,
  updateDecision,
  updateMeeting,
  type MeetingQuery,
  type StoredAttendee,
  type StoredDecision,
  type StoredMeeting,
} from '../db/finance-department-meetings.ts'
import { loadBranchData } from '../db/finance-leave-calendar.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Zümre toplantısı tutanağı (DOM-FIN-132; ON-217; K-451…K-453). Kural core
 * `lib/finance-department-meetings.ts`'tedir; servis kurum kilidi altında toplantıyı, kararları
 * ve kişilerin üyeliğini yükler, tek transaction'da yazar ve denetime alan adlarını düşer. Zümre
 * dersi izin takvimiyle aynı kaynaktan okunur (K-421 `loadBranchData`). Rol ve modül denetimi
 * rotadadır.
 */

const MEETING = 'department_meetings'
const DECISION = 'department_meeting_decisions'
const SUBJECT_NAME_MAX = 120

export function meetingView(meeting: StoredMeeting) {
  return {
    id: meeting.id,
    subjectId: meeting.subjectId,
    subjectName: meeting.subjectName,
    kind: meeting.kind,
    meetingDate: meeting.meetingDate,
    location: meeting.location,
    chairMembershipId: meeting.chairMembershipId,
    chairName: meeting.chairName,
    agendaCount: meeting.agenda.length,
    status: meeting.status,
    signedDate: meeting.signedDate,
    finalizedAt: meeting.finalizedAt,
    attendeeCount: meeting.attendeeCount,
    attendedCount: meeting.attendedCount,
    decisionCount: meeting.decisionCount,
    openDecisionCount: meeting.openDecisionCount,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
    version: meeting.version,
  }
}

const attendeeView = (attendee: StoredAttendee) => ({
  membershipId: attendee.membershipId,
  name: attendee.name,
  role: attendee.role,
  active: attendee.active,
  status: attendee.status,
})

function decisionView(decision: StoredDecision & { number: string }, today: string) {
  return {
    id: decision.id,
    number: decision.number,
    agendaItemId: decision.agendaItemId,
    text: decision.text,
    responsibleMembershipId: decision.responsibleMembershipId,
    responsibleName: decision.responsibleName,
    dueDate: decision.dueDate,
    status: decision.status,
    followUpNote: decision.followUpNote,
    overdue: isDecisionOverdue(decision, today),
    statusChangedAt: decision.statusChangedAt,
    createdAt: decision.createdAt,
    version: decision.version,
  }
}

const todayOf = (ctx: ServiceContext) => dayKey(ctx.now)

export async function listMeetingsFor(ctx: ServiceContext, query: MeetingQuery) {
  const { items, total } = await listMeetings(ctx.db, ctx.institutionId, query)
  return { items: items.map(meetingView), total }
}

async function detailBody(db: Database, ctx: ServiceContext, id: string) {
  const meeting = await findMeeting(db, ctx.institutionId, id)
  if (meeting === null) throw new NotFoundError()
  const [attendees, decisions] = await Promise.all([
    listAttendees(db, ctx.institutionId, id),
    listMeetingDecisions(db, ctx.institutionId, id),
  ])
  const today = todayOf(ctx)
  return {
    ...meetingView(meeting),
    agenda: meeting.agenda,
    attendees: attendees.map(attendeeView),
    decisions: numberDecisions(meeting.agenda, decisions).map((decision) =>
      decisionView(decision, today),
    ),
  }
}

/** Tutanak ayrıntısı: gündem, katılım ve numaralı kararlar (PDF bu yanıttan üretilir). */
export async function meetingFor(ctx: ServiceContext, id: string) {
  return detailBody(ctx.db, ctx, id)
}

/** Kesinleşmiş tutanakların kararları; `overdue` termini geçmiş açık kararlar (K-453). */
export async function listDecisionsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    status?: DepartmentDecisionStatus | undefined
    overdue?: boolean | undefined
    responsibleMembershipId?: string | undefined
    subjectId?: string | undefined
  },
) {
  const today = todayOf(ctx)
  const { items, total } = await listDecisions(ctx.db, ctx.institutionId, { ...query, today })
  return {
    items: items.map((item) => ({
      id: item.id,
      meetingId: item.meetingId,
      subjectName: item.subjectName,
      meetingDate: item.meetingDate,
      meetingKind: item.meetingKind,
      agendaTitle: item.agendaTitle,
      text: item.text,
      responsibleMembershipId: item.responsibleMembershipId,
      responsibleName: item.responsibleName,
      dueDate: item.dueDate,
      status: item.status,
      followUpNote: item.followUpNote,
      overdue: isDecisionOverdue(item, today),
      overdueDays: overdueDays(item, today),
      statusChangedAt: item.statusChangedAt,
      version: item.version,
    })),
    total,
  }
}

/**
 * Zümre seçenekleri (K-451): kurumun ders kayıtları ve öğretmen kayıtlarının dersleri (izin
 * takvimiyle aynı kaynak, K-421); kurumda hiç ders yoksa müfredat dersleri.
 */
async function subjectOptions(db: Database, institutionId: string) {
  const { subjectNames } = await loadBranchData(db, institutionId)
  const entries =
    subjectNames.size > 0
      ? [...subjectNames]
      : curriculumSubjects.map((subject) => [subject.id, subject.name] as const)
  return new Map(
    entries
      .map(([id, name]) => [id, name.slice(0, SUBJECT_NAME_MAX)] as const)
      .sort((a, b) => a[1].localeCompare(b[1], 'tr') || a[0].localeCompare(b[0])),
  )
}

export async function subjectsFor(ctx: ServiceContext) {
  const options = await subjectOptions(ctx.db, ctx.institutionId)
  return [...options].map(([id, name]) => ({ id, name }))
}

const subjectNotFound = () =>
  new DomainError('department_meeting_subject_not_found', 'Zümre (ders) bu kurumda bulunamadı.', {
    path: ['subjectId'],
  })

/** Başkan ve katılımcılar (K-452); daha önce tutanakta olan kişi ayrılmış olsa da kalır. */
function assertPeople(
  input: DepartmentMeetingInput,
  staff: ReadonlyMap<string, { role: string; active: boolean }>,
  listed: ReadonlySet<string>,
) {
  assertMeetingPerson({
    staff: staff.get(input.chairMembershipId) ?? null,
    alreadyListed: listed.has(input.chairMembershipId),
    path: ['chairMembershipId'],
  })
  input.attendees.forEach((attendee, index) =>
    assertMeetingPerson({
      staff: staff.get(attendee.membershipId) ?? null,
      alreadyListed: listed.has(attendee.membershipId),
      path: ['attendees', index, 'membershipId'],
    }),
  )
}

const peopleOf = (input: DepartmentMeetingInput) => [
  input.chairMembershipId,
  ...input.attendees.map((attendee) => attendee.membershipId),
]

/** Yazılan alanlar (denetim kaydı; değer değil ad). */
const MEETING_FIELDS = [
  'subjectId',
  'kind',
  'meetingDate',
  'location',
  'chairMembershipId',
  'agenda',
  'attendees',
]

async function meetingResponse(tx: Database, ctx: ServiceContext, id: string) {
  return { data: await detailBody(tx, ctx, id) }
}

/** Yeni tutanak taslak açılır. `Idempotency-Key` rotada zorunlu. 201. */
export function createMeetingCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: MEETING, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.department_meeting.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = departmentMeetingInputSchema.parse(input)
        const [subjects, staff] = await Promise.all([
          subjectOptions(tx, ctx.institutionId),
          findMeetingStaff(tx, ctx.institutionId, peopleOf(parsed)),
        ])
        return {
          run: () => {
            const subjectName = subjects.get(parsed.subjectId)
            if (subjectName === undefined) throw subjectNotFound()
            assertPeople(parsed, staff, new Set())
            const agenda = mergeAgenda({
              previous: [],
              next: parsed.agenda,
              usedIds: new Set(),
              newId: randomUUID,
            })
            return { parsed, subjectName, agenda }
          },
        }
      },
      after: async (tx, { parsed, subjectName, agenda }) => {
        await insertMeeting(tx, ctx.institutionId, {
          id,
          subjectId: parsed.subjectId,
          subjectName,
          kind: parsed.kind,
          meetingDate: parsed.meetingDate,
          location: parsed.location,
          chairMembershipId: parsed.chairMembershipId,
          agenda,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await syncAttendees(tx, ctx.institutionId, {
          meetingId: id,
          previous: [],
          next: parsed.attendees,
          newId: randomUUID,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.department_meeting.create', entity, [
          ...MEETING_FIELDS,
          'status',
        ])
        body = await meetingResponse(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Taslak düzeltmesi (tam gövde): kesinleşmiş tutanak 409 (K-453). */
export function updateMeetingCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: MEETING, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.department_meeting.update',
      collections: [],
      entity,
      load: async (tx) => {
        const meeting = await findMeeting(tx, ctx.institutionId, id)
        if (meeting === null) throw new NotFoundError()
        if (meeting.version !== expectedVersion) throw new ConflictError()
        const parsed = departmentMeetingInputSchema.parse(input)
        const [subjects, staff, attendees, decisions] = await Promise.all([
          subjectOptions(tx, ctx.institutionId),
          findMeetingStaff(tx, ctx.institutionId, peopleOf(parsed)),
          listAttendees(tx, ctx.institutionId, id),
          listMeetingDecisions(tx, ctx.institutionId, id),
        ])
        return {
          run: () => {
            assertMeetingEditable(meeting.status)
            const subjectName =
              parsed.subjectId === meeting.subjectId
                ? meeting.subjectName
                : subjects.get(parsed.subjectId)
            if (subjectName === undefined) throw subjectNotFound()
            assertPeople(
              parsed,
              staff,
              new Set([meeting.chairMembershipId, ...attendees.map((row) => row.membershipId)]),
            )
            const agenda = mergeAgenda({
              previous: meeting.agenda,
              next: parsed.agenda,
              usedIds: new Set(decisions.map((decision) => decision.agendaItemId)),
              newId: randomUUID,
            })
            const dueDates = decisions
              .map((decision) => decision.dueDate)
              .filter((day): day is string => day !== null)
              .sort()
            assertMeetingDateFitsDecisions(parsed.meetingDate, dueDates[0] ?? null)
            return { parsed, subjectName, agenda, attendees }
          },
        }
      },
      after: async (tx, { parsed, subjectName, agenda, attendees }) => {
        const saved = await updateMeeting(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            subjectId: parsed.subjectId,
            subjectName,
            kind: parsed.kind,
            meetingDate: parsed.meetingDate,
            location: parsed.location,
            chairMembershipId: parsed.chairMembershipId,
            agenda,
          },
        })
        if (!saved) throw new ConflictError()
        await syncAttendees(tx, ctx.institutionId, {
          meetingId: id,
          previous: attendees,
          next: parsed.attendees,
          newId: randomUUID,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.department_meeting.update', entity, MEETING_FIELDS)
        body = await meetingResponse(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Kesinleştirme (K-453): imza günüyle; sonra toplantı ve karar metni değişmez. */
export function finalizeMeetingCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: MEETING, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.department_meeting.finalize',
      collections: [],
      entity,
      load: async (tx) => {
        const meeting = await findMeeting(tx, ctx.institutionId, id)
        if (meeting === null) throw new NotFoundError()
        if (meeting.version !== expectedVersion) throw new ConflictError()
        const { signedDate } = departmentMeetingFinalizeSchema.parse(input)
        return {
          run: () => {
            assertFinalize({
              status: meeting.status,
              meetingDate: meeting.meetingDate,
              signedDate,
              today: todayOf(ctx),
            })
            return signedDate
          },
        }
      },
      after: async (tx, signedDate) => {
        const saved = await updateMeeting(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'finalized',
            signedDate,
            finalizedAt: ctx.now,
            finalizedByUserId: ctx.actor.userId,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.department_meeting.finalize', entity, [
          'status',
          'signedDate',
        ])
        body = await meetingResponse(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Kararlar -----------------------------------------------------------------------------------

/** Tutanağın kararı; başka toplantının ya da kurumun kararı 404. */
async function decisionOf(tx: Database, ctx: ServiceContext, meetingId: string, id: string) {
  const decision = await findDecision(tx, ctx.institutionId, id)
  if (decision === null || decision.meetingId !== meetingId) throw new NotFoundError()
  return decision
}

async function loadMeeting(tx: Database, ctx: ServiceContext, meetingId: string) {
  const meeting = await findMeeting(tx, ctx.institutionId, meetingId)
  if (meeting === null) throw new NotFoundError()
  return meeting
}

async function decisionResponse(tx: Database, ctx: ServiceContext, meetingId: string, id: string) {
  const meeting = await findMeeting(tx, ctx.institutionId, meetingId)
  const decisions = await listMeetingDecisions(tx, ctx.institutionId, meetingId)
  const numbered = numberDecisions(meeting?.agenda ?? [], decisions).find((row) => row.id === id)
  if (numbered === undefined) throw new Error('department meeting decision was not written')
  return { data: decisionView(numbered, todayOf(ctx)) }
}

const DECISION_FIELDS = ['agendaItemId', 'text', 'responsibleMembershipId', 'dueDate']

function checkDecision(
  meeting: { status: StoredMeeting['status']; agenda: StoredAgendaItem[]; meetingDate: string },
  parsed: { agendaItemId: string; dueDate: string | null; responsibleMembershipId: string },
  staff: { role: string; active: boolean } | null,
  alreadyListed: boolean,
) {
  assertMeetingEditable(meeting.status)
  assertDecision({
    agenda: meeting.agenda,
    agendaItemId: parsed.agendaItemId,
    meetingDate: meeting.meetingDate,
    dueDate: parsed.dueDate,
  })
  assertMeetingPerson({ staff, alreadyListed, path: ['responsibleMembershipId'] })
}

/** Taslağa karar (K-452). `Idempotency-Key` rotada zorunlu. 201. */
export function createDecisionCommand(
  ctx: ServiceContext,
  meetingId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DECISION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.department_meeting.decision_create',
      collections: [],
      entity,
      load: async (tx) => {
        const meeting = await loadMeeting(tx, ctx, meetingId)
        const parsed = departmentDecisionInputSchema.parse(input)
        const staff = await findMeetingStaff(tx, ctx.institutionId, [
          parsed.responsibleMembershipId,
        ])
        return {
          run: () => {
            checkDecision(meeting, parsed, staff.get(parsed.responsibleMembershipId) ?? null, false)
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertDecision(tx, ctx.institutionId, {
          id,
          meetingId,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.department_meeting.decision_create', entity, [
          'meetingId',
          ...DECISION_FIELDS,
          'status',
        ])
        body = await decisionResponse(tx, ctx, meetingId, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Taslaktaki kararın düzeltmesi (tam gövde); kesinleşmiş tutanak 409 (K-453). */
export function updateDecisionCommand(
  ctx: ServiceContext,
  meetingId: string,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DECISION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.department_meeting.decision_update',
      collections: [],
      entity,
      load: async (tx) => {
        const meeting = await loadMeeting(tx, ctx, meetingId)
        const decision = await decisionOf(tx, ctx, meetingId, id)
        if (decision.version !== expectedVersion) throw new ConflictError()
        const parsed = departmentDecisionInputSchema.parse(input)
        const staff = await findMeetingStaff(tx, ctx.institutionId, [
          parsed.responsibleMembershipId,
        ])
        return {
          run: () => {
            checkDecision(
              meeting,
              parsed,
              staff.get(parsed.responsibleMembershipId) ?? null,
              decision.responsibleMembershipId === parsed.responsibleMembershipId,
            )
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateDecision(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: parsed,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.department_meeting.decision_update',
          entity,
          DECISION_FIELDS,
        )
        body = await decisionResponse(tx, ctx, meetingId, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Taslaktaki kararı kaldırır (arşiv); kesinleşmiş tutanakta karar iptal edilir, kaldırılmaz. */
export function removeDecisionCommand(
  ctx: ServiceContext,
  meetingId: string,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DECISION, id }
  return runCommand(
    ctx,
    {
      action: 'finance.department_meeting.decision_remove',
      collections: [],
      entity,
      load: async (tx) => {
        const meeting = await loadMeeting(tx, ctx, meetingId)
        const decision = await decisionOf(tx, ctx, meetingId, id)
        if (decision.version !== expectedVersion) throw new ConflictError()
        return { run: () => assertMeetingEditable(meeting.status) }
      },
      after: async (tx) => {
        const saved = await updateDecision(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.department_meeting.decision_remove', entity, [
          'archivedAt',
        ])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

/** Karar takibi (K-453): yalnız kesinleşmiş tutanakta durum ve takip notu. */
export function followUpDecisionCommand(
  ctx: ServiceContext,
  meetingId: string,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DECISION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.department_meeting.decision_follow_up',
      collections: [],
      entity,
      load: async (tx) => {
        const meeting = await loadMeeting(tx, ctx, meetingId)
        const decision = await decisionOf(tx, ctx, meetingId, id)
        if (decision.version !== expectedVersion) throw new ConflictError()
        const parsed = departmentDecisionFollowUpSchema.parse(input)
        return {
          run: () => {
            assertFollowUp({ meetingStatus: meeting.status, from: decision.status })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateDecision(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { ...parsed, statusChangedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.department_meeting.decision_follow_up', entity, [
          'status',
          ...(parsed.followUpNote === null ? [] : ['followUpNote']),
        ])
        body = await decisionResponse(tx, ctx, meetingId, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
