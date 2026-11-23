import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import type {
  CandidateInterviewStatus,
  CandidateInterviewType,
  CandidateRating,
  InterviewCriterion,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'
import type { JobApplicationStage } from '@kampus/school-core/lib/finance-job-postings.ts'
import type { ObservationCriterion } from '@kampus/school-core/lib/finance-lesson-observations.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  candidateInterviewEvaluations,
  candidateInterviews,
  interviewTemplates,
  interviewTemplateVersions,
} from './schema/finance-candidate-interviews.ts'
import { jobApplications, jobPostings } from './schema/finance-job-postings.ts'
import { lessonObservationTemplateVersions } from './schema/finance-lesson-observations.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Aday mülakatı deposu (DOM-FIN-138; ON-178). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-candidate-interviews.ts`'tedir; depo yalnız okur ve yazar. Başvuru
 * ON-177 tablolarından, örnek ders formu ON-206 gözlem formu sürümünden, değerlendirici adı
 * üyelikten (Better Auth `memberships`, `users`) yalnız okunur.
 */

const templateOf = (institutionId: string) => eq(interviewTemplates.institutionId, institutionId)
const versionOf = (institutionId: string) =>
  eq(interviewTemplateVersions.institutionId, institutionId)
const interviewOf = (institutionId: string) => eq(candidateInterviews.institutionId, institutionId)
const evaluationOf = (institutionId: string) =>
  eq(candidateInterviewEvaluations.institutionId, institutionId)

// --- Şablon --------------------------------------------------------------------------------------

export interface StoredInterviewTemplate {
  id: string
  versionId: string
  versionNumber: number
  name: string
  scaleMax: number
  criteria: InterviewCriterion[]
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const TEMPLATE_COLUMNS = {
  id: interviewTemplates.id,
  versionId: interviewTemplateVersions.id,
  versionNumber: interviewTemplateVersions.versionNumber,
  name: interviewTemplateVersions.name,
  scaleMax: interviewTemplateVersions.scaleMax,
  criteria: interviewTemplateVersions.criteria,
  archivedAt: interviewTemplates.archivedAt,
  createdAt: interviewTemplates.createdAt,
  updatedAt: interviewTemplates.updatedAt,
  version: interviewTemplates.version,
}
type TemplateRow = Omit<StoredInterviewTemplate, 'archivedAt' | 'createdAt' | 'updatedAt'> & {
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toTemplate = (row: TemplateRow): StoredInterviewTemplate => ({
  ...row,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Şablonun son sürümüne birleşim. */
const ON_LATEST = and(
  eq(interviewTemplateVersions.institutionId, interviewTemplates.institutionId),
  eq(interviewTemplateVersions.templateId, interviewTemplates.id),
  eq(interviewTemplateVersions.versionNumber, interviewTemplates.latestVersionNumber),
)

export async function findInterviewTemplate(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredInterviewTemplate | null> {
  const [row] = await db
    .select(TEMPLATE_COLUMNS)
    .from(interviewTemplates)
    .innerJoin(interviewTemplateVersions, ON_LATEST)
    .where(and(templateOf(institutionId), eq(interviewTemplates.id, id)))
    .limit(1)
  return row === undefined ? null : toTemplate(row)
}

export interface InterviewTemplateQuery {
  page: number
  pageSize: number
  q?: string | undefined
  includeArchived?: boolean | undefined
}

/** Şablonlar son sürümleriyle, ada göre; arşivli yalnız istenirse. */
export async function listInterviewTemplates(
  db: Database,
  institutionId: string,
  query: InterviewTemplateQuery,
): Promise<{ items: StoredInterviewTemplate[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    templateOf(institutionId),
    query.includeArchived === true ? undefined : isNull(interviewTemplates.archivedAt),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(interviewTemplateVersions.name)}, ${search}) > 0`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(interviewTemplates)
    .innerJoin(interviewTemplateVersions, ON_LATEST)
    .where(where)
  const rows = await db
    .select(TEMPLATE_COLUMNS)
    .from(interviewTemplates)
    .innerJoin(interviewTemplateVersions, ON_LATEST)
    .where(where)
    .orderBy(asc(foldSql(interviewTemplateVersions.name)), asc(interviewTemplates.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toTemplate), total: totalRow?.total ?? 0 }
}

/** Sürüm başına mülakat sayısı (kullanılmış sürüm değişmez; K-470). */
export async function interviewCountsByVersion(
  db: Database,
  institutionId: string,
  versionIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (versionIds.length === 0) return counts
  const rows = await db
    .select({ versionId: candidateInterviews.interviewTemplateVersionId, total: count() })
    .from(candidateInterviews)
    .where(
      and(
        interviewOf(institutionId),
        inArray(candidateInterviews.interviewTemplateVersionId, [...new Set(versionIds)]),
      ),
    )
    .groupBy(candidateInterviews.interviewTemplateVersionId)
  for (const row of rows) if (row.versionId !== null) counts.set(row.versionId, row.total)
  return counts
}

/**
 * Gözlem formu sürümü başına örnek ders sayısı (K-471): örnek derste kullanılmış gözlem formu
 * sürümü de değişmez; ders gözlemi servisi düzeltmede bunu da sayar.
 */
export async function sampleLessonCountsByVersion(
  db: Database,
  institutionId: string,
  versionIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (versionIds.length === 0) return counts
  const rows = await db
    .select({ versionId: candidateInterviews.observationTemplateVersionId, total: count() })
    .from(candidateInterviews)
    .where(
      and(
        interviewOf(institutionId),
        inArray(candidateInterviews.observationTemplateVersionId, [...new Set(versionIds)]),
      ),
    )
    .groupBy(candidateInterviews.observationTemplateVersionId)
  for (const row of rows) if (row.versionId !== null) counts.set(row.versionId, row.total)
  return counts
}

interface TemplateContent {
  name: string
  scaleMax: number
  criteria: InterviewCriterion[]
}

export async function insertInterviewTemplate(
  tx: Database,
  institutionId: string,
  input: TemplateContent & { id: string; versionId: string; userId: string; now: Date },
): Promise<void> {
  const { now } = input
  await tx.insert(interviewTemplates).values({
    institutionId,
    id: input.id,
    latestVersionNumber: 1,
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(interviewTemplateVersions).values({
    institutionId,
    id: input.versionId,
    templateId: input.id,
    versionNumber: 1,
    name: input.name,
    scaleMax: input.scaleMax,
    criteria: input.criteria,
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Şablon satırının sürümünü ilerletir; sürüm tutmazsa `false` (409). */
async function bumpTemplate(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    latestVersionNumber?: number
    archive?: boolean
  },
): Promise<boolean> {
  const rows = await tx
    .update(interviewTemplates)
    .set({
      ...(input.latestVersionNumber === undefined
        ? {}
        : { latestVersionNumber: input.latestVersionNumber }),
      ...(input.archive === true ? { archivedAt: input.now } : {}),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        templateOf(institutionId),
        eq(interviewTemplates.id, input.id),
        eq(interviewTemplates.version, input.expectedVersion),
      ),
    )
    .returning({ id: interviewTemplates.id })
  return rows.length === 1
}

/** Kullanılmamış son sürümün yerinde düzeltmesi (K-470). */
export async function updateInterviewTemplateVersion(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    versionId: string
    expectedVersion: number
    patch: Partial<TemplateContent>
    now: Date
  },
): Promise<boolean> {
  if (!(await bumpTemplate(tx, institutionId, input))) return false
  await tx
    .update(interviewTemplateVersions)
    .set({ ...input.patch, updatedAt: input.now })
    .where(and(versionOf(institutionId), eq(interviewTemplateVersions.id, input.versionId)))
  return true
}

/** Yeni sürüm; şablonun son sürüm numarası ilerler (K-470). */
export async function insertInterviewTemplateVersion(
  tx: Database,
  institutionId: string,
  input: TemplateContent & {
    id: string
    versionId: string
    versionNumber: number
    expectedVersion: number
    userId: string
    now: Date
  },
): Promise<boolean> {
  const bumped = await bumpTemplate(tx, institutionId, {
    id: input.id,
    expectedVersion: input.expectedVersion,
    now: input.now,
    latestVersionNumber: input.versionNumber,
  })
  if (!bumped) return false
  await tx.insert(interviewTemplateVersions).values({
    institutionId,
    id: input.versionId,
    templateId: input.id,
    versionNumber: input.versionNumber,
    name: input.name,
    scaleMax: input.scaleMax,
    criteria: input.criteria,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
  return true
}

export const archiveInterviewTemplate = (
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
) => bumpTemplate(tx, institutionId, { ...input, archive: true })

// --- Mülakat -------------------------------------------------------------------------------------

/** Mülakatın formu; örnek derste gözlem formu ölçütleri (seviye tanımlarıyla). */
export type StoredInterviewForm =
  | {
      kind: 'interview'
      templateId: string
      versionId: string
      versionNumber: number
      name: string
      scaleMax: number
      criteria: InterviewCriterion[]
    }
  | {
      kind: 'observation'
      templateId: string
      versionId: string
      versionNumber: number
      name: string
      criteria: ObservationCriterion[]
    }

export interface StoredCandidateInterview {
  id: string
  jobApplicationId: string
  type: CandidateInterviewType
  scheduledAt: string
  location: string | null
  meetingUrl: string | null
  status: CandidateInterviewStatus
  completedAt: string | null
  cancelledAt: string | null
  form: StoredInterviewForm
  createdAt: string
  updatedAt: string
  version: number
}

const INTERVIEW_COLUMNS = {
  id: candidateInterviews.id,
  jobApplicationId: candidateInterviews.jobApplicationId,
  type: candidateInterviews.type,
  scheduledAt: candidateInterviews.scheduledAt,
  location: candidateInterviews.location,
  meetingUrl: candidateInterviews.meetingUrl,
  status: candidateInterviews.status,
  completedAt: candidateInterviews.completedAt,
  cancelledAt: candidateInterviews.cancelledAt,
  createdAt: candidateInterviews.createdAt,
  updatedAt: candidateInterviews.updatedAt,
  version: candidateInterviews.version,
  interviewVersionId: interviewTemplateVersions.id,
  interviewTemplateId: interviewTemplateVersions.templateId,
  interviewVersionNumber: interviewTemplateVersions.versionNumber,
  interviewName: interviewTemplateVersions.name,
  interviewScaleMax: interviewTemplateVersions.scaleMax,
  interviewCriteria: interviewTemplateVersions.criteria,
  observationVersionId: lessonObservationTemplateVersions.id,
  observationTemplateId: lessonObservationTemplateVersions.templateId,
  observationVersionNumber: lessonObservationTemplateVersions.versionNumber,
  observationName: lessonObservationTemplateVersions.name,
  observationCriteria: lessonObservationTemplateVersions.criteria,
}

interface InterviewRow {
  id: string
  jobApplicationId: string
  type: CandidateInterviewType
  scheduledAt: Date
  location: string | null
  meetingUrl: string | null
  status: CandidateInterviewStatus
  completedAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  version: number
  interviewVersionId: string | null
  interviewTemplateId: string | null
  interviewVersionNumber: number | null
  interviewName: string | null
  interviewScaleMax: number | null
  interviewCriteria: InterviewCriterion[] | null
  observationVersionId: string | null
  observationTemplateId: string | null
  observationVersionNumber: number | null
  observationName: string | null
  observationCriteria: ObservationCriterion[] | null
}

function formOf(row: InterviewRow): StoredInterviewForm {
  if (
    row.observationVersionId !== null &&
    row.observationTemplateId !== null &&
    row.observationVersionNumber !== null &&
    row.observationName !== null &&
    row.observationCriteria !== null
  )
    return {
      kind: 'observation',
      templateId: row.observationTemplateId,
      versionId: row.observationVersionId,
      versionNumber: row.observationVersionNumber,
      name: row.observationName,
      criteria: row.observationCriteria,
    }
  if (
    row.interviewVersionId !== null &&
    row.interviewTemplateId !== null &&
    row.interviewVersionNumber !== null &&
    row.interviewName !== null &&
    row.interviewScaleMax !== null &&
    row.interviewCriteria !== null
  )
    return {
      kind: 'interview',
      templateId: row.interviewTemplateId,
      versionId: row.interviewVersionId,
      versionNumber: row.interviewVersionNumber,
      name: row.interviewName,
      scaleMax: row.interviewScaleMax,
      criteria: row.interviewCriteria,
    }
  // Kısıt (`candidate_interviews_form_check`) tam bir form bağını güvenceler.
  throw new Error('candidate interview has no form version')
}

const toInterview = (row: InterviewRow): StoredCandidateInterview => ({
  id: row.id,
  jobApplicationId: row.jobApplicationId,
  type: row.type,
  scheduledAt: row.scheduledAt.toISOString(),
  location: row.location,
  meetingUrl: row.meetingUrl,
  status: row.status,
  completedAt: row.completedAt?.toISOString() ?? null,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  form: formOf(row),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
})

const interviewBase = (db: Database) =>
  db
    .select(INTERVIEW_COLUMNS)
    .from(candidateInterviews)
    .leftJoin(
      interviewTemplateVersions,
      and(
        eq(interviewTemplateVersions.institutionId, candidateInterviews.institutionId),
        eq(interviewTemplateVersions.id, candidateInterviews.interviewTemplateVersionId),
      ),
    )
    .leftJoin(
      lessonObservationTemplateVersions,
      and(
        eq(lessonObservationTemplateVersions.institutionId, candidateInterviews.institutionId),
        eq(lessonObservationTemplateVersions.id, candidateInterviews.observationTemplateVersionId),
      ),
    )

export async function findCandidateInterview(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredCandidateInterview | null> {
  const [row] = await interviewBase(db)
    .where(and(interviewOf(institutionId), eq(candidateInterviews.id, id)))
    .limit(1)
  return row === undefined ? null : toInterview(row)
}

/** Başvurunun mülakatları, ana göre (eskiden yeniye). */
export async function listApplicationInterviews(
  db: Database,
  institutionId: string,
  applicationId: string,
): Promise<StoredCandidateInterview[]> {
  const rows = await interviewBase(db)
    .where(and(interviewOf(institutionId), eq(candidateInterviews.jobApplicationId, applicationId)))
    .orderBy(asc(candidateInterviews.scheduledAt), asc(candidateInterviews.id))
  return rows.map(toInterview)
}

/** Başvurunun yapılmış mülakat sayısı (teklif kapısı, K-469). */
export async function countCompletedInterviews(
  db: Database,
  institutionId: string,
  applicationId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(candidateInterviews)
    .where(
      and(
        interviewOf(institutionId),
        eq(candidateInterviews.jobApplicationId, applicationId),
        eq(candidateInterviews.status, 'completed'),
      ),
    )
  return row?.total ?? 0
}

export async function insertCandidateInterview(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    jobApplicationId: string
    type: CandidateInterviewType
    scheduledAt: Date
    location: string | null
    meetingUrl: string | null
    interviewTemplateVersionId: string | null
    observationTemplateVersionId: string | null
    evaluators: readonly { id: string; membershipId: string }[]
    userId: string
    now: Date
  },
): Promise<void> {
  const { now, userId, evaluators, ...fields } = input
  await tx.insert(candidateInterviews).values({
    ...fields,
    institutionId,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(candidateInterviewEvaluations).values(
    evaluators.map((evaluator) => ({
      institutionId,
      id: evaluator.id,
      candidateInterviewId: input.id,
      evaluatorMembershipId: evaluator.membershipId,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** Mülakat güncellemesi (düzeltme, yapıldı, iptal); yalnız planlı ve sürüm tutarsa, değilse `false`. */
export async function updatePlannedInterview(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      scheduledAt: Date
      location: string | null
      meetingUrl: string | null
      status: CandidateInterviewStatus
      completedAt: Date
      completedByUserId: string
      cancelledAt: Date
      cancelledByUserId: string
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(candidateInterviews)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        interviewOf(institutionId),
        eq(candidateInterviews.id, input.id),
        eq(candidateInterviews.version, input.expectedVersion),
        eq(candidateInterviews.status, 'planned'),
      ),
    )
    .returning({ id: candidateInterviews.id })
  return rows.length === 1
}

// --- Değerlendirme -------------------------------------------------------------------------------

export interface StoredEvaluation {
  id: string
  candidateInterviewId: string
  evaluatorMembershipId: string
  evaluatorName: string
  ratings: CandidateRating[] | null
  generalNote: string | null
  submittedAt: string | null
  version: number
}

/** Mülakatların değerlendirici satırları, değerlendirici adına göre. */
export async function listEvaluations(
  db: Database,
  institutionId: string,
  interviewIds: readonly string[],
): Promise<StoredEvaluation[]> {
  if (interviewIds.length === 0) return []
  const rows = await db
    .select({
      id: candidateInterviewEvaluations.id,
      candidateInterviewId: candidateInterviewEvaluations.candidateInterviewId,
      evaluatorMembershipId: candidateInterviewEvaluations.evaluatorMembershipId,
      evaluatorName: users.name,
      ratings: candidateInterviewEvaluations.ratings,
      generalNote: candidateInterviewEvaluations.generalNote,
      submittedAt: candidateInterviewEvaluations.submittedAt,
      version: candidateInterviewEvaluations.version,
    })
    .from(candidateInterviewEvaluations)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, candidateInterviewEvaluations.institutionId),
        eq(memberships.id, candidateInterviewEvaluations.evaluatorMembershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        evaluationOf(institutionId),
        inArray(candidateInterviewEvaluations.candidateInterviewId, [...new Set(interviewIds)]),
      ),
    )
    .orderBy(asc(users.name), asc(candidateInterviewEvaluations.id))
  return rows.map((row) => ({ ...row, submittedAt: row.submittedAt?.toISOString() ?? null }))
}

/** Gönderim (K-470): yalnız gönderilmemiş satır ve sürüm tutarsa yazar, değilse `false` (409). */
export async function submitEvaluation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    ratings: CandidateRating[]
    generalNote: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(candidateInterviewEvaluations)
    .set({
      ratings: input.ratings,
      generalNote: input.generalNote,
      submittedAt: input.now,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        evaluationOf(institutionId),
        eq(candidateInterviewEvaluations.id, input.id),
        eq(candidateInterviewEvaluations.version, input.expectedVersion),
        isNull(candidateInterviewEvaluations.submittedAt),
      ),
    )
    .returning({ id: candidateInterviewEvaluations.id })
  return rows.length === 1
}

/**
 * Başvuru anonimleştirmesinin mülakat payı (K-471): yer ve bağlantı silinir, planlı mülakat iptal
 * olur; gönderilmiş değerlendirmelerin ölçüt notları ve genel değerlendirmesi silinir, puanlar
 * kalır. Satırlar silinmez. Etkilenen mülakat ve değerlendirme sayısı döner.
 */
export async function anonymizeApplicationInterviews(
  tx: Database,
  institutionId: string,
  input: { applicationId: string; userId: string; now: Date },
): Promise<{ interviews: number; evaluations: number }> {
  const interviews = await tx
    .select({ id: candidateInterviews.id, status: candidateInterviews.status })
    .from(candidateInterviews)
    .where(
      and(
        interviewOf(institutionId),
        eq(candidateInterviews.jobApplicationId, input.applicationId),
      ),
    )
  if (interviews.length === 0) return { interviews: 0, evaluations: 0 }
  const ids = interviews.map((row) => row.id)
  await tx
    .update(candidateInterviews)
    .set({
      location: null,
      meetingUrl: null,
      status: sql`case when ${candidateInterviews.status} = 'planned' then 'cancelled' else ${candidateInterviews.status} end`,
      cancelledAt: sql`case when ${candidateInterviews.status} = 'planned' then ${input.now.toISOString()}::timestamptz else ${candidateInterviews.cancelledAt} end`,
      cancelledByUserId: sql`case when ${candidateInterviews.status} = 'planned' then ${input.userId} else ${candidateInterviews.cancelledByUserId} end`,
      updatedAt: input.now,
      version: sql`${candidateInterviews.version} + 1`,
    })
    .where(and(interviewOf(institutionId), inArray(candidateInterviews.id, ids)))
  const evaluations = await tx
    .select({
      id: candidateInterviewEvaluations.id,
      ratings: candidateInterviewEvaluations.ratings,
    })
    .from(candidateInterviewEvaluations)
    .where(
      and(
        evaluationOf(institutionId),
        inArray(candidateInterviewEvaluations.candidateInterviewId, ids),
        isNotNull(candidateInterviewEvaluations.submittedAt),
      ),
    )
  for (const evaluation of evaluations)
    await tx
      .update(candidateInterviewEvaluations)
      .set({
        ratings: (evaluation.ratings ?? []).map((rating) => ({ ...rating, note: null })),
        generalNote: null,
        updatedAt: input.now,
        version: sql`${candidateInterviewEvaluations.version} + 1`,
      })
      .where(and(evaluationOf(institutionId), eq(candidateInterviewEvaluations.id, evaluation.id)))
  return { interviews: interviews.length, evaluations: evaluations.length }
}

// --- Değerlendiricinin listesi -------------------------------------------------------------------

export interface AssignedInterview {
  interview: StoredCandidateInterview
  candidateName: string
  postingTitle: string
  applicationStage: JobApplicationStage
}

/**
 * Değerlendiricinin mülakatları (K-470): değerlendirici olduğu, iptal edilmemiş ve başvurusu
 * anonimleştirilmemiş mülakatlar, yakın an önce; `pending=true` yalnız gönderilmemiş satırlar.
 */
export async function listAssignedInterviews(
  db: Database,
  institutionId: string,
  query: { membershipId: string; page: number; pageSize: number; pending: boolean },
): Promise<{ items: AssignedInterview[]; total: number }> {
  const where = and(
    interviewOf(institutionId),
    eq(candidateInterviewEvaluations.evaluatorMembershipId, query.membershipId),
    inArray(candidateInterviews.status, ['planned', 'completed']),
    isNull(jobApplications.anonymizedAt),
    query.pending ? isNull(candidateInterviewEvaluations.submittedAt) : undefined,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(candidateInterviews)
    .innerJoin(
      candidateInterviewEvaluations,
      and(
        eq(candidateInterviewEvaluations.institutionId, candidateInterviews.institutionId),
        eq(candidateInterviewEvaluations.candidateInterviewId, candidateInterviews.id),
      ),
    )
    .innerJoin(
      jobApplications,
      and(
        eq(jobApplications.institutionId, candidateInterviews.institutionId),
        eq(jobApplications.id, candidateInterviews.jobApplicationId),
      ),
    )
    .where(where)
  const rows = await db
    .select({
      ...INTERVIEW_COLUMNS,
      candidateName: jobApplications.candidateName,
      postingTitle: jobPostings.title,
      applicationStage: jobApplications.stage,
    })
    .from(candidateInterviews)
    .leftJoin(
      interviewTemplateVersions,
      and(
        eq(interviewTemplateVersions.institutionId, candidateInterviews.institutionId),
        eq(interviewTemplateVersions.id, candidateInterviews.interviewTemplateVersionId),
      ),
    )
    .leftJoin(
      lessonObservationTemplateVersions,
      and(
        eq(lessonObservationTemplateVersions.institutionId, candidateInterviews.institutionId),
        eq(lessonObservationTemplateVersions.id, candidateInterviews.observationTemplateVersionId),
      ),
    )
    .innerJoin(
      candidateInterviewEvaluations,
      and(
        eq(candidateInterviewEvaluations.institutionId, candidateInterviews.institutionId),
        eq(candidateInterviewEvaluations.candidateInterviewId, candidateInterviews.id),
      ),
    )
    .innerJoin(
      jobApplications,
      and(
        eq(jobApplications.institutionId, candidateInterviews.institutionId),
        eq(jobApplications.id, candidateInterviews.jobApplicationId),
      ),
    )
    .innerJoin(
      jobPostings,
      and(
        eq(jobPostings.institutionId, jobApplications.institutionId),
        eq(jobPostings.id, jobApplications.jobPostingId),
      ),
    )
    .where(where)
    .orderBy(asc(candidateInterviews.scheduledAt), asc(candidateInterviews.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ candidateName, postingTitle, applicationStage, ...row }) => ({
      interview: toInterview(row),
      candidateName,
      postingTitle,
      applicationStage,
    })),
    total: totalRow?.total ?? 0,
  }
}
