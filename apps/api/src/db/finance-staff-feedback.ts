import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  DEFAULT_STAFF_FEEDBACK_SETTINGS,
  type StaffFeedbackAnswer,
  type StaffFeedbackChannel,
  type StaffFeedbackQuestion,
  type StaffFeedbackRelation,
  type StaffFeedbackSettings,
  type StaffFeedbackStatus,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { performanceReviews } from './schema/finance-performance.ts'
import {
  staffFeedbackAssignments,
  staffFeedbackSettings,
  staffFeedbackTemplates,
} from './schema/finance-staff-feedback.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Çok kaynaklı geri bildirim deposu (DOM-FIN-134; ON-212). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-feedback.ts`'tedir. Personel üyelikten (Better
 * Auth `memberships`, `users`) ve dönemin performans kaydından yalnız okunur. Liste ve sayım
 * fonksiyonları cevap döndürmez; cevap yalnız toplu sonuç için `loadSubmittedStaffFeedback`'ten
 * okunur (K-459). Arşivli (kaldırılmış) atama hiçbir yerde sayılmaz.
 */

const templateOf = (institutionId: string) =>
  eq(staffFeedbackTemplates.institutionId, institutionId)
const activeAssignmentOf = (institutionId: string) =>
  and(
    eq(staffFeedbackAssignments.institutionId, institutionId),
    isNull(staffFeedbackAssignments.archivedAt),
  )

const subjectMembers = alias(memberships, 'subject_members')
const subjectUsers = alias(users, 'subject_users')
const reviewerMembers = alias(memberships, 'reviewer_members')
const reviewerUsers = alias(users, 'reviewer_users')

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredStaffFeedbackSettings extends StaffFeedbackSettings {
  version: number
}

/** Kurum ayarı; satır yoksa varsayılan ve sürüm 1 (K-459). */
export async function loadStaffFeedbackSettings(
  db: Database,
  institutionId: string,
): Promise<StoredStaffFeedbackSettings> {
  const [row] = await db
    .select({
      peerAnonymityThreshold: staffFeedbackSettings.peerAnonymityThreshold,
      version: staffFeedbackSettings.version,
    })
    .from(staffFeedbackSettings)
    .where(eq(staffFeedbackSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_STAFF_FEEDBACK_SETTINGS, version: 1 }
}

/** Ayarı sürüm koşuluyla yazar; tutmazsa `false` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveStaffFeedbackSettings(
  tx: Database,
  institutionId: string,
  input: StaffFeedbackSettings & { expectedVersion: number; now: Date },
): Promise<boolean> {
  const [updated] = await tx
    .update(staffFeedbackSettings)
    .set({
      peerAnonymityThreshold: input.peerAnonymityThreshold,
      updatedAt: input.now,
      version: sql`${staffFeedbackSettings.version} + 1`,
    })
    .where(
      and(
        eq(staffFeedbackSettings.institutionId, institutionId),
        eq(staffFeedbackSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: staffFeedbackSettings.version })
  if (updated !== undefined) return true
  if (input.expectedVersion !== 1) return false
  const [created] = await tx
    .insert(staffFeedbackSettings)
    .values({
      institutionId,
      peerAnonymityThreshold: input.peerAnonymityThreshold,
      version: 2,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ version: staffFeedbackSettings.version })
  return created !== undefined
}

// --- Şablon --------------------------------------------------------------------------------------

export interface StoredStaffFeedbackTemplate {
  id: string
  periodId: string
  questions: StaffFeedbackQuestion[]
  createdAt: string
  updatedAt: string
  version: number
}

const TEMPLATE_COLUMNS = {
  id: staffFeedbackTemplates.id,
  periodId: staffFeedbackTemplates.periodId,
  questions: staffFeedbackTemplates.questions,
  createdAt: staffFeedbackTemplates.createdAt,
  updatedAt: staffFeedbackTemplates.updatedAt,
  version: staffFeedbackTemplates.version,
}

const toTemplate = (row: {
  id: string
  periodId: string
  questions: StaffFeedbackQuestion[]
  createdAt: Date
  updatedAt: Date
  version: number
}): StoredStaffFeedbackTemplate => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export async function findStaffFeedbackTemplate(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffFeedbackTemplate | null> {
  const [row] = await db
    .select(TEMPLATE_COLUMNS)
    .from(staffFeedbackTemplates)
    .where(and(templateOf(institutionId), eq(staffFeedbackTemplates.id, id)))
    .limit(1)
  return row === undefined ? null : toTemplate(row)
}

export async function findPeriodStaffFeedbackTemplate(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<StoredStaffFeedbackTemplate | null> {
  const [row] = await db
    .select(TEMPLATE_COLUMNS)
    .from(staffFeedbackTemplates)
    .where(and(templateOf(institutionId), eq(staffFeedbackTemplates.periodId, periodId)))
    .limit(1)
  return row === undefined ? null : toTemplate(row)
}

export async function insertStaffFeedbackTemplate(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    questions: StaffFeedbackQuestion[]
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx
    .insert(staffFeedbackTemplates)
    .values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

/** Soru düzeltmesi; sürüm tutmazsa `false` (409). */
export async function updateStaffFeedbackTemplate(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; questions: StaffFeedbackQuestion[]; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffFeedbackTemplates)
    .set({ questions: input.questions, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        templateOf(institutionId),
        eq(staffFeedbackTemplates.id, input.id),
        eq(staffFeedbackTemplates.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffFeedbackTemplates.id })
  return rows.length === 1
}

/**
 * Şablonla girilmiş yanıt sayısı (şablon kilidi; K-457). Geri alınan yanıt da sayılır: şablon
 * kimliği atamada kalır, sorular bir kez yanıtlandıktan sonra değişmez.
 */
export async function templateResponseCount(
  db: Database,
  institutionId: string,
  templateId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(staffFeedbackAssignments)
    .where(
      and(
        eq(staffFeedbackAssignments.institutionId, institutionId),
        eq(staffFeedbackAssignments.templateId, templateId),
      ),
    )
  return row?.total ?? 0
}

// --- Sayım ve takip ------------------------------------------------------------------------------

/** Dönemin etkin atamaları, ilişki ve duruma göre (K-458). */
export async function staffFeedbackCounts(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<{ relation: StaffFeedbackRelation; status: StaffFeedbackStatus; total: number }[]> {
  return db
    .select({
      relation: staffFeedbackAssignments.relation,
      status: staffFeedbackAssignments.status,
      total: count(),
    })
    .from(staffFeedbackAssignments)
    .where(and(activeAssignmentOf(institutionId), eq(staffFeedbackAssignments.periodId, periodId)))
    .groupBy(staffFeedbackAssignments.relation, staffFeedbackAssignments.status)
}

export interface StaffFeedbackSubjectRow {
  membershipId: string
  staffName: string
  staffRole: string
  counts: { relation: StaffFeedbackRelation; status: StaffFeedbackStatus; total: number }[]
}

export interface StaffFeedbackSubjectQuery {
  page: number
  pageSize: number
  q?: string | undefined
}

/**
 * Dönemin değerlendirilenleri (performans kaydı olan personel), ada göre, atama sayılarıyla.
 * Cevap ve değerlendiren adı dönmez.
 */
export async function listStaffFeedbackSubjects(
  db: Database,
  institutionId: string,
  periodId: string,
  query: StaffFeedbackSubjectQuery,
): Promise<{ items: StaffFeedbackSubjectRow[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const memberJoin = and(
    eq(memberships.institutionId, performanceReviews.institutionId),
    eq(memberships.id, performanceReviews.membershipId),
  )
  const where = and(
    eq(performanceReviews.institutionId, institutionId),
    eq(performanceReviews.periodId, periodId),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(performanceReviews)
    .innerJoin(memberships, memberJoin)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await db
    .select({
      membershipId: performanceReviews.membershipId,
      staffName: users.name,
      staffRole: memberships.role,
    })
    .from(performanceReviews)
    .innerJoin(memberships, memberJoin)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(performanceReviews.membershipId))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const ids = rows.map((row) => row.membershipId)
  const counts =
    ids.length === 0
      ? []
      : await db
          .select({
            membershipId: staffFeedbackAssignments.subjectMembershipId,
            relation: staffFeedbackAssignments.relation,
            status: staffFeedbackAssignments.status,
            total: count(),
          })
          .from(staffFeedbackAssignments)
          .where(
            and(
              activeAssignmentOf(institutionId),
              eq(staffFeedbackAssignments.periodId, periodId),
              inArray(staffFeedbackAssignments.subjectMembershipId, ids),
            ),
          )
          .groupBy(
            staffFeedbackAssignments.subjectMembershipId,
            staffFeedbackAssignments.relation,
            staffFeedbackAssignments.status,
          )
  return {
    items: rows.map((row) => ({
      ...row,
      counts: counts
        .filter((entry) => entry.membershipId === row.membershipId)
        .map(({ relation, status, total }) => ({ relation, status, total })),
    })),
    total: totalRow?.total ?? 0,
  }
}

/** Değerlendirilen dönemde performans kaydı olan personel mi; adı ve rolüyle, yoksa `null`. */
export async function findStaffFeedbackSubject(
  db: Database,
  institutionId: string,
  periodId: string,
  membershipId: string,
): Promise<{ membershipId: string; staffName: string; staffRole: string; userId: string } | null> {
  const [row] = await db
    .select({
      membershipId: performanceReviews.membershipId,
      staffName: users.name,
      staffRole: memberships.role,
      userId: memberships.userId,
    })
    .from(performanceReviews)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, performanceReviews.institutionId),
        eq(memberships.id, performanceReviews.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(performanceReviews.institutionId, institutionId),
        eq(performanceReviews.periodId, periodId),
        eq(performanceReviews.membershipId, membershipId),
      ),
    )
    .limit(1)
  return row ?? null
}

// --- Atama ---------------------------------------------------------------------------------------

export interface StoredStaffFeedbackAssignment {
  id: string
  periodId: string
  subjectMembershipId: string
  subjectName: string
  subjectUserId: string
  reviewerMembershipId: string
  reviewerName: string
  reviewerRole: string
  relation: StaffFeedbackRelation
  status: StaffFeedbackStatus
  channel: StaffFeedbackChannel | null
  submittedAt: string | null
  withdrawCount: number
  withdrawnAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

/** Atama satırı: cevap ve geri alma gerekçesi dönmez (K-459). */
const ASSIGNMENT_COLUMNS = {
  id: staffFeedbackAssignments.id,
  periodId: staffFeedbackAssignments.periodId,
  subjectMembershipId: staffFeedbackAssignments.subjectMembershipId,
  subjectName: subjectUsers.name,
  subjectUserId: subjectMembers.userId,
  reviewerMembershipId: staffFeedbackAssignments.reviewerMembershipId,
  reviewerName: reviewerUsers.name,
  reviewerRole: reviewerMembers.role,
  relation: staffFeedbackAssignments.relation,
  status: staffFeedbackAssignments.status,
  channel: staffFeedbackAssignments.channel,
  submittedAt: staffFeedbackAssignments.submittedAt,
  withdrawCount: staffFeedbackAssignments.withdrawCount,
  withdrawnAt: staffFeedbackAssignments.withdrawnAt,
  createdAt: staffFeedbackAssignments.createdAt,
  updatedAt: staffFeedbackAssignments.updatedAt,
  version: staffFeedbackAssignments.version,
}

type AssignmentRow = Omit<
  StoredStaffFeedbackAssignment,
  'submittedAt' | 'withdrawnAt' | 'createdAt' | 'updatedAt'
> & { submittedAt: Date | null; withdrawnAt: Date | null; createdAt: Date; updatedAt: Date }

const toAssignment = (row: AssignmentRow): StoredStaffFeedbackAssignment => ({
  ...row,
  submittedAt: row.submittedAt?.toISOString() ?? null,
  withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

function assignmentSelect(db: Database) {
  return db
    .select(ASSIGNMENT_COLUMNS)
    .from(staffFeedbackAssignments)
    .innerJoin(
      subjectMembers,
      and(
        eq(subjectMembers.institutionId, staffFeedbackAssignments.institutionId),
        eq(subjectMembers.id, staffFeedbackAssignments.subjectMembershipId),
      ),
    )
    .innerJoin(subjectUsers, eq(subjectUsers.id, subjectMembers.userId))
    .innerJoin(
      reviewerMembers,
      and(
        eq(reviewerMembers.institutionId, staffFeedbackAssignments.institutionId),
        eq(reviewerMembers.id, staffFeedbackAssignments.reviewerMembershipId),
      ),
    )
    .innerJoin(reviewerUsers, eq(reviewerUsers.id, reviewerMembers.userId))
}

export async function findStaffFeedbackAssignment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffFeedbackAssignment | null> {
  const [row] = await assignmentSelect(db)
    .where(and(activeAssignmentOf(institutionId), eq(staffFeedbackAssignments.id, id)))
    .limit(1)
  return row === undefined ? null : toAssignment(row)
}

export interface StaffFeedbackAssignmentQuery {
  page: number
  pageSize: number
  q?: string | undefined
  subjectMembershipId?: string | undefined
  relation?: StaffFeedbackRelation | undefined
  status?: StaffFeedbackStatus | undefined
}

/** Dönemin etkin atamaları; değerlendirilen ve değerlendiren adına göre sıralı, adlarda arama. */
export async function listStaffFeedbackAssignments(
  db: Database,
  institutionId: string,
  periodId: string,
  query: StaffFeedbackAssignmentQuery,
): Promise<{ items: StoredStaffFeedbackAssignment[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    activeAssignmentOf(institutionId),
    eq(staffFeedbackAssignments.periodId, periodId),
    query.subjectMembershipId === undefined
      ? undefined
      : eq(staffFeedbackAssignments.subjectMembershipId, query.subjectMembershipId),
    query.relation === undefined
      ? undefined
      : eq(staffFeedbackAssignments.relation, query.relation),
    query.status === undefined ? undefined : eq(staffFeedbackAssignments.status, query.status),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(subjectUsers.name)}, ${search}) > 0 or strpos(${foldSql(reviewerUsers.name)}, ${search}) > 0)`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(staffFeedbackAssignments)
    .innerJoin(
      subjectMembers,
      and(
        eq(subjectMembers.institutionId, staffFeedbackAssignments.institutionId),
        eq(subjectMembers.id, staffFeedbackAssignments.subjectMembershipId),
      ),
    )
    .innerJoin(subjectUsers, eq(subjectUsers.id, subjectMembers.userId))
    .innerJoin(
      reviewerMembers,
      and(
        eq(reviewerMembers.institutionId, staffFeedbackAssignments.institutionId),
        eq(reviewerMembers.id, staffFeedbackAssignments.reviewerMembershipId),
      ),
    )
    .innerJoin(reviewerUsers, eq(reviewerUsers.id, reviewerMembers.userId))
    .where(where)
  const rows = await assignmentSelect(db)
    .where(where)
    .orderBy(
      asc(foldSql(subjectUsers.name)),
      asc(staffFeedbackAssignments.relation),
      asc(foldSql(reviewerUsers.name)),
      asc(staffFeedbackAssignments.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toAssignment), total: totalRow?.total ?? 0 }
}

/** Aynı değerlendirilen × değerlendiren dönemde etkin atanmış mı (K-458). */
export async function staffFeedbackPairExists(
  db: Database,
  institutionId: string,
  input: { periodId: string; subjectMembershipId: string; reviewerMembershipId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffFeedbackAssignments.id })
    .from(staffFeedbackAssignments)
    .where(
      and(
        activeAssignmentOf(institutionId),
        eq(staffFeedbackAssignments.periodId, input.periodId),
        eq(staffFeedbackAssignments.subjectMembershipId, input.subjectMembershipId),
        eq(staffFeedbackAssignments.reviewerMembershipId, input.reviewerMembershipId),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function insertStaffFeedbackAssignment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    subjectMembershipId: string
    reviewerMembershipId: string
    relation: StaffFeedbackRelation
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx
    .insert(staffFeedbackAssignments)
    .values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

const versioned = (institutionId: string, id: string, expectedVersion: number) =>
  and(
    activeAssignmentOf(institutionId),
    eq(staffFeedbackAssignments.id, id),
    eq(staffFeedbackAssignments.version, expectedVersion),
  )

/** Yanıtı girilmemiş atamayı arşivler; sürüm tutmazsa `false` (409). */
export async function archiveStaffFeedbackAssignment(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffFeedbackAssignments)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        versioned(institutionId, input.id, input.expectedVersion),
        eq(staffFeedbackAssignments.status, 'pending'),
      ),
    )
    .returning({ id: staffFeedbackAssignments.id })
  return rows.length === 1
}

/** Yanıt girişi: cevaplar, kanal ve şablon yazılır, durum yanıtlandı; sürüm tutmazsa `false`. */
export async function recordStaffFeedbackResponse(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    templateId: string
    answers: StaffFeedbackAnswer[]
    channel: StaffFeedbackChannel
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(staffFeedbackAssignments)
    .set({
      status: 'submitted',
      templateId: input.templateId,
      answers: input.answers,
      channel: input.channel,
      submittedAt: input.now,
      submittedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: staffFeedbackAssignments.id })
  return rows.length === 1
}

/** Geri alma: cevaplar silinir, yanıt bekleniyor olur; son gerekçe saklanır (K-458). */
export async function withdrawStaffFeedbackResponse(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; reason: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffFeedbackAssignments)
    .set({
      status: 'pending',
      answers: null,
      channel: null,
      submittedAt: null,
      submittedByUserId: null,
      withdrawCount: sql`${staffFeedbackAssignments.withdrawCount} + 1`,
      withdrawnAt: input.now,
      withdrawnByUserId: input.userId,
      withdrawReason: input.reason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: staffFeedbackAssignments.id })
  return rows.length === 1
}

// --- Toplu sonuç girdisi -------------------------------------------------------------------------

export interface StaffFeedbackResultRow {
  subjectMembershipId: string
  relation: StaffFeedbackRelation
  status: StaffFeedbackStatus
  // kvkk: K
  reviewerName: string
  submittedAt: string | null
  // kvkk: K (puan ve serbest metin)
  answers: StaffFeedbackAnswer[] | null
}

/**
 * Dönemin etkin atamaları ve girilmiş cevapları (toplu sonucun girdisi; K-459). Yalnız
 * `multiSourceFeedbackResult`'a verilir; meslektaş cevabı bu satırlarla istemciye dönmez.
 * `subjectMembershipIds` verilirse yalnız o değerlendirilenler.
 */
export async function loadSubmittedStaffFeedback(
  db: Database,
  institutionId: string,
  periodId: string,
  subjectMembershipIds?: readonly string[],
): Promise<StaffFeedbackResultRow[]> {
  if (subjectMembershipIds !== undefined && subjectMembershipIds.length === 0) return []
  const rows = await db
    .select({
      subjectMembershipId: staffFeedbackAssignments.subjectMembershipId,
      relation: staffFeedbackAssignments.relation,
      status: staffFeedbackAssignments.status,
      reviewerName: reviewerUsers.name,
      submittedAt: staffFeedbackAssignments.submittedAt,
      answers: staffFeedbackAssignments.answers,
    })
    .from(staffFeedbackAssignments)
    .innerJoin(
      reviewerMembers,
      and(
        eq(reviewerMembers.institutionId, staffFeedbackAssignments.institutionId),
        eq(reviewerMembers.id, staffFeedbackAssignments.reviewerMembershipId),
      ),
    )
    .innerJoin(reviewerUsers, eq(reviewerUsers.id, reviewerMembers.userId))
    .where(
      and(
        activeAssignmentOf(institutionId),
        eq(staffFeedbackAssignments.periodId, periodId),
        subjectMembershipIds === undefined
          ? undefined
          : inArray(staffFeedbackAssignments.subjectMembershipId, [...subjectMembershipIds]),
      ),
    )
    .orderBy(asc(staffFeedbackAssignments.submittedAt), asc(staffFeedbackAssignments.id))
  return rows.map((row) => ({ ...row, submittedAt: row.submittedAt?.toISOString() ?? null }))
}
