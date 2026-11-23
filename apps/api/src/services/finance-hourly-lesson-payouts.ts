import {
  groupPayoutSessions,
  hourlyLessonPayout,
  hourlyPayoutCsv,
  hourlyPayoutFilename,
  hourlyPayoutRange,
  type HourlyPayout,
  type HourlyPayoutPurpose,
  type PayoutTeacher,
  type TeacherPayout,
} from '@kampus/school-core/lib/finance-hourly-lesson-payouts.ts'
import {
  payrollMonthRange,
  type PayrollStaff,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'

import type { Database } from '../db/client.ts'
import { loadCourses } from '../db/courses.ts'
import { loadClassNames } from '../db/finance-lesson-hour-suggestions.ts'
import { loadStaffPayRates } from '../db/finance-pay-rates.ts'
import { loadPayrollStaff } from '../db/finance-payroll-exports.ts'
import { loadGroups } from '../db/language-groups.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { loadLessonInputs } from './finance-lesson-hour-suggestions.ts'
import { getInstitutionModules } from './modules.ts'

/**
 * Saat ücretli öğretmenin ders saati hakediş dökümü (DOM-FIN-167; ON-075; IST-087; K-556…K-558).
 * Kural core `lib/finance-hourly-lesson-payouts.ts`'tedir. Servis ders programını, izin ve rapor
 * aralıklarını, kurum tatillerini ve sınıf günü yoklamasını programdan ek ders önerisiyle
 * (DOM-FIN-165) aynı okuyucuyla (`loadLessonInputs`) okur; dil okulunda ayrıca grupları ve kurları.
 * Döküm saklanmaz ve bordroya aktarılmaz (K-558).
 *
 * Görünürlük: yönetici bütün öğretmenleri okur, her okuması denetime düşer (tutar ve izin günü
 * taşır); personel yalnız kendi dökümünü okur, ekran okuması denetime düşmez. PDF verisi ve CSV
 * ikisinde de `finance.hourly_lesson_payout.export` denetimi yazar; taze oturum rotadadır.
 */

const ENTITY = 'finance_export'
const FIELDS = ['staffName', 'lines', 'hours', 'rateCents', 'amountCents', 'status']

export type PayoutExport = HourlyPayoutPurpose | 'csv'

interface Sources {
  payout: HourlyPayout
  staff: Map<string, PayrollStaff>
  placeNames: Map<string, string>
}

/** Dökümün girdileri ve sonucu; `only` verilirse yalnız o üyeliğin dökümü hesaplanır. */
async function compute(
  db: Database,
  ctx: ServiceContext,
  month: string,
  only: string | null,
): Promise<Sources> {
  const institution = await getInstitutionModules(db, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  const { teacherIds, lessons, absences, attendanceDays, holidays } = await loadLessonInputs(
    db,
    ctx.institutionId,
    hourlyPayoutRange(month),
    institution.modules.academic === true,
  )
  const language = institution.type === 'language_school'
  const [groups, courses, classNames] = await Promise.all([
    language ? loadGroups(db, ctx.institutionId) : Promise.resolve([]),
    language ? loadCourses(db, ctx.institutionId) : Promise.resolve([]),
    loadClassNames(db, ctx.institutionId),
  ])
  const groupSessions = groupPayoutSessions(groups, courses, payrollMonthRange(month))
  const membershipIds = [
    ...new Set([
      ...teacherIds.keys(),
      ...groupSessions.map((session) => session.teacherMembershipId),
    ]),
  ].filter((membershipId) => only === null || membershipId === only)
  const [staff, rates] = await Promise.all([
    loadPayrollStaff(db, ctx.institutionId, membershipIds),
    loadStaffPayRates(db, ctx.institutionId, membershipIds),
  ])
  const people = new Map(staff.map((person) => [person.membershipId, person]))
  const teachers: PayoutTeacher[] = membershipIds
    .filter((membershipId) => people.has(membershipId))
    .map((membershipId) => ({
      membershipId,
      teacherIds: teacherIds.get(membershipId) ?? [],
      rates: rates.filter((rate) => rate.membershipId === membershipId),
    }))
  const payout = hourlyLessonPayout({
    month,
    now: ctx.now.toISOString(),
    lessons,
    teachers,
    groupSessions: groupSessions.filter((session) => people.has(session.teacherMembershipId)),
    holidays,
    absences,
    attendanceDays,
  })
  return {
    payout,
    staff: people,
    placeNames: new Map([...classNames, ...groups.map((group) => [group.id, group.name] as const)]),
  }
}

function summary(item: TeacherPayout, sources: Sources) {
  const person = sources.staff.get(item.membershipId)
  return {
    membershipId: item.membershipId,
    staffName: person?.name ?? '',
    role: person?.role ?? '',
    staffActive: person?.active ?? false,
    payBasis: item.payBasis,
    totals: item.totals,
    rates: item.rates,
    warnings: item.warnings,
  }
}

function detail(item: TeacherPayout, sources: Sources) {
  return {
    ...summary(item, sources),
    month: sources.payout.month,
    monthComplete: sources.payout.monthComplete,
    attendanceKnown: sources.payout.attendanceKnown,
    days: item.days.map((day) => ({
      day: day.day,
      lines: day.lines.map((line) => ({
        ...line,
        placeName: sources.placeNames.get(line.groupId ?? line.classId ?? '') ?? null,
      })),
    })),
  }
}
export type HourlyPayoutDetail = ReturnType<typeof detail>

const byName = (a: { staffName: string; membershipId: string }, b: typeof a) =>
  a.staffName.localeCompare(b.staffName, 'tr') || a.membershipId.localeCompare(b.membershipId)

async function audit(
  tx: Database,
  ctx: ServiceContext,
  action: 'finance.hourly_lesson_payout.read' | 'finance.hourly_lesson_payout.export',
  entityId: string,
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: ENTITY,
    entityId,
    changes: { fields: FIELDS },
    createdAt: ctx.now,
  })
}

const actionOf = (purpose: PayoutExport) =>
  purpose === 'view' ? 'finance.hourly_lesson_payout.read' : 'finance.hourly_lesson_payout.export'
const entityOf = (month: string, membershipId: string | null, purpose: PayoutExport) =>
  `hourly-lesson-payout:${month}${membershipId === null ? '' : `:${membershipId}`}${purpose === 'view' ? '' : `:${purpose}`}`

/** Ayın dökümü (yönetici): öğretmen başına özet ve toplamlar; okuma denetime düşer. */
export function hourlyLessonPayoutsFor(ctx: ServiceContext, month: string, purpose: PayoutExport) {
  return ctx.db.transaction(async (tx) => {
    const sources = await compute(tx, ctx, month, null)
    await audit(tx, ctx, actionOf(purpose), entityOf(month, null, purpose))
    const teachers = sources.payout.teachers.map((item) => summary(item, sources)).sort(byName)
    return {
      sources,
      data: {
        month,
        monthComplete: sources.payout.monthComplete,
        attendanceKnown: sources.payout.attendanceKnown,
        teachers,
        totals: {
          teacherCount: teachers.length,
          givenLessons: teachers.reduce((sum, item) => sum + item.totals.givenLessons, 0),
          givenHours: teachers.reduce((sum, item) => sum + item.totals.givenHours, 0),
          cancelledLessons: teachers.reduce((sum, item) => sum + item.totals.cancelledLessons, 0),
          makeupLessons: teachers.reduce((sum, item) => sum + item.totals.makeupLessons, 0),
          amountCents: teachers.reduce((sum, item) => sum + item.totals.amountCents, 0),
          unpricedTeacherCount: teachers.filter((item) => item.totals.unpricedHours > 0).length,
        },
      },
    }
  })
}

/** Öğretmenin gün gün dökümü (yönetici); dökümde olmayan ya da başka kurumun üyeliği 404. */
export function hourlyLessonPayoutDetailFor(
  ctx: ServiceContext,
  month: string,
  membershipId: string,
  purpose: PayoutExport,
) {
  return ctx.db.transaction(async (tx) => {
    const sources = await compute(tx, ctx, month, membershipId)
    const item = sources.payout.teachers.find((entry) => entry.membershipId === membershipId)
    if (item === undefined) throw new NotFoundError()
    await audit(tx, ctx, actionOf(purpose), entityOf(month, membershipId, purpose))
    return detail(item, sources)
  })
}

/**
 * Personelin kendi dökümü (DOM-FIN-166 self-servisi): istekte üyelik yoktur, oturumdaki üyelik
 * kullanılır. Dökümü yoksa (aylık ücretli ya da ayda dersi yok) `payout: null`. Yalnız PDF ve CSV
 * denetime düşer.
 */
export function ownHourlyLessonPayoutFor(
  ctx: ServiceContext,
  month: string,
  purpose: PayoutExport,
) {
  return ctx.db.transaction(async (tx) => {
    const membershipId = ctx.actor.membershipId
    const sources = await compute(tx, ctx, month, membershipId)
    const item = sources.payout.teachers.find((entry) => entry.membershipId === membershipId)
    if (purpose !== 'view') {
      if (item === undefined) throw new NotFoundError()
      await audit(tx, ctx, actionOf(purpose), entityOf(month, membershipId, purpose))
    }
    return { month, payout: item === undefined ? null : detail(item, sources) }
  })
}

/** CSV (yönetici: bütün öğretmenler ya da biri; personel: kendisi). BOM'u rota ekler. */
export async function hourlyLessonPayoutCsvFor(
  ctx: ServiceContext,
  month: string,
  scope: { membershipId: string } | { own: true } | null,
): Promise<{ csv: string; filename: string }> {
  let teachers: HourlyPayoutDetail[]
  if (scope === null) {
    const { sources } = await hourlyLessonPayoutsFor(ctx, month, 'csv')
    teachers = sources.payout.teachers.map((item) => detail(item, sources)).sort(byName)
  } else if ('own' in scope) {
    const { payout } = await ownHourlyLessonPayoutFor(ctx, month, 'csv')
    teachers = payout === null ? [] : [payout]
  } else teachers = [await hourlyLessonPayoutDetailFor(ctx, month, scope.membershipId, 'csv')]
  return { csv: hourlyPayoutCsv(teachers), filename: hourlyPayoutFilename(month, 'csv') }
}
