import { and, asc, count, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm'

import type {
  AgreementBenefit,
  AgreementStatus,
  AgreementViewStatus,
  ContributionType,
  StakeholderFields,
  StakeholderType,
} from '@kampus/school-core/lib/finance-stakeholders.ts'

import type { Database } from './client.ts'
import { stakeholderAgreements, stakeholders } from './schema/finance-stakeholders.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Paydaş ve anlaşma deposu (DOM-FIN-102; ON-262). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-stakeholders.ts`'tedir; depo okur ve yazar, maskeyi ve
 * hesaplanan durumu servis uygular. Liste süzgeçleri core `agreementSchedule` ile aynı sınırları
 * kullanır: bitiş günü dahil, "sona erdi" = yürürlükte ve bitiş < bugün.
 */

export type StoredStakeholder = StakeholderFields & {
  id: string
  isActive: boolean
  version: number
  createdAt: string
}

const STAKEHOLDER_COLUMNS = {
  id: stakeholders.id,
  name: stakeholders.name,
  type: stakeholders.type,
  taxNumber: stakeholders.taxNumber,
  contactName: stakeholders.contactName,
  contactEmail: stakeholders.contactEmail,
  contactPhone: stakeholders.contactPhone,
  tags: stakeholders.tags,
  isActive: stakeholders.isActive,
  version: stakeholders.version,
  createdAt: stakeholders.createdAt,
}

type StakeholderRow = Omit<StoredStakeholder, 'createdAt'> & { createdAt: Date }
const toStakeholder = (row: StakeholderRow): StoredStakeholder => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

const stakeholderOf = (institutionId: string) =>
  and(eq(stakeholders.institutionId, institutionId), isNull(stakeholders.archivedAt))
const agreementOf = (institutionId: string) =>
  and(
    eq(stakeholderAgreements.institutionId, institutionId),
    isNull(stakeholderAgreements.archivedAt),
  )

/** Yürürlükte ve bitiş günü geçmemiş (bitiş günü dahil). */
const inForce = (today: string) =>
  sql`${stakeholderAgreements.status} = 'active' and ${stakeholderAgreements.endDate} >= ${today}::date`
/** Yenileme uyarısında: yürürlükte, bitmemiş ve kalan gün bildirim gününe eşit ya da az (K-319). */
const renewalDue = (today: string) =>
  sql`${inForce(today)} and ${stakeholderAgreements.endDate} - ${today}::date <= ${stakeholderAgreements.renewalNoticeDays}`

export async function findStakeholder(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStakeholder | null> {
  const [row] = await db
    .select(STAKEHOLDER_COLUMNS)
    .from(stakeholders)
    .where(and(stakeholderOf(institutionId), eq(stakeholders.id, id)))
    .limit(1)
  return row === undefined ? null : toStakeholder(row)
}

/** VKN başka bir paydaşta (pasif dahil) kullanılıyor mu; düzeltmede kendisi dışlanır. */
export async function isStakeholderTaxNumberTaken(
  db: Database,
  institutionId: string,
  taxNumber: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: stakeholders.id })
    .from(stakeholders)
    .where(
      and(
        stakeholderOf(institutionId),
        eq(stakeholders.taxNumber, taxNumber),
        exceptId === undefined ? undefined : sql`${stakeholders.id} <> ${exceptId}`,
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface StakeholderQuery {
  page: number
  pageSize: number
  today: string
  q?: string | undefined
  type?: StakeholderType | undefined
  status?: 'active' | 'inactive' | undefined
  tag?: string | undefined
  /** Yalnız yenileme uyarısında anlaşması olanlar. */
  renewalDue?: boolean | undefined
}

export type StakeholderListRow = StoredStakeholder & {
  activeAgreementCount: number
  renewalDueCount: number
}

/** Paydaşlar: etkinler önce, ada göre; yürürlükteki ve uyarıdaki anlaşma sayılarıyla. */
export async function listStakeholders(
  db: Database,
  institutionId: string,
  query: StakeholderQuery,
): Promise<{ items: StakeholderListRow[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  // İlişkili alt sorgu: dış tablo adı açık yazılır (Drizzle tek tablolu sorguda kolonu tablo
  // adısız yazar, alt sorguda iç tabloya bağlanırdı). Sınırlar `inForce`/`renewalDue` ile aynıdır.
  const agreementCount = (onlyRenewalDue: boolean) =>
    sql<number>`(select count(*)::int from "stakeholder_agreements" sa
      where sa.institution_id = "stakeholders"."institution_id"
        and sa.stakeholder_id = "stakeholders"."id"
        and sa.archived_at is null and sa.status = 'active' and sa.end_date >= ${query.today}::date
        ${onlyRenewalDue ? sql`and sa.end_date - ${query.today}::date <= sa.renewal_notice_days` : sql``})`
  const where = and(
    stakeholderOf(institutionId),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(stakeholders.name)}, ${search}) > 0`,
          sql`strpos(${stakeholders.taxNumber}, ${search}) > 0`,
          sql`strpos(${foldSql(sql`coalesce(${stakeholders.contactName}, '')`)}, ${search}) > 0`,
        ),
    query.type === undefined ? undefined : eq(stakeholders.type, query.type),
    query.status === undefined ? undefined : eq(stakeholders.isActive, query.status === 'active'),
    query.tag === undefined ? undefined : sql`${query.tag} = any(${stakeholders.tags})`,
    query.renewalDue === true ? sql`${agreementCount(true)} > 0` : undefined,
  )
  const [totalRow] = await db.select({ total: count() }).from(stakeholders).where(where)
  const rows = await db
    .select({
      ...STAKEHOLDER_COLUMNS,
      activeAgreementCount: agreementCount(false),
      renewalDueCount: agreementCount(true),
    })
    .from(stakeholders)
    .where(where)
    .orderBy(desc(stakeholders.isActive), asc(foldSql(stakeholders.name)), asc(stakeholders.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({
      ...toStakeholder(row),
      activeAgreementCount: Number(row.activeAgreementCount),
      renewalDueCount: Number(row.renewalDueCount),
    })),
    total: totalRow?.total ?? 0,
  }
}

export async function insertStakeholder(
  tx: Database,
  institutionId: string,
  input: StakeholderFields & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(stakeholders).values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateStakeholder(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<StakeholderFields> & { isActive?: boolean }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(stakeholders)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        stakeholderOf(institutionId),
        eq(stakeholders.id, input.id),
        eq(stakeholders.version, input.expectedVersion),
      ),
    )
    .returning({ id: stakeholders.id })
  return rows.length === 1
}

// --- Anlaşma -------------------------------------------------------------------------------------

export interface StoredAgreement {
  id: string
  stakeholderId: string
  stakeholderName: string
  stakeholderType: StakeholderType
  subject: string
  startDate: string
  endDate: string
  renewalNoticeDays: number
  contributionType: ContributionType
  contributionAmountCents: number | null
  contributionDescription: string | null
  benefits: AgreementBenefit[]
  benefitNote: string | null
  contractFileId: string | null
  status: AgreementStatus
  activatedAt: string | null
  terminationDate: string | null
  terminationReason: string | null
  terminatedAt: string | null
  version: number
  createdAt: string
}

const AGREEMENT_COLUMNS = {
  id: stakeholderAgreements.id,
  stakeholderId: stakeholderAgreements.stakeholderId,
  stakeholderName: stakeholders.name,
  stakeholderType: stakeholders.type,
  subject: stakeholderAgreements.subject,
  startDate: stakeholderAgreements.startDate,
  endDate: stakeholderAgreements.endDate,
  renewalNoticeDays: stakeholderAgreements.renewalNoticeDays,
  contributionType: stakeholderAgreements.contributionType,
  contributionAmountCents: stakeholderAgreements.contributionAmountCents,
  contributionDescription: stakeholderAgreements.contributionDescription,
  benefits: stakeholderAgreements.benefits,
  benefitNote: stakeholderAgreements.benefitNote,
  contractFileId: stakeholderAgreements.contractFileId,
  status: stakeholderAgreements.status,
  activatedAt: stakeholderAgreements.activatedAt,
  terminationDate: stakeholderAgreements.terminationDate,
  terminationReason: stakeholderAgreements.terminationReason,
  terminatedAt: stakeholderAgreements.terminatedAt,
  version: stakeholderAgreements.version,
  createdAt: stakeholderAgreements.createdAt,
}

type AgreementRow = Omit<StoredAgreement, 'activatedAt' | 'terminatedAt' | 'createdAt'> & {
  activatedAt: Date | null
  terminatedAt: Date | null
  createdAt: Date
}
const toAgreement = (row: AgreementRow): StoredAgreement => ({
  ...row,
  activatedAt: row.activatedAt?.toISOString() ?? null,
  terminatedAt: row.terminatedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const withStakeholder = and(
  eq(stakeholders.institutionId, stakeholderAgreements.institutionId),
  eq(stakeholders.id, stakeholderAgreements.stakeholderId),
)

export async function findAgreement(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredAgreement | null> {
  const [row] = await db
    .select(AGREEMENT_COLUMNS)
    .from(stakeholderAgreements)
    .innerJoin(stakeholders, withStakeholder)
    .where(and(agreementOf(institutionId), eq(stakeholderAgreements.id, id)))
    .limit(1)
  return row === undefined ? null : toAgreement(row)
}

export interface AgreementQuery {
  page: number
  pageSize: number
  today: string
  stakeholderId?: string | undefined
  status?: AgreementViewStatus | undefined
  /** Bitişi bugün dahil N gün içinde olan yürürlükteki anlaşmalar. */
  expiringWithinDays?: number | undefined
  /** Yenileme uyarısındakiler (bildirim penceresi, K-319). */
  renewalDue?: boolean | undefined
  q?: string | undefined
}

function statusCondition(status: AgreementViewStatus, today: string): SQL {
  switch (status) {
    case 'draft':
    case 'terminated':
      return eq(stakeholderAgreements.status, status)
    case 'active':
      return inForce(today)
    case 'ended':
      return sql`${stakeholderAgreements.status} = 'active' and ${stakeholderAgreements.endDate} < ${today}::date`
    default:
      return status satisfies never
  }
}

/**
 * Anlaşmalar. Bitiş süzgecinde (`expiringWithinDays`, `renewalDue`) bitişi en yakın önce; diğer
 * listelerde yeni başlangıç önce.
 */
export async function listAgreements(
  db: Database,
  institutionId: string,
  query: AgreementQuery,
): Promise<{ items: StoredAgreement[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    agreementOf(institutionId),
    query.stakeholderId === undefined
      ? undefined
      : eq(stakeholderAgreements.stakeholderId, query.stakeholderId),
    query.status === undefined ? undefined : statusCondition(query.status, query.today),
    query.expiringWithinDays === undefined
      ? undefined
      : sql`${inForce(query.today)} and ${stakeholderAgreements.endDate} - ${query.today}::date <= ${query.expiringWithinDays}`,
    query.renewalDue === true ? renewalDue(query.today) : undefined,
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(stakeholderAgreements.subject)}, ${search}) > 0`,
          sql`strpos(${foldSql(stakeholders.name)}, ${search}) > 0`,
        ),
  )
  const byEnd = query.expiringWithinDays !== undefined || query.renewalDue === true
  const [totalRow] = await db
    .select({ total: count() })
    .from(stakeholderAgreements)
    .innerJoin(stakeholders, withStakeholder)
    .where(where)
  const rows = await db
    .select(AGREEMENT_COLUMNS)
    .from(stakeholderAgreements)
    .innerJoin(stakeholders, withStakeholder)
    .where(where)
    .orderBy(
      ...(byEnd
        ? [asc(stakeholderAgreements.endDate)]
        : [desc(stakeholderAgreements.startDate), desc(stakeholderAgreements.createdAt)]),
      asc(stakeholderAgreements.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toAgreement), total: totalRow?.total ?? 0 }
}

export type AgreementWrite = {
  subject: string
  startDate: string
  endDate: string
  renewalNoticeDays: number
  contributionType: ContributionType
  contributionAmountCents: number | null
  contributionDescription: string | null
  benefits: AgreementBenefit[]
  benefitNote: string | null
  contractFileId: string | null
}

export async function insertAgreement(
  tx: Database,
  institutionId: string,
  input: AgreementWrite & {
    id: string
    stakeholderId: string
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(stakeholderAgreements)
    .values({ ...fields, institutionId, status: 'draft', createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateAgreement(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<AgreementWrite> & {
      status?: AgreementStatus
      activatedAt?: Date
      terminationDate?: string
      terminationReason?: string
      terminatedAt?: Date
      archivedAt?: Date
    }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(stakeholderAgreements)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        agreementOf(institutionId),
        eq(stakeholderAgreements.id, input.id),
        eq(stakeholderAgreements.version, input.expectedVersion),
      ),
    )
    .returning({ id: stakeholderAgreements.id })
  return rows.length === 1
}

/** Bağlı dosyanın okunabilmesi için anlaşma var mı (arşivli değil). */
export async function agreementExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: stakeholderAgreements.id })
    .from(stakeholderAgreements)
    .where(and(agreementOf(institutionId), eq(stakeholderAgreements.id, id)))
    .limit(1)
  return row !== undefined
}
