import { randomUUID } from 'node:crypto'

import {
  applyConsentGrant,
  applyPaidActivityBulkJoin,
  paidActivityRosterCsv,
  planConsentSync,
  planManualConsent,
  isWithdrawnLeftover,
  planWithdrawnLeftoverCancel,
  type ConsentGrantPlan,
  type RosterRow,
  type WithdrawnLeftoverCancel,
} from '@kampus/school-core/lib/finance-paid-activity-participants.ts'
import {
  applyParticipationCancel,
  holdsSeat,
  participationPaymentStatus,
  type ConsentChannel,
  type ParticipationCancelPlan,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { maskPhone } from '@kampus/school-core/lib/parent-contact.ts'

import type { Database } from '../db/client.ts'
import {
  findPaidActivity,
  findParticipant,
  invoicePayments,
  isStudentActive,
  listWithdrawnLeftovers,
  markParticipantCancelled,
  markParticipantConsentGranted,
  openParticipants,
  rosterParticipants,
  withdrawnLeftoverCandidates,
  type OpenParticipant,
  type StoredPaidActivity,
} from '../db/finance-paid-activities.ts'
import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  cancelFields,
  classNames,
  joinContext,
  promoteWaitlist,
  promotionPreview,
  reloadActivity,
  writeReasonedCancel,
  reloadParticipant,
  requireActivity,
  requireLoaded,
  waitlistRanks,
  writeJoin,
  writePromotions,
} from './finance-paid-activities.ts'
import { formConsentStatuses } from './finance-paid-activity-consent.ts'
import { getInstitutionModules } from './modules.ts'
import {
  FINANCE_TABLE_STORES,
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
  type LoadScope,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'
import { WITHDRAWAL_CANCEL_REASON } from './withdrawals.ts'

/**
 * Gezi katılımcı yönetimi servisi (docs/domain/finans.md DOM-FIN-112; ON-156; K-369…K-371): toplu
 * katılım, veli izninin kaydı, dijital izin formundan eşitleme ve katılım listesi (PDF verisi ve
 * CSV). Kural core `lib/finance-paid-activity-participants.ts`'tedir. Taksit, katılım, yedekten
 * geçiş ve denetim tek transaction'da, kurum kilidi altındadır. Taksiti yazılacak öğrencilerin
 * taksitleri kilitten önce okunan plana göre yüklenir; kilit altında plan genişlediyse 409. İzni
 * verenin adı loglanmaz, denetime yalnız alan adları düşer.
 */

const ACTIVITY = 'paid_activities'
const PARTICIPANT = 'paid_activity_participants'

const studentsScope = (studentIds: readonly string[]): LoadScope => ({
  match: [{ kind: 'equals', field: 'studentId', values: [...new Set(studentIds)] }],
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const strings = (input: unknown, key: string): string[] => {
  const value: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, key) : undefined
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
    : []
}

// --- Toplu katılım -------------------------------------------------------------------------------

/**
 * Sınıf seçerek toplu katılım (K-371): seçilen sınıfların etkin öğrencileri ada göre yazılır,
 * kontenjanı aşan kısım yedektir; zaten katılımı olan atlanır. 201.
 */
export async function bulkJoinPaidActivityCommand(
  ctx: ServiceContext,
  activityId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const classIds = strings(input, 'classIds').filter((id) => id !== '')
  const studentScope: LoadScope = {
    match: [{ kind: 'equals', field: 'classId', values: classIds }],
  }
  // Kilitten önce: sınıfların öğrencileri (taksitleri yüklensin diye).
  const preview =
    classIds.length === 0
      ? []
      : (await loadRecords(ctx.db, ctx.institutionId, ['students'], studentScope)).map(
          (row) => row.id,
        )
  const loaded = new Set(preview)
  const entity = { type: ACTIVITY, id: activityId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.bulk_join',
      collections: ['students', 'classes', 'invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: {
        students: classIds.length === 0 ? { ids: [] } : studentScope,
        classes: { ids: classIds },
        invoices: studentsScope(preview),
      },
      entity,
      load: async (tx) => {
        const row = await requireActivity(tx, ctx, activityId)
        const context = await joinContext(tx, ctx, activityId)
        return {
          run: (state, { makeId }) => {
            const plan = applyPaidActivityBulkJoin(state, row, input, {
              today: dayKey(ctx.now),
              makeId,
              ...context,
            })
            requireLoaded(
              loaded,
              plan.joined.filter((item) => item.invoiceId !== null).map((item) => item.studentId),
            )
            return plan
          },
        }
      },
      after: async (tx, plan) => {
        const ids: string[] = []
        for (const joined of plan.joined) {
          const id = randomUUID()
          ids.push(id)
          await writeJoin(tx, ctx, id, activityId, joined)
        }
        await auditWork(tx, ctx, 'paid_activity.bulk_join', entity, ['classIds'])
        body = {
          data: {
            activity: await reloadActivity(tx, ctx, activityId),
            participantIds: ids,
            activeCount: plan.joined.filter((item) => item.status === 'active').length,
            awaitingConsentCount: plan.joined.filter((item) => item.status === 'awaiting_consent')
              .length,
            waitlistedCount: plan.joined.filter((item) => item.status === 'waitlisted').length,
            skippedStudentIds: plan.skippedStudentIds,
          },
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

// --- Veli izni -----------------------------------------------------------------------------------

async function writeGrant(
  tx: Database,
  ctx: ServiceContext,
  participantId: string,
  expectedVersion: number | null,
  plan: ConsentGrantPlan,
) {
  const saved = await markParticipantConsentGranted(tx, ctx.institutionId, {
    id: participantId,
    expectedVersion,
    status: plan.status,
    invoiceId: plan.invoiceId,
    channel: plan.channel,
    grantorName: plan.grantorName,
    userId: ctx.actor.userId,
    now: ctx.now,
  })
  if (!saved) throw new ConflictError()
  await auditWork(
    tx,
    ctx,
    'paid_activity.consent_grant',
    { type: PARTICIPANT, id: participantId },
    [
      'consentStatus',
      'consentChannel',
      'consentAt',
      ...(plan.grantorName === null ? [] : ['consentGrantorName']),
      ...(plan.invoiceId === null ? [] : ['status', 'invoiceId']),
    ],
  )
}

/**
 * Personelin girdiği veli izni (K-370): kanal (kâğıt, telefon, yüz yüze) ve izni verenin adı. İzin
 * bekleyen asil asil olur ve taksiti açılır; yedeğin izni kaydedilir. Öğrencinin etkinliği kilit
 * altında okunur; etkin değilse 422 `paid_activity_student_inactive` (K-418).
 */
export async function grantConsentCommand(
  ctx: ServiceContext,
  participantId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const owner = await findParticipant(ctx.db, ctx.institutionId, participantId)
  const entity = { type: PARTICIPANT, id: participantId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.consent_grant',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: studentsScope(owner === null ? [] : [owner.studentId]) },
      entity,
      load: async (tx) => {
        const row = await findParticipant(tx, ctx.institutionId, participantId)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const [activity, studentActive, institution] = await Promise.all([
          requireActivity(tx, ctx, row.activityId),
          isStudentActive(tx, ctx.institutionId, row.studentId),
          getInstitutionModules(tx, ctx.institutionId),
        ])
        return {
          run: (state, { makeId }) => {
            const grant = planManualConsent(input)
            // Ayrılmış ya da mezun öğrenciye izin kaydedilmez, taksit açılmaz (K-418).
            return applyConsentGrant(state, activity, { ...row, studentActive }, grant, {
              today: dayKey(ctx.now),
              makeId,
              institutionType: institution?.type ?? 'school',
            })
          },
        }
      },
      after: async (tx, plan) => {
        await writeGrant(tx, ctx, participantId, expectedVersion, plan)
        body = { data: await reloadParticipant(tx, ctx, participantId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Bağlı dijital izin formundan eşitleme (K-370, IST-067): formda onaylananların izni alınır (izin
 * bekleyen asilin taksiti açılır); formda reddedilenlerin katılımı K-302 kuralıyla iptal edilir ve
 * boşalan yerlere yedekler geçer (K-369). Etkin olmayan öğrencinin yedek ve izin bekleyen katılımı
 * formdan bağımsız parasız iptal edilir, izni alınmaz (K-418; denetimde gerekçe kodu
 * `student_inactive`). Form bağlı değil ya da kullanılamıyorsa 422.
 */
export async function syncConsentsCommand(
  ctx: ServiceContext,
  activityId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const today = dayKey(ctx.now)
  const readPlan = async (db: Database) => {
    const activity = await requireActivity(db, ctx, activityId)
    if (activity.permissionFormId === null || !activity.requiresConsent)
      throw mapOperationError(
        new DomainError(
          'paid_activity_permission_form_missing',
          'Bu etkinliğe bağlı izin formu yok.',
        ),
      )
    const open = await openParticipants(db, ctx.institutionId, activityId)
    const statuses = await formConsentStatuses(
      db,
      ctx.institutionId,
      activity.permissionFormId,
      open.map((item) => item.studentId),
      ctx.now,
    )
    if (statuses === null)
      throw mapOperationError(
        new DomainError(
          'paid_activity_permission_form_not_found',
          'İzin formu bulunamadı ya da kullanılamıyor (iletişim modülü kapalı, form iptal ya da arşiv).',
        ),
      )
    return {
      activity,
      open,
      plan: planConsentSync(open, statuses, { today, activityDate: activity.activityDate }),
    }
  }
  // Kilitten önce: taksiti açılacak öğrenciler (izni gelen izin bekleyenler, iptal edilecek
  // asiller ve geçecek yedekler; etkin olmayanın izin bekleyen katılımı da yer boşaltır).
  const before = await readPlan(ctx.db).catch(() => null)
  const preview =
    before === null
      ? []
      : [
          ...before.plan.grant.map((item) => item.studentId),
          ...before.plan.withdraw.map((item) => item.studentId),
          ...promotionPreview(before.activity, before.open, {
            freed:
              before.plan.withdraw.length +
              before.plan.inactive.filter((item) => holdsSeat(item.status)).length,
            today,
          }),
        ]
  const loaded = new Set(preview)
  const entity = { type: ACTIVITY, id: activityId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.consent_sync',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: studentsScope(preview) },
      entity,
      load: async (tx) => {
        const { activity, open, plan } = await readPlan(tx)
        const paid = await invoicePayments(
          tx,
          ctx.institutionId,
          plan.withdraw.flatMap((item) => (item.invoiceId === null ? [] : [item.invoiceId])),
        )
        const allocated = new Map([...paid].map(([id, item]) => [id, item.paidCents]))
        return {
          run: (state, { makeId }) => {
            const grants = plan.grant.map((participant) => ({
              participant,
              plan: applyConsentGrant(
                state,
                activity,
                participant,
                { channel: 'permission_form', grantorName: null },
                { today, makeId },
              ),
            }))
            const cancels = plan.withdraw.map((participant) => ({
              participant,
              plan: applyParticipationCancel(state, activity, participant, {
                today,
                kind: 'consent',
                allocated,
                makeId,
              }),
            }))
            const inactive = plan.inactive.map((participant) => ({
              participant,
              plan: applyParticipationCancel(state, activity, participant, {
                today,
                kind: 'participant',
                allocated,
                makeId,
              }),
            }))
            requireLoaded(loaded, [
              ...grants
                .filter((item) => item.plan.invoiceId !== null)
                .map((item) => item.participant.studentId),
              ...cancels
                .filter((item) => item.plan.debtInvoiceId !== null)
                .map((item) => item.participant.studentId),
            ])
            const withdrawn = new Set([...plan.withdraw, ...plan.inactive].map((item) => item.id))
            const granted = new Map(grants.map((item) => [item.participant.id, item.plan.status]))
            const remaining: OpenParticipant[] = open
              .filter((item) => !withdrawn.has(item.id))
              .map((item) => {
                const status = granted.get(item.id)
                return status === undefined
                  ? item
                  : { ...item, status, consentStatus: 'granted' as const }
              })
            const promotions = promoteWaitlist(state, activity, remaining, {
              today,
              makeId,
              loaded,
            })
            return { grants, cancels, inactive, promotions }
          },
        }
      },
      after: async (tx, { grants, cancels, inactive, promotions }) => {
        for (const { participant, plan } of grants)
          await writeGrant(tx, ctx, participant.id, null, plan)
        for (const { participant, plan } of cancels)
          await writeConsentCancel(tx, ctx, participant.id, plan, 'permission_form')
        for (const { participant, plan } of inactive)
          await writeReasonedCancel(tx, ctx, participant.id, plan, INACTIVE_CANCEL_REASON)
        await writePromotions(tx, ctx, promotions)
        await auditWork(tx, ctx, 'paid_activity.consent_sync', entity, ['permissionFormId'])
        body = {
          data: {
            activity: await reloadActivity(tx, ctx, activityId),
            grantedCount: grants.length,
            withdrawnCount: cancels.length,
            inactiveCancelledCount: inactive.length,
            promotedCount: promotions.length,
          },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

async function writeConsentCancel(
  tx: Database,
  ctx: ServiceContext,
  participantId: string,
  plan: ParticipationCancelPlan,
  channel: ConsentChannel,
) {
  const saved = await markParticipantCancelled(tx, ctx.institutionId, {
    id: participantId,
    expectedVersion: null,
    ...plan,
    userId: ctx.actor.userId,
    now: ctx.now,
    withdrawal: { channel },
  })
  if (!saved) throw new ConflictError()
  await auditWork(
    tx,
    ctx,
    'paid_activity.participant_cancel',
    { type: PARTICIPANT, id: participantId },
    [...cancelFields(plan), 'consentStatus', 'consentWithdrawnAt', 'consentWithdrawalChannel'],
  )
}

/** Etkin olmayan öğrencinin taksitsiz katılımının eşitlemedeki iptal gerekçesi (K-418). */
export const INACTIVE_CANCEL_REASON = 'student_inactive'

// --- Ayrılıştan kalan katılımlar -----------------------------------------------------------------

/**
 * Ayrılıştan kalan katılımlar (K-419): ayrılmış öğrencinin iptal edilmemiş etkinlikteki yedek ve
 * izin bekleyen katılımları (etkinlik günü son ayrılış günü ya da sonra). ON-346 öncesi ayrılışlar
 * bu satırları kapatmıyordu; yönetici listeyi görüp onaylayarak kapatır.
 */
export function listWithdrawnLeftoversFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) {
  return listWithdrawnLeftovers(ctx.db, ctx.institutionId, query)
}

interface FreedSeat {
  activity: StoredPaidActivity
  open: OpenParticipant[]
  freed: number
}

/**
 * Seçilen kalan katılımlar ve yer boşaltacakları etkinlikler: izin bekleyen kalan katılımın
 * günü bugün ya da sonra olan, iptal edilmemiş etkinliği (K-369; günü geçmişte geçiş olmaz).
 */
async function leftoverSeats(
  db: Database,
  ctx: ServiceContext,
  ids: readonly string[],
  today: string,
) {
  const rows = await withdrawnLeftoverCandidates(db, ctx.institutionId, ids)
  const freed = new Map<string, number>()
  for (const row of rows)
    if (isWithdrawnLeftover(row) && holdsSeat(row.status) && row.activityDate >= today)
      freed.set(row.activityId, (freed.get(row.activityId) ?? 0) + 1)
  const seats = new Map<string, FreedSeat>()
  for (const [activityId, count] of freed) {
    const activity = await findPaidActivity(db, ctx.institutionId, activityId)
    if (activity === null || activity.status === 'cancelled') continue
    seats.set(activityId, {
      activity,
      open: await openParticipants(db, ctx.institutionId, activityId),
      freed: count,
    })
  }
  return { rows, seats }
}

/**
 * Ayrılıştan kalan katılımları yönetici onayıyla parasız iptal eder (K-419): iptal türü katılımcı,
 * iptal günü bugün, denetimde gerekçe kodu `student_withdrawal` (K-395 ile aynı). İzin bekleyenin
 * boşalttığı yere sıradaki etkin yedek aynı işlemde geçer (K-369, K-396); geçecek yedeklerin
 * taksitleri kilitten önce okunan plana göre yüklenir, değiştiyse 409. Başka kurumun katılımı 404.
 */
export async function cancelWithdrawnLeftoversCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const today = dayKey(ctx.now)
  const ids = strings(input, 'participantIds').filter((id) => UUID.test(id))
  const before = await leftoverSeats(ctx.db, ctx, ids, today)
  const preview = [...before.seats.values()].flatMap(({ activity, open, freed }) =>
    promotionPreview(activity, open, { freed, today }),
  )
  const loaded = new Set(preview)
  const entity = { type: PARTICIPANT, id: randomUUID() }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'paid_activity.withdrawn_cleanup',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: studentsScope(preview) },
      entity,
      load: async (tx) => {
        const { rows, seats } = await leftoverSeats(tx, ctx, ids, today)
        const candidates = new Map(rows.map((row) => [row.id, row]))
        return {
          run: (state, { makeId }) => {
            const cancels = planWithdrawnLeftoverCancel(input, candidates, { today })
            const cancelled = new Set(cancels.map((item) => item.participant.id))
            const promotions = [...seats.values()].flatMap(({ activity, open }) =>
              promoteWaitlist(
                state,
                activity,
                open.filter((item) => !cancelled.has(item.id)),
                { today, makeId, loaded },
              ),
            )
            return { cancels, promotions }
          },
        }
      },
      after: async (tx, { cancels, promotions }) => {
        await writeLeftoverCancels(tx, ctx, cancels)
        await writePromotions(tx, ctx, promotions)
        await auditWork(tx, ctx, 'paid_activity.withdrawn_cleanup', entity, ['participantIds'])
        body = {
          data: {
            cancelledIds: cancels.map((item) => item.participant.id),
            promotedCount: promotions.length,
          },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

async function writeLeftoverCancels(
  tx: Database,
  ctx: ServiceContext,
  cancels: readonly WithdrawnLeftoverCancel[],
) {
  for (const { participant, plan } of cancels)
    await writeReasonedCancel(tx, ctx, participant.id, plan, WITHDRAWAL_CANCEL_REASON)
}

// --- Katılım listesi -----------------------------------------------------------------------------

/** Velilerin maskeli telefonları (`records` `parents.phone`; KVKK, `maskPhone`). */
async function maskedParentPhones(db: Database, ctx: ServiceContext, parentIds: readonly string[]) {
  const ids = [...new Set(parentIds)].filter((id) => id !== '')
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'parents', ids, {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => {
      const phone: unknown = row.data.phone
      return [row.id, typeof phone === 'string' && phone.trim() !== '' ? maskPhone(phone) : null]
    }),
  )
}

export type RosterView = RosterRow & { id: string; studentId: string }

/**
 * Basılabilir katılım listesi (K-371): iptal edilmemiş katılımlar; öğrenci, sınıf, maskeli veli
 * telefonu, katılım (asil, izin bekliyor, yedek sırası), veli izni ve ödeme. Tam telefon, IBAN ve
 * izni verenin adı dönmez. Okuma denetime düşer (`finance.paid_activity_roster_export`).
 */
export async function paidActivityRosterFor(ctx: ServiceContext, activityId: string) {
  const activity = await reloadActivity(ctx.db, ctx, activityId)
  const rows = await rosterParticipants(ctx.db, ctx.institutionId, activityId)
  const [paid, classes, phones] = await Promise.all([
    invoicePayments(
      ctx.db,
      ctx.institutionId,
      rows.flatMap((row) => (row.invoiceId === null ? [] : [row.invoiceId])),
    ),
    classNames(
      ctx.db,
      ctx,
      rows.map((row) => row.classId ?? ''),
    ),
    maskedParentPhones(
      ctx.db,
      ctx,
      rows.map((row) => row.parentId ?? ''),
    ),
  ])
  const ranks = waitlistRanks(rows)
  const items: RosterView[] = rows.flatMap((row) => {
    if (row.status === 'cancelled') return []
    const invoice = row.invoiceId === null ? undefined : paid.get(row.invoiceId)
    const amountCents = row.invoiceId === null ? 0 : (invoice?.amountCents ?? row.feeCents)
    const collectedCents = invoice?.paidCents ?? 0
    return [
      {
        id: row.id,
        studentId: row.studentId,
        studentName: row.studentName ?? '',
        className: row.classId === null ? null : (classes.get(row.classId) ?? null),
        guardianPhoneMasked: row.parentId === null ? null : (phones.get(row.parentId) ?? null),
        status: row.status,
        waitlistRank: ranks.get(row.id) ?? null,
        consentStatus: row.consentStatus,
        consentChannel: row.consentChannel,
        paymentStatus: participationPaymentStatus(
          amountCents,
          collectedCents,
          row.invoiceId !== null,
        ),
        amountCents,
        collectedCents,
      },
    ]
  })
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.paid_activity_roster_export',
    entityType: ACTIVITY,
    entityId: activityId,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { activity, items }
}

/** Katılım listesi CSV'si (K-371). */
export async function paidActivityRosterCsvFor(ctx: ServiceContext, activityId: string) {
  const { items } = await paidActivityRosterFor(ctx, activityId)
  return {
    csv: paidActivityRosterCsv(items),
    filename: `gezi-katilim-listesi-${dayKey(ctx.now)}.csv`,
  }
}
