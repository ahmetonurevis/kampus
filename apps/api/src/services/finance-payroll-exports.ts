import { createHash, randomUUID } from 'node:crypto'

import {
  payrollExportCsv,
  payrollExportLines,
  payrollLessonHoursInputSchema,
  payrollLessonHoursUpdateSchema,
  payrollMonthRange,
  planPayrollLessonHours,
  planPayrollLessonHoursUpdate,
  setPayrollExportProfileSchema,
  type PayrollExport,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'
import {
  assertLessonHoursWritable,
  isLessonSheetApproved,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import {
  assertPayrollDaysUnlocked,
  monthEnd,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import {
  addMonths,
  STAFF_ADVANCE_MAX_INSTALLMENTS,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findLessonSheet } from '../db/finance-lesson-hour-approvals.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import {
  archiveLessonHours,
  findLessonHours,
  insertLessonHours,
  insertPayrollExport,
  lessonHoursExist,
  listPayrollExports,
  loadMonthLessonHours,
  loadMonthPayRates,
  loadPayrollExportProfile,
  loadPayrollStaff,
  savePayrollExportProfile,
  updateLessonHours,
  type StoredLessonHours,
  type StoredPayrollExportProfile,
} from '../db/finance-payroll-exports.ts'
import { loadAdjustmentsTargeting, lockedPayrollMonths } from '../db/finance-payroll-periods.ts'
import { loadMonthDeductionRows } from '../db/finance-staff-deductions.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Bordro programına aktarım (DOM-FIN-105; ON-202, ON-343). Bordroyu dış programda hesaplatan kurum için
 * (ADR 0011 karar 9; Kampüs'ün hesabı DOM-FIN-115) ayın girdi satırları ücret tanımlarından, elle girilen ek ders saatinden, ayın avans, icra ve
 * BES kayıtlarından (DOM-FIN-101, K-392) ve aya aktarılan bordro düzeltmelerinden (DOM-FIN-108,
 * K-393) core'da üretilir. Ek ders satırı ayın çizelgesi müdür onaylı değilse "onay bekliyor"
 * uyarısıyla tutarsızdır (DOM-FIN-120, K-411); saat yazmaları müdür onaylı ayda 409
 * `lesson_hours_locked`, bordro dönemi kilitli ayda 409 `payroll_period_locked` olur (K-410). Ücret kişisel veridir (K-306): tutar içeren önizleme okumayla aynı
 * transaction'da denetime düşer (`finance.payroll_export.read`, K-338); icra satırı dönerse
 * denetime icra alanlarının adı da yazılır (K-315). Dosya üretimi özet satırı (`payroll_exports`)
 * ve denetim kaydıyla tek transaction'dadır. Denetime alan adları yazılır; tutar, saat, not ve
 * icra bilgisi yazılmaz. Rol ve modül denetimi rotadadır (yalnız yönetici).
 */

const HOURS_ENTITY = 'payroll_lesson_hours'
const EXPORT_ENTITY = 'payroll_exports'

const monthStartOf = (month: string) => `${month}-01`

/**
 * Ayın satırları: ayla kesişen tanımlar, ek ders saatleri, ayın kesinti kayıtları, aya aktarılan
 * düzeltmeler ve bunların personeli.
 */
async function monthExport(tx: Database, institutionId: string, month: string) {
  const range = payrollMonthRange(month)
  const rates = await loadMonthPayRates(tx, institutionId, range)
  const lessonHours = await loadMonthLessonHours(tx, institutionId, range.from)
  const deductions = await loadMonthDeductionRows(tx, institutionId, {
    month,
    earliestFirstMonth: addMonths(month, 1 - STAFF_ADVANCE_MAX_INSTALLMENTS),
    monthEnd: monthEnd(month),
  })
  const adjustments = await loadAdjustmentsTargeting(tx, institutionId, month, month)
  const sheet = await findLessonSheet(tx, institutionId, month)
  const staff = await loadPayrollStaff(tx, institutionId, [
    ...rates.map((rate) => rate.membershipId),
    ...lessonHours.map((entry) => entry.membershipId),
    ...deductions.advances.map((item) => item.membershipId),
    ...deductions.garnishments.map((item) => item.membershipId),
    ...deductions.pensions.map((item) => item.membershipId),
    ...adjustments.map((item) => item.membershipId),
  ])
  return payrollExportLines({
    month,
    staff,
    rates,
    lessonHours,
    deductions,
    adjustments,
    lessonHoursApproved: isLessonSheetApproved(sheet),
  })
}

/** Önizleme denetimine yazılan alan adları; icra satırı dönerse icra alanları da (K-315). */
function previewAuditFields(result: PayrollExport): string[] {
  const fields = ['rateCents', 'totalCents', 'quantity']
  if (result.lines.some((line) => line.deductionKind === 'garnishment'))
    fields.push('garnishment.rateBasisPoints', 'garnishment.capCents')
  if (result.lines.some((line) => line.kind === 'adjustment')) fields.push('adjustment.totalCents')
  return fields
}

/** Önizleme (DOM-FIN-105): satırlar ve toplamlar; tutar içerdiği için her okuma denetime düşer. */
export function payrollExportPreviewFor(
  ctx: ServiceContext,
  month: string,
): Promise<PayrollExport> {
  return ctx.db.transaction(async (tx) => {
    const result = await monthExport(tx, ctx.institutionId, month)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: 'finance.payroll_export.read',
      entityType: EXPORT_ENTITY,
      entityId: month,
      // kvkk: tutar değil, dönen alanların adı (K-307, K-315, K-338).
      changes: { fields: previewAuditFields(result) },
      createdAt: ctx.now,
    })
    return result
  })
}

/**
 * Dosya (K-338): satırlar profil ya da genel biçimle CSV olur; özet satırı (ay, biçim, sayılar,
 * toplamlar, SHA-256) ve denetim kaydı aynı transaction'da yazılır. Dosya saklanmaz; aynı ay
 * yeniden üretilebilir (dönem kilidi yok).
 */
export async function payrollExportFileFor(
  ctx: ServiceContext,
  month: string,
): Promise<{ body: string; fileName: string; exportId: string }> {
  const id = randomUUID()
  const entity = { type: EXPORT_ENTITY, id }
  let body = ''
  await runCommand(
    ctx,
    {
      action: 'finance.payroll_export.create',
      collections: [],
      entity,
      load: async (tx) => {
        const result = await monthExport(tx, ctx.institutionId, month)
        const { profile } = await loadPayrollExportProfile(tx, ctx.institutionId)
        return { run: () => ({ result, profile }) }
      },
      after: async (tx, { result, profile }) => {
        body = `\uFEFF${payrollExportCsv(result.lines, profile)}`
        await insertPayrollExport(tx, ctx.institutionId, {
          id,
          monthStart: result.from,
          format: profile === null ? 'standard' : 'profile',
          lineCount: result.totals.lineCount,
          staffCount: result.totals.staffCount,
          earningCents: result.totals.earningCents,
          deductionCents: result.totals.deductionCents,
          missingTotalCount: result.totals.missingTotalCount,
          contentSha256: createHash('sha256').update(body, 'utf8').digest('hex'),
          createdByUserId: ctx.actor.userId,
          createdAt: ctx.now,
        })
        const garnishment = result.lines.some((line) => line.deductionKind === 'garnishment')
        await auditWork(tx, ctx, 'finance.payroll_export.create', entity, [
          `month:${month}`,
          ...(garnishment ? ['garnishment.rateBasisPoints', 'garnishment.capCents'] : []),
        ])
      },
    },
    () => ({ statusCode: 200, body: null }),
    null,
  )
  return { body, fileName: `bordro-girdi-${month}.csv`, exportId: id }
}

export async function payrollExportHistoryFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; month?: string | undefined },
) {
  const { items, total } = await listPayrollExports(ctx.db, ctx.institutionId, {
    page: query.page,
    pageSize: query.pageSize,
    monthStart: query.month === undefined ? undefined : monthStartOf(query.month),
  })
  return {
    items: items.map((item) => ({
      id: item.id,
      month: item.monthStart.slice(0, 7),
      format: item.format,
      lineCount: item.lineCount,
      staffCount: item.staffCount,
      earningCents: item.earningCents,
      deductionCents: item.deductionCents,
      missingTotalCount: item.missingTotalCount,
      contentSha256: item.contentSha256,
      createdByName: item.createdByName,
      createdAt: item.createdAt.toISOString(),
    })),
    total,
  }
}

// --- Ek ders saati -------------------------------------------------------------------------------

/** Ayın kilit kaynakları (K-410): çizelge durumu ve bordro dönemi kilitli aylar. */
async function hoursLocks(tx: Database, institutionId: string, month: string) {
  const sheet = await findLessonSheet(tx, institutionId, month)
  const locked = await lockedPayrollMonths(tx, institutionId)
  return () => {
    assertLessonHoursWritable(sheet)
    assertPayrollDaysUnlocked(locked, [{ from: monthStartOf(month), to: monthEnd(month) }], 'month')
  }
}

function hoursView(entry: StoredLessonHours) {
  return {
    id: entry.id,
    membershipId: entry.membershipId,
    month: entry.monthStart.slice(0, 7),
    lessonType: entry.lessonType,
    hours: entry.hours,
    note: entry.note,
    version: entry.version,
  }
}

async function hoursBody(tx: Database, ctx: ServiceContext, id: string) {
  const entry = await findLessonHours(tx, ctx.institutionId, id)
  if (entry === null) throw new NotFoundError()
  return hoursView(entry)
}

/** Yeni ek ders saati kaydı (K-337). 201. */
export function createLessonHoursCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: HOURS_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_lesson_hours.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payrollLessonHoursInputSchema.parse(input)
        const monthStart = monthStartOf(parsed.month)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const exists = await lessonHoursExist(tx, ctx.institutionId, {
          membershipId: parsed.membershipId,
          monthStart,
          lessonType: parsed.lessonType,
        })
        const assertUnlocked = await hoursLocks(tx, ctx.institutionId, parsed.month)
        return {
          run: () => {
            planPayrollLessonHours(parsed, { staff, exists, today: dayKey(ctx.now) })
            assertUnlocked()
            return { parsed, monthStart }
          },
        }
      },
      after: async (tx, { parsed, monthStart }) => {
        await insertLessonHours(tx, ctx.institutionId, {
          id,
          membershipId: parsed.membershipId,
          monthStart,
          lessonType: parsed.lessonType,
          hours: parsed.hours,
          note: parsed.note,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.payroll_lesson_hours.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        body = { data: await hoursBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzeltilecek ya da silinecek kayıt ve ayının kilit denetimi (K-410). */
async function currentHours(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const entry = await findLessonHours(tx, ctx.institutionId, id)
  if (entry === null) throw new NotFoundError()
  if (entry.version !== version) throw new ConflictError()
  const assertUnlocked = await hoursLocks(tx, ctx.institutionId, entry.monthStart.slice(0, 7))
  return { entry, assertUnlocked }
}

/** Saat ya da not düzeltmesi (`If-Match`). */
export function updateLessonHoursCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: HOURS_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_lesson_hours.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payrollLessonHoursUpdateSchema.parse(input)
        const { entry, assertUnlocked } = await currentHours(tx, ctx, id, expectedVersion)
        return {
          run: () => {
            const next = planPayrollLessonHoursUpdate(entry, parsed)
            assertUnlocked()
            return { parsed, next }
          },
        }
      },
      after: async (tx, { parsed, next }) => {
        const saved = await updateLessonHours(tx, ctx.institutionId, {
          id,
          expectedVersion,
          ...next,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.payroll_lesson_hours.update', entity, Object.keys(parsed))
        body = { data: await hoursBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Silme = arşiv (`If-Match`). */
export function archiveLessonHoursCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: HOURS_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_lesson_hours.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const { assertUnlocked } = await currentHours(tx, ctx, id, expectedVersion)
        return { run: assertUnlocked }
      },
      after: async (tx) => {
        const saved = await archiveLessonHours(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.payroll_lesson_hours.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Şablon --------------------------------------------------------------------------------------

export function payrollExportProfileFor(ctx: ServiceContext): Promise<StoredPayrollExportProfile> {
  return loadPayrollExportProfile(ctx.db, ctx.institutionId)
}

/** Şablonu yazar (K-339); `profile: null` genel dosyaya döner. Denetime yalnız alan adı. */
export function setPayrollExportProfileCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: 'payroll_export_profiles', id: ctx.institutionId }
  let result: StoredPayrollExportProfile | undefined
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_export_profile',
      collections: [],
      entity,
      load: async (tx) => {
        const { profile } = setPayrollExportProfileSchema.parse(input)
        const row = await loadPayrollExportProfile(tx, ctx.institutionId)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => profile }
      },
      after: async (tx, profile) => {
        const saved = await savePayrollExportProfile(tx, ctx.institutionId, {
          profile,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.payroll_export_profile', entity, ['profile'])
        result = saved
      },
    },
    () => {
      if (result === undefined) throw new Error('payroll export profile was not written')
      return { statusCode: 200, body: { data: result } }
    },
    idempotency,
  )
}
