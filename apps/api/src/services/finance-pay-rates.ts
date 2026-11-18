import { randomUUID } from 'node:crypto'

import {
  latestPayRate,
  payRateCancelSchema,
  payRateEndSchema,
  payRateInputSchema,
  payRateSlot,
  payRateState,
  payRatesOn,
  planPayRate,
  planPayRateCancel,
  planPayRateEnd,
  severancePaySuggestion,
  wageOn,
  type PayRateTarget,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  assertPayrollDaysUnlocked,
  payRateCancelRange,
  payRateCreateRange,
  payRateEndRange,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import {
  cancelPayRate,
  closePayRate,
  findClosedBy,
  findPayRate,
  findStaffMember,
  insertPayRate,
  linkClosedPayRate,
  listStaffMembers,
  loadSlotPayRates,
  loadStaffPayRates,
  reopenPayRate,
  setPayRateEnd,
  type StaffQuery,
  type StoredPayRate,
} from '../db/finance-pay-rates.ts'
import { lockedPayrollMonths } from '../db/finance-payroll-periods.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel ücret tanımı (DOM-FIN-099; ON-194). Kural core `lib/finance-pay-rates.ts`'tedir; servis
 * kurum kilidi altında üyeliği ve yuvanın tanımlarını yükler, aynı transaction'da yazar. Ücret
 * kişisel veridir (K-306): denetim kaydına alan adları yazılır, tutar, not ve gerekçe yazılmaz.
 * Tutar içeren her okuma (`finance.pay_rate.read`) okumayla aynı transaction'da denetime düşer;
 * maskeli liste okuması düşmez (K-307). Onaylı bordro ayına düşen yazma 409 `payroll_period_locked`
 * olur (DOM-FIN-108, K-357). Rol ve modül denetimi rotadadır (yalnız yönetici).
 */

const ENTITY = 'staff_pay_rates'
const READ_ACTION = 'finance.pay_rate.read'

/** Yanıt görünümü: durum bugüne göre hesaplanır, iç bağlar dönmez. */
export function payRateView(rate: StoredPayRate, today: string) {
  return {
    id: rate.id,
    membershipId: rate.membershipId,
    component: rate.component,
    rateType: rate.rateType,
    amountCents: rate.amountCents,
    currency: rate.currency,
    benefitForm: rate.benefitForm,
    taxable: rate.taxable,
    startDate: rate.startDate,
    endDate: rate.endDate,
    note: rate.note,
    autoClosed: rate.closedByRateId !== null,
    state: payRateState(rate, today),
    createdAt: rate.createdAt,
    version: rate.version,
  }
}
export type PayRateView = ReturnType<typeof payRateView>

async function auditRead(tx: Database, ctx: ServiceContext, entityId: string) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: READ_ACTION,
    entityType: ENTITY,
    entityId,
    // kvkk: tutar değil, dönen alanın adı (K-307).
    changes: { fields: ['amountCents'] },
    createdAt: ctx.now,
  })
}

/** Personel üyeliği: yoksa ya da personel değilse (öğrenci, veli) 404. */
async function staffOf(db: Database, ctx: ServiceContext, membershipId: string) {
  const member = await findStaffMember(db, ctx.institutionId, membershipId)
  if (member === null || !isStaffRole(member.role)) throw new NotFoundError()
  return member
}

/**
 * Personel listesi ve `day` günündeki ücret özeti (K-306). Varsayılan maskelidir: ana ücret türü ve
 * başlangıcı döner, tutar `null`. `showAmounts` tutarı da verir ve denetime düşer (K-307).
 */
export async function listPayRateStaffFor(
  ctx: ServiceContext,
  query: StaffQuery & { day?: string | undefined; showAmounts: boolean },
) {
  const day = query.day ?? dayKey(ctx.now)
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listStaffMembers(tx, ctx.institutionId, query)
    const rates = await loadStaffPayRates(
      tx,
      ctx.institutionId,
      items.map((item) => item.membershipId),
    )
    const byMember = new Map<string, StoredPayRate[]>()
    for (const rate of rates)
      byMember.set(rate.membershipId, [...(byMember.get(rate.membershipId) ?? []), rate])
    const rows = items.map((member) => {
      const own = byMember.get(member.membershipId) ?? []
      const effective = payRatesOn(own, day)
      const wage = wageOn(own, day)
      return {
        ...member,
        wage:
          wage === null
            ? null
            : {
                rateType: wage.rateType,
                amountCents: query.showAmounts ? wage.amountCents : null,
                startDate: wage.startDate,
              },
        lessonRateCount: effective.filter((rate) => rate.component === 'lesson').length,
        benefitCount: effective.filter((rate) => rate.component === 'benefit').length,
        rateCount: own.length,
      }
    })
    if (query.showAmounts) await auditRead(tx, ctx, ctx.institutionId)
    return { items: rows, total, day }
  })
}

/**
 * Personelin ücret geçmişi ve `day` gününde geçerli tanımları ("şu tarihte geçerli ücret").
 * Tutar içerdiği için her okuma denetime düşer (K-307); denetim yazılamazsa yanıt dönmez.
 */
export async function getStaffPayRatesFor(
  ctx: ServiceContext,
  membershipId: string,
  day: string | undefined,
) {
  const on = day ?? dayKey(ctx.now)
  const today = dayKey(ctx.now)
  return ctx.db.transaction(async (tx) => {
    const member = await staffOf(tx, ctx, membershipId)
    const rates = await loadStaffPayRates(tx, ctx.institutionId, [membershipId])
    await auditRead(tx, ctx, membershipId)
    return {
      ...member,
      date: on,
      rates: rates.map((rate) => payRateView(rate, today)),
      effective: payRatesOn(rates, on).map((rate) => payRateView(rate, today)),
    }
  })
}

/**
 * Yalnız okuma (ON-205 kıdem hesaplayıcısının "güncel ücret" önerisi için): `day` gününde geçerli
 * tanımlar ve aylık brüt + yan hak önerisi. Denetim kaydını çağıran uç yazar (K-307).
 */
export async function payRatesInEffectFor(
  ctx: Pick<ServiceContext, 'db' | 'institutionId'>,
  membershipId: string,
  day: string,
) {
  const rates = await loadStaffPayRates(ctx.db, ctx.institutionId, [membershipId])
  return { effective: payRatesOn(rates, day), severance: severancePaySuggestion(rates, day) }
}

async function rateBody(tx: Database, ctx: ServiceContext, id: string) {
  const rate = await findPayRate(tx, ctx.institutionId, id)
  if (rate === null) throw new NotFoundError()
  return payRateView(rate, dayKey(ctx.now))
}

/** Tanımın yuvadaki yeri (son tanım mı); bulunamazsa 404, sürüm tutmazsa 409. */
async function targetOf(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
): Promise<{ rate: StoredPayRate; target: PayRateTarget }> {
  const rate = await findPayRate(tx, ctx.institutionId, id)
  if (rate === null) throw new NotFoundError()
  if (rate.version !== expectedVersion) throw new ConflictError()
  const slot = await loadSlotPayRates(tx, ctx.institutionId, rate.membershipId, rate.slot)
  return { rate, target: { ...rate, isLatest: latestPayRate(slot)?.id === rate.id } }
}

/** Yeni tanım (K-304): yuvanın son tanımı kendiliğinden kapanır. 201. */
export function createPayRateCommand(
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
      action: 'finance.pay_rate.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payRateInputSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const slotRates = await loadSlotPayRates(
          tx,
          ctx.institutionId,
          parsed.membershipId,
          payRateSlot(parsed.component, parsed.rateType),
        )
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return {
          run: () => {
            const plan = planPayRate(parsed, { staff, slotRates })
            assertPayrollDaysUnlocked(locked, [
              payRateCreateRange(parsed, plan.close?.previousEndDate),
            ])
            return { parsed, plan }
          },
        }
      },
      after: async (tx, { parsed, plan }) => {
        if (plan.close !== null) {
          const closed = await closePayRate(tx, ctx.institutionId, {
            id: plan.close.id,
            endDate: plan.close.endDate,
            now: ctx.now,
          })
          if (!closed) throw new ConflictError()
        }
        await insertPayRate(tx, ctx.institutionId, {
          id,
          membershipId: parsed.membershipId,
          component: parsed.component,
          rateType: parsed.rateType,
          slot: plan.slot,
          amountCents: parsed.amountCents,
          benefitForm: parsed.component === 'benefit' ? parsed.benefitForm : null,
          taxable: parsed.component === 'benefit' ? parsed.taxable : null,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          note: parsed.note,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (plan.close !== null) {
          await linkClosedPayRate(tx, ctx.institutionId, {
            id: plan.close.id,
            closedByRateId: id,
            previousEndDate: plan.close.previousEndDate,
          })
          await auditWork(tx, ctx, 'finance.pay_rate.close', { type: ENTITY, id: plan.close.id }, [
            'endDate',
          ])
        }
        await auditWork(
          tx,
          ctx,
          'finance.pay_rate.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        const rate = await rateBody(tx, ctx, id)
        const closedRate = plan.close === null ? null : await rateBody(tx, ctx, plan.close.id)
        body = { data: { rate, closedRate } }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Son tanımın bitişini değiştir (K-304). */
export function endPayRateCommand(
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
      action: 'finance.pay_rate.end',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payRateEndSchema.parse(input)
        const { target } = await targetOf(tx, ctx, id, expectedVersion)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return {
          run: () => {
            planPayRateEnd(target, parsed)
            assertPayrollDaysUnlocked(
              locked,
              [payRateEndRange(target.endDate, parsed.endDate)],
              'endDate',
            )
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await setPayRateEnd(tx, ctx.institutionId, {
          id,
          expectedVersion,
          endDate: parsed.endDate,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.pay_rate.end', entity, ['endDate'])
        body = { data: await rateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Son tanımı gerekçeyle iptal et (K-304); kapattığı tanımın eski bitişi geri yazılır. */
export function cancelPayRateCommand(
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
      action: 'finance.pay_rate.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payRateCancelSchema.parse(input)
        const { target } = await targetOf(tx, ctx, id, expectedVersion)
        const closed = await findClosedBy(tx, ctx.institutionId, id)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return {
          run: () => {
            const plan = planPayRateCancel(target, closed)
            assertPayrollDaysUnlocked(
              locked,
              [payRateCancelRange(target, closed?.previousEndDate)],
              'id',
            )
            return { parsed, plan }
          },
        }
      },
      after: async (tx, { parsed, plan }) => {
        const saved = await cancelPayRate(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.pay_rate.cancel', entity, ['archivedAt', 'cancelReason'])
        const reopened = plan.reopen
        if (reopened !== null) {
          await reopenPayRate(tx, ctx.institutionId, { ...reopened, now: ctx.now })
          await auditWork(tx, ctx, 'finance.pay_rate.reopen', { type: ENTITY, id: reopened.id }, [
            'endDate',
          ])
        }
        body = {
          data: {
            id,
            reopenedRate: reopened === null ? null : await rateBody(tx, ctx, reopened.id),
          },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
