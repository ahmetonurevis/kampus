import { randomUUID } from 'node:crypto'

import {
  assertMedicalReportPeriod,
  FINANCE_MEDICAL_REPORT_ROLES,
  medicalReportCancelSchema,
  medicalReportDays,
  medicalReportDaysInPeriod,
  medicalReportInputSchema,
  medicalReportState,
  medicalReportUpdateSchema,
  monthPeriod,
  planMedicalReport,
  planMedicalReportCancel,
  planMedicalReportUpdate,
  type MedicalReportDays,
  type MedicalReportState,
  type MedicalReportType,
} from '@kampus/school-core/lib/finance-medical-reports.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  cancelMedicalReport,
  findMedicalReport,
  findReportStaffMember,
  insertMedicalReport,
  listMedicalReports,
  listReportStaff,
  loadMedicalReportsInPeriod,
  loadStaffReportPeriods,
  medicalReportHasFile,
  updateMedicalReport,
  type MedicalReportListQuery,
  type StoredMedicalReport,
} from '../db/finance-medical-reports.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel sağlık raporu (DOM-FIN-110; ON-185). Kural core `lib/finance-medical-reports.ts`'tedir;
 * servis kurum kilidi altında personeli ve raporlarını yükler, aynı transaction'da yazar. Sağlık
 * verisi özel niteliklidir (K-363): denetim kaydına yalnız alan adları yazılır (tür, tarih ve
 * gerekçe yazılmaz). Liste ve özet okuması okumayla aynı transaction'da denetime düşer; dosyanın
 * her açılışı (bilgi ya da bağlantı) dosya okuma kuralında denetime yazılır. Rol ve modül denetimi
 * rotadadır (yalnız yönetici).
 */

const ENTITY = 'staff_medical_reports'
const READ_ACTION = 'finance.medical_report.read'
export const MEDICAL_REPORT_FILE_ATTACHMENT = 'staff_medical_report'

/** Yanıt görünümü: durum bugüne göre, dönem verildiyse döneme düşen gün. */
export function medicalReportView(
  report: StoredMedicalReport,
  today: string,
  period: { from: string; to: string } | null = null,
) {
  return {
    id: report.id,
    membershipId: report.membershipId,
    staffName: report.staffName,
    reportType: report.reportType,
    startDate: report.startDate,
    endDate: report.endDate,
    dayCount: report.dayCount,
    daysInPeriod:
      period === null ? null : medicalReportDaysInPeriod(report, period.from, period.to),
    issuerType: report.issuerType,
    fileId: report.fileId,
    employerNotifiedAt: report.employerNotifiedAt,
    sgkApprovedAt: report.sgkApprovedAt,
    state: medicalReportState({ ...report, cancelled: report.cancelledAt !== null }, today),
    cancelledAt: report.cancelledAt,
    cancelReason: report.cancelReason,
    createdAt: report.createdAt,
    version: report.version,
  }
}

const stateOf = (report: StoredMedicalReport): MedicalReportState => ({
  cancelled: report.cancelledAt !== null,
  employerNotified: report.employerNotifiedAt !== null,
  sgkApproved: report.sgkApprovedAt !== null,
  fileId: report.fileId,
})

async function auditRead(tx: Database, ctx: ServiceContext, entityId: string, fields: string[]) {
  await auditWork(tx, ctx, READ_ACTION, { type: ENTITY, id: entityId }, fields)
}

/** Dönem: verilmezse bugünün ayı; yalnız başlangıç verilirse o ayın sonu. */
function resolvePeriod(ctx: Pick<ServiceContext, 'now'>, from?: string, to?: string) {
  const base = monthPeriod(from ?? to ?? dayKey(ctx.now))
  const period = { from: from ?? base.from, to: to ?? monthPeriod(from ?? base.from).to }
  try {
    assertMedicalReportPeriod(period.from, period.to)
  } catch (error) {
    throw mapOperationError(error)
  }
  return period
}

/**
 * Rapor listesi (DOM-FIN-110): dönemle kesişen raporlar, en yeni başlangıç önce; iptal edilmişler
 * `state=cancelled` ile. Dönem verilirse her satır döneme düşen günü taşır. Okuma denetime düşer.
 */
export async function listMedicalReportsFor(
  ctx: ServiceContext,
  query: Omit<MedicalReportListQuery, 'state'> & { state?: 'active' | 'cancelled' | undefined },
) {
  const today = dayKey(ctx.now)
  const period =
    query.from === undefined && query.to === undefined
      ? null
      : resolvePeriod(ctx, query.from, query.to)
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listMedicalReports(tx, ctx.institutionId, {
      ...query,
      from: period?.from,
      to: period?.to,
      state: query.state ?? 'active',
    })
    await auditRead(tx, ctx, ctx.institutionId, ['reportType', 'startDate', 'endDate'])
    return { items: items.map((item) => medicalReportView(item, today, period)), total, period }
  })
}

/**
 * Dönem özeti (DOM-FIN-110; bordro girdisi): personel başına döneme düşen rapor günü, türe göre
 * gün, rapor sayısı ve işareti eksik rapor sayısı. Varsayılan bütün personel; `withReports` yalnız
 * dönemde raporu olanlar. Okuma denetime düşer.
 */
export async function medicalReportSummaryFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: 'active' | 'passive' | undefined
    from?: string | undefined
    to?: string | undefined
    withReports: boolean
  },
) {
  const period = resolvePeriod(ctx, query.from, query.to)
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listReportStaff(tx, ctx.institutionId, {
      ...query,
      withReportsIn: query.withReports ? period : undefined,
    })
    const reports = await loadMedicalReportsInPeriod(tx, ctx.institutionId, {
      membershipIds: items.map((item) => item.membershipId),
      ...period,
    })
    const byMember = new Map<string, StoredMedicalReport[]>()
    for (const report of reports)
      byMember.set(report.membershipId, [...(byMember.get(report.membershipId) ?? []), report])
    const rows = items.map((member) => {
      const own = byMember.get(member.membershipId) ?? []
      const days = medicalReportDays(own, period.from, period.to)
      return {
        membershipId: member.membershipId,
        name: member.name,
        role: member.role,
        active: member.active,
        totalDays: days.totalDays,
        byType: days.byType,
        reportCount: own.length,
        awaitingNoticeCount: own.filter((report) => report.employerNotifiedAt === null).length,
        awaitingSgkCount: own.filter((report) => report.sgkApprovedAt === null).length,
      }
    })
    await auditRead(tx, ctx, ctx.institutionId, ['reportType', 'startDate', 'endDate'])
    return { items: rows, total, period }
  })
}

/**
 * "Tarih aralığındaki rapor günleri" (DOM-FIN-110; yalnız okuma). İzin hak edişi (ON-181) ve
 * bordro aktarımı (ON-202) çağırır: iptal edilmemiş raporların `from`–`to` (en çok 366 gün) ile
 * kesişen günleri, personel başına türe göre sayı ve gün listesi. `membershipIds` verilirse her
 * kimlik için (raporu yoksa sıfır) bir satır, verilmezse dönemde raporu olan personel döner.
 * Denetim kaydını çağıran uç yazar (`finance.medical_report.read`, alan adları).
 */
export async function medicalReportDaysFor(
  ctx: Pick<ServiceContext, 'db' | 'institutionId'>,
  input: { membershipIds?: readonly string[] | undefined; from: string; to: string },
): Promise<(MedicalReportDays & { membershipId: string })[]> {
  assertMedicalReportPeriod(input.from, input.to)
  const reports = await loadMedicalReportsInPeriod(ctx.db, ctx.institutionId, input)
  const byMember = new Map<
    string,
    { reportType: MedicalReportType; startDate: string; endDate: string }[]
  >()
  for (const id of input.membershipIds ?? []) byMember.set(id, [])
  for (const report of reports)
    byMember.set(report.membershipId, [...(byMember.get(report.membershipId) ?? []), report])
  return [...byMember].map(([membershipId, own]) => ({
    membershipId,
    ...medicalReportDays(own, input.from, input.to),
  }))
}

// --- Komutlar ------------------------------------------------------------------------------------

const attachReportFile = (tx: Database, ctx: ServiceContext, reportId: string, fileId: string) =>
  attachFile(tx, ctx, {
    fileId,
    attachedType: MEDICAL_REPORT_FILE_ATTACHMENT,
    attachedId: reportId,
    dataSubjectId: null,
  })

const detachReportFile = (tx: Database, ctx: ServiceContext, reportId: string, fileId: string) =>
  detachFile(tx, ctx, {
    fileId,
    attachedType: MEDICAL_REPORT_FILE_ATTACHMENT,
    attachedId: reportId,
  })

async function reportBody(tx: Database, ctx: ServiceContext, id: string) {
  const report = await findMedicalReport(tx, ctx.institutionId, id)
  if (report === null) throw new NotFoundError()
  return medicalReportView(report, dayKey(ctx.now))
}

/** Raporu yükler; yoksa (başka kurum dahil) 404, sürüm tutmazsa 409. */
async function currentOf(tx: Database, ctx: ServiceContext, id: string, expectedVersion: number) {
  const report = await findMedicalReport(tx, ctx.institutionId, id)
  if (report === null) throw new NotFoundError()
  if (report.version !== expectedVersion) throw new ConflictError()
  return report
}

/** Yeni rapor (K-363, K-364): çakışma kurum kilidi altında denetlenir; dosya aynı işlemde bağlanır. 201. */
export function createMedicalReportCommand(
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
      action: 'finance.medical_report.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = medicalReportInputSchema.parse(input)
        const staff = await findReportStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const reports =
          staff === null
            ? []
            : await loadStaffReportPeriods(tx, ctx.institutionId, staff.membershipId)
        return {
          run: () => ({
            parsed,
            plan: planMedicalReport(parsed, { staff, reports, today: dayKey(ctx.now) }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        // Önce dosya bağlanır (başkasının ya da hazır olmayan dosya 422, işlem geri alınır).
        if (parsed.fileId !== null) await attachReportFile(tx, ctx, id, parsed.fileId)
        await insertMedicalReport(tx, ctx.institutionId, {
          id,
          membershipId: parsed.membershipId,
          reportType: parsed.reportType,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          dayCount: plan.dayCount,
          issuerType: parsed.issuerType,
          fileId: parsed.fileId,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.medical_report.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        body = { data: await reportBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** İşaret ve dosya (K-365): verilen alanlar değişir; tarih ve tür değişmez. */
export function updateMedicalReportCommand(
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
      action: 'finance.medical_report.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = medicalReportUpdateSchema.parse(input)
        const current = await currentOf(tx, ctx, id, expectedVersion)
        return { run: () => planMedicalReportUpdate(stateOf(current), parsed) }
      },
      after: async (tx, plan) => {
        if (plan.file?.detach != null) await detachReportFile(tx, ctx, id, plan.file.detach)
        if (plan.file?.attach != null) await attachReportFile(tx, ctx, id, plan.file.attach)
        const saved = await updateMedicalReport(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
          employerNotified: plan.fields.includes('employerNotified')
            ? plan.employerNotified
            : undefined,
          sgkApproved: plan.fields.includes('sgkApproved') ? plan.sgkApproved : undefined,
          fileId: plan.file === undefined ? undefined : plan.file.attach,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.medical_report.update', entity, plan.fields)
        body = { data: await reportBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Gerekçeli iptal (K-364): bir kez; dosya bağı kalkar (K-363). */
export function cancelMedicalReportCommand(
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
      action: 'finance.medical_report.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = medicalReportCancelSchema.parse(input)
        const current = await currentOf(tx, ctx, id, expectedVersion)
        return { run: () => ({ parsed, plan: planMedicalReportCancel(stateOf(current)) }) }
      },
      after: async (tx, { parsed, plan }) => {
        if (plan.detachFileId !== null) await detachReportFile(tx, ctx, id, plan.detachFileId)
        const saved = await cancelMedicalReport(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.medical_report.cancel',
          entity,
          plan.detachFileId === null
            ? ['archivedAt', 'cancelReason']
            : ['archivedAt', 'cancelReason', 'fileId'],
        )
        body = { data: await reportBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Rapora bağlı dosya yalnız yöneticiye, `finance` modülü açıkken ve rapor iptal edilmemişken
 * açılır (ADR 0003 karar 6; K-363). Dosyanın her açılışı (bilgi ya da imzalı bağlantı) bu kuralın
 * içinde, açılışla aynı transaction'da `finance.medical_report.file_open` olarak denetime yazılır:
 * bağlantı üretilemezse denetim de geri alınır. PGlite tek bağlantılıdır: okuma `tx` ile yapılır.
 */
defineFileAttachment(MEDICAL_REPORT_FILE_ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, reportId) => {
    if (!(FINANCE_MEDICAL_REPORT_ROLES as readonly string[]).includes(ctx.actor.role)) return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    if (!(await medicalReportHasFile(tx, ctx.institutionId, reportId))) return false
    await auditWork(tx, ctx, 'finance.medical_report.file_open', { type: ENTITY, id: reportId }, [
      'fileId',
    ])
    return true
  },
})
