import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { advanceOutstanding, monthOf } from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { leaveEntitlement } from '@kampus/school-core/lib/finance-staff-leave.ts'
import { staffCertificateLabel } from '@kampus/school-core/lib/finance-staff-certificates.ts'
import {
  markFieldOf,
  missingSeparationSteps,
  planStaffSeparation,
  planStaffSeparationCancel,
  planStaffSeparationComplete,
  planStaffSeparationStep,
  planStaffSeparationUpdate,
  staffSeparationInputSchema,
  staffSeparationNotice,
  staffSeparationSteps,
  staffSeparationUpdateSchema,
  type StaffSeparationFacts,
} from '@kampus/school-core/lib/finance-staff-separations.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { listAssignments, type StoredAssignment } from '../db/finance-fixed-asset-assignments.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import { lockedPayrollMonths } from '../db/finance-payroll-periods.ts'
import { listStaffCertificates } from '../db/finance-staff-certificates.ts'
import { listAdvances, listGarnishments } from '../db/finance-staff-deductions.ts'
import { findLeaveProfile, loadLeaveRecords } from '../db/finance-staff-leave.ts'
import {
  cancelStaffSeparation,
  completeStaffSeparation,
  findStaffSeparation,
  hasOpenSeparation,
  insertStaffSeparation,
  listStaffSeparations,
  markStaffSeparationStep,
  separationUserNames,
  updateStaffSeparationDetails,
  type StaffSeparationQuery,
  type StoredStaffSeparation,
} from '../db/finance-staff-separations.ts'
import { institutions } from '../db/schema/auth.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * İşten ayrılış süreci (DOM-FIN-118; ON-180). Kural core `lib/finance-staff-separations.ts`'tedir;
 * servis dosyayı ve adımların kaynaklarını yükler: personelin zimmetleri (DOM-FIN-086), avans ve
 * icraları (DOM-FIN-101), izin profili ve kayıtları (DOM-FIN-109), hizmet belgesi (DOM-FIN-106),
 * üyeliğin pasifleştirilmesi (DOM-YTK-070) ve bordro ayı kilidi (DOM-FIN-108). Hesap kapatma kodu
 * yazmaz; platformun pasifleştirmesini okur (K-405). Yazmalar kurum kilidi altında tek
 * transaction'dadır; denetim kaydına alan adları yazılır, not ve gerekçe yazılmaz. İcra sayısı
 * dönen okuma `finance.staff_separation.garnishment_read` denetimine düşer (K-315). Rol ve modül
 * denetimi rotadadır (yalnız yönetici).
 */

const ENTITY = 'staff_separations'
/** Bir personelin zimmet dökümü için üst sınır (personel başına zimmet sayısı küçüktür). */
const ASSET_PAGE = 100

const presentKeys = (value: Record<string, unknown>) =>
  Object.keys(value).filter((key) => value[key] !== null && value[key] !== undefined)

/** Liste görünümü (adımlar hesaplanmaz; ayrıntıda). */
export function staffSeparationView(separation: StoredStaffSeparation) {
  return {
    id: separation.id,
    membershipId: separation.membershipId,
    staffName: separation.staffName,
    staffRole: separation.staffRole,
    staffActive: separation.deactivatedAt === null,
    separationDate: separation.separationDate,
    reason: separation.reason,
    sgkExitCode: separation.sgkExitCode,
    hireDate: separation.hireDate,
    noticeGivenDate: separation.noticeGivenDate,
    note: separation.note,
    status: separation.status,
    createdAt: separation.createdAt,
    completedAt: separation.completedAt,
    cancelledAt: separation.cancelledAt,
    cancelReason: separation.cancelReason,
    version: separation.version,
  }
}

export async function listStaffSeparationsFor(ctx: ServiceContext, query: StaffSeparationQuery) {
  const { items, total } = await listStaffSeparations(ctx.db, ctx.institutionId, query)
  return { items: items.map(staffSeparationView), total }
}

/** Adım kaynakları: zimmetler, avans/icra, izin, hizmet belgesi ve bordro ayı kilidi. */
async function loadSources(db: Database, ctx: ServiceContext, separation: StoredStaffSeparation) {
  const { institutionId } = ctx
  const membershipId = separation.membershipId
  const [
    openAssets,
    returnedAssets,
    advances,
    garnishments,
    profile,
    records,
    certificates,
    locks,
  ] = await Promise.all([
    listAssignments(db, institutionId, {
      page: 1,
      pageSize: ASSET_PAGE,
      membershipId,
      state: 'open',
    }),
    listAssignments(db, institutionId, {
      page: 1,
      pageSize: ASSET_PAGE,
      membershipId,
      state: 'returned',
    }),
    listAdvances(db, institutionId, membershipId),
    listGarnishments(db, institutionId, membershipId),
    findLeaveProfile(db, institutionId, membershipId),
    loadLeaveRecords(db, institutionId, [membershipId]),
    listStaffCertificates(db, institutionId, {
      page: 1,
      pageSize: 1,
      membershipId,
      kind: 'service',
      status: 'valid',
    }),
    lockedPayrollMonths(db, institutionId),
  ])
  const exitMonth = monthOf(separation.separationDate)
  const openAdvances = advances
    .map((advance) => advanceOutstanding(advance, exitMonth))
    .filter((amount) => amount > 0)
  const activeGarnishmentCount = garnishments.filter((item) => item.status === 'active').length
  const unusedLeaveDays =
    profile === null
      ? null
      : leaveEntitlement(profile, records, separation.separationDate, separation.separationDate)
          .balanceDays
  const certificate = certificates.items[0] ?? null
  const facts: StaffSeparationFacts = {
    openAssetCount: openAssets.total,
    openAdvanceCents: openAdvances.reduce((total, amount) => total + amount, 0),
    activeGarnishmentCount,
    accountClosed: separation.deactivatedAt !== null,
    serviceCertificate: certificate !== null,
  }
  return {
    facts,
    assets: [...openAssets.items, ...returnedAssets.items],
    openAdvanceCount: openAdvances.length,
    hasLeaveProfile: profile !== null,
    unusedLeaveDays,
    certificate,
    payrollMonth: exitMonth,
    payrollMonthLocked: locks.includes(exitMonth),
  }
}
type Sources = Awaited<ReturnType<typeof loadSources>>

const assetView = (assignment: StoredAssignment) => ({
  assignmentId: assignment.id,
  assetId: assignment.assetId,
  assetTagNumber: assignment.assetTagNumber,
  assetName: assignment.assetName,
  assignedDate: assignment.assignedDate,
  returnDate: assignment.returnDate,
  returnCondition: assignment.returnCondition,
  version: assignment.version,
})

/** Ayrıntı: dosya, bildirim bilgisi, adımlar ve adım kaynaklarının özeti. */
async function detailBody(db: Database, ctx: ServiceContext, separation: StoredStaffSeparation) {
  const sources = await loadSources(db, ctx, separation)
  const steps = staffSeparationSteps(separation, sources.facts)
  const names = await separationUserNames(db, [
    separation.deductionsCheckedByUserId,
    separation.leaveCheckedByUserId,
    separation.severanceCheckedByUserId,
    separation.completedByUserId,
  ])
  const byOf = {
    deductions: separation.deductionsCheckedByUserId,
    leave: separation.leaveCheckedByUserId,
    severance: separation.severanceCheckedByUserId,
  } as const
  const frozen = separation.status === 'completed'
  return {
    ...staffSeparationView(separation),
    accountClosedDate:
      separation.deactivatedAt === null ? null : dayKey(new Date(separation.deactivatedAt)),
    completedByName:
      separation.completedByUserId === null
        ? null
        : (names.get(separation.completedByUserId) ?? null),
    notice: staffSeparationNotice(separation),
    steps: steps.map((item) => {
      const by =
        item.step === 'deductions' || item.step === 'leave' || item.step === 'severance'
          ? byOf[item.step]
          : null
      return { ...item, checkedByName: by === null ? null : (names.get(by) ?? null) }
    }),
    missingSteps: missingSeparationSteps(steps),
    assets: sources.assets.map(assetView),
    deductions: {
      openAdvanceCount: sources.openAdvanceCount,
      openAdvanceCents: sources.facts.openAdvanceCents,
      activeGarnishmentCount: sources.facts.activeGarnishmentCount,
      currency: 'TRY' as const,
    },
    leave: {
      hasProfile: sources.hasLeaveProfile,
      unusedDays: frozen ? separation.unusedLeaveDays : sources.unusedLeaveDays,
      frozen,
    },
    serviceCertificate:
      sources.certificate === null
        ? null
        : {
            id: sources.certificate.id,
            label: staffCertificateLabel(sources.certificate),
            createdAt: sources.certificate.createdAt,
          },
    payrollMonth: sources.payrollMonth,
    payrollMonthLocked: sources.payrollMonthLocked,
  }
}

async function separationOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findStaffSeparation(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

/** İcra sayısı dönen yanıt denetime yazılır (alan adı; K-315). */
async function auditGarnishmentRead(
  db: Database,
  ctx: ServiceContext,
  body: { id: string; deductions: { activeGarnishmentCount: number } },
) {
  if (body.deductions.activeGarnishmentCount > 0)
    await auditWork(
      db,
      ctx,
      'finance.staff_separation.garnishment_read',
      { type: ENTITY, id: body.id },
      ['activeGarnishmentCount'],
    )
}

/** Ayrıntı okuması; icra sayısı dönerse okuma aynı transaction'da denetime düşer. */
export function getStaffSeparationFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const body = await detailBody(tx, ctx, await separationOf(tx, ctx, id))
    await auditGarnishmentRead(tx, ctx, body)
    return body
  })
}

async function commandBody(tx: Database, ctx: ServiceContext, id: string) {
  const body = await detailBody(tx, ctx, await separationOf(tx, ctx, id))
  await auditGarnishmentRead(tx, ctx, body)
  return { data: body }
}

async function institutionNameOf(db: Database, institutionId: string): Promise<string> {
  const [row] = await db
    .select({ name: institutions.name })
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1)
  if (row === undefined) throw new NotFoundError()
  return row.name
}

/**
 * İlişik kesme belgesinin verisi (K-403): kurum adı, personel, günler, neden, SGK kodu, adımların
 * durumu, zimmet dökümü (demirbaş adı, iade günü ve durumu), izin günü (tamamlanmışta dondurulan)
 * ve hizmet belgesi numarası. Avans ve icra tutarı belgeye girmez (yalnız adımın durumu).
 */
export async function staffSeparationDocumentFor(ctx: ServiceContext, id: string) {
  const separation = await separationOf(ctx.db, ctx, id)
  const sources: Sources = await loadSources(ctx.db, ctx, separation)
  const steps = staffSeparationSteps(separation, sources.facts)
  const names = await separationUserNames(ctx.db, [separation.completedByUserId])
  return {
    ...staffSeparationView(separation),
    institutionName: await institutionNameOf(ctx.db, ctx.institutionId),
    completedByName:
      separation.completedByUserId === null
        ? null
        : (names.get(separation.completedByUserId) ?? null),
    steps: steps.map(({ step, required, done }) => ({ step, required, done })),
    assets: sources.assets.map(assetView),
    unusedLeaveDays:
      separation.status === 'completed' ? separation.unusedLeaveDays : sources.unusedLeaveDays,
    serviceCertificateLabel:
      sources.certificate === null ? null : staffCertificateLabel(sources.certificate),
    generatedAt: ctx.now.toISOString(),
  }
}

// --- Yazma ---------------------------------------------------------------------------------------

/** Dosya aç (K-403): personel başka kurumdaysa 422, açık dosya varken 409. 201. */
export function createStaffSeparationCommand(
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
      action: 'finance.staff_separation.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffSeparationInputSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const hasOpen =
          staff === null
            ? false
            : await hasOpenSeparation(tx, ctx.institutionId, parsed.membershipId)
        return {
          run: () => planStaffSeparation(parsed, { staff, hasOpen, today: dayKey(ctx.now) }),
        }
      },
      after: async (tx, plan) => {
        await insertStaffSeparation(tx, ctx.institutionId, {
          ...plan,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.staff_separation.create',
          entity,
          presentKeys({ ...plan }),
        )
        body = await commandBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Sürümü denetlenmiş dosya; başka kurumun ya da olmayan dosya 404, sürüm tutmazsa 409. */
async function versionedSeparation(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const current = await separationOf(tx, ctx, id)
  if (current.version !== expectedVersion) throw new ConflictError()
  return current
}

/** Ayrıntıyı düzelt (K-403): yalnız açık dosya; değişen alan adları denetime yazılır. */
export function updateStaffSeparationCommand(
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
      action: 'finance.staff_separation.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffSeparationUpdateSchema.parse(input)
        const current = await versionedSeparation(tx, ctx, id, expectedVersion)
        return { run: () => planStaffSeparationUpdate(current, parsed, dayKey(ctx.now)) }
      },
      after: async (tx, { next, changed }) => {
        const saved = await updateStaffSeparationDetails(tx, ctx.institutionId, {
          id,
          expectedVersion,
          details: next,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_separation.update', entity, changed)
        body = await commandBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Elle adımı işaretle ya da kaldır (K-404). Durum aynıysa yazılmaz (200, denetim yok, sürüm
 * değişmez).
 */
export function markStaffSeparationStepCommand(
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
      action: 'finance.staff_separation.mark_step',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await versionedSeparation(tx, ctx, id, expectedVersion)
        return { run: () => planStaffSeparationStep(current, input) }
      },
      after: async (tx, plan) => {
        if (plan.changed) {
          const saved = await markStaffSeparationStep(tx, ctx.institutionId, {
            id,
            expectedVersion,
            step: plan.step,
            done: plan.done,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
          if (!saved) throw new ConflictError()
          await auditWork(tx, ctx, 'finance.staff_separation.mark_step', entity, [
            markFieldOf(plan.step),
          ])
        }
        body = await commandBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Tamamla, ilişiği kes (K-403): adımlar kurum kilidi altında kaynaklardan yeniden hesaplanır;
 * kullanılmayan izin günü dondurulur.
 */
export function completeStaffSeparationCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_separation.complete',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await versionedSeparation(tx, ctx, id, expectedVersion)
        const sources = await loadSources(tx, ctx, current)
        const steps = staffSeparationSteps(current, sources.facts)
        return {
          run: () => {
            planStaffSeparationComplete(current, steps, dayKey(ctx.now))
            return { unusedLeaveDays: sources.unusedLeaveDays }
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await completeStaffSeparation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          unusedLeaveDays: plan.unusedLeaveDays,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_separation.complete', entity, [
          'status',
          'completedAt',
          ...(plan.unusedLeaveDays === null ? [] : ['unusedLeaveDays']),
        ])
        body = await commandBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** İptal (K-403): yalnız açık dosya, gerekçeyle; gerekçe denetime yazılmaz. */
export function cancelStaffSeparationCommand(
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
      action: 'finance.staff_separation.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await versionedSeparation(tx, ctx, id, expectedVersion)
        return { run: () => planStaffSeparationCancel(current, input) }
      },
      after: async (tx, parsed) => {
        const saved = await cancelStaffSeparation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_separation.cancel', entity, [
          'status',
          'cancelReason',
        ])
        body = await commandBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
