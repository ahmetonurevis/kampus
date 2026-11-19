import { createHash, randomUUID } from 'node:crypto'

import {
  lessonConfirmationInputSchema,
  lessonEntriesFingerprint,
  lessonSheetApproveSchema,
  lessonSheetReopenSchema,
  lessonSheetStatus,
  lessonSheetSubmitSchema,
  lessonTeacherStates,
  planLessonConfirmation,
  planLessonSheetApproval,
  planLessonSheetReopen,
  planLessonSheetSubmit,
  staffFingerprints,
  type LessonTeacherState,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import {
  assertPayrollDaysUnlocked,
  isPayrollMonthLocked,
  monthEnd,
  monthStart,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'

import type { Database } from '../db/client.ts'
import {
  findLessonSheet,
  insertLessonConfirmation,
  insertLessonSheet,
  listLessonConfirmations,
  updateLessonSheet,
  type StoredLessonConfirmation,
  type StoredLessonSheet,
} from '../db/finance-lesson-hour-approvals.ts'
import {
  loadMonthLessonHours,
  loadPayrollStaff,
  type StoredLessonHours,
} from '../db/finance-payroll-exports.ts'
import { lockedPayrollMonths, userNames } from '../db/finance-payroll-periods.ts'
import { ConflictError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Ek ders çizelgesi onayı (DOM-FIN-120; ON-196, K-409…K-411). Kural core
 * `lib/finance-lesson-hour-approvals.ts`'tedir; servis kurum kilidi altında ayın çizelgesini, saat
 * kayıtlarını ve yanıtları yükler, geçişi tek transaction'da yazar. Teyit, personelin saat
 * kayıtlarının SHA-256 özetine bağlanır; kayıt değişince teyit kendiliğinden geçersizleşir.
 * Bordro dönemi kilitliyse (DOM-FIN-108) müdür onayı ve yeniden açma 409
 * `payroll_period_locked`. Denetim kaydına alan adları yazılır; saat, gerekçe ve kanal yazılmaz.
 * Rol ve modül denetimi rotadadır.
 */

const SHEET = 'lesson_hour_approvals'
const CONFIRMATION = 'lesson_hour_confirmations'

const sha256 = (source: string) => createHash('sha256').update(source).digest('hex')

/** Ayın bütün saat kayıtlarının damgası (müdür onayında gönderilir). */
export const lessonEntriesHash = (entries: readonly StoredLessonHours[]) =>
  sha256(lessonEntriesFingerprint(entries))

/** Personel başına saat kayıtlarının damgası (teyidin bağlandığı özet). */
function staffHashes(entries: readonly StoredLessonHours[]): Map<string, string> {
  return new Map(
    [...staffFingerprints(entries)].map(([membershipId, source]) => [membershipId, sha256(source)]),
  )
}

function teacherStates(
  entries: readonly StoredLessonHours[],
  confirmations: readonly StoredLessonConfirmation[],
) {
  return lessonTeacherStates(staffHashes(entries), confirmations)
}

const monthRange = (month: string) => ({ from: monthStart(month), to: monthEnd(month) })

interface SheetSources {
  sheet: StoredLessonSheet | null
  entries: StoredLessonHours[]
  confirmations: StoredLessonConfirmation[]
  locked: string[]
}

async function loadSources(db: Database, institutionId: string, month: string) {
  const sheet = await findLessonSheet(db, institutionId, month)
  const entries = await loadMonthLessonHours(db, institutionId, monthStart(month))
  const confirmations =
    sheet === null ? [] : await listLessonConfirmations(db, institutionId, sheet.id)
  const locked = await lockedPayrollMonths(db, institutionId)
  return { sheet, entries, confirmations, locked } satisfies SheetSources
}

/**
 * Çizelge görünümü: durum, son gönderme/onay/yeniden açma, saat kayıtları (tutarsız) ve
 * personel başına teyit durumu ile son yanıt.
 */
async function sheetView(db: Database, institutionId: string, month: string, src: SheetSources) {
  const { sheet, entries, confirmations, locked } = src
  const staff = await loadPayrollStaff(
    db,
    institutionId,
    entries.map((entry) => entry.membershipId),
  )
  const people = new Map(staff.map((person) => [person.membershipId, person]))
  const names = await userNames(db, [
    ...(sheet === null ? [] : [sheet.submittedByUserId]),
    ...(sheet?.approvedByUserId == null ? [] : [sheet.approvedByUserId]),
    ...(sheet?.reopenedByUserId == null ? [] : [sheet.reopenedByUserId]),
    ...confirmations.map((item) => item.recordedByUserId),
  ])
  const nameOf = (userId: string | null | undefined) =>
    userId == null ? null : (names.get(userId) ?? null)
  const personOf = (membershipId: string) => {
    const person = people.get(membershipId)
    return {
      staffName: person?.name ?? '',
      role: person?.role ?? '',
      staffActive: person?.active ?? false,
    }
  }
  const states = teacherStates(entries, confirmations)
  const staffRows = [...states].map(([membershipId, { state, last }]) => {
    const own = entries.filter((entry) => entry.membershipId === membershipId)
    return {
      membershipId,
      ...personOf(membershipId),
      state: state satisfies LessonTeacherState,
      totalHours: own.reduce((sum, entry) => sum + entry.hours, 0),
      entryCount: own.length,
      lastResponse:
        last === null
          ? null
          : {
              outcome: last.outcome,
              channel: last.channel,
              reason: last.reason,
              recordedAt: last.createdAt.toISOString(),
              recordedByName: nameOf(last.recordedByUserId),
              current: state !== 'pending',
            },
    }
  })
  staffRows.sort(
    (a, b) =>
      a.staffName.localeCompare(b.staffName, 'tr') || a.membershipId.localeCompare(b.membershipId),
  )
  return {
    month,
    status: lessonSheetStatus(sheet),
    version: sheet?.version ?? null,
    payrollLocked: isPayrollMonthLocked(locked, month),
    entriesHash: lessonEntriesHash(entries),
    submittedAt: sheet?.submittedAt.toISOString() ?? null,
    submittedByName: nameOf(sheet?.submittedByUserId),
    approvedAt: sheet?.approvedAt?.toISOString() ?? null,
    approvedByName: nameOf(sheet?.approvedByUserId),
    approvalCount: sheet?.approvalCount ?? 0,
    reopenedAt: sheet?.reopenedAt?.toISOString() ?? null,
    reopenedByName: nameOf(sheet?.reopenedByUserId),
    reopenReason: sheet?.reopenReason ?? null,
    entries: entries.map((entry) => ({
      id: entry.id,
      membershipId: entry.membershipId,
      ...personOf(entry.membershipId),
      lessonType: entry.lessonType,
      hours: entry.hours,
      note: entry.note,
      version: entry.version,
    })),
    staff: staffRows,
  }
}

/** Ayın çizelgesi (okuma denetime düşmez: tutar yok, K-409). */
export async function lessonSheetFor(ctx: ServiceContext, month: string) {
  const sources = await loadSources(ctx.db, ctx.institutionId, month)
  return sheetView(ctx.db, ctx.institutionId, month, sources)
}

async function sheetBody(tx: Database, ctx: ServiceContext, month: string) {
  const sources = await loadSources(tx, ctx.institutionId, month)
  return { data: await sheetView(tx, ctx.institutionId, month, sources) }
}

function requireSheet(sheet: StoredLessonSheet | null): StoredLessonSheet {
  if (sheet === null) throw new Error('lesson sheet guard did not run')
  return sheet
}

/** Taslak → öğretmen kontrolü (K-409). İlk gönderim çizelge satırını açar. */
export function submitLessonSheetCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let id: string = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_hour_sheet.submit',
      collections: [],
      entity: () => ({ type: SHEET, id }),
      load: async (tx) => {
        lessonSheetSubmitSchema.parse(input)
        const sheet = await findLessonSheet(tx, ctx.institutionId, month)
        const entries = await loadMonthLessonHours(tx, ctx.institutionId, monthStart(month))
        return {
          run: () => {
            planLessonSheetSubmit(sheet, entries.length)
            return sheet
          },
        }
      },
      after: async (tx, sheet) => {
        if (sheet === null)
          await insertLessonSheet(tx, ctx.institutionId, {
            id,
            month,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
        else {
          id = sheet.id
          const saved = await updateLessonSheet(tx, ctx.institutionId, {
            id,
            expectedVersion: sheet.version,
            now: ctx.now,
            set: {
              status: 'teacher_review',
              submittedAt: ctx.now,
              submittedByUserId: ctx.actor.userId,
            },
          })
          if (!saved) throw new ConflictError()
        }
        await auditWork(tx, ctx, 'finance.lesson_hour_sheet.submit', { type: SHEET, id }, [
          'status',
          'submittedAt',
        ])
        body = await sheetBody(tx, ctx, month)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Öğretmen yanıtı (K-409): teyit ya da itiraz, öğretmen adına kanalıyla. Yanıt personelin o anki
 * saat kayıtlarının damgasını taşır; itiraz çizelgeyi taslağa döndürür.
 */
export function recordLessonConfirmationCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const confirmationId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_hour_sheet.confirmation',
      collections: [],
      entity: { type: CONFIRMATION, id: confirmationId },
      load: async (tx) => {
        const parsed = lessonConfirmationInputSchema.parse(input)
        const sheet = await findLessonSheet(tx, ctx.institutionId, month)
        const entries = await loadMonthLessonHours(tx, ctx.institutionId, monthStart(month))
        const hash = staffHashes(entries).get(parsed.membershipId)
        return {
          run: () => {
            const plan = planLessonConfirmation(sheet, parsed, hash !== undefined)
            return { parsed, plan, sheet: requireSheet(sheet), hash: hash ?? '' }
          },
        }
      },
      after: async (tx, { parsed, plan, sheet, hash }) => {
        await insertLessonConfirmation(tx, ctx.institutionId, {
          id: confirmationId,
          approvalId: sheet.id,
          membershipId: parsed.membershipId,
          outcome: parsed.outcome,
          channel: parsed.channel,
          reason: parsed.reason,
          entriesHash: hash,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (plan.nextStatus !== sheet.status) {
          const saved = await updateLessonSheet(tx, ctx.institutionId, {
            id: sheet.id,
            expectedVersion: sheet.version,
            now: ctx.now,
            set: { status: plan.nextStatus },
          })
          if (!saved) throw new ConflictError()
        }
        await auditWork(
          tx,
          ctx,
          'finance.lesson_hour_sheet.confirmation',
          { type: CONFIRMATION, id: confirmationId },
          [
            'membershipId',
            'outcome',
            'channel',
            ...(parsed.reason === null ? [] : ['reason']),
            ...(plan.nextStatus === sheet.status ? [] : ['status']),
          ],
        )
        body = await sheetBody(tx, ctx, month)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Müdür onayı (K-409, K-410): her personel güncel saatlerini teyit etmiş, onaylayanın gördüğü
 * damga güncel olmalı; bordro dönemi kilitliyse 409. Ay kilitlenir.
 */
export function approveLessonSheetCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let id = month
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_hour_sheet.approve',
      collections: [],
      entity: () => ({ type: SHEET, id }),
      load: async (tx) => {
        const parsed = lessonSheetApproveSchema.parse(input)
        const { sheet, entries, confirmations, locked } = await loadSources(
          tx,
          ctx.institutionId,
          month,
        )
        return {
          run: () => {
            planLessonSheetApproval(sheet, teacherStates(entries, confirmations), {
              expected: parsed.entriesHash,
              current: lessonEntriesHash(entries),
            })
            assertPayrollDaysUnlocked(locked, [monthRange(month)], 'month')
            return requireSheet(sheet)
          },
        }
      },
      after: async (tx, sheet) => {
        id = sheet.id
        const saved = await updateLessonSheet(tx, ctx.institutionId, {
          id,
          expectedVersion: sheet.version,
          now: ctx.now,
          set: {
            status: 'approved',
            approvedAt: ctx.now,
            approvedByUserId: ctx.actor.userId,
            approvalCount: sheet.approvalCount + 1,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lesson_hour_sheet.approve', { type: SHEET, id }, [
          'status',
          'approvedAt',
          'entriesHash',
        ])
        body = await sheetBody(tx, ctx, month)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yeniden açma (K-410): yalnız müdür onaylı çizelge, gerekçeyle; taslağa döner. */
export function reopenLessonSheetCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let id = month
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_hour_sheet.reopen',
      collections: [],
      entity: () => ({ type: SHEET, id }),
      load: async (tx) => {
        const parsed = lessonSheetReopenSchema.parse(input)
        const sheet = await findLessonSheet(tx, ctx.institutionId, month)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return {
          run: () => {
            planLessonSheetReopen(sheet)
            assertPayrollDaysUnlocked(locked, [monthRange(month)], 'month')
            return { reason: parsed.reason, sheet: requireSheet(sheet) }
          },
        }
      },
      after: async (tx, { reason, sheet }) => {
        id = sheet.id
        const saved = await updateLessonSheet(tx, ctx.institutionId, {
          id,
          expectedVersion: sheet.version,
          now: ctx.now,
          set: {
            status: 'draft',
            reopenedAt: ctx.now,
            reopenedByUserId: ctx.actor.userId,
            reopenReason: reason,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lesson_hour_sheet.reopen', { type: SHEET, id }, [
          'status',
          'reopenedAt',
          'reopenReason',
        ])
        body = await sheetBody(tx, ctx, month)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
