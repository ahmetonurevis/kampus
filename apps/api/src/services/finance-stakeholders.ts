import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  agreementSchedule,
  assertStakeholderTaxNumberFree,
  maskStakeholderContact,
  planStakeholderAgreement,
  planStakeholderAgreementActivate,
  planStakeholderAgreementArchive,
  planStakeholderAgreementTerminate,
  planStakeholderAgreementUpdate,
  planStakeholderUpdate,
  stakeholderAgreementSchema,
  stakeholderAgreementsCsv,
  stakeholderSchema,
  stakeholdersCsv,
  terminateStakeholderAgreementSchema,
  updateStakeholderAgreementSchema,
  updateStakeholderSchema,
  type StakeholderAgreementChanges,
  type StakeholderChanges,
} from '@kampus/school-core/lib/finance-stakeholders.ts'

import type { Database } from '../db/client.ts'
import { findFile } from '../db/files.ts'
import {
  agreementExists,
  findAgreement,
  findStakeholder,
  insertAgreement,
  insertStakeholder,
  isStakeholderTaxNumberTaken,
  listAgreements,
  listStakeholders,
  updateAgreement,
  updateStakeholder,
  type AgreementQuery,
  type AgreementWrite,
  type StakeholderListRow,
  type StakeholderQuery,
  type StoredAgreement,
} from '../db/finance-stakeholders.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Paydaş ve sponsor kaydı (DOM-FIN-102; ON-262). Kural core `lib/finance-stakeholders.ts`'tedir;
 * servis kurum kilidi altında VKN tekilliğini, paydaşın etkinliğini ve anlaşmanın durumunu yükler,
 * yazmaları tek transaction'da yapar. Anlaşmanın gösterilen durumu ve yenileme uyarısı her okumada
 * `agreementSchedule` ile `ctx.now`'dan hesaplanır (K-318, K-319). Sözleşme dosyası platform dosya
 * altyapısıyla (`attachFile`, amaç `document`) aynı transaction'da bağlanır. Listede iletişim
 * e-postası ve telefonu maskelidir (K-317). Denetim kaydına alan adları yazılır, değerler yazılmaz.
 * Rol ve modül denetimi rotadadır.
 */

const STAKEHOLDER_ENTITY = 'stakeholders'
const AGREEMENT_ENTITY = 'stakeholder_agreements'
/** Dosya bağ türü (ADR 0003 karar 5): sözleşme dosyası anlaşmaya bağlanır. */
export const AGREEMENT_FILE_ATTACHMENT = 'stakeholder_agreement'
const CSV_BATCH = 100

// --- Görünümler ----------------------------------------------------------------------------------

/** Liste satırı: e-posta ve telefon maskeli (K-317). */
function stakeholderListView(row: StakeholderListRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    taxNumber: row.taxNumber,
    contactName: row.contactName,
    ...maskStakeholderContact(row),
    tags: row.tags,
    isActive: row.isActive,
    activeAgreementCount: row.activeAgreementCount,
    renewalDueCount: row.renewalDueCount,
    version: row.version,
  }
}

function agreementView(agreement: StoredAgreement, today: string) {
  const schedule = agreementSchedule(agreement, today)
  return {
    id: agreement.id,
    stakeholder: {
      id: agreement.stakeholderId,
      name: agreement.stakeholderName,
      type: agreement.stakeholderType,
    },
    subject: agreement.subject,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    renewalNoticeDays: agreement.renewalNoticeDays,
    contributionType: agreement.contributionType,
    contributionAmountCents: agreement.contributionAmountCents,
    contributionDescription: agreement.contributionDescription,
    benefits: agreement.benefits,
    benefitNote: agreement.benefitNote,
    contractFileId: agreement.contractFileId,
    status: schedule.status,
    daysLeft: schedule.daysLeft,
    noticeDate: schedule.noticeDate,
    renewalDue: schedule.renewalDue,
    terminationDate: agreement.terminationDate,
    version: agreement.version,
  }
}

async function stakeholderOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findStakeholder(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

async function agreementOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findAgreement(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

/** Ayrıntı: fesih gerekçesi ve sözleşme dosyasının adı (silinmiş dosyada boş). */
async function agreementDetail(db: Database, ctx: ServiceContext, id: string) {
  const agreement = await agreementOf(db, ctx, id)
  const file =
    agreement.contractFileId === null
      ? null
      : await findFile(db, ctx.institutionId, agreement.contractFileId)
  return {
    ...agreementView(agreement, dayKey(ctx.now)),
    contractFile:
      file === null || file.status === 'deleted' || file.status === 'rejected'
        ? null
        : { id: file.id, name: file.originalName ?? 'sozlesme.pdf', byteSize: file.byteSize },
    activatedAt: agreement.activatedAt,
    terminationReason: agreement.terminationReason,
    terminatedAt: agreement.terminatedAt,
    createdAt: agreement.createdAt,
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

type StakeholderListQuery = Omit<StakeholderQuery, 'today'>
type AgreementListQuery = Omit<AgreementQuery, 'today'>

export async function listStakeholdersFor(ctx: ServiceContext, query: StakeholderListQuery) {
  const { items, total } = await listStakeholders(ctx.db, ctx.institutionId, {
    ...query,
    today: dayKey(ctx.now),
  })
  return { items: items.map(stakeholderListView), total }
}

/** Ayrıntı: tam iletişim bilgisi (yalnız yönetici, K-317). */
export async function getStakeholderFor(ctx: ServiceContext, id: string) {
  return stakeholderOf(ctx.db, ctx, id)
}

export async function listAgreementsFor(ctx: ServiceContext, query: AgreementListQuery) {
  const today = dayKey(ctx.now)
  const { items, total } = await listAgreements(ctx.db, ctx.institutionId, { ...query, today })
  return { items: items.map((item) => agreementView(item, today)), total }
}

export function getAgreementFor(ctx: ServiceContext, id: string) {
  return agreementDetail(ctx.db, ctx, id)
}

async function exportAudit(ctx: ServiceContext, action: string, entityType: string) {
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType,
    entityId: ctx.institutionId,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
}

async function allPages<T>(load: (page: number) => Promise<{ items: T[] }>): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; ; page += 1) {
    const batch = await load(page)
    rows.push(...batch.items)
    if (batch.items.length < CSV_BATCH) return rows
  }
}

/** Paydaş CSV'si (K-317): süzgeçle eşleşen bütün paydaşlar; iletişim kişisi dosyaya girmez. */
export async function stakeholdersCsvFor(
  ctx: ServiceContext,
  query: Omit<StakeholderListQuery, 'page' | 'pageSize'>,
): Promise<{ csv: string; filename: string }> {
  const rows = await allPages((page) =>
    listStakeholders(ctx.db, ctx.institutionId, {
      ...query,
      page,
      pageSize: CSV_BATCH,
      today: dayKey(ctx.now),
    }),
  )
  const csv = stakeholdersCsv(rows)
  await exportAudit(ctx, 'finance.stakeholder_export', STAKEHOLDER_ENTITY)
  return { csv, filename: `paydaslar-${dayKey(ctx.now)}.csv` }
}

/** Anlaşma CSV'si: süzgeçle eşleşen bütün anlaşmalar, listedeki sırayla. */
export async function agreementsCsvFor(
  ctx: ServiceContext,
  query: Omit<AgreementListQuery, 'page' | 'pageSize'>,
): Promise<{ csv: string; filename: string }> {
  const rows = await allPages((page) =>
    listAgreementsFor(ctx, { ...query, page, pageSize: CSV_BATCH }),
  )
  const csv = stakeholderAgreementsCsv(
    rows.map((row) => ({
      stakeholderName: row.stakeholder.name,
      stakeholderType: row.stakeholder.type,
      subject: row.subject,
      startDate: row.startDate,
      endDate: row.endDate,
      renewalNoticeDays: row.renewalNoticeDays,
      contributionType: row.contributionType,
      contributionAmountCents: row.contributionAmountCents,
      contributionDescription: row.contributionDescription,
      benefits: row.benefits,
      benefitNote: row.benefitNote,
      status: row.status,
      daysLeft: row.daysLeft,
      terminationDate: row.terminationDate,
    })),
  )
  await exportAudit(ctx, 'finance.stakeholder_agreement_export', AGREEMENT_ENTITY)
  return { csv, filename: `paydas-anlasmalari-${dayKey(ctx.now)}.csv` }
}

// --- Paydaş komutları ----------------------------------------------------------------------------

/** Yeni paydaş (K-316); VKN verilmişse kurumda tekil. 201. */
export function createStakeholderCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: STAKEHOLDER_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stakeholder.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = stakeholderSchema.parse(input)
        const taken =
          data.taxNumber !== null &&
          (await isStakeholderTaxNumberTaken(tx, ctx.institutionId, data.taxNumber))
        return {
          run: () => {
            assertStakeholderTaxNumberFree(taken)
            return data
          },
        }
      },
      after: async (tx, data) => {
        await insertStakeholder(tx, ctx.institutionId, {
          ...data,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        const fields = Object.entries(data)
          .filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))
          .map(([key]) => key)
        await auditWork(tx, ctx, 'stakeholder.create', entity, fields)
        body = { data: await stakeholderOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kısmi düzeltme ve pasifleştirme (K-316); başka paydaşın VKN'si 409. */
export function updateStakeholderCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: STAKEHOLDER_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stakeholder.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await stakeholderOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const changes = updateStakeholderSchema.parse(input)
        const taken =
          changes.taxNumber !== undefined &&
          changes.taxNumber !== null &&
          changes.taxNumber !== current.taxNumber &&
          (await isStakeholderTaxNumberTaken(tx, ctx.institutionId, changes.taxNumber, id))
        return {
          run: () => {
            const changed = planStakeholderUpdate(current, changes)
            assertStakeholderTaxNumberFree(taken)
            const write: Partial<StakeholderChanges> = {}
            for (const key of changed) Object.assign(write, { [key]: changes[key] })
            return { changed, write }
          },
        }
      },
      after: async (tx, { changed, write }) => {
        const saved = await updateStakeholder(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: write,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stakeholder.update', entity, changed)
        body = { data: await stakeholderOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Anlaşma komutları ---------------------------------------------------------------------------

/** Sözleşme dosyasını anlaşmaya bağlar; dosya yükleyen yöneticinin, hazır ve bağsız olmalıdır. */
const attachContract = (tx: Database, ctx: ServiceContext, agreementId: string, fileId: string) =>
  attachFile(tx, ctx, {
    fileId,
    attachedType: AGREEMENT_FILE_ATTACHMENT,
    attachedId: agreementId,
    dataSubjectId: null,
  })

const detachContract = (tx: Database, ctx: ServiceContext, agreementId: string, fileId: string) =>
  detachFile(tx, ctx, {
    fileId,
    attachedType: AGREEMENT_FILE_ATTACHMENT,
    attachedId: agreementId,
  })

/** Yeni anlaşma taslak olarak açılır (K-318); paydaş etkin olmalı. 201. */
export function createAgreementCommand(
  ctx: ServiceContext,
  stakeholderId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: AGREEMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stakeholder_agreement.create',
      collections: [],
      entity,
      load: async (tx) => {
        const stakeholder = await stakeholderOf(tx, ctx, stakeholderId)
        const data = stakeholderAgreementSchema.parse(input)
        return { run: () => planStakeholderAgreement(data, stakeholder) }
      },
      after: async (tx, data) => {
        // Dosya satırı yabancı anahtardır: önce bağlanır (başka kurumun ya da başkasının dosyası
        // 422 `file_unavailable`), sonra anlaşma yazılır.
        if (data.contractFileId !== null) await attachContract(tx, ctx, id, data.contractFileId)
        await insertAgreement(tx, ctx.institutionId, {
          ...data,
          id,
          stakeholderId,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        const fields = Object.entries(data)
          .filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))
          .map(([key]) => key)
        await auditWork(tx, ctx, 'stakeholder_agreement.create', entity, [
          'stakeholderId',
          ...fields,
        ])
        body = { data: await agreementDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Anlaşma düzeltmesi (K-318): feshedilmiş anlaşma değişmez; dosya değişince eski bağ kalkar. */
export function updateAgreementCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: AGREEMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stakeholder_agreement.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await agreementOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const changes = updateStakeholderAgreementSchema.parse(input)
        return {
          run: () => {
            const changed = planStakeholderAgreementUpdate(current, changes)
            const write: Partial<StakeholderAgreementChanges> = {}
            for (const key of changed) Object.assign(write, { [key]: changes[key] })
            return { changed, write: write as Partial<AgreementWrite>, current }
          },
        }
      },
      after: async (tx, { changed, write, current }) => {
        if (write.contractFileId !== undefined) {
          if (current.contractFileId !== null)
            await detachContract(tx, ctx, id, current.contractFileId)
          if (write.contractFileId !== null) await attachContract(tx, ctx, id, write.contractFileId)
        }
        const saved = await updateAgreement(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: write,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stakeholder_agreement.update', entity, changed)
        body = { data: await agreementDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yürürlüğe alma (K-318): taslaktan, etkin paydaşla. */
export function activateAgreementCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: AGREEMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stakeholder_agreement.activate',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await agreementOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const stakeholder = await stakeholderOf(tx, ctx, current.stakeholderId)
        return { run: () => planStakeholderAgreementActivate(current, stakeholder) }
      },
      after: async (tx) => {
        const saved = await updateAgreement(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: { status: 'active', activatedAt: ctx.now },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stakeholder_agreement.activate', entity, ['status'])
        body = { data: await agreementDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Fesih (K-318): gün ve gerekçe; gerekçe denetim kaydına yazılmaz. */
export function terminateAgreementCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: AGREEMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'stakeholder_agreement.terminate',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await agreementOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const data = terminateStakeholderAgreementSchema.parse(input)
        return {
          run: () => {
            planStakeholderAgreementTerminate(current, data, dayKey(ctx.now))
            return data
          },
        }
      },
      after: async (tx, data) => {
        const saved = await updateAgreement(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: {
            status: 'terminated',
            terminationDate: data.terminationDate,
            terminationReason: data.reason,
            terminatedAt: ctx.now,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stakeholder_agreement.terminate', entity, [
          'status',
          'terminationDate',
          'terminationReason',
        ])
        body = { data: await agreementDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Taslağın silinmesi (arşiv, K-318); bağlı dosyanın bağı kalkar. */
export function archiveAgreementCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: AGREEMENT_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'stakeholder_agreement.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await agreementOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => {
            planStakeholderAgreementArchive(current)
            return current
          },
        }
      },
      after: async (tx, current) => {
        if (current.contractFileId !== null)
          await detachContract(tx, ctx, id, current.contractFileId)
        const saved = await updateAgreement(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: { archivedAt: ctx.now },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'stakeholder_agreement.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}

/**
 * Anlaşmaya bağlı sözleşme dosyası anlaşmayı okuyabilene açılır (ADR 0003 karar 6): yalnız
 * yönetici, `finance` modülü açıkken ve anlaşma silinmemişken (K-317). PGlite tek bağlantılıdır:
 * okuma işlemin bağlantısıyla (`tx`) yapılır.
 */
defineFileAttachment(AGREEMENT_FILE_ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, agreementId) => {
    if (ctx.actor.role !== 'yonetici') return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    return agreementExists(tx, ctx.institutionId, agreementId)
  },
})
