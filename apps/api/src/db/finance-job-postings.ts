import { and, asc, count, desc, eq, inArray, isNull, max, ne, or, sql, type SQL } from 'drizzle-orm'

import {
  ANONYMIZED_CANDIDATE_NAME,
  DEFAULT_JOB_APPLICATION_SETTINGS,
  type JobApplicationAnonymizationReason,
  type JobApplicationChannel,
  type JobApplicationSettings,
  type JobApplicationStage,
  type JobEmploymentType,
  type JobPostingStatus,
} from '@kampus/school-core/lib/finance-job-postings.ts'

import type { Database } from './client.ts'
import {
  jobApplicationSettings,
  jobApplicationStageChanges,
  jobApplications,
  jobPostings,
} from './schema/finance-job-postings.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * İş ilanı ve başvuru havuzu deposu (DOM-FIN-128; ON-177). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-job-postings.ts`'tedir; depo yalnız okur ve yazar.
 * İlan ve başvuru silinmez; aşama geçmişi değişmez (tetikleyici).
 */

// --- İlan ----------------------------------------------------------------------------------------

export interface StoredJobPosting {
  id: string
  title: string
  position: string
  employmentType: JobEmploymentType
  description: string
  requirements: string | null
  publishOn: string
  deadlineOn: string
  status: JobPostingStatus
  closedOn: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const POSTING_COLUMNS = {
  id: jobPostings.id,
  title: jobPostings.title,
  position: jobPostings.position,
  employmentType: jobPostings.employmentType,
  description: jobPostings.description,
  requirements: jobPostings.requirements,
  publishOn: jobPostings.publishOn,
  deadlineOn: jobPostings.deadlineOn,
  status: jobPostings.status,
  closedOn: jobPostings.closedOn,
  createdAt: jobPostings.createdAt,
  updatedAt: jobPostings.updatedAt,
  version: jobPostings.version,
}
type PostingRow = Omit<StoredJobPosting, 'createdAt' | 'updatedAt'> & {
  createdAt: Date
  updatedAt: Date
}
const toPosting = (row: PostingRow): StoredJobPosting => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
const postingOf = (institutionId: string) => eq(jobPostings.institutionId, institutionId)

export async function findJobPosting(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredJobPosting | null> {
  const [row] = await db
    .select(POSTING_COLUMNS)
    .from(jobPostings)
    .where(and(postingOf(institutionId), eq(jobPostings.id, id)))
    .limit(1)
  return row === undefined ? null : toPosting(row)
}

export interface JobPostingQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: JobPostingStatus | undefined
  employmentType?: JobEmploymentType | undefined
}

/** İlanlar: taslak ve yayındakiler önce, son başvuru gününe göre (en yakın önce). */
export async function listJobPostings(
  db: Database,
  institutionId: string,
  query: JobPostingQuery,
): Promise<{ items: StoredJobPosting[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    postingOf(institutionId),
    query.status === undefined ? undefined : eq(jobPostings.status, query.status),
    query.employmentType === undefined
      ? undefined
      : eq(jobPostings.employmentType, query.employmentType),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(jobPostings.title)}, ${search}) > 0`,
          sql`strpos(${foldSql(jobPostings.position)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db.select({ total: count() }).from(jobPostings).where(where)
  const rows = await db
    .select(POSTING_COLUMNS)
    .from(jobPostings)
    .where(where)
    .orderBy(
      sql`case when ${jobPostings.status} = 'closed' then 1 else 0 end`,
      desc(jobPostings.deadlineOn),
      asc(jobPostings.title),
      asc(jobPostings.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toPosting), total: totalRow?.total ?? 0 }
}

export type JobPostingWrite = Pick<
  StoredJobPosting,
  | 'title'
  | 'position'
  | 'employmentType'
  | 'description'
  | 'requirements'
  | 'publishOn'
  | 'deadlineOn'
>

export async function insertJobPosting(
  tx: Database,
  institutionId: string,
  input: JobPostingWrite & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(jobPostings)
    .values({ ...fields, institutionId, status: 'draft', createdAt: now, updatedAt: now })
}

/** Düzeltme ya da durum; sürüm tutmazsa `false` (409). */
export async function updateJobPosting(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<JobPostingWrite> & { status?: JobPostingStatus; closedOn?: string | null }
  },
): Promise<boolean> {
  const rows = await tx
    .update(jobPostings)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        postingOf(institutionId),
        eq(jobPostings.id, input.id),
        eq(jobPostings.version, input.expectedVersion),
      ),
    )
    .returning({ id: jobPostings.id })
  return rows.length === 1
}

/** İlanların başvuru sayıları (aşamaya göre); anonimleştirilmişler dahil. */
export async function countApplicationsByPosting(
  db: Database,
  institutionId: string,
  postingIds: readonly string[],
): Promise<Map<string, Partial<Record<JobApplicationStage, number>>>> {
  const result = new Map<string, Partial<Record<JobApplicationStage, number>>>()
  if (postingIds.length === 0) return result
  const rows = await db
    .select({
      postingId: jobApplications.jobPostingId,
      stage: jobApplications.stage,
      total: count(),
    })
    .from(jobApplications)
    .where(
      and(
        eq(jobApplications.institutionId, institutionId),
        inArray(jobApplications.jobPostingId, [...postingIds]),
      ),
    )
    .groupBy(jobApplications.jobPostingId, jobApplications.stage)
  for (const row of rows) {
    const counts = result.get(row.postingId) ?? {}
    counts[row.stage] = row.total
    result.set(row.postingId, counts)
  }
  return result
}

/** İlana alınmış başvuruların en geç günü; yoksa `null`. */
export async function latestApplicationReceivedOn(
  db: Database,
  institutionId: string,
  postingId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ latest: max(jobApplications.receivedOn) })
    .from(jobApplications)
    .where(
      and(
        eq(jobApplications.institutionId, institutionId),
        eq(jobApplications.jobPostingId, postingId),
      ),
    )
  return row?.latest ?? null
}

// --- Başvuru -------------------------------------------------------------------------------------

export interface StoredJobApplication {
  id: string
  jobPostingId: string
  postingTitle: string
  postingStatus: JobPostingStatus
  postingClosedOn: string | null
  candidateName: string
  email: string | null
  phone: string | null
  channel: JobApplicationChannel
  receivedOn: string
  cvFileId: string | null
  privacyNoticeVersion: string
  privacyNoticeShownOn: string
  note: string | null
  stage: JobApplicationStage
  stageChangedOn: string
  anonymizedAt: string | null
  anonymizationReason: JobApplicationAnonymizationReason | null
  createdAt: string
  updatedAt: string
  version: number
}

const APPLICATION_COLUMNS = {
  id: jobApplications.id,
  jobPostingId: jobApplications.jobPostingId,
  postingTitle: jobPostings.title,
  postingStatus: jobPostings.status,
  postingClosedOn: jobPostings.closedOn,
  candidateName: jobApplications.candidateName,
  email: jobApplications.email,
  phone: jobApplications.phone,
  channel: jobApplications.channel,
  receivedOn: jobApplications.receivedOn,
  cvFileId: jobApplications.cvFileId,
  privacyNoticeVersion: jobApplications.privacyNoticeVersion,
  privacyNoticeShownOn: jobApplications.privacyNoticeShownOn,
  note: jobApplications.note,
  stage: jobApplications.stage,
  stageChangedOn: jobApplications.stageChangedOn,
  anonymizedAt: jobApplications.anonymizedAt,
  anonymizationReason: jobApplications.anonymizationReason,
  createdAt: jobApplications.createdAt,
  updatedAt: jobApplications.updatedAt,
  version: jobApplications.version,
}
type ApplicationRow = Omit<StoredJobApplication, 'createdAt' | 'updatedAt' | 'anonymizedAt'> & {
  createdAt: Date
  updatedAt: Date
  anonymizedAt: Date | null
}
const toApplication = (row: ApplicationRow): StoredJobApplication => ({
  ...row,
  anonymizedAt: row.anonymizedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
const applicationOf = (institutionId: string) => eq(jobApplications.institutionId, institutionId)
const postingJoin = and(
  eq(jobPostings.institutionId, jobApplications.institutionId),
  eq(jobPostings.id, jobApplications.jobPostingId),
)

export async function findJobApplication(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredJobApplication | null> {
  const [row] = await db
    .select(APPLICATION_COLUMNS)
    .from(jobApplications)
    .innerJoin(jobPostings, postingJoin)
    .where(and(applicationOf(institutionId), eq(jobApplications.id, id)))
    .limit(1)
  return row === undefined ? null : toApplication(row)
}

/** Dosya bağlantısı için: başvuru var ve anonimleştirilmemiş mi. */
export async function jobApplicationReadable(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: jobApplications.id })
    .from(jobApplications)
    .where(
      and(
        applicationOf(institutionId),
        eq(jobApplications.id, id),
        isNull(jobApplications.anonymizedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface JobApplicationQuery {
  page: number
  pageSize: number
  q?: string | undefined
  jobPostingId?: string | undefined
  stage?: JobApplicationStage | undefined
  channel?: JobApplicationChannel | undefined
  open?: boolean | undefined
}

/** Başvurular: en yeni başvuru önce; arama aday adında ve ilan başlığında. */
export async function listJobApplications(
  db: Database,
  institutionId: string,
  query: JobApplicationQuery,
): Promise<{ items: StoredJobApplication[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    applicationOf(institutionId),
    query.jobPostingId === undefined
      ? undefined
      : eq(jobApplications.jobPostingId, query.jobPostingId),
    query.stage === undefined ? undefined : eq(jobApplications.stage, query.stage),
    query.channel === undefined ? undefined : eq(jobApplications.channel, query.channel),
    query.open === true
      ? and(
          inArray(jobApplications.stage, ['new', 'screening', 'interview', 'offer']),
          isNull(jobApplications.anonymizedAt),
        )
      : undefined,
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(jobApplications.candidateName)}, ${search}) > 0`,
          sql`strpos(${foldSql(jobPostings.title)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(jobApplications)
    .innerJoin(jobPostings, postingJoin)
    .where(where)
  const rows = await db
    .select(APPLICATION_COLUMNS)
    .from(jobApplications)
    .innerJoin(jobPostings, postingJoin)
    .where(where)
    .orderBy(desc(jobApplications.receivedOn), desc(jobApplications.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toApplication), total: totalRow?.total ?? 0 }
}

/** Aynı ilanda aynı e-posta ya da telefonla başka başvuru var mı (K-440). */
export async function findDuplicateApplication(
  db: Database,
  institutionId: string,
  input: { jobPostingId: string; email: string | null; phone: string | null; exceptId?: string },
): Promise<'email' | 'phone' | null> {
  const matches: SQL[] = []
  if (input.email !== null) matches.push(eq(jobApplications.email, input.email))
  if (input.phone !== null) matches.push(eq(jobApplications.phone, input.phone))
  if (matches.length === 0) return null
  const rows = await db
    .select({ email: jobApplications.email, phone: jobApplications.phone })
    .from(jobApplications)
    .where(
      and(
        applicationOf(institutionId),
        eq(jobApplications.jobPostingId, input.jobPostingId),
        input.exceptId === undefined ? undefined : ne(jobApplications.id, input.exceptId),
        or(...matches),
      ),
    )
    .limit(2)
  if (rows.some((row) => input.email !== null && row.email === input.email)) return 'email'
  return rows.length > 0 ? 'phone' : null
}

export async function insertJobApplication(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    jobPostingId: string
    candidateName: string
    email: string | null
    phone: string | null
    channel: JobApplicationChannel
    receivedOn: string
    cvFileId: string | null
    privacyNoticeVersion: string
    privacyNoticeShownOn: string
    note: string | null
    recordedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(jobApplications).values({
    ...fields,
    institutionId,
    stage: 'new',
    stageChangedOn: input.receivedOn,
    createdAt: now,
    updatedAt: now,
  })
}

/** Başvuru güncellemesi (düzeltme, aşama, anonimleştirme); sürüm tutmazsa `false` (409). */
export async function updateJobApplication(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      candidateName: string
      email: string | null
      phone: string | null
      note: string | null
      cvFileId: string | null
      stage: JobApplicationStage
      stageChangedOn: string
      anonymizedAt: Date
      anonymizationReason: JobApplicationAnonymizationReason
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(jobApplications)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        applicationOf(institutionId),
        eq(jobApplications.id, input.id),
        eq(jobApplications.version, input.expectedVersion),
      ),
    )
    .returning({ id: jobApplications.id })
  return rows.length === 1
}

/** Anonimleştirme yazması (K-441): ad sabit metne, iletişim, not ve özgeçmiş bağı boşa. */
export function anonymizeJobApplication(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    reason: JobApplicationAnonymizationReason
    now: Date
  },
) {
  return updateJobApplication(tx, institutionId, {
    id: input.id,
    expectedVersion: input.expectedVersion,
    now: input.now,
    values: {
      candidateName: ANONYMIZED_CANDIDATE_NAME,
      email: null,
      phone: null,
      note: null,
      cvFileId: null,
      anonymizedAt: input.now,
      anonymizationReason: input.reason,
    },
  })
}

export async function loadJobApplicationsByIds(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredJobApplication[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select(APPLICATION_COLUMNS)
    .from(jobApplications)
    .innerJoin(jobPostings, postingJoin)
    .where(and(applicationOf(institutionId), inArray(jobApplications.id, [...ids])))
  return rows.map(toApplication)
}

// --- Aşama geçmişi -------------------------------------------------------------------------------

export interface StoredStageChange {
  id: string
  fromStage: JobApplicationStage | null
  toStage: JobApplicationStage
  changedOn: string
  changedByUserId: string
  createdAt: string
}

export async function insertStageChange(
  tx: Database,
  institutionId: string,
  input: Omit<StoredStageChange, 'createdAt'> & { jobApplicationId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(jobApplicationStageChanges)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

export async function listStageChanges(
  db: Database,
  institutionId: string,
  applicationId: string,
): Promise<StoredStageChange[]> {
  const rows = await db
    .select({
      id: jobApplicationStageChanges.id,
      fromStage: jobApplicationStageChanges.fromStage,
      toStage: jobApplicationStageChanges.toStage,
      changedOn: jobApplicationStageChanges.changedOn,
      changedByUserId: jobApplicationStageChanges.changedByUserId,
      createdAt: jobApplicationStageChanges.createdAt,
    })
    .from(jobApplicationStageChanges)
    .where(
      and(
        eq(jobApplicationStageChanges.institutionId, institutionId),
        eq(jobApplicationStageChanges.jobApplicationId, applicationId),
      ),
    )
    .orderBy(
      asc(jobApplicationStageChanges.changedOn),
      asc(jobApplicationStageChanges.createdAt),
      // Aşama yalnız ileri gider: aynı gün ve anda sıra aşamanın süreçteki yeridir.
      sql`array_position(array['new','screening','interview','offer','hired','rejected']::text[], ${jobApplicationStageChanges.toStage})`,
    )
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

// --- Saklama -------------------------------------------------------------------------------------

/**
 * Saklama süresinin başladığı gün (K-441; core `retentionStartOn` ile aynı): reddedilen başvuruda
 * ret günü, işe alınmamış ve reddedilmemiş başvuruda ilanın kapanış günü.
 */
const retentionStart = sql<
  string | null
>`case when ${jobApplications.stage} = 'rejected' then ${jobApplications.stageChangedOn} when ${jobApplications.stage} <> 'hired' then ${jobPostings.closedOn} end`

/** Süresi dolan başvurular: süre sonu bugün ya da önce, en eski süre sonu önce (sayfalı). */
export async function listRetentionDueApplications(
  db: Database,
  institutionId: string,
  query: { retentionMonths: number; today: string; page: number; pageSize: number },
): Promise<{ items: (StoredJobApplication & { retentionDueOn: string })[]; total: number }> {
  const dueOn = sql<string>`((${retentionStart}) + make_interval(months => ${query.retentionMonths}))::date`
  const where = and(
    applicationOf(institutionId),
    isNull(jobApplications.anonymizedAt),
    ne(jobApplications.stage, 'hired'),
    sql`${retentionStart} is not null`,
    sql`${dueOn} <= ${query.today}::date`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(jobApplications)
    .innerJoin(jobPostings, postingJoin)
    .where(where)
  const rows = await db
    .select({ ...APPLICATION_COLUMNS, retentionDueOn: sql<string>`${dueOn}::text` })
    .from(jobApplications)
    .innerJoin(jobPostings, postingJoin)
    .where(where)
    .orderBy(asc(dueOn), asc(jobApplications.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ retentionDueOn, ...row }) => ({ ...toApplication(row), retentionDueOn })),
    total: totalRow?.total ?? 0,
  }
}

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredJobApplicationSettings extends JobApplicationSettings {
  /** `If-Match` sürümü; ayar hiç kaydedilmediyse 1. */
  version: number
}

export async function loadJobApplicationSettings(
  db: Database,
  institutionId: string,
): Promise<StoredJobApplicationSettings> {
  const [row] = await db
    .select({
      retentionMonths: jobApplicationSettings.retentionMonths,
      privacyNoticeVersion: jobApplicationSettings.privacyNoticeVersion,
      version: jobApplicationSettings.version,
    })
    .from(jobApplicationSettings)
    .where(eq(jobApplicationSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_JOB_APPLICATION_SETTINGS, version: 1 }
}

/** Ayarı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveJobApplicationSettings(
  tx: Database,
  institutionId: string,
  input: JobApplicationSettings & { expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = {
    retentionMonths: input.retentionMonths,
    privacyNoticeVersion: input.privacyNoticeVersion,
    updatedAt: input.now,
  }
  const [updated] = await tx
    .update(jobApplicationSettings)
    .set({ ...values, version: sql`${jobApplicationSettings.version} + 1` })
    .where(
      and(
        eq(jobApplicationSettings.institutionId, institutionId),
        eq(jobApplicationSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: jobApplicationSettings.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(jobApplicationSettings)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: jobApplicationSettings.version })
  return created?.version ?? null
}
