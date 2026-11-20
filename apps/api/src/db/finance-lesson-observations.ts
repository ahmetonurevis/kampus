import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  LessonObservationPatch,
  LessonObservationStatus,
  ObservationCriterion,
  ObservationMember,
  ObservationRating,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'

import type { Database } from './client.ts'
import { loadRecordsByIds } from './records.ts'
import { memberships, users } from './schema/auth.ts'
import {
  lessonObservations,
  lessonObservationTemplates,
  lessonObservationTemplateVersions,
} from './schema/finance-lesson-observations.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Ders gözlem formu deposu (DOM-FIN-130; ON-206). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-lesson-observations.ts`'tedir. Öğretmen ve gözlemci
 * üyelikten (Better Auth `memberships`, `users`), sınıf ve ders `records`'tan yalnız okunur.
 */

const templateOf = (institutionId: string) =>
  eq(lessonObservationTemplates.institutionId, institutionId)
const versionOf = (institutionId: string) =>
  eq(lessonObservationTemplateVersions.institutionId, institutionId)
const observationOf = (institutionId: string) => eq(lessonObservations.institutionId, institutionId)
/** Arşivlenmemiş gözlem: arşivli taslak okunmaz ve yazılmaz (K-446). */
const liveObservationOf = (institutionId: string) =>
  and(observationOf(institutionId), isNull(lessonObservations.archivedAt))

// --- Şablon --------------------------------------------------------------------------------------

export interface StoredObservationTemplate {
  id: string
  versionId: string
  versionNumber: number
  name: string
  criteria: ObservationCriterion[]
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const TEMPLATE_COLUMNS = {
  id: lessonObservationTemplates.id,
  versionId: lessonObservationTemplateVersions.id,
  versionNumber: lessonObservationTemplateVersions.versionNumber,
  name: lessonObservationTemplateVersions.name,
  criteria: lessonObservationTemplateVersions.criteria,
  archivedAt: lessonObservationTemplates.archivedAt,
  createdAt: lessonObservationTemplates.createdAt,
  updatedAt: lessonObservationTemplates.updatedAt,
  version: lessonObservationTemplates.version,
}

type TemplateRow = Omit<StoredObservationTemplate, 'archivedAt' | 'createdAt' | 'updatedAt'> & {
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toTemplate = (row: TemplateRow): StoredObservationTemplate => ({
  ...row,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Şablon ve son sürümü birlikte okunur. */
const templateBase = (db: Database) =>
  db
    .select(TEMPLATE_COLUMNS)
    .from(lessonObservationTemplates)
    .innerJoin(
      lessonObservationTemplateVersions,
      and(
        eq(
          lessonObservationTemplateVersions.institutionId,
          lessonObservationTemplates.institutionId,
        ),
        eq(lessonObservationTemplateVersions.templateId, lessonObservationTemplates.id),
        eq(
          lessonObservationTemplateVersions.versionNumber,
          lessonObservationTemplates.latestVersionNumber,
        ),
      ),
    )

export async function findObservationTemplate(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredObservationTemplate | null> {
  const [row] = await templateBase(db)
    .where(and(templateOf(institutionId), eq(lessonObservationTemplates.id, id)))
    .limit(1)
  return row === undefined ? null : toTemplate(row)
}

export interface ObservationTemplateQuery {
  page: number
  pageSize: number
  q?: string | undefined
  includeArchived?: boolean | undefined
}

/** Şablonlar son sürümleriyle, ada göre; arşivli yalnız istenirse. */
export async function listObservationTemplates(
  db: Database,
  institutionId: string,
  query: ObservationTemplateQuery,
): Promise<{ items: StoredObservationTemplate[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    templateOf(institutionId),
    query.includeArchived === true ? undefined : isNull(lessonObservationTemplates.archivedAt),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(lessonObservationTemplateVersions.name)}, ${search}) > 0`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(lessonObservationTemplates)
    .innerJoin(
      lessonObservationTemplateVersions,
      and(
        eq(
          lessonObservationTemplateVersions.institutionId,
          lessonObservationTemplates.institutionId,
        ),
        eq(lessonObservationTemplateVersions.templateId, lessonObservationTemplates.id),
        eq(
          lessonObservationTemplateVersions.versionNumber,
          lessonObservationTemplates.latestVersionNumber,
        ),
      ),
    )
    .where(where)
  const rows = await templateBase(db)
    .where(where)
    .orderBy(
      asc(foldSql(lessonObservationTemplateVersions.name)),
      asc(lessonObservationTemplates.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toTemplate), total: totalRow?.total ?? 0 }
}

/** Sürüm başına gözlem sayısı (kullanılmış sürüm değişmez; K-445). */
export async function observationCountsByVersion(
  db: Database,
  institutionId: string,
  versionIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (versionIds.length === 0) return counts
  const rows = await db
    .select({ versionId: lessonObservations.templateVersionId, total: count() })
    .from(lessonObservations)
    .where(
      and(
        observationOf(institutionId),
        inArray(lessonObservations.templateVersionId, [...new Set(versionIds)]),
      ),
    )
    .groupBy(lessonObservations.templateVersionId)
  for (const row of rows) counts.set(row.versionId, row.total)
  return counts
}

export async function insertObservationTemplate(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    versionId: string
    name: string
    criteria: ObservationCriterion[]
    userId: string
    now: Date
  },
): Promise<void> {
  const { now } = input
  await tx.insert(lessonObservationTemplates).values({
    institutionId,
    id: input.id,
    latestVersionNumber: 1,
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(lessonObservationTemplateVersions).values({
    institutionId,
    id: input.versionId,
    templateId: input.id,
    versionNumber: 1,
    name: input.name,
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
    .update(lessonObservationTemplates)
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
        eq(lessonObservationTemplates.id, input.id),
        eq(lessonObservationTemplates.version, input.expectedVersion),
      ),
    )
    .returning({ id: lessonObservationTemplates.id })
  return rows.length === 1
}

/** Kullanılmamış son sürümün yerinde düzeltmesi (K-445). */
export async function updateObservationTemplateVersion(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    versionId: string
    expectedVersion: number
    patch: { name?: string; criteria?: ObservationCriterion[] }
    now: Date
  },
): Promise<boolean> {
  if (!(await bumpTemplate(tx, institutionId, input))) return false
  await tx
    .update(lessonObservationTemplateVersions)
    .set({ ...input.patch, updatedAt: input.now })
    .where(and(versionOf(institutionId), eq(lessonObservationTemplateVersions.id, input.versionId)))
  return true
}

/** Yeni sürüm; şablonun son sürüm numarası ilerler (K-445). */
export async function insertObservationTemplateVersion(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    versionId: string
    versionNumber: number
    expectedVersion: number
    name: string
    criteria: ObservationCriterion[]
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
  await tx.insert(lessonObservationTemplateVersions).values({
    institutionId,
    id: input.versionId,
    templateId: input.id,
    versionNumber: input.versionNumber,
    name: input.name,
    criteria: input.criteria,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
  return true
}

export const archiveObservationTemplate = (
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
) => bumpTemplate(tx, institutionId, { ...input, archive: true })

// --- Gözlem --------------------------------------------------------------------------------------

export interface StoredLessonObservation {
  id: string
  templateId: string
  templateVersionId: string
  templateName: string
  templateVersionNumber: number
  criteria: ObservationCriterion[]
  teacherMembershipId: string
  teacherName: string
  observerMembershipId: string
  observerName: string
  observedDate: string
  classId: string | null
  subjectId: string | null
  performancePeriodId: string | null
  ratings: ObservationRating[]
  generalNote: string | null
  status: LessonObservationStatus
  completedAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const teacherMembership = alias(memberships, 'teacher_membership')
const teacherUser = alias(users, 'teacher_user')
const observerMembership = alias(memberships, 'observer_membership')
const observerUser = alias(users, 'observer_user')

const OBSERVATION_COLUMNS = {
  id: lessonObservations.id,
  templateId: lessonObservationTemplateVersions.templateId,
  templateVersionId: lessonObservations.templateVersionId,
  templateName: lessonObservationTemplateVersions.name,
  templateVersionNumber: lessonObservationTemplateVersions.versionNumber,
  criteria: lessonObservationTemplateVersions.criteria,
  teacherMembershipId: lessonObservations.teacherMembershipId,
  teacherName: teacherUser.name,
  observerMembershipId: lessonObservations.observerMembershipId,
  observerName: observerUser.name,
  observedDate: lessonObservations.observedDate,
  classId: lessonObservations.classId,
  subjectId: lessonObservations.subjectId,
  performancePeriodId: lessonObservations.performancePeriodId,
  ratings: lessonObservations.ratings,
  generalNote: lessonObservations.generalNote,
  status: lessonObservations.status,
  completedAt: lessonObservations.completedAt,
  createdAt: lessonObservations.createdAt,
  updatedAt: lessonObservations.updatedAt,
  version: lessonObservations.version,
}

type ObservationRow = Omit<StoredLessonObservation, 'completedAt' | 'createdAt' | 'updatedAt'> & {
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toObservation = (row: ObservationRow): StoredLessonObservation => ({
  ...row,
  completedAt: row.completedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

// Gözlem satırının sürüm, öğretmen ve gözlemci bağları (iki sorguda aynı birleşimler).
const ON_VERSION = and(
  eq(lessonObservationTemplateVersions.institutionId, lessonObservations.institutionId),
  eq(lessonObservationTemplateVersions.id, lessonObservations.templateVersionId),
)
const ON_TEACHER = and(
  eq(teacherMembership.institutionId, lessonObservations.institutionId),
  eq(teacherMembership.id, lessonObservations.teacherMembershipId),
)
const ON_OBSERVER = and(
  eq(observerMembership.institutionId, lessonObservations.institutionId),
  eq(observerMembership.id, lessonObservations.observerMembershipId),
)

const observationBase = (db: Database) =>
  db
    .select(OBSERVATION_COLUMNS)
    .from(lessonObservations)
    .innerJoin(lessonObservationTemplateVersions, ON_VERSION)
    .innerJoin(teacherMembership, ON_TEACHER)
    .innerJoin(teacherUser, eq(teacherUser.id, teacherMembership.userId))
    .innerJoin(observerMembership, ON_OBSERVER)
    .innerJoin(observerUser, eq(observerUser.id, observerMembership.userId))

const observationCount = (db: Database) =>
  db
    .select({ total: count() })
    .from(lessonObservations)
    .innerJoin(teacherMembership, ON_TEACHER)
    .innerJoin(teacherUser, eq(teacherUser.id, teacherMembership.userId))

/**
 * Öğretmenin görebildiği gözlemler (K-447): gözlemcisi olduğu her kayıt ve gözlendiği tamamlanmış
 * kayıt. Yönetici için süzgeç yoktur (`null`). Core `canViewLessonObservation` ile aynı kuraldır.
 */
const visibleTo = (viewerMembershipId: string | null): SQL | undefined =>
  viewerMembershipId === null
    ? undefined
    : or(
        eq(lessonObservations.observerMembershipId, viewerMembershipId),
        and(
          eq(lessonObservations.teacherMembershipId, viewerMembershipId),
          eq(lessonObservations.status, 'completed'),
        ),
      )

export async function findLessonObservation(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredLessonObservation | null> {
  const [row] = await observationBase(db)
    .where(and(liveObservationOf(institutionId), eq(lessonObservations.id, id)))
    .limit(1)
  return row === undefined ? null : toObservation(row)
}

export interface LessonObservationQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: LessonObservationStatus | undefined
  performancePeriodId?: string | undefined
}

/** Gözlemler, yeni gün önce; arama öğretmen adında. `viewerMembershipId` öğretmen süzgecidir. */
export async function listLessonObservations(
  db: Database,
  institutionId: string,
  query: LessonObservationQuery,
  viewerMembershipId: string | null,
): Promise<{ items: StoredLessonObservation[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    liveObservationOf(institutionId),
    visibleTo(viewerMembershipId),
    query.status === undefined ? undefined : eq(lessonObservations.status, query.status),
    query.performancePeriodId === undefined
      ? undefined
      : eq(lessonObservations.performancePeriodId, query.performancePeriodId),
    search === undefined ? undefined : sql`strpos(${foldSql(teacherUser.name)}, ${search}) > 0`,
  )
  const [totalRow] = await observationCount(db).where(where)
  const rows = await observationBase(db)
    .where(where)
    .orderBy(desc(lessonObservations.observedDate), asc(lessonObservations.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toObservation), total: totalRow?.total ?? 0 }
}

/** Kurumdaki üyelik (rol, etkin mi); yoksa `null`. */
export async function findObservationMember(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<ObservationMember | null> {
  const [row] = await db
    .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return row === undefined
    ? null
    : { membershipId, role: row.role, active: row.deactivatedAt === null }
}

/** Sınıf ya da ders kaydı kurumda var ve arşivli değil mi; `null` kimlikte `null` (istenmedi). */
export async function observationRecordExists(
  db: Database,
  institutionId: string,
  collection: 'classes' | 'subjects',
  id: string | null | undefined,
): Promise<boolean | null> {
  if (id === null || id === undefined) return null
  const rows = await loadRecordsByIds(db, institutionId, collection, [id])
  return rows.length === 1
}

/** Sınıf ve ders adları (arşivli dahil); bulunamayan kimlik eşlemede yoktur. */
export async function observationRecordNames(
  db: Database,
  institutionId: string,
  collection: 'classes' | 'subjects',
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  const rows = await loadRecordsByIds(db, institutionId, collection, wanted, {
    includeArchived: true,
  })
  const names = new Map<string, string>()
  for (const row of rows)
    if (typeof row.data.name === 'string' && row.data.name.trim() !== '')
      names.set(row.id, row.data.name)
  return names
}

export async function insertLessonObservation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    templateVersionId: string
    teacherMembershipId: string
    observerMembershipId: string
    observedDate: string
    classId: string | null
    subjectId: string | null
    performancePeriodId: string | null
    ratings: ObservationRating[]
    userId: string
    now: Date
  },
): Promise<void> {
  const { now, userId, ...rest } = input
  await tx.insert(lessonObservations).values({
    institutionId,
    ...rest,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Taslak düzeltmesi; yalnız taslak ve sürüm tutarsa yazar, değilse `false` (409). */
export async function updateLessonObservation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; patch: LessonObservationPatch; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(lessonObservations)
    .set({ ...input.patch, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveObservationOf(institutionId),
        eq(lessonObservations.id, input.id),
        eq(lessonObservations.version, input.expectedVersion),
        eq(lessonObservations.status, 'draft'),
      ),
    )
    .returning({ id: lessonObservations.id })
  return rows.length === 1
}

/** Tamamlama (K-446); yalnız taslak ve sürüm tutarsa. */
export async function completeLessonObservation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(lessonObservations)
    .set({
      status: 'completed',
      completedAt: input.now,
      completedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        liveObservationOf(institutionId),
        eq(lessonObservations.id, input.id),
        eq(lessonObservations.version, input.expectedVersion),
        eq(lessonObservations.status, 'draft'),
      ),
    )
    .returning({ id: lessonObservations.id })
  return rows.length === 1
}

/** Taslak arşivi (K-446); yalnız taslak ve sürüm tutarsa. */
export async function archiveLessonObservation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(lessonObservations)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveObservationOf(institutionId),
        eq(lessonObservations.id, input.id),
        eq(lessonObservations.version, input.expectedVersion),
        eq(lessonObservations.status, 'draft'),
      ),
    )
    .returning({ id: lessonObservations.id })
  return rows.length === 1
}
