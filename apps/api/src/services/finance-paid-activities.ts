import { randomUUID } from 'node:crypto'

import type { State } from '@kampus/school-core/data/seed.ts'
import {
  activityPayerName,
  applyParticipationCancel,
  applyPaidActivityJoin,
  holdsSeat,
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
  type JoinPlan,
  type SeatCounts,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import {
  applyWaitlistPromotions,
  planConsentWithdrawal,
  promotionCandidates,
  type FormConsentStatus,
  type Promotion,
} from '@kampus/school-core/lib/finance-paid-activity-participants.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { isFinanceDayClosed } from '../db/finance-day-closings.ts'
import {
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
  markParticipantPromoted,
  markParticipantRefundPaid,
  maxWaitlistPosition,
  openParticipants,
  updatePaidActivity,
  type ActivityCounts,
  type OpenParticipant,
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
import { formConsentStatuses, permissionFormUsable } from './finance-paid-activity-consent.ts'
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
  awaitingConsentCount: number
  waitlistCount: number
  pendingRefundCount: number
}

const NO_COUNTS = {
  participantCount: 0,
  awaitingConsentCount: 0,
  waitlistCount: 0,
  pendingRefundCount: 0,
}

function activityView(
  row: StoredPaidActivity,
  counts: ActivityCounts | undefined,
): PaidActivityView {
  return { ...row, ...NO_COUNTS, ...counts, cancelledAt: row.cancelledAt?.toISOString() ?? null }
}

export async function requireActivity(db: Database, ctx: ServiceContext, id: string) {
  const row = await findPaidActivity(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

export async function reloadActivity(db: Database, ctx: ServiceContext, id: string) {
  const row = await requireActivity(db, ctx, id)
  const counts = (await activityCounts(db, ctx.institutionId, [id])).get(id)
  return activityView(row, counts)
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
  return {
    items: items.map((item) => activityView(item, counts.get(item.id))),
    total,
  }
}

export async function getPaidActivityFor(ctx: ServiceContext, id: string) {
  return reloadActivity(ctx.db, ctx, id)
}

export type ParticipantView = Omit<
  StoredParticipant,
  'refundIban' | 'promotedAt' | 'consentAt' | 'consentWithdrawnAt'
> & {
  /** IBAN yalnız son dört hanesiyle döner (guvenlik-kvkk.md Ç sınıfı). */
  maskedIban: string | null
  className: string | null
  /** Yedeğin güncel sırası (1'den); yedek değilse `null` (K-369). */
  waitlistRank: number | null
  promotedAt: string | null
  consentAt: string | null
  consentWithdrawnAt: string | null
  /** Bağlı izin formundaki durum (K-370); form bağlı değil ya da kullanılamıyorsa `null`. */
  permissionStatus: FormConsentStatus | null
  /** Katılım taksitinin (iptal edilmişte kesinti taksitinin değil) tutarı ve alınan kısmı. */
  amountCents: number
  collectedCents: number
  paymentStatus: ParticipationPaymentStatus
  refundStatus: ParticipationRefundStatus
}

const texts = (value: unknown) => (typeof value === 'string' ? value : null)

/** Sınıf adları (`records` `classes`, arşivli dahil). */
export async function classNames(db: Database, ctx: ServiceContext, classIds: readonly string[]) {
  const ids = [...new Set(classIds)].filter((id) => id !== '')
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'classes', ids, {
    includeArchived: true,
  })
  return new Map(rows.map((row) => [row.id, texts(row.data.name)]))
}

/** Etkinlikteki yedeklerin güncel sıraları: sıra numarasına göre 1'den. */
export function waitlistRanks(
  open: readonly { id: string; status: string; waitlistPosition: number | null }[],
) {
  return new Map(
    open
      .filter((item) => item.status === 'waitlisted')
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))
      .map((item, index) => [item.id, index + 1]),
  )
}

export async function participantViews(
  db: Database,
  ctx: ServiceContext,
  rows: readonly StoredParticipant[],
): Promise<ParticipantView[]> {
  const activityIds = [...new Set(rows.map((row) => row.activityId))]
  const [paid, classes, activities, opens] = await Promise.all([
    invoicePayments(
      db,
      ctx.institutionId,
      rows.flatMap((row) => (row.invoiceId === null ? [] : [row.invoiceId])),
    ),
    classNames(
      db,
      ctx,
      rows.map((row) => row.classId ?? ''),
    ),
    Promise.all(activityIds.map((id) => findPaidActivity(db, ctx.institutionId, id))),
    Promise.all(activityIds.map((id) => openParticipants(db, ctx.institutionId, id))),
  ])
  const ranks = waitlistRanks(opens.flat())
  const forms = new Map<string, Map<string, FormConsentStatus> | null>()
  for (const activity of activities) {
    if (activity?.permissionFormId == null) continue
    forms.set(
      activity.id,
      await formConsentStatuses(
        db,
        ctx.institutionId,
        activity.permissionFormId,
        rows.filter((row) => row.activityId === activity.id).map((row) => row.studentId),
        ctx.now,
      ),
    )
  }
  return rows.map(({ refundIban, promotedAt, consentAt, consentWithdrawnAt, ...row }) => {
    const invoice = row.invoiceId === null ? undefined : paid.get(row.invoiceId)
    const billed = row.invoiceId !== null
    const amountCents = billed ? (invoice?.amountCents ?? row.feeCents) : 0
    // İptal edilmiş katılımda alınan tutar iptal anındaki değerdir (iade ona dayanır).
    const collectedCents = row.paidCents ?? invoice?.paidCents ?? 0
    return {
      ...row,
      maskedIban: refundIban === null ? null : `TR** **** ${refundIban.slice(-4)}`,
      className: row.classId === null ? null : (classes.get(row.classId) ?? null),
      waitlistRank: ranks.get(row.id) ?? null,
      promotedAt: promotedAt?.toISOString() ?? null,
      consentAt: consentAt?.toISOString() ?? null,
      consentWithdrawnAt: consentWithdrawnAt?.toISOString() ?? null,
      permissionStatus: forms.get(row.activityId)?.get(row.studentId) ?? null,
      amountCents,
      collectedCents,
      paymentStatus: participationPaymentStatus(amountCents, collectedCents, billed),
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

export async function reloadParticipant(db: Database, ctx: ServiceContext, id: string) {
  const row = await findParticipant(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const [view] = await participantViews(db, ctx, [row])
  if (view === undefined) throw new NotFoundError()
  return view
}

// --- Yer, yedek ve geçiş -------------------------------------------------------------------------

/** Kilit altında okunan katılımlardan yer durumu (K-369). */
export function seatCountsOf(open: readonly OpenParticipant[], maxPosition: number): SeatCounts {
  return {
    seatCount: open.filter((item) => holdsSeat(item.status)).length,
    waitlistCount: open.filter((item) => item.status === 'waitlisted').length,
    nextWaitlistPosition: maxPosition + 1,
  }
}

const waitlistOf = (open: readonly OpenParticipant[]) =>
  open.flatMap((item) =>
    item.status === 'waitlisted' && item.waitlistPosition !== null
      ? [{ ...item, waitlistPosition: item.waitlistPosition }]
      : [],
  )

/**
 * Kilitten önce: yer açılırsa asile geçecek yedeklerin öğrencileri (taksitleri yüklensin diye).
 * `freed` işlemle boşalan yer, `capacity` verilirse yeni kontenjan.
 */
export function promotionPreview(
  activity: StoredPaidActivity,
  open: readonly OpenParticipant[],
  options: { freed?: number; capacity?: number; today: string },
): string[] {
  const seatCount = open.filter((item) => holdsSeat(item.status)).length - (options.freed ?? 0)
  return promotionCandidates(
    { ...activity, capacity: options.capacity ?? activity.capacity },
    { seatCount, waitlisted: waitlistOf(open) },
    options.today,
  ).map((item) => item.studentId)
}

/**
 * Taksiti yazılacak öğrencilerin taksitleri kilitten önce yüklenmiş olmalıdır (taksit numarası
 * öğrencinin taksitlerinden devam eder); arada liste değiştiyse 409, istemci yeniden dener.
 */
export function requireLoaded(loaded: ReadonlySet<string>, studentIds: readonly string[]) {
  if (studentIds.some((id) => !loaded.has(id))) throw new ConflictError()
}

/**
 * Yer açıldığı işlemde yedekleri asile geçirir (K-369): kilit altındaki son durumdan (`open`,
 * işlemle iptal edilenler çıkarılmış) boş yer kadar en küçük numaralı yedek. State'i değiştirir.
 */
export function promoteWaitlist(
  state: State,
  activity: StoredPaidActivity,
  open: readonly OpenParticipant[],
  context: { today: string; makeId: (prefix: string) => string; loaded: ReadonlySet<string> },
): Promotion[] {
  const promotions = applyWaitlistPromotions(
    state,
    activity,
    {
      seatCount: open.filter((item) => holdsSeat(item.status)).length,
      waitlisted: waitlistOf(open),
    },
    context,
  )
  requireLoaded(
    context.loaded,
    promotions.filter((item) => item.invoiceId !== null).map((item) => item.studentId),
  )
  return promotions
}

/** Geçişleri yazar ve denetler (`paid_activity.promote`). */
export async function writePromotions(
  tx: Database,
  ctx: ServiceContext,
  promotions: readonly Promotion[],
) {
  for (const promotion of promotions) {
    const saved = await markParticipantPromoted(tx, ctx.institutionId, {
      id: promotion.participantId,
      status: promotion.status,
      invoiceId: promotion.invoiceId,
      now: ctx.now,
    })
    if (!saved) throw new ConflictError()
    await auditWork(
      tx,
      ctx,
      'paid_activity.promote',
      { type: PARTICIPANT, id: promotion.participantId },
      ['status', 'promotedAt', ...(promotion.invoiceId === null ? [] : ['invoiceId'])],
    )
  }
}

/**
 * Gövdedeki izin formu bağlanabilir mi (K-370); kilit altında okunur, karar `run` içinde
 * (`assertFormUsable`) verilir ki hata core hatası gibi 422'ye çevrilsin.
 */
async function formUsability(tx: Database, ctx: ServiceContext, input: unknown) {
  const formId = field(input, 'permissionFormId')
  return formId === undefined || formId === ''
    ? null
    : { formId, usable: await permissionFormUsable(tx, ctx.institutionId, formId) }
}

function assertFormUsable(
  check: { formId: string; usable: boolean } | null,
  formId: string | null,
  changed = true,
) {
  if (formId === null || !changed) return
  if (check?.formId === formId && check.usable) return
  throw new DomainError(
    'paid_activity_permission_form_not_found',
    'İzin formu bulunamadı ya da kullanılamıyor (iletişim modülü kapalı, form iptal ya da arşiv).',
    { path: ['permissionFormId'] },
  )
}

// --- Etkinlik komutları --------------------------------------------------------------------------

/** Ücretli gezi ya da etkinliği tanımlar (K-300, K-370). 201. */
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
      load: async (tx) => {
        const check = await formUsability(tx, ctx, input)
        return {
          run: () => {
            const plan = planPaidActivity(input, dayKey(ctx.now))
            assertFormUsable(check, plan.permissionFormId)
            return plan
          },
        }
      },
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
          ...(plan.requiresConsent ? ['requiresConsent'] : []),
          ...(plan.permissionFormId === null ? [] : ['permissionFormId']),
        ])
        body = { data: await reloadActivity(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Gövdedeki kontenjan; sayı değilse `undefined` (şema ayrıca reddeder). */
function rawCapacity(input: unknown): number | undefined {
  const value: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'capacity') : undefined
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/**
 * Ad, kontenjan, son katılım günü, dış referans ve izin formunu düzeltir (K-300, K-370).
 * Kontenjan artarsa yedekler aynı işlemde sırayla asile geçer (K-369).
 */
export async function updatePaidActivityCommand(
  ctx: ServiceContext,
  activityId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const today = dayKey(ctx.now)
  const current = await findPaidActivity(ctx.db, ctx.institutionId, activityId)
  const capacity = rawCapacity(input)
  const preview =
    current === null || capacity === undefined
      ? []
      : promotionPreview(current, await openParticipants(ctx.db, ctx.institutionId, activityId), {
          capacity,
          today,
        })
  const loaded = new Set(preview)
  const entity = { type: ACTIVITY, id: activityId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.update',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: studentsScope(preview) },
      entity,
      load: async (tx) => {
        const row = await requireActivity(tx, ctx, activityId)
        if (row.version !== expectedVersion) throw new ConflictError()
        const open = await openParticipants(tx, ctx.institutionId, activityId)
        const seats = open.filter((item) => holdsSeat(item.status)).length
        const check = await formUsability(tx, ctx, input)
        return {
          run: (state, { makeId }) => {
            const plan = planPaidActivityUpdate(row, input, { activeCount: seats })
            assertFormUsable(
              check,
              plan.permissionFormId,
              plan.changed.includes('permissionFormId'),
            )
            const promotions = promoteWaitlist(state, { ...row, ...plan }, open, {
              today,
              makeId,
              loaded,
            })
            return { ...plan, promotions }
          },
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
          permissionFormId: plan.permissionFormId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'paid_activity.update', entity, plan.changed)
        await writePromotions(tx, ctx, plan.promotions)
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

export function cancelFields(plan: ParticipationCancelPlan): string[] {
  return [
    ...CANCEL_FIELDS,
    ...(plan.closedInvoiceId === null ? [] : ['closedInvoiceId']),
    ...(plan.debtInvoiceId === null ? [] : ['debtInvoiceId']),
  ]
}

/**
 * Kurum etkinliği iptal eder (K-302): bütün iptal edilmemiş katılımlar tam iadeyle kapanır;
 * ödenmemiş taksit kapanır, alınan tutar iade kaydı olur; yedek ve izin bekleyen katılım parasız
 * kapanır. Katılımcılar kilitten önce okunur ki yalnız onların taksitleri yüklensin; kilit altında
 * yeniden okunur, arada katılım eklendiyse 409.
 */
export async function cancelPaidActivityCommand(
  ctx: ServiceContext,
  activityId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const preview = await openParticipants(ctx.db, ctx.institutionId, activityId)
  const entity = { type: ACTIVITY, id: activityId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.cancel',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: {
        invoices: studentsScope(
          preview.filter((item) => item.invoiceId !== null).map((item) => item.studentId),
        ),
      },
      entity,
      load: async (tx) => {
        const row = await requireActivity(tx, ctx, activityId)
        if (row.version !== expectedVersion) throw new ConflictError()
        const open = await openParticipants(tx, ctx.institutionId, activityId)
        const known = new Map(preview.map((item) => [item.id, item.invoiceId]))
        if (open.some((item) => known.get(item.id) !== item.invoiceId || !known.has(item.id)))
          throw new ConflictError()
        const paid = await invoicePayments(
          tx,
          ctx.institutionId,
          open.flatMap((item) => (item.invoiceId === null ? [] : [item.invoiceId])),
        )
        const allocated = new Map([...paid].map(([id, item]) => [id, item.paidCents]))
        return {
          run: (state, { makeId }) => {
            const { reason } = planPaidActivityCancel(row, input)
            const today = dayKey(ctx.now)
            const plans = open.map((participant) => ({
              participant,
              plan: applyParticipationCancel(state, row, participant, {
                today,
                kind: 'activity',
                allocated,
                makeId,
              }),
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

/** Kilit altında katılım yazımı için yer durumu ve iptal edilmemiş katılımı olan öğrenciler. */
export async function joinContext(tx: Database, ctx: ServiceContext, activityId: string) {
  const [open, maxPosition, institution] = await Promise.all([
    openParticipants(tx, ctx.institutionId, activityId),
    maxWaitlistPosition(tx, ctx.institutionId, activityId),
    getInstitutionModules(tx, ctx.institutionId),
  ])
  return {
    activeStudentIds: new Set(open.map((item) => item.studentId)),
    counts: seatCountsOf(open, maxPosition),
    institutionType: institution?.type ?? 'school',
  }
}

/** Katılım satırını yazar ve denetler (`paid_activity.join`). */
export async function writeJoin(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  activityId: string,
  plan: JoinPlan,
) {
  await insertParticipant(tx, ctx.institutionId, {
    id,
    activityId,
    studentId: plan.studentId,
    invoiceId: plan.invoiceId,
    feeCents: plan.feeCents,
    joinedDate: dayKey(ctx.now),
    status: plan.status,
    waitlistPosition: plan.waitlistPosition,
    consentStatus: plan.consentStatus,
    createdByUserId: ctx.actor.userId,
    now: ctx.now,
  })
  await auditWork(tx, ctx, 'paid_activity.join', { type: PARTICIPANT, id }, [
    'activityId',
    'studentId',
    'status',
    'feeCents',
    'consentStatus',
    ...(plan.invoiceId === null ? [] : ['invoiceId']),
    ...(plan.waitlistPosition === null ? [] : ['waitlistPosition']),
  ])
}

/**
 * Öğrenciyi etkinliğe yazar (K-301, K-369, K-370): kontenjanda yer varsa asil (izin isteyen
 * etkinlikte izin bekliyor, taksit izinle), doluysa sıra numarasıyla yedek. Taksit, katılım ve
 * denetim tek işlemdedir; kontenjan ve mükerrer katılım kurum kilidi altında denetlenir. 201.
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
        const context = await joinContext(tx, ctx, activityId)
        return {
          run: (state, { makeId }) =>
            applyPaidActivityJoin(state, row, input, {
              today: dayKey(ctx.now),
              makeId,
              ...context,
            }),
        }
      },
      after: async (tx, plan) => {
        await writeJoin(tx, ctx, id, activityId, plan)
        body = { data: await reloadParticipant(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Katılımı iptal eder (K-302): son iptal gününe kadar tam iade, sonra etkinliğin kuralı. Ödenmemiş
 * taksit kapanır, alınan tutar kesintiyi aşarsa iade kaydı, azsa kesinti taksiti açılır; taksiti
 * olmayan (yedek, izin bekleyen) katılım parasız kapanır. Yer boşalırsa sıradaki yedek aynı işlemde
 * asile geçer (K-369).
 */
export async function cancelParticipationCommand(
  ctx: ServiceContext,
  participantId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
  options: { kind?: 'participant' | 'consent'; input?: unknown } = {},
): Promise<CommandResponse> {
  const kind = options.kind ?? 'participant'
  const today = dayKey(ctx.now)
  // Katılımın öğrencisi değişmez; yükleme kilitten önce öğrenciye ve geçecek yedeklere daraltılır.
  const owner = await findParticipant(ctx.db, ctx.institutionId, participantId)
  const ownerActivity =
    owner === null ? null : await findPaidActivity(ctx.db, ctx.institutionId, owner.activityId)
  const preview =
    owner === null || ownerActivity === null
      ? []
      : [
          owner.studentId,
          ...promotionPreview(
            ownerActivity,
            await openParticipants(ctx.db, ctx.institutionId, owner.activityId),
            { freed: holdsSeat(owner.status) ? 1 : 0, today },
          ),
        ]
  const loaded = new Set(preview)
  const entity = { type: PARTICIPANT, id: participantId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action:
        kind === 'consent' ? 'paid_activity.consent_withdraw' : 'paid_activity.participant_cancel',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: studentsScope(preview) },
      entity,
      load: async (tx) => {
        const row = await findParticipant(tx, ctx.institutionId, participantId)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const activity = await requireActivity(tx, ctx, row.activityId)
        const open = await openParticipants(tx, ctx.institutionId, row.activityId)
        const paid = await invoicePayments(
          tx,
          ctx.institutionId,
          row.invoiceId === null ? [] : [row.invoiceId],
        )
        const allocated = new Map([...paid].map(([id, item]) => [id, item.paidCents]))
        return {
          run: (state, { makeId }) => {
            const withdrawal =
              kind === 'consent' ? planConsentWithdrawal(activity, row, options.input) : null
            const plan = applyParticipationCancel(state, activity, row, {
              today,
              kind,
              allocated,
              makeId,
            })
            const promotions = promoteWaitlist(
              state,
              activity,
              open.filter((item) => item.id !== participantId),
              { today, makeId, loaded },
            )
            return { plan, promotions, withdrawal }
          },
        }
      },
      after: async (tx, { plan, promotions, withdrawal }) => {
        const saved = await markParticipantCancelled(tx, ctx.institutionId, {
          id: participantId,
          expectedVersion,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
          ...(withdrawal === null ? {} : { withdrawal }),
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'paid_activity.participant_cancel', entity, [
          ...cancelFields(plan),
          ...(withdrawal === null
            ? []
            : ['consentStatus', 'consentWithdrawnAt', 'consentWithdrawalChannel']),
        ])
        await writePromotions(tx, ctx, promotions)
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
