import { randomUUID } from 'node:crypto'

import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { assertPayrollDaysUnlocked } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import {
  advanceClosedRemainder,
  advanceInstallmentPlan,
  advanceLockRange,
  advanceOutstanding,
  fromDayLockRange,
  garnishmentQueue,
  monthlyDeductionRequestSchema,
  monthlyDeductions,
  monthOf,
  pensionOptOutKind,
  pensionPauseLockRange,
  pensionStateIn,
  planStaffAdvance,
  planStaffAdvanceCancel,
  planStaffAdvanceClose,
  planStaffGarnishment,
  planStaffGarnishmentBalance,
  planStaffGarnishmentClose,
  planStaffPension,
  planStaffPensionOptOut,
  planStaffPensionPause,
  staffAdvanceCloseSchema,
  staffAdvanceSchema,
  staffDeductionCancelSchema,
  staffGarnishmentBalanceSchema,
  staffGarnishmentCloseSchema,
  staffGarnishmentSchema,
  staffPensionOptOutSchema,
  staffPensionPauseSchema,
  staffPensionSchema,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { lockedPayrollMonths } from '../db/finance-payroll-periods.ts'
import {
  cancelAdvance,
  closeAdvance,
  closeGarnishment,
  findAdvance,
  findDeductionStaff,
  findGarnishment,
  findPension,
  hasOpenPension,
  insertAdvance,
  insertGarnishment,
  insertPension,
  listAdvances,
  listDeductionStaff,
  listGarnishments,
  listPensions,
  loadGarnishmentState,
  updateGarnishmentRemaining,
  updateOpenPension,
  type DeductionStaffQuery,
  type StoredAdvance,
  type StoredGarnishment,
  type StoredPension,
} from '../db/finance-staff-deductions.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Avans ve kesintiler (DOM-FIN-101; ON-199). Kural core `lib/finance-staff-deductions.ts`'tedir;
 * servis kurum kilidi altında personel üyeliğini ve kaydı yükler, aynı transaction'da yazar.
 * İcra bilgisi hassastır (K-315): icra dönen her okuma denetim kaydına alan adlarıyla yazılır;
 * daire, dosya, tutar ve gerekçe metni denetime ve loga yazılmaz. Rol ve modül denetimi rotadadır.
 *
 * Dönem kilidi (DOM-FIN-108, K-394): kesinti ayını değiştiren yazma kurum kilidi altında onaylı
 * ayları okur ve kendi etki aralığıyla core `assertPayrollDaysUnlocked`'u çağırır; kilitli aya
 * değen değişiklik 409 `payroll_period_locked`. Kalan alacak güncellemesi tarihsiz bakiyedir,
 * denetlenmez.
 */

const ADVANCES = 'staff_advances'
const GARNISHMENTS = 'staff_garnishments'
const PENSIONS = 'staff_pension_enrollments'
/** İcra okumasında denetime yazılan alan adları (değer yazılmaz). */
const GARNISHMENT_READ_FIELDS = [
  'office',
  'fileNumber',
  'claimCents',
  'remainingCents',
  'rateBasisPoints',
  'isAlimony',
]

const presentKeys = (value: Record<string, unknown>) =>
  Object.keys(value).filter((key) => value[key] !== null && value[key] !== undefined)

// --- Görünümler ----------------------------------------------------------------------------------

type InstallmentState = 'past' | 'current' | 'upcoming' | 'closed' | 'cancelled'

/** Avans ve taksit planı; taksit durumu bugünün ayına göredir (bordro kesintisi henüz yok). */
export function advanceView(advance: StoredAdvance, today: string) {
  const month = monthOf(today)
  const stateOf = (installmentMonth: string): InstallmentState => {
    if (advance.status === 'cancelled') return 'cancelled'
    if (advance.closedFromMonth !== null && installmentMonth >= advance.closedFromMonth)
      return 'closed'
    if (installmentMonth < month) return 'past'
    return installmentMonth === month ? 'current' : 'upcoming'
  }
  return {
    ...advance,
    installments: advanceInstallmentPlan(advance).map((item) => ({
      ...item,
      state: stateOf(item.month),
    })),
    outstandingCents: advanceOutstanding(advance, month),
    closedRemainderCents: advanceClosedRemainder(advance),
  }
}

/** İcralar ve kesinti sırası (açıklar arasında; kapanmışta boş). */
export function garnishmentViews(items: readonly StoredGarnishment[]) {
  const queue = garnishmentQueue(items.filter((item) => item.status === 'active'))
  const position = new Map(queue.map((item, index) => [item.id, index + 1]))
  return items.map((item) => ({ ...item, queuePosition: position.get(item.id) ?? null }))
}

export function pensionView(pension: StoredPension, today: string) {
  return {
    ...pension,
    state: pensionStateIn(pension, monthOf(today)),
    optOutKind: pensionOptOutKind(pension),
  }
}

async function staffOf(ctx: ServiceContext, db: Database, membershipId: string) {
  const staff = await findDeductionStaff(db, ctx.institutionId, membershipId)
  if (staff === null) throw new NotFoundError()
  return staff
}

const auditRead = (ctx: ServiceContext, action: string, entityId: string) =>
  auditWork(ctx.db, ctx, action, { type: GARNISHMENTS, id: entityId }, GARNISHMENT_READ_FIELDS)

// --- Okuma ---------------------------------------------------------------------------------------

/** Personel listesi ve açık kayıt sayıları; icra sayısı dönen sayfa denetime yazılır (K-315). */
export async function listDeductionStaffFor(ctx: ServiceContext, query: DeductionStaffQuery) {
  const result = await listDeductionStaff(ctx.db, ctx.institutionId, query)
  if (result.items.some((item) => item.activeGarnishmentCount > 0))
    await auditWork(ctx.db, ctx, 'staff_deduction.list_read', { type: GARNISHMENTS, id: 'list' }, [
      'activeGarnishmentCount',
    ])
  return result
}

async function loadSources(ctx: ServiceContext, membershipId: string) {
  const [advances, garnishments, pensions] = await Promise.all([
    listAdvances(ctx.db, ctx.institutionId, membershipId),
    listGarnishments(ctx.db, ctx.institutionId, membershipId),
    listPensions(ctx.db, ctx.institutionId, membershipId),
  ])
  return { advances, garnishments, pensions }
}

/** Personelin avansları (planla), icraları (sırayla) ve BES katılımları. İcra okuması denetlenir. */
export async function getStaffDeductionsFor(ctx: ServiceContext, membershipId: string) {
  const staff = await staffOf(ctx, ctx.db, membershipId)
  const { advances, garnishments, pensions } = await loadSources(ctx, membershipId)
  if (garnishments.length > 0) await auditRead(ctx, 'staff_deduction.read', membershipId)
  const today = dayKey(ctx.now)
  return {
    staff,
    advances: advances.map((item) => advanceView(item, today)),
    garnishments: garnishmentViews(garnishments),
    pensions: pensions.map((item) => pensionView(item, today)),
  }
}

/**
 * Ay için kesinti listesi (DOM-FIN-101, K-315): kayıtları okur, core `monthlyDeductions` ile
 * hesaplar; hiçbir şey yazmaz, net ücret ve matrah saklanmaz. İcra satırı dönerse denetlenir.
 */
export async function previewMonthlyDeductionsFor(
  ctx: ServiceContext,
  membershipId: string,
  input: unknown,
) {
  await staffOf(ctx, ctx.db, membershipId)
  const request = monthlyDeductionRequestSchema.parse(input)
  const sources = await loadSources(ctx, membershipId)
  const result = monthlyDeductions(request, sources)
  if (result.lines.some((line) => line.kind === 'garnishment'))
    await auditRead(ctx, 'staff_deduction.preview', membershipId)
  return result
}

// --- Yazma ---------------------------------------------------------------------------------------

/** Komut çalıştırıcı: kurum kilidi altında yükler, kuralı çalıştırır, yazar ve denetler. */
function command<P>(
  ctx: ServiceContext,
  spec: {
    action: string
    entity: { type: string; id: string }
    statusCode: 200 | 201
    load: (tx: Database) => Promise<() => P>
    write: (tx: Database, planned: P) => Promise<string[]>
    body: (tx: Database) => Promise<unknown>
  },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: spec.action,
      collections: [],
      entity: spec.entity,
      load: async (tx) => ({ run: await spec.load(tx) }),
      after: async (tx, planned) => {
        const fields = await spec.write(tx, planned)
        await auditWork(tx, ctx, spec.action, spec.entity, fields)
        body = { data: await spec.body(tx) }
      },
    },
    () => ({ statusCode: spec.statusCode, body }),
    idempotency,
  )
}

const advanceBody = async (tx: Database, ctx: ServiceContext, id: string) => {
  const found = await findAdvance(tx, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return advanceView(found, dayKey(ctx.now))
}

async function advanceFor(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const found = await findAdvance(tx, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  if (found.version !== version) throw new ConflictError()
  return found
}

/** Avans (K-312): personel kurumun etkin personeli; 201. `Idempotency-Key` zorunlu. */
export function createAdvanceCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  return command(
    ctx,
    {
      action: 'staff_advance.create',
      entity: { type: ADVANCES, id },
      statusCode: 201,
      load: async (tx) => {
        const parsed = staffAdvanceSchema.parse(input)
        const staff = await findDeductionStaff(tx, ctx.institutionId, parsed.membershipId)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return () => {
          const planned = planStaffAdvance(parsed, { today: dayKey(ctx.now), staff })
          assertPayrollDaysUnlocked(locked, [advanceLockRange(planned)], 'firstMonth')
          return planned
        }
      },
      write: async (tx, planned) => {
        await insertAdvance(tx, ctx.institutionId, {
          ...planned,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        return Object.keys(planned)
      },
      body: (tx) => advanceBody(tx, ctx, id),
    },
    idempotency,
  )
}

/** Erken kapama (K-312): kalan taksitler kesilmez; `If-Match` zorunlu. */
export function closeAdvanceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'staff_advance.close',
      entity: { type: ADVANCES, id },
      statusCode: 200,
      load: async (tx) => {
        const parsed = staffAdvanceCloseSchema.parse(input)
        const current = await advanceFor(tx, ctx, id, expectedVersion)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return () => {
          planStaffAdvanceClose(current, parsed, dayKey(ctx.now))
          assertPayrollDaysUnlocked(
            locked,
            [advanceLockRange(current, parsed.fromMonth)],
            'fromMonth',
          )
          return parsed
        }
      },
      write: async (tx, parsed) => {
        const saved = await closeAdvance(tx, ctx.institutionId, {
          ...parsed,
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        return ['status', 'closedDate', 'closedFromMonth', 'closeMethod']
      },
      body: (tx) => advanceBody(tx, ctx, id),
    },
    idempotency,
  )
}

/** İptal (K-312): gerekçe saklanır, denetime yalnız alan adı yazılır; `If-Match` zorunlu. */
export function cancelAdvanceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'staff_advance.cancel',
      entity: { type: ADVANCES, id },
      statusCode: 200,
      load: async (tx) => {
        const parsed = staffDeductionCancelSchema.parse(input)
        const current = await advanceFor(tx, ctx, id, expectedVersion)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return () => {
          planStaffAdvanceCancel(current)
          assertPayrollDaysUnlocked(locked, [advanceLockRange(current)], 'reason')
          return parsed
        }
      },
      write: async (tx, parsed) => {
        const saved = await cancelAdvance(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        return ['status', 'cancelReason']
      },
      body: (tx) => advanceBody(tx, ctx, id),
    },
    idempotency,
  )
}

const garnishmentBody = async (tx: Database, ctx: ServiceContext, id: string) => {
  const found = await findGarnishment(tx, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  const all = await listGarnishments(tx, ctx.institutionId, found.membershipId)
  const view = garnishmentViews(all).find((item) => item.id === id)
  if (view === undefined) throw new NotFoundError()
  return view
}

async function garnishmentFor(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const found = await findGarnishment(tx, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  if (found.version !== version) throw new ConflictError()
  return found
}

/** İcra kaydı (K-313): aynı daire ve dosya 409; sıra numarası kurum kilidi altında verilir. */
export function createGarnishmentCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  let sequence = 0
  return command(
    ctx,
    {
      action: 'staff_garnishment.create',
      entity: { type: GARNISHMENTS, id },
      statusCode: 201,
      load: async (tx) => {
        const parsed = staffGarnishmentSchema.parse(input)
        const staff = await findDeductionStaff(tx, ctx.institutionId, parsed.membershipId)
        const state = await loadGarnishmentState(tx, ctx.institutionId, parsed)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        sequence = state.nextSequence
        return () => {
          const planned = planStaffGarnishment(parsed, { today: dayKey(ctx.now), staff })
          if (state.duplicate)
            throw new DomainError(
              'staff_garnishment_duplicate',
              'Bu icra dosyası bu personele zaten kayıtlı.',
              { kind: 'conflict', path: ['fileNumber'] },
            )
          assertPayrollDaysUnlocked(
            locked,
            [fromDayLockRange(planned.receivedDate)],
            'receivedDate',
          )
          return planned
        }
      },
      write: async (tx, planned) => {
        await insertGarnishment(tx, ctx.institutionId, {
          ...planned,
          id,
          sequence,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        return [...Object.keys(planned), 'remainingCents', 'sequence']
      },
      body: (tx) => garnishmentBody(tx, ctx, id),
    },
    idempotency,
  )
}

/** Kalan alacak (K-313): yalnız açık icrada, alacağı aşamaz; `If-Match` zorunlu. */
export function updateGarnishmentCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'staff_garnishment.update',
      entity: { type: GARNISHMENTS, id },
      statusCode: 200,
      load: async (tx) => {
        const parsed = staffGarnishmentBalanceSchema.parse(input)
        const current = await garnishmentFor(tx, ctx, id, expectedVersion)
        return () => {
          planStaffGarnishmentBalance(current, parsed.remainingCents)
          return parsed
        }
      },
      write: async (tx, parsed) => {
        const saved = await updateGarnishmentRemaining(tx, ctx.institutionId, {
          id,
          expectedVersion,
          remainingCents: parsed.remainingCents,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        return ['remainingCents']
      },
      body: (tx) => garnishmentBody(tx, ctx, id),
    },
    idempotency,
  )
}

/** İcra kapanışı (K-313): gün ve neden; `If-Match` zorunlu. */
export function closeGarnishmentCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'staff_garnishment.close',
      entity: { type: GARNISHMENTS, id },
      statusCode: 200,
      load: async (tx) => {
        const parsed = staffGarnishmentCloseSchema.parse(input)
        const current = await garnishmentFor(tx, ctx, id, expectedVersion)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return () => {
          planStaffGarnishmentClose(current, parsed, dayKey(ctx.now))
          assertPayrollDaysUnlocked(locked, [fromDayLockRange(parsed.closedDate)], 'closedDate')
          return parsed
        }
      },
      write: async (tx, parsed) => {
        const saved = await closeGarnishment(tx, ctx.institutionId, {
          ...parsed,
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        return ['status', 'closedDate', 'closeReason']
      },
      body: (tx) => garnishmentBody(tx, ctx, id),
    },
    idempotency,
  )
}

const pensionBody = async (tx: Database, ctx: ServiceContext, id: string) => {
  const found = await findPension(tx, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return pensionView(found, dayKey(ctx.now))
}

async function pensionFor(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const found = await findPension(tx, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  if (found.version !== version) throw new ConflictError()
  return found
}

/** BES katılımı (K-314): personelin tek açık katılımı (409); 201. */
export function createPensionCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  return command(
    ctx,
    {
      action: 'staff_pension.create',
      entity: { type: PENSIONS, id },
      statusCode: 201,
      load: async (tx) => {
        const parsed = staffPensionSchema.parse(input)
        const staff = await findDeductionStaff(tx, ctx.institutionId, parsed.membershipId)
        const hasOpenEnrollment = await hasOpenPension(tx, ctx.institutionId, parsed.membershipId)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return () => {
          const planned = planStaffPension(parsed, { staff, hasOpenEnrollment })
          assertPayrollDaysUnlocked(locked, [fromDayLockRange(planned.startDate)], 'startDate')
          return planned
        }
      },
      write: async (tx, planned) => {
        await insertPension(tx, ctx.institutionId, {
          ...planned,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        return presentKeys(planned)
      },
      body: (tx) => pensionBody(tx, ctx, id),
    },
    idempotency,
  )
}

/** Ara verme (K-314): çakışmayan, en çok 12 aylık aralık; `If-Match` zorunlu. */
export function pausePensionCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'staff_pension.pause',
      entity: { type: PENSIONS, id },
      statusCode: 200,
      load: async (tx) => {
        const parsed = staffPensionPauseSchema.parse(input)
        const current = await pensionFor(tx, ctx, id, expectedVersion)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return () => {
          planStaffPensionPause(current, parsed)
          assertPayrollDaysUnlocked(locked, [pensionPauseLockRange(parsed)], 'fromMonth')
          return [...current.pauses, parsed].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth))
        }
      },
      write: async (tx, pauses) => {
        const saved = await updateOpenPension(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          pauses,
        })
        if (!saved) throw new ConflictError()
        return ['pauses']
      },
      body: (tx) => pensionBody(tx, ctx, id),
    },
    idempotency,
  )
}

/** Cayma ya da ayrılma (K-314): bir kez; `If-Match` zorunlu. */
export function optOutPensionCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return command(
    ctx,
    {
      action: 'staff_pension.opt_out',
      entity: { type: PENSIONS, id },
      statusCode: 200,
      load: async (tx) => {
        const parsed = staffPensionOptOutSchema.parse(input)
        const current = await pensionFor(tx, ctx, id, expectedVersion)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return () => {
          planStaffPensionOptOut(current, parsed.optOutDate, dayKey(ctx.now))
          assertPayrollDaysUnlocked(locked, [fromDayLockRange(parsed.optOutDate)], 'optOutDate')
          return parsed
        }
      },
      write: async (tx, parsed) => {
        const saved = await updateOpenPension(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          optOut: { date: parsed.optOutDate, userId: ctx.actor.userId },
        })
        if (!saved) throw new ConflictError()
        return ['optOutDate']
      },
      body: (tx) => pensionBody(tx, ctx, id),
    },
    idempotency,
  )
}
