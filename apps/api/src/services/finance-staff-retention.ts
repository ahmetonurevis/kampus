import { randomUUID } from 'node:crypto'

import {
  planStaffDataDestruction,
  resolveStaffRetentionPolicy,
  separationDayOf,
  STAFF_RETENTION_CATEGORIES,
  STAFF_RETENTION_CATEGORY_SPECS,
  STAFF_RETENTION_MONTHS_MAX,
  staffDataDestructionInputSchema,
  staffRetentionCandidates,
  staffRetentionPolicyUpdateSchema,
  type StaffRetentionCategory,
  type StaffRetentionPolicy,
  type StaffRetentionStatus,
} from '@kampus/school-core/lib/finance-staff-retention.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  countStaffRetentionRecords,
  destroyStaffCategory,
  findRetentionMember,
  findStaffDataDestruction,
  insertStaffDataDestruction,
  listDepartedStaff,
  listStaffDataDestructions,
  loadStaffRetentionSettings,
  upsertStaffRetentionSettings,
} from '../db/finance-staff-retention.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { scheduleDocumentPurge } from './enrollment-document-links.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel özlük verisinin saklanması ve imhası (DOM-FIN-122; ON-176; KVKK IST-021). Kural core
 * `lib/finance-staff-retention.ts`'tedir; servis kurum kilidi altında üyeliği, politikayı ve
 * kategori kayıt sayısını okur, imhayı ve imha kaydını aynı transaction'da yazar. Dosyalar platform
 * deseniyle imha edilir: saklama sonu "şimdi"ye çekilir (`scheduleDocumentPurge`), nesneyi günlük
 * `files.purge-expired` işi siler. Arka plan otomatik imhası yoktur; imha yalnız yöneticinin onayıyla
 * (taze oturum) olur (K-417). İmha kaydına ve denetime personelin kimliği yazılmaz. Rol, modül ve
 * taze oturum denetimi rotadadır.
 */

const SETTINGS_ENTITY = 'staff_retention_settings'
const DESTRUCTION_ENTITY = 'staff_data_destructions'

async function policyOf(db: Database, institutionId: string): Promise<StaffRetentionPolicy> {
  const { stored } = await loadStaffRetentionSettings(db, institutionId)
  return resolveStaffRetentionPolicy(stored)
}

async function policyBody(db: Database, institutionId: string) {
  const { stored, updatedAt } = await loadStaffRetentionSettings(db, institutionId)
  const policy = resolveStaffRetentionPolicy(stored)
  return STAFF_RETENTION_CATEGORIES.map((category) => {
    const spec = STAFF_RETENTION_CATEGORY_SPECS[category]
    return {
      category,
      retentionMonths: policy[category].retentionMonths,
      legalMinimumMonths: spec.legalMinimumMonths,
      maximumMonths: STAFF_RETENTION_MONTHS_MAX,
      startEvent: spec.startEvent,
      method: spec.method,
      special: spec.special,
      customized: policy[category].customized,
      updatedAt: updatedAt[category] ?? null,
    }
  })
}

export async function getStaffRetentionPolicyFor(ctx: ServiceContext) {
  return policyBody(ctx.db, ctx.institutionId)
}

/** Kategori sürelerini yazar (K-415); yasal en az sürenin altı şemada 400. */
export function updateStaffRetentionPolicyCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS_ENTITY, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_retention.update',
      collections: [],
      entity,
      load: () => Promise.resolve({ run: () => staffRetentionPolicyUpdateSchema.parse(input) }),
      after: async (tx, update) => {
        const settings: Partial<Record<StaffRetentionCategory, number | null>> = {}
        for (const category of STAFF_RETENTION_CATEGORIES) {
          const entry = update[category]
          if (entry !== undefined) settings[category] = entry.retentionMonths
        }
        await upsertStaffRetentionSettings(tx, ctx.institutionId, {
          settings,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_retention.update', entity, Object.keys(settings))
        body = { data: await policyBody(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * İmha adayları (K-415): pasifleştirilmiş personel × kayıt bulunan kategori; süresi dolanlar önce.
 * `status` `due` (imha edilebilir) ya da `waiting`; ad araması ve kategori süzgeci. Sayfalama
 * hesaplanmış liste üzerindedir (ayrılmış personel sayısı küçüktür).
 */
export async function listStaffRetentionCandidatesFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    category?: StaffRetentionCategory | undefined
    status?: StaffRetentionStatus | undefined
  },
) {
  const today = dayKey(ctx.now)
  const policy = await policyOf(ctx.db, ctx.institutionId)
  const staff = await listDepartedStaff(ctx.db, ctx.institutionId, query.q)
  const counts = await countStaffRetentionRecords(
    ctx.db,
    ctx.institutionId,
    staff.map((member) => member.membershipId),
    query.category === undefined ? STAFF_RETENTION_CATEGORIES : [query.category],
  )
  const rows = staffRetentionCandidates(
    staff.map((member) => ({
      membershipId: member.membershipId,
      name: member.name,
      role: member.role,
      separationDay: separationDayOf(member.deactivatedAt),
    })),
    counts,
    policy,
    today,
    { status: query.status, category: query.category },
  )
  const start = (query.page - 1) * query.pageSize
  return {
    items: rows.slice(start, start + query.pageSize).map(({ separationDay, dueDay, ...row }) => ({
      ...row,
      separationDate: separationDay,
      dueDate: dueDay,
      method: STAFF_RETENTION_CATEGORY_SPECS[row.category].method,
      special: STAFF_RETENTION_CATEGORY_SPECS[row.category].special,
    })),
    total: rows.length,
  }
}

export async function listStaffDataDestructionsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; category?: StaffRetentionCategory | undefined },
) {
  return listStaffDataDestructions(ctx.db, ctx.institutionId, query)
}

/**
 * Onaylı imha (K-416, K-417): tek personel × kategori. Kurum kilidi altında üyelik, politika ve
 * kategori kayıt sayısı okunur, core planı denetler (başka kurum ya da personel olmayan 404, etkin
 * personel, süresi dolmamış ve kayıtsız kategori 422). Satırlar silinir, dosyaları imhaya işaretlenir,
 * imha kaydı ve `finance.staff_data.destroy` denetimi aynı transaction'da yazılır. 201.
 */
export function destroyStaffDataCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DESTRUCTION_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_data.destroy',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffDataDestructionInputSchema.parse(input)
        const member = await findRetentionMember(tx, ctx.institutionId, parsed.membershipId)
        const policy = await policyOf(tx, ctx.institutionId)
        const counts =
          member === null
            ? new Map()
            : await countStaffRetentionRecords(
                tx,
                ctx.institutionId,
                [parsed.membershipId],
                [parsed.category],
              )
        const recordCount = counts.get(parsed.membershipId)?.[parsed.category] ?? 0
        return {
          run: () => ({
            parsed,
            plan: planStaffDataDestruction(parsed, {
              member,
              policy,
              recordCount,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        const destroyed = await destroyStaffCategory(
          tx,
          ctx.institutionId,
          parsed.membershipId,
          plan.category,
        )
        // Sayım ve silme aynı kurum kilidi altındadır; fark programlama hatasıdır.
        if (destroyed.recordCount !== plan.recordCount) throw new ConflictError()
        for (const fileId of destroyed.fileIds)
          await scheduleDocumentPurge(tx, ctx, fileId, ctx.now)
        await insertStaffDataDestruction(tx, ctx.institutionId, {
          id,
          category: plan.category,
          method: plan.method,
          recordCount: destroyed.recordCount,
          fileCount: destroyed.fileIds.length,
          retentionMonths: plan.retentionMonths,
          startEvent: plan.startEvent,
          destroyedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        // kvkk: denetime personel kimliği değil, imha kaydı ve alan adları yazılır.
        await auditWork(tx, ctx, 'finance.staff_data.destroy', entity, [
          'category',
          'recordCount',
          'fileCount',
        ])
        ctx.log.info({
          event: 'finance.staff_data_destroyed',
          category: plan.category,
          method: plan.method,
          recordCount: destroyed.recordCount,
          fileCount: destroyed.fileIds.length,
        })
        const saved = await findStaffDataDestruction(tx, ctx.institutionId, id)
        if (saved === null) throw new NotFoundError()
        body = { data: saved }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}
