import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'

import type {
  TeacherFeedbackAnswer,
  TeacherFeedbackDraft,
  TeacherFeedbackPhase,
  TeacherFeedbackQuestion,
  TeacherFeedbackRespondentRole,
  TeacherFeedbackStatus,
  TeacherFeedbackStoredResponse,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'

import type { Database } from './client.ts'
import {
  teacherFeedbackParticipations,
  teacherFeedbackResponses,
  teacherFeedbackSurveys,
} from './schema/finance-teacher-feedback.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Öğretmen geri bildirim anketi deposu (DOM-FIN-159; ON-213). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-teacher-feedback.ts`'tedir. Katılım işareti (kim, hangi
 * öğretmeni) ile yanıt (öğretmen, sınıf, cevaplar) ayrı tablolardadır; yanıtlar yalnız öğretmen
 * başına toplu sonuç için okunur ve rastgele kimlik sırasıyla döner (K-532, K-533).
 */

const surveyOf = (institutionId: string) =>
  and(
    eq(teacherFeedbackSurveys.institutionId, institutionId),
    isNull(teacherFeedbackSurveys.archivedAt),
  )

export interface StoredTeacherFeedbackSurvey extends TeacherFeedbackDraft {
  id: string
  status: TeacherFeedbackStatus
  publishedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const SURVEY_COLUMNS = {
  id: teacherFeedbackSurveys.id,
  title: teacherFeedbackSurveys.title,
  term: teacherFeedbackSurveys.term,
  status: teacherFeedbackSurveys.status,
  openDate: teacherFeedbackSurveys.openDate,
  closeDate: teacherFeedbackSurveys.closeDate,
  anonymityThreshold: teacherFeedbackSurveys.anonymityThreshold,
  respondentRoles: teacherFeedbackSurveys.respondentRoles,
  classIds: teacherFeedbackSurveys.classIds,
  questions: teacherFeedbackSurveys.questions,
  publishedAt: teacherFeedbackSurveys.publishedAt,
  closedAt: teacherFeedbackSurveys.closedAt,
  createdAt: teacherFeedbackSurveys.createdAt,
  updatedAt: teacherFeedbackSurveys.updatedAt,
  version: teacherFeedbackSurveys.version,
}

type SurveyRow = {
  id: string
  title: string
  term: string
  status: TeacherFeedbackStatus
  openDate: string
  closeDate: string
  anonymityThreshold: number
  respondentRoles: TeacherFeedbackRespondentRole[]
  classIds: string[]
  questions: TeacherFeedbackQuestion[]
  publishedAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
  version: number
}

const toSurvey = ({
  respondentRoles,
  classIds,
  ...row
}: SurveyRow): StoredTeacherFeedbackSurvey => ({
  ...row,
  audience: { respondents: respondentRoles, classIds },
  publishedAt: row.publishedAt?.toISOString() ?? null,
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const draftColumns = (draft: TeacherFeedbackDraft) => ({
  title: draft.title,
  term: draft.term,
  openDate: draft.openDate,
  closeDate: draft.closeDate,
  anonymityThreshold: draft.anonymityThreshold,
  respondentRoles: draft.audience.respondents,
  classIds: draft.audience.classIds,
  questions: draft.questions,
})

export async function findTeacherFeedbackSurvey(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredTeacherFeedbackSurvey | null> {
  const [row] = await db
    .select(SURVEY_COLUMNS)
    .from(teacherFeedbackSurveys)
    .where(and(surveyOf(institutionId), eq(teacherFeedbackSurveys.id, id)))
    .limit(1)
  return row === undefined ? null : toSurvey(row)
}

export async function insertTeacherFeedbackSurvey(
  tx: Database,
  institutionId: string,
  input: TeacherFeedbackDraft & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  await tx.insert(teacherFeedbackSurveys).values({
    institutionId,
    id: input.id,
    ...draftColumns(input),
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

const versioned = (
  institutionId: string,
  id: string,
  expectedVersion: number,
  status: TeacherFeedbackStatus,
) =>
  and(
    surveyOf(institutionId),
    eq(teacherFeedbackSurveys.id, id),
    eq(teacherFeedbackSurveys.version, expectedVersion),
    eq(teacherFeedbackSurveys.status, status),
  )

/** Taslak düzeltmesi; sürüm tutmazsa ya da taslak değilse `false` (409). */
export async function updateTeacherFeedbackDraft(
  tx: Database,
  institutionId: string,
  input: TeacherFeedbackDraft & { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(teacherFeedbackSurveys)
    .set({ ...draftColumns(input), updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(versioned(institutionId, input.id, input.expectedVersion, 'draft'))
    .returning({ id: teacherFeedbackSurveys.id })
  return rows.length === 1
}

/** Yayım; sürüm tutmazsa `false`. */
export async function publishTeacherFeedbackSurvey(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(teacherFeedbackSurveys)
    .set({
      status: 'published',
      publishedAt: input.now,
      publishedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion, 'draft'))
    .returning({ id: teacherFeedbackSurveys.id })
  return rows.length === 1
}

/** Taslağı kaldırır (arşiv); sürüm tutmazsa `false`. */
export async function archiveTeacherFeedbackSurvey(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(teacherFeedbackSurveys)
    .set({
      status: 'archived',
      archivedAt: input.now,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion, 'draft'))
    .returning({ id: teacherFeedbackSurveys.id })
  return rows.length === 1
}

/** Erken kapatma: yalnız `closed_at` boşken; sürüm tutmazsa `false`. */
export async function closeTeacherFeedbackSurvey(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(teacherFeedbackSurveys)
    .set({
      closedAt: input.now,
      closedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        versioned(institutionId, input.id, input.expectedVersion, 'published'),
        isNull(teacherFeedbackSurveys.closedAt),
      ),
    )
    .returning({ id: teacherFeedbackSurveys.id })
  return rows.length === 1
}

// --- Katılım ve yanıt ----------------------------------------------------------------------------

/** Anket başına yanıt sayısı (katılım satırı) ve yanıtlayan kişi sayısı. */
export async function teacherFeedbackCounts(
  db: Database,
  institutionId: string,
  surveyIds: readonly string[],
): Promise<Map<string, { responses: number; respondents: number }>> {
  if (surveyIds.length === 0) return new Map()
  const rows = await db
    .select({
      surveyId: teacherFeedbackParticipations.surveyId,
      responses: count(),
      respondents:
        sql<number>`count(distinct ${teacherFeedbackParticipations.membershipId})`.mapWith(Number),
    })
    .from(teacherFeedbackParticipations)
    .where(
      and(
        eq(teacherFeedbackParticipations.institutionId, institutionId),
        inArray(teacherFeedbackParticipations.surveyId, [...surveyIds]),
      ),
    )
    .groupBy(teacherFeedbackParticipations.surveyId)
  return new Map(
    rows.map((row) => [row.surveyId, { responses: row.responses, respondents: row.respondents }]),
  )
}

/** Yanıtlayanın ankette değerlendirdiği öğretmenler, anket başına. */
export async function respondedTeachers(
  db: Database,
  institutionId: string,
  membershipId: string,
  surveyIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  if (surveyIds.length === 0) return new Map()
  const rows = await db
    .select({
      surveyId: teacherFeedbackParticipations.surveyId,
      teacherId: teacherFeedbackParticipations.teacherId,
    })
    .from(teacherFeedbackParticipations)
    .where(
      and(
        eq(teacherFeedbackParticipations.institutionId, institutionId),
        eq(teacherFeedbackParticipations.membershipId, membershipId),
        inArray(teacherFeedbackParticipations.surveyId, [...surveyIds]),
      ),
    )
  const map = new Map<string, Set<string>>()
  for (const row of rows)
    map.set(row.surveyId, (map.get(row.surveyId) ?? new Set()).add(row.teacherId))
  return map
}

/**
 * Katılımı yazar (K-533); zaman kolonları yayım anıdır. Aynı üyelik × öğretmen zaten varsa
 * `false` (409).
 */
export async function insertTeacherFeedbackParticipation(
  tx: Database,
  institutionId: string,
  input: { surveyId: string; membershipId: string; teacherId: string; at: Date },
): Promise<boolean> {
  const rows = await tx
    .insert(teacherFeedbackParticipations)
    .values({
      institutionId,
      surveyId: input.surveyId,
      membershipId: input.membershipId,
      teacherId: input.teacherId,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .onConflictDoNothing()
    .returning({ surveyId: teacherFeedbackParticipations.surveyId })
  return rows.length === 1
}

/** Anonim yanıt: kişi kimliği ve rol yok; zaman kolonları anketin yayım anıdır (K-533). */
export async function insertTeacherFeedbackResponse(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    surveyId: string
    teacherId: string
    classId: string
    answers: TeacherFeedbackAnswer[]
    at: Date
  },
): Promise<void> {
  await tx.insert(teacherFeedbackResponses).values({
    institutionId,
    id: input.id,
    surveyId: input.surveyId,
    teacherId: input.teacherId,
    classId: input.classId,
    answers: input.answers,
    createdAt: input.at,
    updatedAt: input.at,
  })
}

/** Toplu sonucun girdisi: öğretmen, sınıf ve cevaplar, rastgele kimlik sırasıyla (K-532). */
export async function loadTeacherFeedbackResponses(
  db: Database,
  institutionId: string,
  surveyIds: readonly string[],
  teacherId?: string,
): Promise<(TeacherFeedbackStoredResponse & { surveyId: string })[]> {
  if (surveyIds.length === 0) return []
  return db
    .select({
      surveyId: teacherFeedbackResponses.surveyId,
      teacherId: teacherFeedbackResponses.teacherId,
      classId: teacherFeedbackResponses.classId,
      answers: teacherFeedbackResponses.answers,
    })
    .from(teacherFeedbackResponses)
    .where(
      and(
        eq(teacherFeedbackResponses.institutionId, institutionId),
        inArray(teacherFeedbackResponses.surveyId, [...surveyIds]),
        teacherId === undefined ? undefined : eq(teacherFeedbackResponses.teacherId, teacherId),
      ),
    )
    .orderBy(asc(teacherFeedbackResponses.id))
}

// --- Listeler ------------------------------------------------------------------------------------

const closedWhere = (today: string) =>
  and(
    eq(teacherFeedbackSurveys.status, 'published'),
    or(isNotNull(teacherFeedbackSurveys.closedAt), lt(teacherFeedbackSurveys.closeDate, today)),
  )
const notClosedWhere = (today: string) =>
  and(
    eq(teacherFeedbackSurveys.status, 'published'),
    isNull(teacherFeedbackSurveys.closedAt),
    gte(teacherFeedbackSurveys.closeDate, today),
  )

function phaseFilter(phase: TeacherFeedbackPhase | undefined, today: string) {
  switch (phase) {
    case undefined:
      return undefined
    case 'draft':
      return eq(teacherFeedbackSurveys.status, 'draft')
    case 'scheduled':
      return and(notClosedWhere(today), gt(teacherFeedbackSurveys.openDate, today))
    case 'open':
      return and(notClosedWhere(today), lte(teacherFeedbackSurveys.openDate, today))
    case 'closed':
      return closedWhere(today)
    default:
      return phase satisfies never
  }
}

export interface TeacherFeedbackListQuery {
  page: number
  pageSize: number
  q?: string | undefined
  phase?: TeacherFeedbackPhase | undefined
}

/** Kurumun anketleri (arşivli taslak hariç), en yeni açılış önce; başlık ve dönemde arama. */
export async function listTeacherFeedbackSurveys(
  db: Database,
  institutionId: string,
  query: TeacherFeedbackListQuery & { today: string },
): Promise<{ items: StoredTeacherFeedbackSurvey[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    surveyOf(institutionId),
    phaseFilter(query.phase, query.today),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(teacherFeedbackSurveys.title)}, ${search}) > 0`,
          sql`strpos(${foldSql(teacherFeedbackSurveys.term)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db.select({ total: count() }).from(teacherFeedbackSurveys).where(where)
  const rows = await db
    .select(SURVEY_COLUMNS)
    .from(teacherFeedbackSurveys)
    .where(where)
    .orderBy(
      desc(teacherFeedbackSurveys.openDate),
      desc(teacherFeedbackSurveys.createdAt),
      asc(teacherFeedbackSurveys.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toSurvey), total: totalRow?.total ?? 0 }
}

/** Rolün yanıtlayabileceği, kapanmamış yayımlanmış anketler, kapanışı yakın önce (K-533). */
export async function listOpenTeacherFeedbackSurveys(
  db: Database,
  institutionId: string,
  query: { role: TeacherFeedbackRespondentRole; today: string },
): Promise<StoredTeacherFeedbackSurvey[]> {
  const rows = await db
    .select(SURVEY_COLUMNS)
    .from(teacherFeedbackSurveys)
    .where(
      and(
        surveyOf(institutionId),
        notClosedWhere(query.today),
        sql`${teacherFeedbackSurveys.respondentRoles} @> ${JSON.stringify([query.role])}::jsonb`,
      ),
    )
    .orderBy(asc(teacherFeedbackSurveys.closeDate), asc(teacherFeedbackSurveys.id))
  return rows.map(toSurvey)
}

/**
 * Öğretmenin yanıt aldığı kapanmış anketler, en yeni kapanış önce, en çok `limit` (eğilim ve
 * "geri bildirim sonuçlarım").
 */
export async function closedSurveysOfTeacher(
  db: Database,
  institutionId: string,
  query: { teacherId: string; today: string; limit: number },
): Promise<StoredTeacherFeedbackSurvey[]> {
  const withResponses = db
    .select({ surveyId: teacherFeedbackResponses.surveyId })
    .from(teacherFeedbackResponses)
    .where(
      and(
        eq(teacherFeedbackResponses.institutionId, institutionId),
        eq(teacherFeedbackResponses.teacherId, query.teacherId),
      ),
    )
  const rows = await db
    .select(SURVEY_COLUMNS)
    .from(teacherFeedbackSurveys)
    .where(
      and(
        surveyOf(institutionId),
        closedWhere(query.today),
        inArray(teacherFeedbackSurveys.id, withResponses),
      ),
    )
    .orderBy(desc(teacherFeedbackSurveys.closeDate), asc(teacherFeedbackSurveys.id))
    .limit(query.limit)
  return rows.map(toSurvey)
}
