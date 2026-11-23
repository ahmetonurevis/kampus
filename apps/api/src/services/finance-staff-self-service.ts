import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  assertPersonnelFileValues,
  changedPersonnelFileFields,
  EMPTY_PERSONNEL_FILE,
  mergePersonnelFile,
  personnelFileView,
  planPersonnelFile,
  type PersonnelFileValues,
} from '@kampus/school-core/lib/finance-personnel-files.ts'
import {
  assertStaffChangePending,
  myLeaveRequestInputSchema,
  planStaffChangeRequest,
  splitStaffChange,
  STAFF_CHANGE_APPROVER_ROLES,
  staffChangeFields,
  staffChangeProposal,
  staffChangeRejectSchema,
  staffChangeRequestInputSchema,
  staffChangeUpdate,
  storedStaffChangePayloadSchema,
  type StaffChangeKind,
  type StaffChangeStatus,
  type StoredStaffChangePayload,
} from '@kampus/school-core/lib/finance-staff-self-service.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import { listLeaveRequests } from '../db/finance-leave-requests.ts'
import {
  findPersonnelFile,
  insertPersonnelFile,
  updatePersonnelFile,
} from '../db/finance-personnel-files.ts'
import {
  closeStaffChangeRequest,
  findStaffChangeRequest,
  insertStaffChangeRequest,
  listStaffChangeRequests,
  pendingStaffChangeKinds,
  staffChangeRequestExists,
  type StoredStaffChangeRequest,
} from '../db/finance-staff-change-requests.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { FieldBinding, FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile, getFileUrl } from './files.ts'
import { createLeaveRequestCommand } from './finance-leave-requests.ts'
import { columnsOf, valuesOf } from './finance-personnel-files.ts'
import { getLeaveStaffFor, listLeaveTypesFor } from './finance-staff-leave.ts'
import { prepareStaffDocument, settingsOf, writeStaffDocument } from './finance-staff-documents.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel self-servisi (DOM-FIN-166; ON-189; K-553…K-555). Kural core
 * `lib/finance-staff-self-service.ts`'tedir. Tek giriş oturumdaki üyeliktir (`ctx.actor
 * .membershipId`): istekte personel kimliği yoktur; personel olmayan üyelik ve başka personelin
 * talebi 404. Değişiklik talebi kurum kilidi altında açılır; IBAN talep satırına bağlı anahtarla
 * şifrelenir, her okumada maskelidir. Onay aynı transaction'da özlük kartını (DOM-FIN-140) ya da
 * özlük belgesini (DOM-FIN-113) yazar; belge dosyası talepten belgeye taşınır. Denetim kaydına
 * alan adları yazılır, değer ve gerekçe yazılmaz. Rol, modül ve taze oturum rotadadır.
 */

const ENTITY = 'staff_change_requests'
const ATTACHMENT = 'staff_change_request'
const FILE_OPEN_ACTION = 'finance.staff_change_request.file_open'

export interface StaffSelfServiceDeps {
  cipher: FieldCipher
}

/**
 * Talep dosyasının bağlantısı yalnız denetim yazan `staffChangeRequestFileUrl`'den üretilir
 * (özlük belgesi deseni, K-374): doğrudan `GET /files/:id/url` 404.
 */
const auditedOpens = new WeakSet<ServiceContext>()

defineFileAttachment(ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, requestId) => {
    if (!auditedOpens.has(ctx)) return false
    if (!(STAFF_CHANGE_APPROVER_ROLES as readonly string[]).includes(ctx.actor.role)) return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    return staffChangeRequestExists(tx, ctx.institutionId, requestId)
  },
})

const ibanBinding = (institutionId: string, requestId: string): FieldBinding => ({
  institutionId,
  table: ENTITY,
  column: 'iban',
  rowKey: requestId,
})

function requestIban(
  deps: StaffSelfServiceDeps,
  institutionId: string,
  row: Pick<StoredStaffChangeRequest, 'id' | 'ibanCiphertext' | 'ibanKeyVersion'>,
): string | null {
  if (row.ibanCiphertext === null || row.ibanKeyVersion === null) return null
  return deps.cipher.decrypt(ibanBinding(institutionId, row.id), {
    ciphertext: row.ibanCiphertext,
    keyVersion: row.ibanKeyVersion,
  })
}

const payloadOf = (row: StoredStaffChangeRequest): StoredStaffChangePayload =>
  storedStaffChangePayloadSchema.parse(row.payload)

/** Yanıt görünümü (K-554): IBAN maskeli, dosya yalnız var/yok. */
function requestView(
  deps: StaffSelfServiceDeps,
  institutionId: string,
  row: StoredStaffChangeRequest,
) {
  return {
    id: row.id,
    membershipId: row.membershipId,
    name: row.name,
    role: row.role,
    kind: row.kind,
    status: row.status,
    proposal: staffChangeProposal(payloadOf(row), {
      iban: requestIban(deps, institutionId, row),
      hasFile: row.fileId !== null,
    }),
    staffDocumentId: row.staffDocumentId,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  }
}

async function requestBody(
  tx: Database,
  ctx: ServiceContext,
  deps: StaffSelfServiceDeps,
  id: string,
) {
  const row = await findStaffChangeRequest(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return { data: requestView(deps, ctx.institutionId, row) }
}

/** Oturumdaki üyelik personel olmalı; değilse 404. */
async function selfStaff(db: Database, ctx: ServiceContext) {
  const staff = await findStaffMember(db, ctx.institutionId, ctx.actor.membershipId)
  if (staff === null || !isStaffRole(staff.role)) throw new NotFoundError()
  return staff
}

// --- Okuma ---------------------------------------------------------------------------------------

/**
 * Kendi özlük özetim (K-553): bütün gruplar salt okunur; T.C. kimlik no ve IBAN maskeli. Kart
 * yoksa `file: null`. Bekleyen taleplerin türleri form kilidi içindir.
 */
export async function ownStaffProfileFor(ctx: ServiceContext, deps: StaffSelfServiceDeps) {
  const staff = await selfStaff(ctx.db, ctx)
  const [stored, pending] = await Promise.all([
    findPersonnelFile(ctx.db, ctx.institutionId, staff.membershipId),
    pendingStaffChangeKinds(ctx.db, ctx.institutionId, staff.membershipId),
  ])
  return {
    membershipId: staff.membershipId,
    name: staff.name,
    role: staff.role,
    active: staff.active,
    file:
      stored === null
        ? null
        : {
            version: stored.version,
            updatedAt: stored.updatedAt.toISOString(),
            // Yöneticinin görünümü bütün grupları maskeli verir; kendi kartı için aynısı.
            ...personnelFileView(valuesOf(deps, ctx.institutionId, stored), 'yonetici'),
          },
    pendingKinds: [...new Set(pending.map((item) => item.kind))],
  }
}

export async function listOwnChangeRequestsFor(
  ctx: ServiceContext,
  deps: StaffSelfServiceDeps,
  query: { page: number; pageSize: number; status?: StaffChangeStatus | undefined },
) {
  const staff = await selfStaff(ctx.db, ctx)
  const { items, total } = await listStaffChangeRequests(ctx.db, ctx.institutionId, {
    ...query,
    membershipId: staff.membershipId,
  })
  return { items: items.map((row) => requestView(deps, ctx.institutionId, row)), total }
}

/** Onay kuyruğu (K-553): yönetici; bekleyenler önce. */
export async function listStaffChangeRequestsFor(
  ctx: ServiceContext,
  deps: StaffSelfServiceDeps,
  query: {
    page: number
    pageSize: number
    status?: StaffChangeStatus | undefined
    kind?: StaffChangeKind | undefined
    q?: string | undefined
  },
) {
  const { items, total } = await listStaffChangeRequests(ctx.db, ctx.institutionId, query)
  return { items: items.map((row) => requestView(deps, ctx.institutionId, row)), total }
}

/**
 * İzin özetim (K-555): kalan, kullanılan ve planlanan yıllık izin (DOM-FIN-109), kullanılmış izin
 * kayıtları, kendi talepleri (son 50) ve seçilebilir türler.
 */
export async function ownLeaveFor(ctx: ServiceContext, day: string | undefined) {
  const staff = await selfStaff(ctx.db, ctx)
  const [leave, requests, types] = await Promise.all([
    getLeaveStaffFor(ctx, staff.membershipId, day),
    listLeaveRequests(ctx.db, ctx.institutionId, {
      page: 1,
      pageSize: 50,
      membershipId: staff.membershipId,
    }),
    listLeaveTypesFor(ctx),
  ])
  return {
    date: leave.date,
    seniorityStartDate: leave.profile?.seniorityStartDate ?? null,
    entitlement: leave.entitlement,
    records: leave.records,
    requests: requests.items,
    types: types
      .filter((type) => type.isActive)
      .map((type) => ({
        code: type.code,
        label: type.label,
        kind: type.kind,
        paid: type.paid,
        deductsFromAnnual: type.deductsFromAnnual,
      })),
  }
}

// --- Yazma: personel -----------------------------------------------------------------------------

/** Değişiklik talebi (K-553, K-554). 201. */
export function createOwnChangeRequestCommand(
  ctx: ServiceContext,
  deps: StaffSelfServiceDeps,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_change_request.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffChangeRequestInputSchema.parse(input)
        const membershipId = ctx.actor.membershipId
        const [staff, pending, stored, documentSettings] = await Promise.all([
          findStaffMember(tx, ctx.institutionId, membershipId),
          pendingStaffChangeKinds(tx, ctx.institutionId, membershipId),
          findPersonnelFile(tx, ctx.institutionId, membershipId),
          settingsOf(tx, ctx.institutionId),
        ])
        const current = stored === null ? null : valuesOf(deps, ctx.institutionId, stored)
        return {
          run: () => {
            planStaffChangeRequest(parsed, {
              staff,
              pending,
              current,
              documentSettings,
              today: dayKey(ctx.now),
            })
            return { kind: parsed.kind, ...splitStaffChange(parsed) }
          },
        }
      },
      after: async (tx, { kind, payload, iban, fileId }) => {
        // Dosya satırdan önce bağlanır: başkasının, başka kurumun ya da hazır olmayan dosyası 422
        // `file_unavailable` (bağlı dosya 409); öğretmen `document` amaçlı dosya yükleyemez.
        if (fileId !== null)
          await attachFile(tx, ctx, {
            fileId,
            attachedType: ATTACHMENT,
            attachedId: id,
            dataSubjectId: null,
          })
        await insertStaffChangeRequest(tx, ctx.institutionId, {
          id,
          membershipId: ctx.actor.membershipId,
          kind,
          payload,
          iban:
            iban === null ? null : deps.cipher.encrypt(ibanBinding(ctx.institutionId, id), iban),
          fileId,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_change_request.create', entity, [
          'kind',
          ...staffChangeFields(payload),
          ...(fileId === null ? [] : ['fileId']),
        ])
        body = await requestBody(tx, ctx, deps, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Bekleyen talebin sahibi ve sürümü (kurum kilidi altında). */
async function pendingRequest(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  owner: string | null,
) {
  const row = await findStaffChangeRequest(tx, ctx.institutionId, id)
  if (row === null || (owner !== null && row.membershipId !== owner)) throw new NotFoundError()
  if (row.version !== expectedVersion) throw new ConflictError()
  return row
}

/** Talebi kapatır, dosyanın talep bağını kaldırır (ret ve geri çekme) ve denetim yazar. */
async function closeRequest(
  tx: Database,
  ctx: ServiceContext,
  row: StoredStaffChangeRequest,
  expectedVersion: number,
  change: {
    status: 'approved' | 'rejected' | 'cancelled'
    action: string
    fields: string[]
    rejectionReason?: string
    staffDocumentId?: string
  },
) {
  const closed = await closeStaffChangeRequest(tx, ctx.institutionId, {
    id: row.id,
    expectedVersion,
    status: change.status,
    userId: ctx.actor.userId,
    rejectionReason: change.rejectionReason ?? null,
    staffDocumentId: change.staffDocumentId ?? null,
    now: ctx.now,
  })
  if (!closed) throw new ConflictError()
  // Reddedilen ya da geri çekilen talebin dosyası bağsız kalır; bağlanmamış dosya temizliği siler.
  if (change.status !== 'approved' && row.fileId !== null)
    await detachFile(tx, ctx, { fileId: row.fileId, attachedType: ATTACHMENT, attachedId: row.id })
  await auditWork(tx, ctx, change.action, { type: ENTITY, id: row.id }, change.fields)
}

/** Personelin bekleyen talebini geri çekmesi; başkasının talebi 404. `If-Match` talep sürümü. */
export function cancelOwnChangeRequestCommand(
  ctx: ServiceContext,
  deps: StaffSelfServiceDeps,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_change_request.cancel',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const row = await pendingRequest(tx, ctx, id, expectedVersion, ctx.actor.membershipId)
        return {
          run: () => {
            assertStaffChangePending(row.status)
            return row
          },
        }
      },
      after: async (tx, row) => {
        await closeRequest(tx, ctx, row, expectedVersion, {
          status: 'cancelled',
          action: 'finance.staff_change_request.cancel',
          fields: ['status'],
        })
        body = await requestBody(tx, ctx, deps, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Personelin kendi izin talebi (K-555): yönetici talebinin aynı kuralı (DOM-FIN-116), personel
 * oturumdan, yedek seçimi yok. `Idempotency-Key` zorunlu.
 */
export function createOwnLeaveRequestCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const parsed = myLeaveRequestInputSchema.parse(input)
  return createLeaveRequestCommand(
    ctx,
    { ...parsed, membershipId: ctx.actor.membershipId, substitutes: [] },
    idempotency,
  )
}

// --- Yazma: onay kuyruğu -------------------------------------------------------------------------

type ApprovalPlan =
  | {
      kind: 'file'
      stored: Awaited<ReturnType<typeof findPersonnelFile>>
      values: PersonnelFileValues
      changed: string[]
      row: StoredStaffChangeRequest
    }
  | {
      kind: 'document'
      prepared: Awaited<ReturnType<typeof prepareStaffDocument>>
      plan: ReturnType<Awaited<ReturnType<typeof prepareStaffDocument>>['plan']>
      row: StoredStaffChangeRequest
    }

/**
 * Onay (K-553): kart talebinde kart (yoksa açılır) birleşik kart kurallarından (DOM-FIN-140)
 * geçerek yazılır; belge talebinde özlük belgesi (DOM-FIN-113) kaydedilir ve dosya talepten
 * belgeye taşınır. Hepsi talebin kapanışıyla aynı transaction'da. `If-Match` talep sürümü.
 */
export function approveStaffChangeRequestCommand(
  ctx: ServiceContext,
  deps: StaffSelfServiceDeps,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_change_request.approve',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const row = await pendingRequest(tx, ctx, id, expectedVersion, null)
        const payload = payloadOf(row)
        const today = dayKey(ctx.now)
        if (payload.kind === 'document') {
          const prepared = await prepareStaffDocument(tx, ctx, {
            membershipId: row.membershipId,
            documentType: payload.documentType,
            healthReportKind: payload.healthReportKind,
            documentDate: payload.documentDate,
            fileId: row.fileId,
            note: payload.note,
          })
          return {
            run: (): ApprovalPlan => {
              assertStaffChangePending(row.status)
              return { kind: 'document', prepared, plan: prepared.plan(), row }
            },
          }
        }
        const update = staffChangeUpdate(payload, requestIban(deps, ctx.institutionId, row))
        const [staff, stored] = await Promise.all([
          findStaffMember(tx, ctx.institutionId, row.membershipId),
          findPersonnelFile(tx, ctx.institutionId, row.membershipId),
        ])
        const current = stored === null ? null : valuesOf(deps, ctx.institutionId, stored)
        return {
          run: (): ApprovalPlan => {
            assertStaffChangePending(row.status)
            if (update === null) throw new Error('file change without update')
            if (current === null) {
              const values = planPersonnelFile(
                'yonetici',
                { membershipId: row.membershipId, ...update },
                { staff, exists: false, today },
              )
              return {
                kind: 'file',
                stored,
                values,
                changed: changedPersonnelFileFields(EMPTY_PERSONNEL_FILE, values),
                row,
              }
            }
            const values = mergePersonnelFile(current, update)
            assertPersonnelFileValues(values, today)
            return {
              kind: 'file',
              stored,
              values,
              changed: changedPersonnelFileFields(current, values),
              row,
            }
          },
        }
      },
      after: async (tx, plan) => {
        const row = plan.row
        let staffDocumentId: string | undefined
        if (plan.kind === 'document') {
          staffDocumentId = randomUUID()
          await writeStaffDocument(tx, ctx, staffDocumentId, plan.prepared.parsed, plan.plan, {
            fileFrom: { type: ATTACHMENT, id: row.id },
          })
        } else {
          const columns = columnsOf(deps, ctx.institutionId, row.membershipId, plan.values)
          const fileEntity = { type: 'staff_personnel_files', id: row.membershipId }
          if (plan.stored === null) {
            await insertPersonnelFile(tx, ctx.institutionId, {
              membershipId: row.membershipId,
              columns,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
            await auditWork(tx, ctx, 'finance.personnel_file.create', fileEntity, plan.changed)
          } else if (plan.changed.length > 0) {
            const saved = await updatePersonnelFile(tx, ctx.institutionId, {
              membershipId: row.membershipId,
              columns,
              expectedVersion: plan.stored.version,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
            if (!saved) throw new ConflictError()
            await auditWork(tx, ctx, 'finance.personnel_file.update', fileEntity, plan.changed)
          }
        }
        await closeRequest(tx, ctx, row, expectedVersion, {
          status: 'approved',
          action: 'finance.staff_change_request.approve',
          fields: ['status', ...(staffDocumentId === undefined ? [] : ['staffDocumentId'])],
          ...(staffDocumentId === undefined ? {} : { staffDocumentId }),
        })
        body = await requestBody(tx, ctx, deps, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Gerekçeli ret (K-553); gerekçe personele gösterilir, denetime yazılmaz. `If-Match`. */
export function rejectStaffChangeRequestCommand(
  ctx: ServiceContext,
  deps: StaffSelfServiceDeps,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_change_request.reject',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const parsed = staffChangeRejectSchema.parse(input)
        const row = await pendingRequest(tx, ctx, id, expectedVersion, null)
        return {
          run: () => {
            assertStaffChangePending(row.status)
            return { row, reason: parsed.reason }
          },
        }
      },
      after: async (tx, { row, reason }) => {
        await closeRequest(tx, ctx, row, expectedVersion, {
          status: 'rejected',
          action: 'finance.staff_change_request.reject',
          fields: ['status', 'rejectionReason'],
          rejectionReason: reason,
        })
        body = await requestBody(tx, ctx, deps, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Dosya açma ----------------------------------------------------------------------------------

/**
 * Belge talebinin dosyası (onaydan önce inceleme): kısa ömürlü imzalı bağlantı. Her üretim
 * `finance.staff_change_request.file_open` denetimine yazılır; denetim yazılamazsa bağlantı dönmez.
 * Dosyasız talep 422 `staff_change_request_no_file`; başka kurumun talebi 404.
 */
export async function staffChangeRequestFileUrl(
  ctx: ServiceContext,
  storage: StorageDriver,
  id: string,
) {
  const row = await findStaffChangeRequest(ctx.db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  if (row.fileId === null)
    throw new RuleViolationError('staff_change_request_no_file', 'Bu talebe dosya eklenmemiş.')
  const opening: ServiceContext = { ...ctx }
  auditedOpens.add(opening)
  const link = await getFileUrl(opening, storage, row.fileId)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: FILE_OPEN_ACTION,
    entityType: ENTITY,
    entityId: row.id,
    // kvkk: dosya adı ve içerik değil, yalnız açılan alanın adı.
    changes: { fields: ['fileId'] },
    createdAt: ctx.now,
  })
  return { url: link.url, expiresAt: link.expiresAt }
}
