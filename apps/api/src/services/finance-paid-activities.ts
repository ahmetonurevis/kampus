import { randomUUID } from 'node:crypto'

import {
  activityPayerName,
  applyParticipationCancel,
  applyPaidActivityJoin,
  participationPaymentStatus,
  participationRefundStatus,
  planParticipationRefund,
  planPaidActivity,
  planPaidActivityCancel,
  planPaidActivityUpdate,
  type ParticipationCancelPlan,
  type ParticipationPaymentStatus,
  type ParticipationRefundStatus,
  type PaidActivityStatus,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { isFinanceDayClosed } from '../db/finance-day-closings.ts'
import {
  activeParticipants,
  activityCounts,
  findPaidActivity,
  findParticipant,
  insertPaidActivity,
  insertParticipant,
  invoicePayments,
  listPaidActivities,
  listParticipants,
  markPaidActivityCancelled,
  markParticipantCancelled,
  markParticipantRefundPaid,
  updatePaidActivity,
  type ParticipantQuery,
  type StoredPaidActivity,
  type StoredParticipant,
} from '../db/finance-paid-activities.ts'
import { listBankAccounts } from '../db/payments.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import {
  FINANCE_TABLE_STORES,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
  type LoadScope,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Gezi ve etkinlik ücreti servisi (docs/domain/finans.md DOM-FIN-098; ON-142; K-300…K-303). Kural
 * core `lib/finance-paid-activities.ts`'tedir. Katılım taksiti, iptalde taksitin kapanması ya da
 * kesinti taksiti, katılım kaydı ve denetim tek transaction'da, kurum kilidi altındadır. Rol ve
 * modül denetimi rotadadır. Gerekçe, IBAN ve tutar loglanmaz; denetime yalnız alan adları düşer.
 */

const ACTIVITY = 'paid_activities'
const PARTICIPANT = 'paid_activity_participants'

const studentsScope = (studentIds: readonly string[]): LoadScope => ({
  match: [{ kind: 'equals', field: 'studentId', values: [...new Set(studentIds)] }],
})

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const value: unknown = Reflect.get(input, key)
  return typeof value === 'string' ? value.trim() : undefined
}

// --- Görünümler ----------------------------------------------------------------------------------

export type PaidActivityView = Omit<StoredPaidActivity, 'cancelledAt'> & {
  cancelledAt: string | null
  participantCount: number
  pendingRefundCount: number
}

function activityView(
  row: StoredPaidActivity,
  counts: { participantCount: number; pendingRefundCount: number } | undefined,
): PaidActivityView {
  return {
    ...row,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    participantCount: counts?.participantCount ?? 0,
    pendingRefundCount: counts?.pendingRefundCount ?? 0,
  }
}

async function requireActivity(db: Database, ctx: ServiceContext, id: string) {
  const row = await findPaidActivity(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

async function reloadActivity(db: Database, ctx: ServiceContext, id: string) {
  const row = await requireActivity(db, ctx, id)
  return activityView(row, (await activityCounts(db, ctx.institutionId, [id])).get(id))
}

export async function listPaidActivitiesFor(
  ctx: ServiceContext,
  query: { status?: PaidActivityStatus | undefined; page: number; pageSize: number },
) {
  const { items, total } = await listPaidActivities(ctx.db, ctx.institutionId, query)
  const counts = await activityCounts(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  return { items: items.map((item) => activityView(item, counts.get(item.id))), total }
}

export async function getPaidActivityFor(ctx: ServiceContext, id: string) {
  return reloadActivity(ctx.db, ctx, id)
}

export type ParticipantView = Omit<StoredParticipant, 'refundIban'> & {
  /** IBAN yalnız son dört hanesiyle döner (guvenlik-kvkk.md Ç sınıfı). */
  maskedIban: string | null
  /** Katılım taksitinin (iptal edilmişte kesinti taksitinin değil) tutarı ve alınan kısmı. */
  amountCents: number
  collectedCents: number
  paymentStatus: ParticipationPaymentStatus
  refundStatus: ParticipationRefundStatus
}

async function participantViews(
  db: Database,
  ctx: ServiceContext,
  rows: readonly StoredParticipant[],
): Promise<ParticipantView[]> {
  const paid = await invoicePayments(
    db,
    ctx.institutionId,
    rows.map((row) => row.invoiceId),
  )
  return rows.map(({ refundIban, ...row }) => {
    const invoice = paid.get(row.invoiceId)
    const amountCents = invoice?.amountCents ?? row.feeCents
    // İptal edilmiş katılımda alınan tutar iptal anındaki değerdir (iade ona dayanır).
    const collectedCents = row.paidCents ?? invoice?.paidCents ?? 0
    return {
      ...row,
      maskedIban: refundIban === null ? null : `TR** **** ${refundIban.slice(-4)}`,
      amountCents,
      collectedCents,
      paymentStatus: participationPaymentStatus(amountCents, collectedCents),
      refundStatus: participationRefundStatus(row),
    }
  })
}

export async function listParticipantsFor(
  ctx: ServiceContext,
  activityId: string,
  query: ParticipantQuery,
) {
  await requireActivity(ctx.db, ctx, activityId)
  const { items, total } = await listParticipants(ctx.db, ctx.institutionId, activityId, query)
  return { items: await participantViews(ctx.db, ctx, items), total }
}

async function reloadParticipant(db: Database, ctx: ServiceContext, id: string) {
  const row = await findParticipant(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const [view] = await participantViews(db, ctx, [row])
  if (view === undefined) throw new NotFoundError()
  return view
}

// --- Etkinlik komutları --------------------------------------------------------------------------

/** Ücretli gezi ya da etkinliği tanımlar (K-300). 201. */
export function createPaidActivityCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ACTIVITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.create',
      collections: [],
      entity,
      run: () => planPaidActivity(input, dayKey(ctx.now)),
      after: async (tx, plan) => {
        await insertPaidActivity(tx, ctx.institutionId, {
          id,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'paid_activity.create', entity, [
          'name',
          'kind',
          'activityDate',
          'feeCents',
          'joinDeadline',
          'cancelDeadline',
          'capacity',
          'lateRefundRule',
          ...(plan.lateRefundPercent === null ? [] : ['lateRefundPercent']),
          ...(plan.lateCostCents === null ? [] : ['lateCostCents']),
          ...(plan.externalRef === null ? [] : ['externalRef']),
        ])
        body = { data: await reloadActivity(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Ad, kontenjan, son katılım günü ve dış referansı düzeltir (K-300). */
export function updatePaidActivityCommand(
  ctx: ServiceContext,
  activityId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ACTIVITY, id: activityId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.update',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await requireActivity(tx, ctx, activityId)
        if (row.version !== expectedVersion) throw new ConflictError()
        const active = await activeParticipants(tx, ctx.institutionId, activityId)
        return {
          run: () => planPaidActivityUpdate(row, input, { activeCount: active.length }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updatePaidActivity(tx, ctx.institutionId, {
          id: activityId,
          expectedVersion,
          name: plan.name,
          capacity: plan.capacity,
          joinDeadline: plan.joinDeadline,
          externalRef: plan.externalRef,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'paid_activity.update', entity, plan.changed)
        body = { data: await reloadActivity(tx, ctx, activityId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

const CANCEL_FIELDS = [
  'status',
  'cancelKind',
  'cancelledDate',
  'paidCents',
  'retainedCents',
  'refundCents',
] as const

function cancelFields(plan: ParticipationCancelPlan): string[] {
  return [
    ...CANCEL_FIELDS,
    ...(plan.closedInvoiceId === null ? [] : ['closedInvoiceId']),
    ...(plan.debtInvoiceId === null ? [] : ['debtInvoiceId']),
  ]
}

/**
 * Kurum etkinliği iptal eder (K-302): bütün iptal edilmemiş katılımlar tam iadeyle kapanır;
 * ödenmemiş taksit kapanır, alınan tutar iade kaydı olur. Katılımcılar kilitten önce okunur ki
 * yalnız onların taksitleri yüklensin; kilit altında yeniden okunur, arada katılım eklendiyse 409.
 */
export async function cancelPaidActivityCommand(
  ctx: ServiceContext,
  activityId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const preview = await activeParticipants(ctx.db, ctx.institutionId, activityId)
  const entity = { type: ACTIVITY, id: activityId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.cancel',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: studentsScope(preview.map((item) => item.studentId)) },
      entity,
      load: async (tx) => {
        const row = await requireActivity(tx, ctx, activityId)
        if (row.version !== expectedVersion) throw new ConflictError()
        const active = await activeParticipants(tx, ctx.institutionId, activityId)
        const known = new Set(preview.map((item) => item.id))
        if (active.some((item) => !known.has(item.id))) throw new ConflictError()
        const paid = await invoicePayments(
          tx,
          ctx.institutionId,
          active.map((item) => item.invoiceId),
        )
        const allocated = new Map([...paid].map(([id, item]) => [id, item.paidCents]))
        return {
          run: (state, { makeId }) => {
            const { reason } = planPaidActivityCancel(row, input)
            const today = dayKey(ctx.now)
            const plans = active.map((participant) => ({
              participant,
              plan: applyParticipationCancel(
                state,
                row,
                { ...participant, status: 'active' },
                { today, kind: 'activity', allocated, makeId },
              ),
            }))
            return { reason, plans }
          },
        }
      },
      after: async (tx, { reason, plans }) => {
        const saved = await markPaidActivityCancelled(tx, ctx.institutionId, {
          id: activityId,
          expectedVersion,
          reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'paid_activity.cancel', entity, [
          'status',
          'cancelledAt',
          'cancelReason',
        ])
        for (const { participant, plan } of plans) {
          const done = await markParticipantCancelled(tx, ctx.institutionId, {
            id: participant.id,
            expectedVersion: null,
            ...plan,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
          if (!done) throw new ConflictError()
          await auditWork(
            tx,
            ctx,
            'paid_activity.participant_cancel',
            { type: PARTICIPANT, id: participant.id },
            cancelFields(plan),
          )
        }
        body = { data: await reloadActivity(tx, ctx, activityId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Katılım komutları ---------------------------------------------------------------------------

/**
 * Öğrenciyi etkinliğe yazar (K-301): sözleşmesiz katılım taksiti ve katılım kaydı tek işlemdedir;
 * kontenjan ve mükerrer katılım kurum kilidi altında denetlenir. 201.
 */
export function joinPaidActivityCommand(
  ctx: ServiceContext,
  activityId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const studentId = field(input, 'studentId') ?? ''
  const entity = { type: PARTICIPANT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.join',
      collections: ['students', 'invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: {
        students: { ids: studentId === '' ? [] : [studentId] },
        invoices: studentsScope(studentId === '' ? [] : [studentId]),
      },
      entity,
      load: async (tx) => {
        const row = await requireActivity(tx, ctx, activityId)
        const [active, institution] = await Promise.all([
          activeParticipants(tx, ctx.institutionId, activityId),
          getInstitutionModules(tx, ctx.institutionId),
        ])
        return {
          run: (state, { makeId }) =>
            applyPaidActivityJoin(state, row, input, {
              today: dayKey(ctx.now),
              activeStudentIds: new Set(active.map((item) => item.studentId)),
              makeId,
              institutionType: institution?.type ?? 'school',
            }),
        }
      },
      after: async (tx, plan) => {
        await insertParticipant(tx, ctx.institutionId, {
          id,
          activityId,
          studentId: plan.studentId,
          invoiceId: plan.invoiceId,
          feeCents: plan.feeCents,
          joinedDate: dayKey(ctx.now),
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'paid_activity.join', entity, [
          'activityId',
          'studentId',
          'invoiceId',
          'feeCents',
        ])
        body = { data: await reloadParticipant(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Katılımı iptal eder (K-302): son iptal gününe kadar tam iade, sonra etkinliğin kuralı.
 * Ödenmemiş taksit kapanır, alınan tutar kesintiyi aşarsa iade kaydı, azsa kesinti taksiti açılır.
 */
export async function cancelParticipationCommand(
  ctx: ServiceContext,
  participantId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  // Katılımın öğrencisi değişmez; yükleme kilitten önce öğrenciye daraltılır.
  const owner = await findParticipant(ctx.db, ctx.institutionId, participantId)
  const entity = { type: PARTICIPANT, id: participantId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.participant_cancel',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: studentsScope(owner === null ? [] : [owner.studentId]) },
      entity,
      load: async (tx) => {
        const row = await findParticipant(tx, ctx.institutionId, participantId)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const activity = await requireActivity(tx, ctx, row.activityId)
        const paid = await invoicePayments(tx, ctx.institutionId, [row.invoiceId])
        const allocated = new Map([...paid].map(([id, item]) => [id, item.paidCents]))
        return {
          run: (state, { makeId }) =>
            applyParticipationCancel(state, activity, row, {
              today: dayKey(ctx.now),
              kind: 'participant',
              allocated,
              makeId,
            }),
        }
      },
      after: async (tx, plan) => {
        const saved = await markParticipantCancelled(tx, ctx.institutionId, {
          id: participantId,
          expectedVersion,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'paid_activity.participant_cancel', entity, cancelFields(plan))
        body = { data: await reloadParticipant(tx, ctx, participantId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Gövdedeki ödeme günü; `YYYY-MM-DD` değilse boş (şema ayrıca reddeder). */
function rawDay(input: unknown): string | null {
  const value = field(input, 'paidDate')
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

const ACCOUNT_FIELDS: ReadonlySet<string> = new Set(['maskedIban', 'refundAccountHolder'])

/** İadeyi alacak kişinin adı (K-303): öğrencinin kayıtlı velisi, velisi yoksa kendisi. */
async function payerNameOf(tx: Database, ctx: ServiceContext, studentId: string) {
  const named = (data: unknown) => {
    const name: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'name') : ''
    return typeof name === 'string' ? { name } : undefined
  }
  const [student] = await loadRecordsByIds(tx, ctx.institutionId, 'students', [studentId], {
    includeArchived: true,
  })
  const rawParentId: unknown =
    typeof student?.data === 'object' && student.data !== null
      ? Reflect.get(student.data, 'parentId')
      : undefined
  const parentId = typeof rawParentId === 'string' ? rawParentId : ''
  const [parent] =
    parentId === ''
      ? []
      : await loadRecordsByIds(tx, ctx.institutionId, 'parents', [parentId], {
          includeArchived: true,
        })
  return activityPayerName(named(student?.data), named(parent?.data))
}

/**
 * Katılım iadesini ödenmiş işaretler (K-303): ayrılış iadesiyle aynı kurallar ve aynı gün sonu
 * (M-13). `Idempotency-Key` kaydına maskeli IBAN ve hesap sahibi yazılmaz; tekrar yanıtı bunları
 * kayıttan ekler (guvenlik-kvkk.md §10).
 */
export async function payParticipationRefundCommand(
  ctx: ServiceContext,
  participantId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PARTICIPANT, id: participantId }
  let result: ParticipantView | undefined
  const response = await runCommand(
    ctx,
    {
      action: 'paid_activity.refund_paid',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await findParticipant(tx, ctx.institutionId, participantId)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const [accounts, payerName] = await Promise.all([
          listBankAccounts(tx, ctx.institutionId),
          payerNameOf(tx, ctx, row.studentId),
        ])
        const paidDay = rawDay(input)
        const dayClosed =
          paidDay !== null && (await isFinanceDayClosed(tx, ctx.institutionId, paidDay))
        return {
          run: () =>
            planParticipationRefund({ ...row, payerName }, input, {
              today: dayKey(ctx.now),
              bankAccountIds: accounts.map((account) => account.id),
              dayClosed,
            }),
        }
      },
      after: async (tx, plan) => {
        const saved = await markParticipantRefundPaid(tx, ctx.institutionId, {
          id: participantId,
          expectedVersion,
          paidDate: plan.paidDate,
          iban: plan.iban,
          accountHolder: plan.accountHolder,
          bankAccountId: plan.bankAccountId,
          paidByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'paid_activity.refund_paid', entity, [
          'refundPaidDate',
          'refundIban',
          'refundAccountHolder',
          'refundBankAccountId',
        ])
        result = await reloadParticipant(tx, ctx, participantId)
      },
    },
    () => {
      if (result === undefined) throw new Error('paid activity refund was not written')
      return {
        statusCode: 200,
        body: {
          data: Object.fromEntries(
            Object.entries(result).filter(([key]) => !ACCOUNT_FIELDS.has(key)),
          ),
        },
      }
    },
    idempotency,
  )
  const stored =
    !response.replayed && result !== undefined
      ? result
      : await reloadParticipant(ctx.db, ctx, participantId)
  const data: unknown =
    typeof response.body === 'object' && response.body !== null
      ? Reflect.get(response.body, 'data')
      : undefined
  return {
    ...response,
    body: {
      data: {
        ...(typeof data === 'object' && data !== null ? data : {}),
        maskedIban: stored.maskedIban,
        refundAccountHolder: stored.refundAccountHolder,
      },
    },
  }
}
