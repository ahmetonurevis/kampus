import { and, asc, count, desc, eq, isNull, max, ne, or, sql } from 'drizzle-orm'

import type {
  DonationCampaignChanges,
  DonationCampaignStatus,
  DonationKind,
  DonationMethod,
  DonationPlan,
  DonorKind,
  DonorRelation,
} from '@kampus/school-core/lib/finance-donations.ts'

import type { Database } from './client.ts'
import {
  donationCampaigns,
  donations,
  donationSettings,
  donors,
} from './schema/finance-donations.ts'
import { bankAccounts } from './schema/payments.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Bağış kampanyası, bağışçı ve bağış deposu (DOM-FIN-097; ON-258); her sorgu kurum kapsamlıdır.
 * Toplanan tutar saklanmaz, geçerli nakdi bağışlardan toplanır. Makbuz numarası kurum kilidi
 * altında verilir; benzersiz indeks ikinci güvencedir. Yazmalar servisin kurum kilidi altındadır.
 */

// --- Kampanya ------------------------------------------------------------------------------------

export type StoredDonationCampaign = {
  id: string
  name: string
  purpose: string
  targetCents: number
  startsOn: string
  endsOn: string
  bankAccountId: string | null
  bankName: string | null
  bankIban: string | null
  status: DonationCampaignStatus
  openedAt: string | null
  closedAt: string | null
  createdAt: string
  version: number
}

export type CampaignTotals = {
  collectedCents: number
  inKindDeclaredCents: number
  donationCount: number
  inKindCount: number
}

const CAMPAIGN_COLUMNS = {
  id: donationCampaigns.id,
  name: donationCampaigns.name,
  purpose: donationCampaigns.purpose,
  targetCents: donationCampaigns.targetCents,
  startsOn: donationCampaigns.startsOn,
  endsOn: donationCampaigns.endsOn,
  bankAccountId: donationCampaigns.bankAccountId,
  bankName: bankAccounts.bankName,
  bankIban: bankAccounts.iban,
  status: donationCampaigns.status,
  openedAt: donationCampaigns.openedAt,
  closedAt: donationCampaigns.closedAt,
  createdAt: donationCampaigns.createdAt,
  version: donationCampaigns.version,
}
type CampaignRow = Omit<
  StoredDonationCampaign,
  'status' | 'openedAt' | 'closedAt' | 'createdAt'
> & {
  status: string
  openedAt: Date | null
  closedAt: Date | null
  createdAt: Date
}
const toCampaign = (row: CampaignRow): StoredDonationCampaign => ({
  ...row,
  status: row.status as DonationCampaignStatus,
  openedAt: row.openedAt?.toISOString() ?? null,
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const CAMPAIGN_ACCOUNT = and(
  eq(bankAccounts.institutionId, donationCampaigns.institutionId),
  eq(bankAccounts.id, donationCampaigns.bankAccountId),
)
const liveCampaign = (institutionId: string) =>
  and(eq(donationCampaigns.institutionId, institutionId), isNull(donationCampaigns.archivedAt))
const liveDonation = (institutionId: string) =>
  and(eq(donations.institutionId, institutionId), isNull(donations.archivedAt))

/** Kampanya başına geçerli bağış toplamları; iptal edilen bağış sayılmaz. */
function donationSums(db: Database, institutionId: string) {
  return db
    .select({
      campaignId: donations.campaignId,
      collected:
        sql<number>`coalesce(sum(${donations.amountCents}) filter (where ${donations.kind} = 'cash'), 0)::bigint`
          .mapWith(Number)
          .as('collected'),
      inKindValue:
        sql<number>`coalesce(sum(${donations.declaredValueCents}) filter (where ${donations.kind} = 'in_kind'), 0)::bigint`
          .mapWith(Number)
          .as('in_kind_value'),
      donationCount: count().as('donation_count'),
      inKindCount: sql<number>`count(*) filter (where ${donations.kind} = 'in_kind')`
        .mapWith(Number)
        .as('in_kind_count'),
    })
    .from(donations)
    .where(and(liveDonation(institutionId), isNull(donations.cancelledAt)))
    .groupBy(donations.campaignId)
    .as('donation_sums')
}

const totalsOf = (row: {
  collected: number | null
  inKindValue: number | null
  donationCount: number | null
  inKindCount: number | null
}): CampaignTotals => ({
  collectedCents: Number(row.collected ?? 0),
  inKindDeclaredCents: Number(row.inKindValue ?? 0),
  donationCount: Number(row.donationCount ?? 0),
  inKindCount: Number(row.inKindCount ?? 0),
})

async function campaignsWithTotals(
  db: Database,
  institutionId: string,
  where: ReturnType<typeof and>,
  page?: { limit: number; offset: number },
): Promise<(StoredDonationCampaign & CampaignTotals)[]> {
  const sums = donationSums(db, institutionId)
  const query = db
    .select({
      ...CAMPAIGN_COLUMNS,
      collected: sums.collected,
      inKindValue: sums.inKindValue,
      donationCount: sums.donationCount,
      inKindCount: sums.inKindCount,
    })
    .from(donationCampaigns)
    .leftJoin(bankAccounts, CAMPAIGN_ACCOUNT)
    .leftJoin(sums, eq(sums.campaignId, donationCampaigns.id))
    .where(where)
    // Açık kampanyalar önce, sonra taslak, en son kapananlar; aynı durumda yeni başlayan önce.
    .orderBy(
      sql`case ${donationCampaigns.status} when 'open' then 0 when 'draft' then 1 else 2 end`,
      desc(donationCampaigns.startsOn),
      asc(donationCampaigns.id),
    )
  const rows = page === undefined ? await query : await query.limit(page.limit).offset(page.offset)
  return rows.map(({ collected, inKindValue, donationCount, inKindCount, ...row }) => ({
    ...toCampaign(row),
    ...totalsOf({ collected, inKindValue, donationCount, inKindCount }),
  }))
}

export async function listDonationCampaigns(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: DonationCampaignStatus | undefined
  },
): Promise<{ items: (StoredDonationCampaign & CampaignTotals)[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    liveCampaign(institutionId),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(donationCampaigns.name)}, ${search}) > 0`,
    query.status === undefined ? undefined : eq(donationCampaigns.status, query.status),
  )
  const [totalRow] = await db.select({ total: count() }).from(donationCampaigns).where(where)
  const items = await campaignsWithTotals(db, institutionId, where, {
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  })
  return { items, total: totalRow?.total ?? 0 }
}

export async function findDonationCampaign(
  db: Database,
  institutionId: string,
  id: string,
): Promise<(StoredDonationCampaign & CampaignTotals) | null> {
  const [row] = await campaignsWithTotals(
    db,
    institutionId,
    and(liveCampaign(institutionId), eq(donationCampaigns.id, id)),
  )
  return row ?? null
}

/** Arşivlenmemiş kampanyaların adları; ad Türkçe küçük harfle tekildir. */
export function donationCampaignNames(
  db: Database,
  institutionId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: donationCampaigns.id, name: donationCampaigns.name })
    .from(donationCampaigns)
    .where(liveCampaign(institutionId))
}

export async function insertDonationCampaign(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    name: string
    purpose: string
    targetCents: number
    startsOn: string
    endsOn: string
    bankAccountId: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...campaign } = input
  await tx
    .insert(donationCampaigns)
    .values({ institutionId, ...campaign, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateDonationCampaign(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: DonationCampaignChanges
    status?: { to: 'open' | 'closed'; userId: string }
    now: Date
  },
): Promise<boolean> {
  const status =
    input.status === undefined
      ? {}
      : input.status.to === 'open'
        ? { status: 'open', openedAt: input.now, openedByUserId: input.status.userId }
        : { status: 'closed', closedAt: input.now, closedByUserId: input.status.userId }
  const rows = await tx
    .update(donationCampaigns)
    .set({
      ...input.changes,
      ...status,
      version: sql`${donationCampaigns.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveCampaign(institutionId),
        eq(donationCampaigns.id, input.id),
        eq(donationCampaigns.version, input.expectedVersion),
      ),
    )
    .returning({ id: donationCampaigns.id })
  return rows.length === 1
}

/** Kampanyanın geçerli bağışlarının en erken ve en geç günü; bağış yoksa `null`. */
export async function campaignDonationDays(
  db: Database,
  institutionId: string,
  campaignId: string,
): Promise<{ first: string; last: string } | null> {
  const [row] = await db
    .select({
      first: sql<string | null>`min(${donations.donatedOn})::text`,
      last: sql<string | null>`max(${donations.donatedOn})::text`,
    })
    .from(donations)
    .where(
      and(
        liveDonation(institutionId),
        eq(donations.campaignId, campaignId),
        isNull(donations.cancelledAt),
      ),
    )
  return row?.first == null || row.last == null ? null : { first: row.first, last: row.last }
}

/** Kurumun arşivlenmemiş banka hesaplarının kimlikleri. */
export async function activeBankAccountIds(
  db: Database,
  institutionId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.institutionId, institutionId), isNull(bankAccounts.archivedAt)))
  return new Set(rows.map((row) => row.id))
}

// --- Bağışçı -------------------------------------------------------------------------------------

export type StoredDonor = {
  id: string
  kind: DonorKind
  name: string
  identityNumber: string | null
  phone: string | null
  email: string | null
  address: string | null
  studentId: string | null
  relation: DonorRelation | null
  createdAt: string
  version: number
}

const DONOR_COLUMNS = {
  id: donors.id,
  kind: donors.kind,
  name: donors.name,
  identityNumber: donors.identityNumber,
  phone: donors.phone,
  email: donors.email,
  address: donors.address,
  studentId: donors.studentId,
  relation: donors.relation,
  createdAt: donors.createdAt,
  version: donors.version,
}
type DonorRow = Omit<StoredDonor, 'kind' | 'relation' | 'createdAt'> & {
  kind: string
  relation: string | null
  createdAt: Date
}
const toDonor = (row: DonorRow): StoredDonor => ({
  ...row,
  kind: row.kind as DonorKind,
  relation: row.relation as DonorRelation | null,
  createdAt: row.createdAt.toISOString(),
})
const liveDonor = (institutionId: string) =>
  and(eq(donors.institutionId, institutionId), isNull(donors.archivedAt))

/** Ada göre; `q` adda ya da kimlik numarasının son hanelerinde arar (tam numara eşleşmesi de). */
export async function listDonors(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{ items: StoredDonor[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    liveDonor(institutionId),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(donors.name)}, ${search}) > 0`,
          // Maskeli gösterimde son dört hane görünür; arama da yalnız o kadarını ya da tam numarayı bulur.
          /^\d{4}$/.test(search)
            ? sql`right(${donors.identityNumber}, 4) = ${search}`
            : eq(donors.identityNumber, search),
        ),
  )
  const [totalRow] = await db.select({ total: count() }).from(donors).where(where)
  const rows = await db
    .select(DONOR_COLUMNS)
    .from(donors)
    .where(where)
    .orderBy(asc(foldSql(donors.name)), asc(donors.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toDonor), total: totalRow?.total ?? 0 }
}

export async function findDonor(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredDonor | null> {
  const [row] = await db
    .select(DONOR_COLUMNS)
    .from(donors)
    .where(and(liveDonor(institutionId), eq(donors.id, id)))
    .limit(1)
  return row === undefined ? null : toDonor(row)
}

/** Kimlik numarası kurumun başka bir bağışçısında var mı. */
export async function donorIdentityTaken(
  db: Database,
  institutionId: string,
  identityNumber: string | null | undefined,
  exceptId?: string,
): Promise<boolean> {
  if (identityNumber === null || identityNumber === undefined) return false
  const [row] = await db
    .select({ id: donors.id })
    .from(donors)
    .where(
      and(
        liveDonor(institutionId),
        eq(donors.identityNumber, identityNumber),
        exceptId === undefined ? undefined : ne(donors.id, exceptId),
      ),
    )
    .limit(1)
  return row !== undefined
}

type DonorValues = {
  name: string
  identityNumber: string | null
  phone: string | null
  email: string | null
  address: string | null
  link: { studentId: string; relation: DonorRelation } | null
}
const linkColumns = (link: DonorValues['link']) => ({
  studentId: link?.studentId ?? null,
  relation: link?.relation ?? null,
})

export async function insertDonor(
  tx: Database,
  institutionId: string,
  input: DonorValues & { id: string; kind: DonorKind; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, link, ...donor } = input
  await tx
    .insert(donors)
    .values({ institutionId, ...donor, ...linkColumns(link), createdAt: now, updatedAt: now })
}

/** Verilen alanları yazar (`undefined` dokunulmaz); sürüm tutmazsa `false` (409). */
export async function updateDonor(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: Partial<DonorValues>; now: Date },
): Promise<boolean> {
  const { link, ...rest } = input.changes
  const values = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as Partial<Omit<DonorValues, 'link'>>
  const rows = await tx
    .update(donors)
    .set({
      ...values,
      ...(link === undefined ? {} : linkColumns(link)),
      version: sql`${donors.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveDonor(institutionId),
        eq(donors.id, input.id),
        eq(donors.version, input.expectedVersion),
      ),
    )
    .returning({ id: donors.id })
  return rows.length === 1
}

// --- Bağış ---------------------------------------------------------------------------------------

export type StoredDonation = {
  id: string
  campaignId: string
  donorId: string | null
  donorKind: DonorKind | null
  donorName: string | null
  donorIdentityNumber: string | null
  kind: DonationKind
  amountCents: number | null
  method: DonationMethod | null
  bankAccountId: string | null
  bankName: string | null
  bankIban: string | null
  reference: string | null
  description: string | null
  declaredValueCents: number | null
  donatedOn: string
  note: string | null
  receiptYear: number
  receiptNumber: number
  taxNotice: string | null
  createdAt: string
  cancelledAt: string | null
  cancelReason: string | null
  version: number
}

const DONATION_COLUMNS = {
  id: donations.id,
  campaignId: donations.campaignId,
  donorId: donations.donorId,
  donorKind: donations.donorKind,
  donorName: donations.donorName,
  donorIdentityNumber: donations.donorIdentityNumber,
  kind: donations.kind,
  amountCents: donations.amountCents,
  method: donations.method,
  bankAccountId: donations.bankAccountId,
  bankName: bankAccounts.bankName,
  bankIban: bankAccounts.iban,
  reference: donations.reference,
  description: donations.description,
  declaredValueCents: donations.declaredValueCents,
  donatedOn: donations.donatedOn,
  note: donations.note,
  receiptYear: donations.receiptYear,
  receiptNumber: donations.receiptNumber,
  taxNotice: donations.taxNotice,
  createdAt: donations.createdAt,
  cancelledAt: donations.cancelledAt,
  cancelReason: donations.cancelReason,
  version: donations.version,
}
type DonationRow = Omit<
  StoredDonation,
  'donorKind' | 'kind' | 'method' | 'createdAt' | 'cancelledAt'
> & {
  donorKind: string | null
  kind: string
  method: string | null
  createdAt: Date
  cancelledAt: Date | null
}
const toDonation = (row: DonationRow): StoredDonation => ({
  ...row,
  donorKind: row.donorKind as DonorKind | null,
  kind: row.kind as DonationKind,
  method: row.method as DonationMethod | null,
  createdAt: row.createdAt.toISOString(),
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
})
const DONATION_ACCOUNT = and(
  eq(bankAccounts.institutionId, donations.institutionId),
  eq(bankAccounts.id, donations.bankAccountId),
)

/** Kampanyanın bağışları; makbuz sırasıyla (en yeni önce). `page` yoksa hepsi (CSV). */
export async function listCampaignDonations(
  db: Database,
  institutionId: string,
  campaignId: string,
  page?: { page: number; pageSize: number },
): Promise<{ items: StoredDonation[]; total: number }> {
  const where = and(liveDonation(institutionId), eq(donations.campaignId, campaignId))
  const [totalRow] = await db.select({ total: count() }).from(donations).where(where)
  const query = db
    .select(DONATION_COLUMNS)
    .from(donations)
    .leftJoin(bankAccounts, DONATION_ACCOUNT)
    .where(where)
    .orderBy(desc(donations.receiptYear), desc(donations.receiptNumber))
  const rows =
    page === undefined
      ? await query
      : await query.limit(page.pageSize).offset((page.page - 1) * page.pageSize)
  return { items: rows.map(toDonation), total: totalRow?.total ?? 0 }
}

export async function findDonation(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredDonation | null> {
  const [row] = await db
    .select(DONATION_COLUMNS)
    .from(donations)
    .leftJoin(bankAccounts, DONATION_ACCOUNT)
    .where(and(liveDonation(institutionId), eq(donations.id, id)))
    .limit(1)
  return row === undefined ? null : toDonation(row)
}

/** Ardışık makbuz numarası kurum kilidi altında okunur; benzersiz indeks ikinci güvencedir. */
async function nextReceiptNumber(db: Database, institutionId: string, year: number) {
  const [row] = await db
    .select({ last: max(donations.receiptNumber) })
    .from(donations)
    .where(and(eq(donations.institutionId, institutionId), eq(donations.receiptYear, year)))
  return (row?.last ?? 0) + 1
}

export async function insertDonation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    campaignId: string
    plan: DonationPlan
    receiptYear: number
    recordedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, plan, ...rest } = input
  const receiptNumber = await nextReceiptNumber(tx, institutionId, input.receiptYear)
  await tx.insert(donations).values({
    institutionId,
    ...rest,
    ...plan,
    receiptNumber,
    createdAt: now,
    updatedAt: now,
  })
}

/** Bağışı iptal eder; sürüm tutmazsa ya da zaten iptalse `false` (409). */
export async function cancelDonation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; reason: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(donations)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.userId,
      cancelReason: input.reason,
      version: sql`${donations.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveDonation(institutionId),
        eq(donations.id, input.id),
        eq(donations.version, input.expectedVersion),
        isNull(donations.cancelledAt),
      ),
    )
    .returning({ id: donations.id })
  return rows.length === 1
}

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredDonationSettings {
  taxNoticeEnabled: boolean
  taxNoticeText: string | null
  version: number
}

const SETTINGS_COLUMNS = {
  taxNoticeEnabled: donationSettings.taxNoticeEnabled,
  taxNoticeText: donationSettings.taxNoticeText,
  version: donationSettings.version,
}

/** Satır yoksa varsayılan: ibare kapalı, sürüm 1 (`If-Match` 1'den başlar). */
export async function loadDonationSettings(
  db: Database,
  institutionId: string,
): Promise<StoredDonationSettings> {
  const [row] = await db
    .select(SETTINGS_COLUMNS)
    .from(donationSettings)
    .where(eq(donationSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { taxNoticeEnabled: false, taxNoticeText: null, version: 1 }
}

/** Sürüm koşulu tutmazsa `null`. İlk yazım satırı açar; varsayılanın sürümü 1, satırın 2. */
export async function saveDonationSettings(
  tx: Database,
  institutionId: string,
  input: {
    taxNoticeEnabled: boolean
    taxNoticeText: string | null
    expectedVersion: number
    now: Date
  },
): Promise<StoredDonationSettings | null> {
  const values = { taxNoticeEnabled: input.taxNoticeEnabled, taxNoticeText: input.taxNoticeText }
  const [updated] = await tx
    .update(donationSettings)
    .set({ ...values, version: sql`${donationSettings.version} + 1`, updatedAt: input.now })
    .where(
      and(
        eq(donationSettings.institutionId, institutionId),
        eq(donationSettings.version, input.expectedVersion),
      ),
    )
    .returning(SETTINGS_COLUMNS)
  if (updated) return updated
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(donationSettings)
    .values({ institutionId, ...values, version: 2, createdAt: input.now, updatedAt: input.now })
    .onConflictDoNothing()
    .returning(SETTINGS_COLUMNS)
  return created ?? null
}
