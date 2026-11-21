import { randomUUID } from 'node:crypto'

import {
  addDayCount,
  defaultWorkPermitValidUntil,
  isUnapprovedTeaching,
  needsAttention,
  planWorkPermit,
  planWorkPermitApply,
  planWorkPermitApprove,
  planWorkPermitReject,
  planWorkPermitUpdate,
  teacherPermitSummary,
  WORK_PERMIT_TEACHER_ROLE,
  WORK_PERMIT_TEACHING_WINDOW_DAYS,
  workPermitApplySchema,
  workPermitApproveSchema,
  workPermitCancelSchema,
  workPermitInputSchema,
  workPermitRejectSchema,
  workPermitState,
  workPermitUpdateSchema,
  type TeacherPermitStatus,
} from '@kampus/school-core/lib/finance-work-permits.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findFile } from '../db/files.ts'
import {
  findMember,
  findWorkPermit,
  insertWorkPermit,
  listActiveTeachers,
  listWorkPermits,
  loadSchoolYearRanges,
  loadTeacherWorkPermits,
  loadTeachingMemberships,
  updateWorkPermit,
  workPermitExists,
  type StoredWorkPermit,
  type WorkPermitChanges,
  type WorkPermitQuery,
} from '../db/finance-work-permits.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Öğretmen çalışma onayı takibi (DOM-FIN-114; ON-174). Kural core `lib/finance-work-permits.ts`'tedir;
 * servis kurum kilidi altında üyeliği ve öğretmenin kayıtlarını yükler, yazmaları tek transaction'da
 * yapar. "Süresi doldu", "dolmak üzere" ve "programda görevli" her okumada `ctx.now`'dan hesaplanır
 * (K-376). Onay belgesi platform dosya altyapısıyla (`attachFile`, amaç `document`) aynı
 * transaction'da bağlanır. MEBBİS'e gönderim yoktur (IST-143). Denetim kaydına alan adları yazılır;
 * ret ve iptal gerekçesi, onay sayısı ve not yazılmaz. Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'teacher_work_permits'
/** Dosya bağ türü (ADR 0003 karar 5): onay belgesi kayda bağlanır. */
export const WORK_PERMIT_FILE_ATTACHMENT = 'teacher_work_permit'

// --- Görünümler ----------------------------------------------------------------------------------

function permitView(permit: StoredWorkPermit, today: string) {
  return {
    id: permit.id,
    teacher: { membershipId: permit.membershipId, name: permit.teacherName },
    permitType: permit.permitType,
    branch: permit.branch,
    status: permit.status,
    state: workPermitState(permit, today),
    applicationDate: permit.applicationDate,
    approvalDate: permit.approvalDate,
    approvalNumber: permit.approvalNumber,
    validUntil: permit.validUntil,
    rejectionDate: permit.rejectionDate,
    documentFileId: permit.documentFileId,
    note: permit.note,
    createdAt: permit.createdAt,
    version: permit.version,
  }
}

async function permitOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findWorkPermit(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

/** Ayrıntı: ret gerekçesi ve onay belgesinin adı (silinmiş ya da reddedilmiş dosyada boş). */
async function permitDetail(db: Database, ctx: ServiceContext, id: string) {
  const permit = await permitOf(db, ctx, id)
  const file =
    permit.documentFileId === null
      ? null
      : await findFile(db, ctx.institutionId, permit.documentFileId)
  return {
    ...permitView(permit, dayKey(ctx.now)),
    rejectionReason: permit.rejectionReason,
    documentFile:
      file === null || file.status === 'deleted' || file.status === 'rejected'
        ? null
        : { id: file.id, name: file.originalName ?? 'calisma-onayi.pdf', byteSize: file.byteSize },
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listWorkPermitsFor(
  ctx: ServiceContext,
  query: Omit<WorkPermitQuery, 'today'>,
) {
  const today = dayKey(ctx.now)
  const { items, total } = await listWorkPermits(ctx.db, ctx.institutionId, { ...query, today })
  return { items: items.map((item) => permitView(item, today)), total }
}

export const getWorkPermitFor = (ctx: ServiceContext, id: string) => permitDetail(ctx.db, ctx, id)

export interface TeacherListQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: TeacherPermitStatus | 'attention' | undefined
  warning?: boolean | undefined
}

/**
 * Takip listesi (K-376): kurumun etkin öğretmenleri ada göre; her satırda geçerli onayın özeti,
 * açık başvuru, programda görevli işareti ve uyarı. Süzgeç hesaplanan değerlere dayanır: liste
 * bellekte süzülür ve sayfalanır. Rozet sayıları (dikkat ve uyarı) süzgeçten bağımsız bütün
 * öğretmenlerdendir.
 */
export async function listWorkPermitTeachersFor(ctx: ServiceContext, query: TeacherListQuery) {
  const today = dayKey(ctx.now)
  // Europe/Istanbul 2016'dan beri sabit UTC+3'tür; ders `date` alanı ISO UTC'dir.
  const fromAt = new Date(`${today}T00:00:00+03:00`).toISOString()
  const toDay = addDayCount(today, WORK_PERMIT_TEACHING_WINDOW_DAYS)
  const toAt = new Date(`${toDay}T00:00:00+03:00`).toISOString()
  const [teachers, teaching] = await Promise.all([
    listActiveTeachers(ctx.db, ctx.institutionId, query.q),
    loadTeachingMemberships(ctx.db, ctx.institutionId, { fromAt, toAt, today }),
  ])
  const permits = await loadTeacherWorkPermits(
    ctx.db,
    ctx.institutionId,
    teachers.map((teacher) => teacher.membershipId),
  )
  const byTeacher = new Map<string, StoredWorkPermit[]>()
  for (const permit of permits)
    byTeacher.set(permit.membershipId, [...(byTeacher.get(permit.membershipId) ?? []), permit])
  const rows = teachers.map((teacher) => {
    const summary = teacherPermitSummary(byTeacher.get(teacher.membershipId) ?? [], today)
    const isTeaching = teaching.has(teacher.membershipId)
    return {
      membershipId: teacher.membershipId,
      name: teacher.name,
      status: summary.status,
      daysLeft: summary.daysLeft,
      current:
        summary.current === null
          ? null
          : {
              id: summary.current.id,
              permitType: summary.current.permitType,
              branch: summary.current.branch,
              approvalDate: summary.current.approvalDate ?? '',
              validUntil: summary.current.validUntil,
            },
      openApplication:
        summary.openApplication === null
          ? null
          : {
              id: summary.openApplication.id,
              permitType: summary.openApplication.permitType,
              status: summary.openApplication.status,
              applicationDate: summary.openApplication.applicationDate,
            },
      teaching: isTeaching,
      warning: isUnapprovedTeaching(summary.status, isTeaching),
    }
  })
  const filtered = rows.filter(
    (row) =>
      (query.status === undefined ||
        (query.status === 'attention'
          ? needsAttention(row.status)
          : row.status === query.status)) &&
      (query.warning !== true || row.warning),
  )
  const start = (query.page - 1) * query.pageSize
  return {
    items: filtered.slice(start, start + query.pageSize),
    total: filtered.length,
    counts: {
      attention: rows.filter((row) => needsAttention(row.status)).length,
      warning: rows.filter((row) => row.warning).length,
    },
  }
}

// --- Komutlar ------------------------------------------------------------------------------------

const attachDocument = (tx: Database, ctx: ServiceContext, permitId: string, fileId: string) =>
  attachFile(tx, ctx, {
    fileId,
    attachedType: WORK_PERMIT_FILE_ATTACHMENT,
    attachedId: permitId,
    dataSubjectId: null,
  })

const detachDocument = (tx: Database, ctx: ServiceContext, permitId: string, fileId: string) =>
  detachFile(tx, ctx, { fileId, attachedType: WORK_PERMIT_FILE_ATTACHMENT, attachedId: permitId })

/** Kayıt bulunamazsa 404, sürüm tutmazsa 409. */
async function currentOf(tx: Database, ctx: ServiceContext, id: string, expectedVersion: number) {
  const current = await permitOf(tx, ctx, id)
  if (current.version !== expectedVersion) throw new ConflictError()
  return current
}

/** Yeni kayıt (K-375): başvuru günü varsa başvuruldu, yoksa hazırlanıyor. 201. */
export function createWorkPermitCommand(
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
      action: 'work_permit.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = workPermitInputSchema.parse(input)
        const teacher = await findMember(tx, ctx.institutionId, data.membershipId)
        const permits =
          teacher === null || teacher.role !== WORK_PERMIT_TEACHER_ROLE
            ? []
            : await loadTeacherWorkPermits(tx, ctx.institutionId, [data.membershipId])
        return {
          run: () => ({
            data,
            status: planWorkPermit(data, { teacher, permits }, dayKey(ctx.now)),
          }),
        }
      },
      after: async (tx, { data, status }) => {
        await insertWorkPermit(tx, ctx.institutionId, {
          ...data,
          id,
          status,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        const fields = Object.entries(data)
          .filter(([, value]) => value !== null)
          .map(([key]) => key)
        await auditWork(tx, ctx, 'work_permit.create', entity, [...fields, 'status'])
        body = { data: await permitDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kısmi düzeltme (K-375); belge değişince eski dosyanın bağı kalkar, yenisi bağlanır. */
export function updateWorkPermitCommand(
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
      action: 'work_permit.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const changes = workPermitUpdateSchema.parse(input)
        return {
          run: () => {
            const changed = planWorkPermitUpdate(current, changes, dayKey(ctx.now))
            const write: WorkPermitChanges = {}
            for (const key of changed) Object.assign(write, { [key]: changes[key] })
            return { changed, write, current }
          },
        }
      },
      after: async (tx, { changed, write, current }) => {
        if (write.documentFileId !== undefined) {
          if (current.documentFileId !== null)
            await detachDocument(tx, ctx, id, current.documentFileId)
          if (write.documentFileId !== null) await attachDocument(tx, ctx, id, write.documentFileId)
        }
        const saved = await updateWorkPermit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: write,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'work_permit.update', entity, changed)
        body = { data: await permitDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Başvuru işareti (K-375): hazırlanan kayıt başvuruldu olur. */
export function applyWorkPermitCommand(
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
      action: 'work_permit.apply',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = workPermitApplySchema.parse(input)
        return {
          run: () => {
            planWorkPermitApply(current, data, dayKey(ctx.now))
            return data
          },
        }
      },
      after: async (tx, data) => {
        const saved = await updateWorkPermit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: { status: 'applied', applicationDate: data.applicationDate },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'work_permit.apply', entity, ['status', 'applicationDate'])
        body = { data: await permitDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Onay (K-375, K-376): bitiş verilmezse onay gününün eğitim yılı sonu; belge isteğe bağlı. */
export function approveWorkPermitCommand(
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
      action: 'work_permit.approve',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = workPermitApproveSchema.parse(input)
        const years = await loadSchoolYearRanges(tx, ctx.institutionId)
        return {
          run: () => {
            const { validUntil } = planWorkPermitApprove(current, data, dayKey(ctx.now), (day) =>
              defaultWorkPermitValidUntil(day, years),
            )
            return { data, validUntil, current }
          },
        }
      },
      after: async (tx, { data, validUntil, current }) => {
        const replaceDocument =
          data.documentFileId !== null && data.documentFileId !== current.documentFileId
        if (replaceDocument) {
          if (current.documentFileId !== null)
            await detachDocument(tx, ctx, id, current.documentFileId)
          await attachDocument(tx, ctx, id, data.documentFileId ?? '')
        }
        const saved = await updateWorkPermit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: {
            status: 'approved',
            approvalDate: data.approvalDate,
            approvalNumber: data.approvalNumber,
            validUntil,
            ...(replaceDocument ? { documentFileId: data.documentFileId } : {}),
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'work_permit.approve', entity, [
          'status',
          'approvalDate',
          'approvalNumber',
          'validUntil',
          ...(replaceDocument ? ['documentFileId'] : []),
        ])
        body = { data: await permitDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Ret (K-375): gün ve gerekçe; gerekçe denetim kaydına yazılmaz. */
export function rejectWorkPermitCommand(
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
      action: 'work_permit.reject',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = workPermitRejectSchema.parse(input)
        return {
          run: () => {
            planWorkPermitReject(current, data, dayKey(ctx.now))
            return data
          },
        }
      },
      after: async (tx, data) => {
        const saved = await updateWorkPermit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: {
            status: 'rejected',
            rejectionDate: data.decisionDate,
            rejectionReason: data.reason,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'work_permit.reject', entity, [
          'status',
          'rejectionDate',
          'rejectionReason',
        ])
        body = { data: await permitDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yanlış kaydın iptali (arşiv): her durumda, gerekçeyle; bağlı belgenin bağı kalkar. */
export function cancelWorkPermitCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'work_permit.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await currentOf(tx, ctx, id, expectedVersion)
        const data = workPermitCancelSchema.parse(input)
        return { run: () => ({ data, current }) }
      },
      after: async (tx, { data, current }) => {
        if (current.documentFileId !== null)
          await detachDocument(tx, ctx, id, current.documentFileId)
        const saved = await updateWorkPermit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: {
            archivedAt: ctx.now,
            cancelReason: data.reason,
            cancelledByUserId: ctx.actor.userId,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'work_permit.cancel', entity, ['archivedAt', 'cancelReason'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, cancelledAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}

/**
 * Kayda bağlı onay belgesi kaydı okuyabilene açılır (ADR 0003 karar 6): yalnız yönetici, `finance`
 * modülü açıkken ve kayıt iptal edilmemişken (K-377). PGlite tek bağlantılıdır: okuma işlemin
 * bağlantısıyla (`tx`) yapılır.
 */
defineFileAttachment(WORK_PERMIT_FILE_ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, permitId) => {
    if (ctx.actor.role !== 'yonetici') return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    return workPermitExists(tx, ctx.institutionId, permitId)
  },
})
