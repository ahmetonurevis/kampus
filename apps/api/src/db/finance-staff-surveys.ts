import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import type {
  StaffSurveyAnswer,
  StaffSurveyCandidate,
  StaffSurveyDraft,
  StaffSurveyParticipant,
  StaffSurveyPhase,
  StaffSurveyQuestion,
  StaffSurveyStatus,
  StaffSurveyStoredResponse,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'
import { STAFF_ROLES, type StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships } from './schema/auth.ts'
import { orgAssignments, orgPositions, orgUnits } from './schema/finance-org-chart.ts'
import {
  staffSurveyParticipants,
  staffSurveyResponses,
  staffSurveys,
} from './schema/finance-staff-surveys.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Personel memnuniyet anketi deposu (DOM-FIN-143; ON-191). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-surveys.ts`'tedir. Personel üyelikten ve
 * organizasyon atamalarından yalnız okunur. Yanıt satırı kişiye bağlanmaz; yanıtlar yalnız toplu
 * sonuç için `loadStaffSurveyResponses`'tan okunur ve kimlik sırasıyla (rastgele UUID) döner,
 * giriş sırası taşımaz (K-485, K-486).
 */

const surveyOf = (institutionId: string) =>
  and(eq(staffSurveys.institutionId, institutionId), isNull(staffSurveys.archivedAt))

export interface StoredStaffSurvey extends StaffSurveyDraft {
  id: string
  revision: number
  sourceSurveyId: string | null
  status: StaffSurveyStatus
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const SURVEY_COLUMNS = {
  id: staffSurveys.id,
  title: staffSurveys.title,
  revision: staffSurveys.revision,
  sourceSurveyId: staffSurveys.sourceSurveyId,
  status: staffSurveys.status,
  openDate: staffSurveys.openDate,
  closeDate: staffSurveys.closeDate,
  anonymityThreshold: staffSurveys.anonymityThreshold,
  audienceRoles: staffSurveys.audienceRoles,
  audienceUnitIds: staffSurveys.audienceUnitIds,
  questions: staffSurveys.questions,
  publishedAt: staffSurveys.publishedAt,
  createdAt: staffSurveys.createdAt,
  updatedAt: staffSurveys.updatedAt,
  version: staffSurveys.version,
}

type SurveyRow = {
  id: string
  title: string
  revision: number
  sourceSurveyId: string | null
  status: StaffSurveyStatus
  openDate: string
  closeDate: string
  anonymityThreshold: number
  audienceRoles: StaffRole[]
  audienceUnitIds: string[]
  questions: StaffSurveyQuestion[]
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  version: number
}

const toSurvey = ({ audienceRoles, audienceUnitIds, ...row }: SurveyRow): StoredStaffSurvey => ({
  ...row,
  audience: { roles: audienceRoles, unitIds: audienceUnitIds },
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const draftColumns = (draft: StaffSurveyDraft) => ({
  title: draft.title,
  openDate: draft.openDate,
  closeDate: draft.closeDate,
  anonymityThreshold: draft.anonymityThreshold,
  audienceRoles: draft.audience.roles,
  audienceUnitIds: draft.audience.unitIds,
  questions: draft.questions,
})

export async function findStaffSurvey(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffSurvey | null> {
  const [row] = await db
    .select(SURVEY_COLUMNS)
    .from(staffSurveys)
    .where(and(surveyOf(institutionId), eq(staffSurveys.id, id)))
    .limit(1)
  return row === undefined ? null : toSurvey(row)
}

export async function insertStaffSurvey(
  tx: Database,
  institutionId: string,
  input: StaffSurveyDraft & {
    id: string
    revision: number
    sourceSurveyId: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(staffSurveys).values({
    institutionId,
    id: input.id,
    revision: input.revision,
    sourceSurveyId: input.sourceSurveyId,
    ...draftColumns(input),
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

const versioned = (institutionId: string, id: string, expectedVersion: number) =>
  and(
    surveyOf(institutionId),
    eq(staffSurveys.id, id),
    eq(staffSurveys.version, expectedVersion),
    eq(staffSurveys.status, 'draft'),
  )

/** Taslak düzeltmesi; sürüm tutmazsa ya da taslak değilse `false` (409). */
export async function updateStaffSurveyDraft(
  tx: Database,
  institutionId: string,
  input: StaffSurveyDraft & { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffSurveys)
    .set({ ...draftColumns(input), updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: staffSurveys.id })
  return rows.length === 1
}

/** Yayım: durum, yayım anı ve yayımlayan yazılır; sürüm tutmazsa `false`. */
export async function publishStaffSurvey(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffSurveys)
    .set({
      status: 'published',
      publishedAt: input.now,
      publishedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: staffSurveys.id })
  return rows.length === 1
}

/** Taslağı kaldırır (arşiv); sürüm tutmazsa `false`. */
export async function archiveStaffSurvey(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffSurveys)
    .set({
      status: 'archived',
      archivedAt: input.now,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: staffSurveys.id })
  return rows.length === 1
}

/** Yayımlanmış anketin etkin (arşivlenmemiş) yeni sürümü var mı. */
export async function staffSurveyCopyExists(
  db: Database,
  institutionId: string,
  sourceSurveyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffSurveys.id })
    .from(staffSurveys)
    .where(and(surveyOf(institutionId), eq(staffSurveys.sourceSurveyId, sourceSurveyId)))
    .limit(1)
  return row !== undefined
}

// --- Birim ve hedef kitle ------------------------------------------------------------------------

/** Kurumda bulunmayan birim kimlikleri (hedef kitle birim süzgeci). */
export async function unknownOrgUnitIds(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: orgUnits.id })
    .from(orgUnits)
    .where(and(eq(orgUnits.institutionId, institutionId), inArray(orgUnits.id, [...ids])))
  const known = new Set(rows.map((row) => row.id))
  return ids.filter((id) => !known.has(id))
}

export async function orgUnitNames(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: orgUnits.id, name: orgUnits.name })
    .from(orgUnits)
    .where(and(eq(orgUnits.institutionId, institutionId), inArray(orgUnits.id, [...ids])))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * Hedef kitle adayları (K-484): kurumun personel rollü üyelikleri, etkinlikleri ve `today`
 * günü süren organizasyon atamalarının birimleri (başlangıç gününe, sonra atama kimliğine göre).
 * Arşivli atama ve arşivli pozisyon sayılmaz. Süzgeç core `staffSurveyParticipants`'tadır.
 */
export async function loadStaffSurveyCandidates(
  db: Database,
  institutionId: string,
  today: string,
): Promise<StaffSurveyCandidate[]> {
  const [members, assignments] = await Promise.all([
    db
      .select({
        membershipId: memberships.id,
        role: memberships.role,
        deactivatedAt: memberships.deactivatedAt,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.institutionId, institutionId),
          inArray(memberships.role, [...STAFF_ROLES]),
        ),
      )
      .orderBy(asc(memberships.id)),
    db
      .select({ membershipId: orgAssignments.membershipId, unitId: orgPositions.unitId })
      .from(orgAssignments)
      .innerJoin(
        orgPositions,
        and(
          eq(orgPositions.institutionId, orgAssignments.institutionId),
          eq(orgPositions.id, orgAssignments.positionId),
        ),
      )
      .where(
        and(
          eq(orgAssignments.institutionId, institutionId),
          isNull(orgAssignments.archivedAt),
          isNull(orgPositions.archivedAt),
          lte(orgAssignments.startDate, today),
          or(isNull(orgAssignments.endDate), gte(orgAssignments.endDate, today)),
        ),
      )
      .orderBy(asc(orgAssignments.startDate), asc(orgAssignments.id)),
  ])
  const units = new Map<string, string[]>()
  for (const row of assignments) {
    const list = units.get(row.membershipId) ?? []
    if (!list.includes(row.unitId)) list.push(row.unitId)
    units.set(row.membershipId, list)
  }
  return members.map((row) => ({
    membershipId: row.membershipId,
    role: row.role,
    active: row.deactivatedAt === null,
    unitIds: units.get(row.membershipId) ?? [],
  }))
}

/** Yayımda donan katılımcılar; zaman kolonları yayım anıdır (K-485). */
export async function insertStaffSurveyParticipants(
  tx: Database,
  institutionId: string,
  input: { surveyId: string; participants: readonly StaffSurveyParticipant[]; now: Date },
): Promise<void> {
  if (input.participants.length === 0) return
  await tx.insert(staffSurveyParticipants).values(
    input.participants.map((participant) => ({
      institutionId,
      surveyId: input.surveyId,
      membershipId: participant.membershipId,
      unitId: participant.unitId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

// --- Katılım -------------------------------------------------------------------------------------

/** Anket başına katılımcı ve yanıtlayan sayısı. */
export async function staffSurveyParticipationCounts(
  db: Database,
  institutionId: string,
  surveyIds: readonly string[],
): Promise<Map<string, { participants: number; responded: number }>> {
  if (surveyIds.length === 0) return new Map()
  const rows = await db
    .select({
      surveyId: staffSurveyParticipants.surveyId,
      participants: count(),
      responded: sql<number>`count(*) filter (where ${staffSurveyParticipants.responded})`.mapWith(
        Number,
      ),
    })
    .from(staffSurveyParticipants)
    .where(
      and(
        eq(staffSurveyParticipants.institutionId, institutionId),
        inArray(staffSurveyParticipants.surveyId, [...surveyIds]),
      ),
    )
    .groupBy(staffSurveyParticipants.surveyId)
  return new Map(
    rows.map((row) => [row.surveyId, { participants: row.participants, responded: row.responded }]),
  )
}

export async function findStaffSurveyParticipant(
  db: Database,
  institutionId: string,
  surveyId: string,
  membershipId: string,
): Promise<{ unitId: string | null; responded: boolean } | null> {
  const [row] = await db
    .select({
      unitId: staffSurveyParticipants.unitId,
      responded: staffSurveyParticipants.responded,
    })
    .from(staffSurveyParticipants)
    .where(
      and(
        eq(staffSurveyParticipants.institutionId, institutionId),
        eq(staffSurveyParticipants.surveyId, surveyId),
        eq(staffSurveyParticipants.membershipId, membershipId),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Katılımı işaretler (K-485): yalnız `responded` değişir; `updated_at` yayım anında kalır.
 * Zaten işaretliyse `false` (409).
 */
export async function markStaffSurveyResponded(
  tx: Database,
  institutionId: string,
  input: { surveyId: string; membershipId: string },
): Promise<boolean> {
  const rows = await tx
    .update(staffSurveyParticipants)
    .set({ responded: true })
    .where(
      and(
        eq(staffSurveyParticipants.institutionId, institutionId),
        eq(staffSurveyParticipants.surveyId, input.surveyId),
        eq(staffSurveyParticipants.membershipId, input.membershipId),
        eq(staffSurveyParticipants.responded, false),
      ),
    )
    .returning({ surveyId: staffSurveyParticipants.surveyId })
  return rows.length === 1
}

/** Anonim yanıt: kişi kimliği yok; zaman kolonları anketin yayım anıdır (K-485). */
export async function insertStaffSurveyResponse(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    surveyId: string
    unitId: string | null
    answers: StaffSurveyAnswer[]
    at: Date
  },
): Promise<void> {
  await tx.insert(staffSurveyResponses).values({
    institutionId,
    id: input.id,
    surveyId: input.surveyId,
    unitId: input.unitId,
    answers: input.answers,
    createdAt: input.at,
    updatedAt: input.at,
  })
}

/** Toplu sonucun girdisi: birim ve cevaplar, rastgele kimlik sırasıyla (K-486). */
export async function loadStaffSurveyResponses(
  db: Database,
  institutionId: string,
  surveyId: string,
): Promise<StaffSurveyStoredResponse[]> {
  return db
    .select({ unitId: staffSurveyResponses.unitId, answers: staffSurveyResponses.answers })
    .from(staffSurveyResponses)
    .where(
      and(
        eq(staffSurveyResponses.institutionId, institutionId),
        eq(staffSurveyResponses.surveyId, surveyId),
      ),
    )
    .orderBy(asc(staffSurveyResponses.id))
}

// --- Listeler ------------------------------------------------------------------------------------

export interface StaffSurveyListQuery {
  page: number
  pageSize: number
  q?: string | undefined
  phase?: StaffSurveyPhase | undefined
}

/** Aşama süzgeci; aşama saklanmaz, durum ve İstanbul gününden hesaplanır (K-484). */
function phaseFilter(phase: StaffSurveyPhase | undefined, today: string) {
  switch (phase) {
    case undefined:
      return undefined
    case 'draft':
      return eq(staffSurveys.status, 'draft')
    case 'scheduled':
      return and(eq(staffSurveys.status, 'published'), gt(staffSurveys.openDate, today))
    case 'open':
      return and(
        eq(staffSurveys.status, 'published'),
        lte(staffSurveys.openDate, today),
        gte(staffSurveys.closeDate, today),
      )
    case 'closed':
      return and(eq(staffSurveys.status, 'published'), lt(staffSurveys.closeDate, today))
    default:
      return phase satisfies never
  }
}

/** Kurumun anketleri (arşivli taslak hariç), en yeni açılış önce; başlıkta arama. */
export async function listStaffSurveys(
  db: Database,
  institutionId: string,
  query: StaffSurveyListQuery & { today: string },
): Promise<{ items: StoredStaffSurvey[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    surveyOf(institutionId),
    phaseFilter(query.phase, query.today),
    search === undefined ? undefined : sql`strpos(${foldSql(staffSurveys.title)}, ${search}) > 0`,
  )
  const [totalRow] = await db.select({ total: count() }).from(staffSurveys).where(where)
  const rows = await db
    .select(SURVEY_COLUMNS)
    .from(staffSurveys)
    .where(where)
    .orderBy(desc(staffSurveys.openDate), desc(staffSurveys.createdAt), asc(staffSurveys.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toSurvey), total: totalRow?.total ?? 0 }
}

/**
 * Personelin katılımcısı olduğu, kapanmamış yayımlanmış anketler (K-485), kapanışı yakın önce;
 * katılım işaretiyle.
 */
export async function listAssignedStaffSurveys(
  db: Database,
  institutionId: string,
  query: { membershipId: string; today: string; page: number; pageSize: number },
): Promise<{ items: (StoredStaffSurvey & { responded: boolean })[]; total: number }> {
  const join = and(
    eq(staffSurveyParticipants.institutionId, staffSurveys.institutionId),
    eq(staffSurveyParticipants.surveyId, staffSurveys.id),
  )
  const where = and(
    surveyOf(institutionId),
    eq(staffSurveys.status, 'published'),
    gte(staffSurveys.closeDate, query.today),
    eq(staffSurveyParticipants.membershipId, query.membershipId),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(staffSurveys)
    .innerJoin(staffSurveyParticipants, join)
    .where(where)
  const rows = await db
    .select({ ...SURVEY_COLUMNS, responded: staffSurveyParticipants.responded })
    .from(staffSurveys)
    .innerJoin(staffSurveyParticipants, join)
    .where(where)
    .orderBy(asc(staffSurveys.closeDate), asc(staffSurveys.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ responded, ...row }) => ({ ...toSurvey(row), responded })),
    total: totalRow?.total ?? 0,
  }
}
