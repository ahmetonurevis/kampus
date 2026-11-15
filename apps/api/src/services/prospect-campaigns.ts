import { randomUUID } from 'node:crypto'

import {
  campaignFunnel,
  campaignFunnelCsv,
  type CampaignFunnelRange,
} from '@kampus/school-core/lib/enrollment-campaign-funnel.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  assertCampaignCodeFree,
  assertCampaignDates,
  campaignStatus,
  createCampaignSchema,
  updateCampaignSchema,
} from '@kampus/school-core/lib/prospect-campaigns.ts'

import type { Database } from '../db/client.ts'
import { loadFunnelProspects } from '../db/enrollment-funnel.ts'
import {
  archiveCampaign,
  findCampaign,
  insertCampaign,
  isCampaignCodeTaken,
  listCampaigns,
  loadFunnelCampaigns,
  updateCampaign,
  type CampaignQuery,
  type StoredCampaign,
} from '../db/prospect-campaigns.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Kampanya kodu (docs/domain/kayit-ve-crm.md DOM-KAY-041; ON-134). Kural core
 * `lib/prospect-campaigns.ts` ve `lib/enrollment-campaign-funnel.ts`'tedir; servis kurum kilidi
 * altında kod tekilliğini denetler ve aynı transaction'da yazar. Denetim kaydına alan adları
 * yazılır. Rol ve modül denetimi rotadadır. Adaya bağ aday işleminde kurulur (`services/prospects.ts`).
 */

const ENTITY = 'campaign_codes'

const view = (campaign: StoredCampaign, today: string) => ({
  ...campaign,
  status: campaignStatus(campaign, today),
})

async function campaignOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findCampaign(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

export async function listCampaignsFor(ctx: ServiceContext, query: Omit<CampaignQuery, 'today'>) {
  const today = dayKey(ctx.now)
  const { items, total } = await listCampaigns(ctx.db, ctx.institutionId, { ...query, today })
  return { items: items.map((item) => view(item, today)), total }
}

export async function getCampaignFor(ctx: ServiceContext, id: string) {
  return view(await campaignOf(ctx.db, ctx, id), dayKey(ctx.now))
}

const campaignBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: view(await campaignOf(tx, ctx, id), dayKey(ctx.now)),
})

/** Yeni kampanya kodu; kod kurumda (arşivliler dahil) tekil (K-288). 201. */
export function createCampaignCommand(
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
      action: 'campaign.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = createCampaignSchema.parse(input)
        const taken = await isCampaignCodeTaken(tx, ctx.institutionId, data.code)
        return {
          run: () => {
            assertCampaignCodeFree(taken)
            return data
          },
        }
      },
      after: async (tx, data) => {
        await insertCampaign(tx, ctx.institutionId, {
          id,
          code: data.code,
          name: data.name,
          channel: data.channel,
          startDate: data.startDate,
          endDate: data.endDate,
          costCents: data.costCents ?? null,
          isActive: data.isActive,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'campaign.create', entity, Object.keys(data))
        body = await campaignBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kısmi düzeltme ve pasifleştirme; kod değişmez. Birleşik tarihler sıralı olmalı (422). */
export function updateCampaignCommand(
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
      action: 'campaign.update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = updateCampaignSchema.parse(input)
        const current = await campaignOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => {
            assertCampaignDates(
              changes.startDate ?? current.startDate,
              changes.endDate ?? current.endDate,
            )
            return changes
          },
        }
      },
      after: async (tx, changes) => {
        const saved = await updateCampaign(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'campaign.update', entity, Object.keys(changes))
        body = await campaignBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Arşivler: kod yeni adaya bağlanmaz, adayları raporda kalır. 200. */
export function archiveCampaignCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'campaign.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await campaignOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await archiveCampaign(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'campaign.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

/**
 * Kayıt hunisinin kampanya kırılımı (DOM-KAY-041): aralıkta açılan adaylar (açılış günü,
 * Europe/Istanbul) ve kurumun kampanyaları. Yanıt aday adı, iletişim bilgisi ve kimliği taşımaz.
 */
export async function campaignFunnelFor(ctx: ServiceContext, range: CampaignFunnelRange) {
  const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  const prospects = await loadFunnelProspects(
    ctx.db,
    ctx.institutionId,
    dayRange('createdAt', range.dateFrom, range.dateTo),
  )
  const campaigns = await loadFunnelCampaigns(ctx.db, ctx.institutionId)
  const funnel = campaignFunnel(prospects, campaigns, institution.type, range)
  return {
    dateFrom: range.dateFrom ?? null,
    dateTo: range.dateTo ?? null,
    ...funnel,
  }
}

export async function campaignFunnelCsvFor(ctx: ServiceContext, range: CampaignFunnelRange) {
  const report = await campaignFunnelFor(ctx, range)
  const span = [report.dateFrom ?? 'baslangic', report.dateTo ?? dayKey(ctx.now)].join('-')
  return { csv: campaignFunnelCsv(report), filename: `kampanya-hunisi-${span}.csv` }
}
