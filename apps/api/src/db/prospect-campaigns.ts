import { and, asc, count, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm'

import type { CampaignFunnelCampaign } from '@kampus/school-core/lib/enrollment-campaign-funnel.ts'
import type { CampaignChannel, CampaignRef } from '@kampus/school-core/lib/prospect-campaigns.ts'

import type { Database } from './client.ts'
import { campaignCodes } from './schema/prospect-campaigns.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Kampanya kodu deposu (DOM-KAY-041; ON-134). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/prospect-campaigns.ts`'tedir; depo yalnız okur ve yazar. Arşivli kampanya
 * listede ve kod aramasında yoktur; kod tekilliği ve rapor arşivlileri de görür.
 */

export type CampaignFields = {
  code: string
  name: string
  channel: CampaignChannel
  startDate: string
  endDate: string
  costCents: number | null
  isActive: boolean
}

export type StoredCampaign = CampaignFields & {
  id: string
  version: number
  createdAt: string
  updatedAt: string
}

const COLUMNS = {
  id: campaignCodes.id,
  code: campaignCodes.code,
  name: campaignCodes.name,
  channel: campaignCodes.channel,
  startDate: campaignCodes.startDate,
  endDate: campaignCodes.endDate,
  costCents: campaignCodes.costCents,
  isActive: campaignCodes.isActive,
  version: campaignCodes.version,
  createdAt: campaignCodes.createdAt,
  updatedAt: campaignCodes.updatedAt,
}

type Row = Omit<StoredCampaign, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }
const toCampaign = (row: Row): StoredCampaign => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(eq(campaignCodes.institutionId, institutionId), isNull(campaignCodes.archivedAt))

export async function findCampaign(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredCampaign | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(campaignCodes)
    .where(and(ofInstitution(institutionId), eq(campaignCodes.id, id)))
    .limit(1)
  return row === undefined ? null : toCampaign(row)
}

/** Adaya girilen kodun arşivlenmemiş kampanyası; kod saklanan (büyük harf) biçimdedir. */
export async function findCampaignByCode(
  db: Database,
  institutionId: string,
  code: string,
): Promise<CampaignRef | null> {
  const [row] = await db
    .select({
      id: campaignCodes.id,
      code: campaignCodes.code,
      isActive: campaignCodes.isActive,
      startDate: campaignCodes.startDate,
      endDate: campaignCodes.endDate,
    })
    .from(campaignCodes)
    .where(and(ofInstitution(institutionId), eq(campaignCodes.code, code)))
    .limit(1)
  return row ?? null
}

/** Kod kurumda (arşivliler dahil) kullanılıyor mu (K-288). */
export async function isCampaignCodeTaken(
  db: Database,
  institutionId: string,
  code: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: campaignCodes.id })
    .from(campaignCodes)
    .where(and(eq(campaignCodes.institutionId, institutionId), eq(campaignCodes.code, code)))
    .limit(1)
  return row !== undefined
}

export interface CampaignQuery {
  page: number
  pageSize: number
  q?: string | undefined
  /** `usable`: etkin ve bugün tarih aralığında; `active`/`inactive` etkinlik bayrağı. */
  status?: 'usable' | 'active' | 'inactive' | undefined
  channel?: CampaignChannel | undefined
  /** `usable` süzgecinin günü (Europe/Istanbul). */
  today: string
}

/** Kampanyalar, en yeni başlangıç önce, sonra koda göre. */
export async function listCampaigns(
  db: Database,
  institutionId: string,
  query: CampaignQuery,
): Promise<{ items: StoredCampaign[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const statusFilter: SQL | undefined =
    query.status === 'usable'
      ? and(
          eq(campaignCodes.isActive, true),
          lte(campaignCodes.startDate, query.today),
          gte(campaignCodes.endDate, query.today),
        )
      : query.status === undefined
        ? undefined
        : eq(campaignCodes.isActive, query.status === 'active')
  const where = and(
    ofInstitution(institutionId),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(campaignCodes.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(campaignCodes.code)}, ${search}) > 0`,
        ),
    statusFilter,
    query.channel === undefined ? undefined : eq(campaignCodes.channel, query.channel),
  )
  const [totalRow] = await db.select({ total: count() }).from(campaignCodes).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(campaignCodes)
    .where(where)
    .orderBy(desc(campaignCodes.startDate), asc(campaignCodes.code))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toCampaign), total: totalRow?.total ?? 0 }
}

/**
 * Raporun kampanyaları: kurumun bütün kampanyaları, arşivliler dahil (kurumda onlarca satır).
 * Hangisinin satır alacağına core `campaignFunnel` karar verir: adayı olan her kampanya ve aralıkla
 * kesişen arşivlenmemiş kampanya.
 */
export async function loadFunnelCampaigns(
  db: Database,
  institutionId: string,
): Promise<CampaignFunnelCampaign[]> {
  const rows = await db
    .select({
      id: campaignCodes.id,
      code: campaignCodes.code,
      name: campaignCodes.name,
      channel: campaignCodes.channel,
      startDate: campaignCodes.startDate,
      endDate: campaignCodes.endDate,
      costCents: campaignCodes.costCents,
      isActive: campaignCodes.isActive,
      archivedAt: campaignCodes.archivedAt,
    })
    .from(campaignCodes)
    .where(eq(campaignCodes.institutionId, institutionId))
  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }))
}

export async function insertCampaign(
  tx: Database,
  institutionId: string,
  input: CampaignFields & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(campaignCodes)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateCampaign(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<Omit<CampaignFields, 'code'>>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(campaignCodes)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(campaignCodes.id, input.id),
        eq(campaignCodes.version, input.expectedVersion),
      ),
    )
    .returning({ id: campaignCodes.id })
  return rows.length === 1
}

/** Arşivler; sürüm tutmazsa `false` (409). */
export async function archiveCampaign(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(campaignCodes)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(campaignCodes.id, input.id),
        eq(campaignCodes.version, input.expectedVersion),
      ),
    )
    .returning({ id: campaignCodes.id })
  return rows.length === 1
}
