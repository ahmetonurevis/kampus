import { randomUUID } from 'node:crypto'

import {
  assertLessonHoursWritable,
  isLessonSheetApproved,
  lessonSheetStatus,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import {
  lessonHourSuggestion,
  lessonSuggestionRange,
  lessonSuggestionTransferSchema,
  planLessonSuggestionTransfer,
  suggestionPayBasis,
  type LessonSuggestion,
  type LessonSuggestionParams,
  type SuggestionTeacher,
  type TeacherSuggestion,
} from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'
import {
  planPayrollLessonHours,
  type PayrollStaff,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'
import {
  assertPayrollDaysUnlocked,
  isPayrollMonthLocked,
  monthEnd,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { loadLeaveAbsences } from '../db/finance-leave-calendar.ts'
import { loadTeachers, teacherLinks } from '../db/finance-leave-requests.ts'
import { findLessonSheet } from '../db/finance-lesson-hour-approvals.ts'
import {
  insertLessonHourSuggestion,
  listLessonHourSuggestions,
  loadClassNames,
  loadAttendanceClassDays,
  loadSuggestionLessons,
  type StoredLessonHourSuggestion,
} from '../db/finance-lesson-hour-suggestions.ts'
import { loadStaffPayRates } from '../db/finance-pay-rates.ts'
import {
  insertLessonHours,
  loadMonthLessonHours,
  loadPayrollStaff,
  updateLessonHours,
  type StoredLessonHours,
} from '../db/finance-payroll-exports.ts'
import { lockedPayrollMonths } from '../db/finance-payroll-periods.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { institutionHolidaysFor } from './finance-school-calendar.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Programdan ek ders önerisi (DOM-FIN-165; ON-195; K-550…K-552). Kural core
 * `lib/finance-lesson-hour-suggestions.ts`'tedir. Servis ayı kapsayan haftaların ders programını
 * (`schedule`), okul takvimi tatillerini (K-545), personelin izin ve rapor aralıklarını ve sınıf
 * günlerinin yoklamasını (yalnız `academic` modülü açıkken) okur; öneri saklanmaz. Aktarım ayın
 * elle girilen ek ders saatini (`payroll_lesson_hours`, `extra`) açar ya da düzeltir ve değişmez
 * aktarım satırını aynı transaction'da yazar; müdür onaylı ya da bordro dönemi kilitli ayda 409
 * (K-410). Yalnız okul türündeki kurumda vardır (dil okulunun saat ücreti IST-087; 404). Rol ve
 * modül denetimi rotadadır (yalnız yönetici).
 */

const ENTITY = 'payroll_lesson_hours'
const monthStartOf = (month: string) => `${month}-01`

/** Dil okulunda uç yoktur (404). */
async function requireSchool(db: Database, institutionId: string) {
  const institution = await getInstitutionModules(db, institutionId)
  if (institution === null || institution.type !== 'school') throw new NotFoundError()
  return institution
}

interface Sources {
  suggestion: LessonSuggestion
  staff: Map<string, PayrollStaff>
  teacherNames: Map<string, string>
  entries: StoredLessonHours[]
}

/**
 * Ders durumlarının girdileri (DOM-FIN-165 ve saat ücreti dökümü DOM-FIN-167 ortak kullanır):
 * aralığın ders programı, kullanılmış izin ve rapor aralıkları, kurum tatilleri, sınıf günü
 * yoklaması (yalnız `academic` açıkken) ve üyelik başına bağlı öğretmen kayıtları.
 */
export async function loadLessonInputs(
  db: Database,
  institutionId: string,
  range: { from: string; to: string },
  academic: boolean,
) {
  const match = dayRange('date', range.from, range.to)
  if (match === null) throw new Error('lesson range is empty')
  const links = await teacherLinks(db, institutionId)
  const teacherIds = new Map<string, string[]>()
  for (const link of links)
    teacherIds.set(link.membershipId, [
      ...(teacherIds.get(link.membershipId) ?? []),
      link.teacherId,
    ])
  const [lessons, absences, attendanceDays, holidays] = await Promise.all([
    loadSuggestionLessons(db, institutionId, match),
    loadLeaveAbsences(db, institutionId, { startDate: range.from, endDate: range.to }),
    academic ? loadAttendanceClassDays(db, institutionId, match) : Promise.resolve(null),
    institutionHolidaysFor(db, institutionId, range),
  ])
  return {
    teacherIds,
    lessons,
    // Talep (bekleyen ya da onaylı) değil, kullanılmış izin ve rapor: ders fiilen yapılmadı.
    absences: absences.filter((item) => item.source !== 'request'),
    attendanceDays,
    holidays,
  }
}

/** Hesabın girdileri ve sonucu (okuma ve aktarım aynı kaynağı kullanır). */
async function compute(
  db: Database,
  ctx: ServiceContext,
  month: string,
  params: LessonSuggestionParams,
): Promise<Sources> {
  const institution = await requireSchool(db, ctx.institutionId)
  const range = lessonSuggestionRange(month)
  const { teacherIds, lessons, absences, attendanceDays, holidays } = await loadLessonInputs(
    db,
    ctx.institutionId,
    range,
    institution.modules.academic === true,
  )
  const membershipIds = [...teacherIds.keys()]
  const [staff, rates, records, entries] = await Promise.all([
    loadPayrollStaff(db, ctx.institutionId, membershipIds),
    loadStaffPayRates(db, ctx.institutionId, membershipIds),
    loadTeachers(db, ctx.institutionId),
    loadMonthLessonHours(db, ctx.institutionId, monthStartOf(month)),
  ])
  const people = new Map(staff.map((person) => [person.membershipId, person]))
  const teachers: SuggestionTeacher[] = membershipIds
    .filter((membershipId) => people.has(membershipId))
    .map((membershipId) => ({
      membershipId,
      teacherIds: teacherIds.get(membershipId) ?? [],
      payBasis: suggestionPayBasis(
        rates.filter((rate) => rate.membershipId === membershipId),
        month,
      ),
    }))
  const suggestion = lessonHourSuggestion({
    month,
    params,
    now: ctx.now.toISOString(),
    lessons,
    teachers,
    holidays,
    absences,
    attendanceDays,
  })
  return {
    suggestion,
    staff: people,
    teacherNames: new Map(records.map((record) => [record.id, record.name])),
    entries,
  }
}

const extraEntries = (entries: readonly StoredLessonHours[]) =>
  new Map(
    entries
      .filter((entry) => entry.lessonType === 'extra')
      .map((entry) => [entry.membershipId, entry]),
  )

function transferView(item: StoredLessonHourSuggestion) {
  return {
    id: item.id,
    suggestedHours: item.suggestedHours,
    previousHours: item.previousHours,
    hours: item.hours,
    reason: item.reason,
    weeklyLoad: item.weeklyLoad,
    weeklyCap: item.weeklyCap,
    createdByName: item.createdByName,
    createdAt: item.createdAt.toISOString(),
  }
}

function teacherSummary(
  item: TeacherSuggestion,
  sources: Sources,
  transfers: readonly StoredLessonHourSuggestion[],
) {
  const person = sources.staff.get(item.membershipId)
  const entry = extraEntries(sources.entries).get(item.membershipId) ?? null
  const last = transfers.find((transfer) => transfer.membershipId === item.membershipId)
  return {
    membershipId: item.membershipId,
    staffName: person?.name ?? '',
    role: person?.role ?? '',
    staffActive: person?.active ?? false,
    payBasis: item.payBasis,
    applicable: item.applicable,
    suggestedHours: item.suggestedHours,
    currentHours: entry?.hours ?? null,
    currentEntryId: entry?.id ?? null,
    difference: item.suggestedHours === null ? null : (entry?.hours ?? 0) - item.suggestedHours,
    totals: item.totals,
    weeks: item.weeks,
    warnings: item.warnings,
    lastTransfer: last === undefined ? null : transferView(last),
  }
}

async function monthState(db: Database, institutionId: string, month: string) {
  const sheet = await findLessonSheet(db, institutionId, month)
  const locked = await lockedPayrollMonths(db, institutionId)
  return { sheet, locked }
}

/** Ayın önerisi: öğretmen başına özet, haftalar, elle girişle fark ve son aktarım. */
export async function lessonHourSuggestionsFor(
  ctx: ServiceContext,
  month: string,
  params: LessonSuggestionParams,
  db: Database = ctx.db,
) {
  const sources = await compute(db, ctx, month, params)
  const transfers = await listLessonHourSuggestions(db, ctx.institutionId, monthStartOf(month))
  const { sheet, locked } = await monthState(db, ctx.institutionId, month)
  const { suggestion } = sources
  const teachers = suggestion.teachers
    .map((item) => teacherSummary(item, sources, transfers))
    .sort(
      (a, b) =>
        a.staffName.localeCompare(b.staffName, 'tr') ||
        a.membershipId.localeCompare(b.membershipId),
    )
  const payrollLocked = isPayrollMonthLocked(locked, month)
  return {
    month,
    weeklyLoad: params.weeklyLoad,
    weeklyCap: params.weeklyCap,
    rangeFrom: suggestion.rangeFrom,
    rangeTo: suggestion.rangeTo,
    monthComplete: suggestion.monthComplete,
    attendanceKnown: suggestion.attendanceKnown,
    sheetStatus: lessonSheetStatus(sheet),
    payrollLocked,
    transferable:
      !payrollLocked && !isLessonSheetApproved(sheet) && month <= dayKey(ctx.now).slice(0, 7),
    teachers,
    unlinked: suggestion.unlinked
      .map((item) => ({ ...item, teacherName: sources.teacherNames.get(item.teacherId) ?? null }))
      .sort((a, b) => (a.teacherName ?? '').localeCompare(b.teacherName ?? '', 'tr')),
    totals: {
      teacherCount: teachers.length,
      suggestedHours: teachers.reduce((sum, item) => sum + (item.suggestedHours ?? 0), 0),
      currentHours: teachers.reduce((sum, item) => sum + (item.currentHours ?? 0), 0),
    },
  }
}

/** Öğretmenin gün dökümü (K-550): hangi ders, hangi sınıf, sayıldı mı ve neden. */
export async function lessonHourSuggestionDetailFor(
  ctx: ServiceContext,
  month: string,
  membershipId: string,
  params: LessonSuggestionParams,
) {
  const sources = await compute(ctx.db, ctx, month, params)
  const item = sources.suggestion.teachers.find((entry) => entry.membershipId === membershipId)
  if (item === undefined) throw new NotFoundError()
  const transfers = await listLessonHourSuggestions(ctx.db, ctx.institutionId, monthStartOf(month))
  const classNames = await loadClassNames(ctx.db, ctx.institutionId)
  return {
    ...teacherSummary(item, sources, transfers),
    month,
    weeklyLoad: params.weeklyLoad,
    weeklyCap: params.weeklyCap,
    days: item.days.map((day) => ({
      ...day,
      items: day.items.map((entry) => ({
        ...entry,
        className: classNames.get(entry.classId) ?? null,
      })),
    })),
    transfers: transfers
      .filter((transfer) => transfer.membershipId === membershipId)
      .map(transferView),
  }
}

/**
 * Aktarım (K-552): öneri (ya da gerekçeli düzeltmesi) ayın `extra` saat kaydına yazılır; kayıt
 * yoksa açılır. Personel ve gelecek ay denetimi elle girişle aynıdır (K-337); kilitli ayda 409
 * (K-410). Her satır değişmez aktarım satırı ve denetim kaydı yazar (gerekçe ve saat yazılmaz).
 */
export function transferLessonHourSuggestionsCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  let entityId = month
  return runCommand(
    ctx,
    {
      action: 'finance.lesson_hour_suggestion.transfer',
      collections: [],
      entity: () => ({ type: ENTITY, id: entityId }),
      load: async (tx) => {
        const parsed = lessonSuggestionTransferSchema.parse(input)
        const params = { weeklyLoad: parsed.weeklyLoad, weeklyCap: parsed.weeklyCap }
        const sources = await compute(tx, ctx, month, params)
        const { sheet, locked } = await monthState(tx, ctx.institutionId, month)
        const today = dayKey(ctx.now)
        return {
          run: () => {
            const plan = planLessonSuggestionTransfer(
              parsed,
              sources.suggestion,
              extraEntries(sources.entries),
            )
            for (const item of plan)
              planPayrollLessonHours(
                {
                  membershipId: item.membershipId,
                  month,
                  lessonType: 'extra',
                  hours: item.hours,
                  note: null,
                },
                {
                  staff: sources.staff.get(item.membershipId) ?? null,
                  exists: false,
                  today,
                },
              )
            assertLessonHoursWritable(sheet)
            assertPayrollDaysUnlocked(
              locked,
              [{ from: monthStartOf(month), to: monthEnd(month) }],
              'month',
            )
            return { plan, params }
          },
        }
      },
      after: async (tx, { plan, params }) => {
        for (const item of plan) {
          let lessonHoursId: string
          if (item.entry === null) {
            lessonHoursId = randomUUID()
            await insertLessonHours(tx, ctx.institutionId, {
              id: lessonHoursId,
              membershipId: item.membershipId,
              monthStart: monthStartOf(month),
              lessonType: 'extra',
              hours: item.hours,
              note: null,
              createdByUserId: ctx.actor.userId,
              now: ctx.now,
            })
          } else {
            lessonHoursId = item.entry.id
            const saved = await updateLessonHours(tx, ctx.institutionId, {
              id: lessonHoursId,
              expectedVersion: item.entry.version,
              hours: item.hours,
              note: item.entry.note,
              now: ctx.now,
            })
            if (!saved) throw new ConflictError()
          }
          const transferId = randomUUID()
          await insertLessonHourSuggestion(tx, ctx.institutionId, {
            id: transferId,
            monthStart: monthStartOf(month),
            membershipId: item.membershipId,
            lessonHoursId,
            suggestedHours: item.suggestedHours,
            previousHours: item.entry?.hours ?? null,
            hours: item.hours,
            reason: item.reason,
            weeklyLoad: params.weeklyLoad,
            weeklyCap: params.weeklyCap,
            createdByUserId: ctx.actor.userId,
            now: ctx.now,
          })
          entityId = lessonHoursId
          await auditWork(
            tx,
            ctx,
            'finance.lesson_hour_suggestion.transfer',
            { type: ENTITY, id: lessonHoursId },
            [
              ...(item.entry === null ? ['membershipId', 'month', 'lessonType'] : []),
              'hours',
              'suggestedHours',
              ...(item.reason === null ? [] : ['reason']),
              `transfer:${transferId}`,
            ],
          )
        }
        body = { data: await lessonHourSuggestionsFor(ctx, month, params, tx) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
