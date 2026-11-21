import {
  branchBusyDays,
  calendarAbsences,
  calendarEntryView,
  leaveCalendarAudience,
  leaveCalendarSettingsSchema,
  leaveConflicts,
  planLeaveCalendarSettings,
  type ConflictTarget,
  type LeaveAbsence,
  type LeaveCalendarStatus,
  type LeaveConflict,
} from '@kampus/school-core/lib/finance-leave-calendar.ts'
import type { LeavePeriod } from '@kampus/school-core/lib/finance-staff-leave.ts'

import type { Database } from '../db/client.ts'
import {
  loadBranchData,
  loadLeaveAbsences,
  loadLeaveCalendarSettings,
  saveLeaveCalendarSettings,
} from '../db/finance-leave-calendar.ts'
import { ConflictError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * İzin takvimi ve çakışma uyarıları (DOM-FIN-123; ON-183; K-420…K-422). Kural core
 * `lib/finance-leave-calendar.ts`'tedir. Takvim yönetici ve ön büroya açıktır; ön büro yalnız onaylı
 * izni türsüz görür, uyarı günlerini görmez. Ayarı yalnız yönetici yazar. Uyarılar engel değildir;
 * izin talebi önizlemesine ve talep ayrıntısına eklenir (`conflictsFor`).
 */

const SETTINGS_ENTITY = 'leave_calendar_settings'

/** Öğretmen kaydı → bağlı personelin izinli aralıkları (yedek uyarısı). */
function teacherAbsencesOf(
  links: readonly { membershipId: string; teacherId: string }[],
  absences: readonly LeaveAbsence[],
) {
  const map = new Map<string, LeavePeriod[]>()
  for (const link of links)
    for (const absence of absences)
      if (absence.membershipId === link.membershipId)
        map.set(link.teacherId, [
          ...(map.get(link.teacherId) ?? []),
          { startDate: absence.startDate, endDate: absence.endDate },
        ])
  return map
}

/**
 * İzin için uyarılar (K-422): aralığa değen izinler, branşlar, ayar ve yedeklerin izinleri
 * yüklenir. Hedefin kendi talepleri branş sayımında zaten dışlanır.
 */
export async function conflictsFor(
  db: Database,
  institutionId: string,
  target: ConflictTarget,
): Promise<LeaveConflict[]> {
  // Talebin dersleri izin aralığındadır (İstanbul günü); yedeklerin izni de bu aralıkta aranır.
  const period = { startDate: target.startDate, endDate: target.endDate }
  const [absences, branch, settings] = await Promise.all([
    loadLeaveAbsences(db, institutionId, period),
    loadBranchData(db, institutionId),
    loadLeaveCalendarSettings(db, institutionId),
  ])
  const visible = calendarAbsences(absences)
  return leaveConflicts(target, {
    absences: visible,
    branches: branch.branches,
    subjectNames: branch.subjectNames,
    settings,
    teacherAbsences: teacherAbsencesOf(
      branch.links,
      visible.filter((absence) => absence.membershipId !== target.membershipId),
    ),
    teacherNames: branch.teacherNames,
  })
}

export interface LeaveCalendarQuery extends LeavePeriod {
  subjectId?: string | undefined
  role?: string | undefined
  status?: LeaveCalendarStatus | undefined
}

/**
 * Takvim (K-420): aralığa değen izinler, sınav haftaları, branş seçenekleri ve (yalnız yönetici)
 * branşta eşiğe ulaşan günler. Ön büro yalnız onaylı izinleri türsüz görür; durum süzgeci onda
 * etkisizdir. Branş ve rol süzgeci kayıtları süzer; eşik günleri branş süzgecine uyar.
 */
export async function leaveCalendarFor(ctx: ServiceContext, query: LeaveCalendarQuery) {
  const audience = leaveCalendarAudience(ctx.actor.role)
  const period = { startDate: query.startDate, endDate: query.endDate }
  const [absences, branch, settings] = await Promise.all([
    loadLeaveAbsences(ctx.db, ctx.institutionId, period),
    loadBranchData(ctx.db, ctx.institutionId),
    loadLeaveCalendarSettings(ctx.db, ctx.institutionId),
  ])
  const all = calendarAbsences(absences)
  const status = audience === 'front_desk' ? 'approved' : query.status
  const branchOf = (membershipId: string) => branch.branches.get(membershipId) ?? []
  const entries = all
    .filter(
      (absence) =>
        (status === undefined || absence.status === status) &&
        (query.role === undefined || absence.role === query.role) &&
        (query.subjectId === undefined || branchOf(absence.membershipId).includes(query.subjectId)),
    )
    .map((absence) => calendarEntryView(absence, branchOf(absence.membershipId), audience))
  const busyDays =
    audience === 'front_desk'
      ? []
      : branchBusyDays(all, branch.branches, period, settings.concurrentThreshold)
          .filter((day) => query.subjectId === undefined || day.subjectId === query.subjectId)
          .map(({ day, subjectId, count }) => ({ day, subjectId, count }))
  const subjects = [...new Set([...branch.branches.values()].flat())]
    .map((id) => ({ id, name: branch.subjectNames.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id))
  return {
    startDate: period.startDate,
    endDate: period.endDate,
    entries,
    examWeeks: settings.examWeeks.filter(
      (week) => week.startDate <= period.endDate && period.startDate <= week.endDate,
    ),
    busyDays,
    subjects,
    concurrentThreshold: audience === 'front_desk' ? null : settings.concurrentThreshold,
  }
}

export async function leaveCalendarSettingsFor(ctx: ServiceContext) {
  return loadLeaveCalendarSettings(ctx.db, ctx.institutionId)
}

/** Ayar (K-421, K-422): gönderilmeyen alan değişmez; `If-Match` ayar sürümü (hiç yoksa 1). */
export function setLeaveCalendarSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS_ENTITY, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.leave_calendar.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveCalendarSettingsSchema.parse(input)
        const current = await loadLeaveCalendarSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planLeaveCalendarSettings(current, parsed) }
      },
      after: async (tx, plan) => {
        const saved = await saveLeaveCalendarSettings(tx, ctx.institutionId, {
          ...plan.next,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.leave_calendar.settings', entity, plan.changed)
        body = { data: await loadLeaveCalendarSettings(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
