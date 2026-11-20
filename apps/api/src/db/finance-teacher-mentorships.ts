import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  MentorshipChecklistTemplateItem,
  MentorshipMember,
  MentorshipStatus,
} from '@kampus/school-core/lib/finance-teacher-mentorships.ts'
import type { JobOfferStatus } from '@kampus/school-core/lib/finance-staff-onboarding.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffJobOffers } from './schema/finance-staff-onboarding.ts'
import {
  teacherMentorshipChecklistItems,
  teacherMentorshipMeetings,
  teacherMentorships,
  teacherMentorshipSettings,
} from './schema/finance-teacher-mentorships.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Yeni öğretmen mentorluğu deposu (DOM-FIN-136; ON-219). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-teacher-mentorships.ts`'tedir. Mentor ve yeni öğretmen
 * üyelikten (Better Auth `memberships`, `users`), işe başlama listesi `staff_job_offers`'tan
 * yalnız okunur.
 */

const mentorshipOf = (institutionId: string) => eq(teacherMentorships.institutionId, institutionId)
const meetingOf = (institutionId: string) =>
  eq(teacherMentorshipMeetings.institutionId, institutionId)
const itemOf = (institutionId: string) =>
  eq(teacherMentorshipChecklistItems.institutionId, institutionId)

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredMentorshipSettings {
  maxActivePerMentor: number
  checklistItems: MentorshipChecklistTemplateItem[]
  updatedAt: string
  version: number
}

export async function loadMentorshipSettings(
  db: Database,
  institutionId: string,
): Promise<StoredMentorshipSettings | null> {
  const [row] = await db
    .select({
      maxActivePerMentor: teacherMentorshipSettings.maxActivePerMentor,
      checklistItems: teacherMentorshipSettings.checklistItems,
      updatedAt: teacherMentorshipSettings.updatedAt,
      version: teacherMentorshipSettings.version,
    })
    .from(teacherMentorshipSettings)
    .where(eq(teacherMentorshipSettings.institutionId, institutionId))
    .limit(1)
  return row === undefined ? null : { ...row, updatedAt: row.updatedAt.toISOString() }
}

/** Ayarı yazar; ilk yazmada satır açılır. Sürüm tutmazsa `false` (409). */
export async function saveMentorshipSettings(
  tx: Database,
  institutionId: string,
  input: {
    maxActivePerMentor: number
    checklistItems: MentorshipChecklistTemplateItem[]
    expectedVersion: number | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  const values = {
    maxActivePerMentor: input.maxActivePerMentor,
    checklistItems: input.checklistItems,
    updatedByUserId: input.userId,
  }
  if (input.expectedVersion === null) {
    const rows = await tx
      .insert(teacherMentorshipSettings)
      .values({ institutionId, ...values, createdAt: input.now, updatedAt: input.now })
      .onConflictDoNothing()
      .returning({ id: teacherMentorshipSettings.institutionId })
    return rows.length === 1
  }
  const rows = await tx
    .update(teacherMentorshipSettings)
    .set({ ...values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(teacherMentorshipSettings.institutionId, institutionId),
        eq(teacherMentorshipSettings.version, input.expectedVersion),
      ),
    )
    .returning({ id: teacherMentorshipSettings.institutionId })
  return rows.length === 1
}

// --- Açılış gerçekleri ---------------------------------------------------------------------------

/** Kurumdaki üyelik (rol, etkin mi); yoksa `null`. */
export async function findMentorshipMember(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<MentorshipMember | null> {
  const [row] = await db
    .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return row === undefined
    ? null
    : { membershipId, role: row.role, active: row.deactivatedAt === null }
}

const activeOf = (institutionId: string) =>
  and(
    mentorshipOf(institutionId),
    eq(teacherMentorships.status, 'active'),
    isNull(teacherMentorships.archivedAt),
  )

/** Mentorun süren eşleşme sayısı (K-463 sınırı). */
export async function countActiveForMentor(
  db: Database,
  institutionId: string,
  mentorMembershipId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(teacherMentorships)
    .where(
      and(activeOf(institutionId), eq(teacherMentorships.mentorMembershipId, mentorMembershipId)),
    )
  return row?.total ?? 0
}

/** Yeni öğretmenin süren eşleşmesi var mı (K-463; kısmi tekil indeks son güvencedir). */
export async function menteeHasActive(
  db: Database,
  institutionId: string,
  menteeMembershipId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: teacherMentorships.id })
    .from(teacherMentorships)
    .where(
      and(activeOf(institutionId), eq(teacherMentorships.menteeMembershipId, menteeMembershipId)),
    )
    .limit(1)
  return row !== undefined
}

/** İşe başlama listesi (iş teklifi) durumu ve bağlı hesap; kurumda yoksa `null`. */
export async function findMentorshipOnboardingOffer(
  db: Database,
  institutionId: string,
  offerId: string,
): Promise<{ status: JobOfferStatus; membershipId: string | null } | null> {
  const [row] = await db
    .select({ status: staffJobOffers.status, membershipId: staffJobOffers.membershipId })
    .from(staffJobOffers)
    .where(and(eq(staffJobOffers.institutionId, institutionId), eq(staffJobOffers.id, offerId)))
    .limit(1)
  return row ?? null
}

/**
 * Bağlanabilecek işe başlama listeleri: kabul edilmiş (geri çekilmemiş) ve hesabı bağlı teklifler,
 * yeni başlangıç önce; seçim listesi olduğu için en çok 200.
 */
export async function listLinkableOnboardingOffers(
  db: Database,
  institutionId: string,
): Promise<{ offerId: string; membershipId: string; position: string; startDate: string }[]> {
  const rows = await db
    .select({
      offerId: staffJobOffers.id,
      membershipId: staffJobOffers.membershipId,
      position: staffJobOffers.position,
      startDate: staffJobOffers.startDate,
    })
    .from(staffJobOffers)
    .where(
      and(
        eq(staffJobOffers.institutionId, institutionId),
        eq(staffJobOffers.status, 'accepted'),
        isNotNull(staffJobOffers.membershipId),
      ),
    )
    .orderBy(desc(staffJobOffers.startDate), asc(staffJobOffers.id))
    .limit(200)
  return rows.flatMap((row) =>
    row.membershipId === null ? [] : [{ ...row, membershipId: row.membershipId }],
  )
}

// --- Eşleşme -------------------------------------------------------------------------------------

export interface StoredMentorship {
  id: string
  mentorMembershipId: string
  mentorName: string
  menteeMembershipId: string
  menteeName: string
  onboardingOfferId: string | null
  onboardingPosition: string | null
  startDate: string
  endDate: string
  status: MentorshipStatus
  closedOn: string | null
  endReason: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const mentorMembership = alias(memberships, 'mentor_membership')
const mentorUser = alias(users, 'mentor_user')
const menteeMembership = alias(memberships, 'mentee_membership')
const menteeUser = alias(users, 'mentee_user')

const MENTORSHIP_COLUMNS = {
  id: teacherMentorships.id,
  mentorMembershipId: teacherMentorships.mentorMembershipId,
  mentorName: mentorUser.name,
  menteeMembershipId: teacherMentorships.menteeMembershipId,
  menteeName: menteeUser.name,
  onboardingOfferId: teacherMentorships.onboardingOfferId,
  onboardingPosition: staffJobOffers.position,
  startDate: teacherMentorships.startDate,
  endDate: teacherMentorships.endDate,
  status: teacherMentorships.status,
  closedOn: teacherMentorships.closedOn,
  endReason: teacherMentorships.endReason,
  createdAt: teacherMentorships.createdAt,
  updatedAt: teacherMentorships.updatedAt,
  version: teacherMentorships.version,
}

type MentorshipRow = Omit<StoredMentorship, 'createdAt' | 'updatedAt'> & {
  createdAt: Date
  updatedAt: Date
}
const toMentorship = (row: MentorshipRow): StoredMentorship => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const ON_MENTOR = and(
  eq(mentorMembership.institutionId, teacherMentorships.institutionId),
  eq(mentorMembership.id, teacherMentorships.mentorMembershipId),
)
const ON_MENTEE = and(
  eq(menteeMembership.institutionId, teacherMentorships.institutionId),
  eq(menteeMembership.id, teacherMentorships.menteeMembershipId),
)
const ON_OFFER = and(
  eq(staffJobOffers.institutionId, teacherMentorships.institutionId),
  eq(staffJobOffers.id, teacherMentorships.onboardingOfferId),
)

const mentorshipBase = (db: Database) =>
  db
    .select(MENTORSHIP_COLUMNS)
    .from(teacherMentorships)
    .innerJoin(mentorMembership, ON_MENTOR)
    .innerJoin(mentorUser, eq(mentorUser.id, mentorMembership.userId))
    .innerJoin(menteeMembership, ON_MENTEE)
    .innerJoin(menteeUser, eq(menteeUser.id, menteeMembership.userId))
    .leftJoin(staffJobOffers, ON_OFFER)

const mentorshipCount = (db: Database) =>
  db
    .select({ total: count() })
    .from(teacherMentorships)
    .innerJoin(mentorMembership, ON_MENTOR)
    .innerJoin(mentorUser, eq(mentorUser.id, mentorMembership.userId))
    .innerJoin(menteeMembership, ON_MENTEE)
    .innerJoin(menteeUser, eq(menteeUser.id, menteeMembership.userId))

/**
 * Son temas günü: arşivlenmemiş son görüşme, yoksa başlangıç (K-465). Core `mentorshipContact`
 * ile aynı kuraldır; süzgeç ve sıralama için SQL'de de hesaplanır.
 */
const lastContactSql = sql<string>`coalesce((
  select max(${teacherMentorshipMeetings.meetingDate})
  from ${teacherMentorshipMeetings}
  where ${teacherMentorshipMeetings.institutionId} = ${teacherMentorships.institutionId}
    and ${teacherMentorshipMeetings.mentorshipId} = ${teacherMentorships.id}
    and ${teacherMentorshipMeetings.archivedAt} is null
), ${teacherMentorships.startDate})`

/** Süren ve son teması `overdueBefore` gününden önce kalan eşleşme (K-465). */
const overdueSql = (overdueBefore: string): SQL | undefined =>
  and(eq(teacherMentorships.status, 'active'), lt(lastContactSql, overdueBefore))

export async function findMentorship(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMentorship | null> {
  const [row] = await mentorshipBase(db)
    .where(and(mentorshipOf(institutionId), eq(teacherMentorships.id, id)))
    .limit(1)
  return row === undefined ? null : toMentorship(row)
}

export interface MentorshipQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: MentorshipStatus | undefined
  overdue?: boolean | undefined
}

/**
 * Eşleşmeler: süren önce, sonra yeni başlangıç önce; arama mentor ya da yeni öğretmen adında.
 * `overdue` süren ve görüşmesi 30 günü aşanları süzer (`overdueBefore` = bugün − 30).
 */
export async function listMentorships(
  db: Database,
  institutionId: string,
  query: MentorshipQuery,
  overdueBefore: string,
): Promise<{ items: StoredMentorship[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    mentorshipOf(institutionId),
    isNull(teacherMentorships.archivedAt),
    query.status === undefined ? undefined : eq(teacherMentorships.status, query.status),
    query.overdue === true ? overdueSql(overdueBefore) : undefined,
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(mentorUser.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(menteeUser.name)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await mentorshipCount(db).where(where)
  const rows = await mentorshipBase(db)
    .where(where)
    .orderBy(
      sql`case when ${teacherMentorships.status} = 'active' then 0 else 1 end`,
      desc(teacherMentorships.startDate),
      asc(teacherMentorships.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toMentorship), total: totalRow?.total ?? 0 }
}

export interface MentorshipAggregate {
  meetingCount: number
  lastMeetingDate: string | null
  items: { required: boolean; completedAt: string | null }[]
}

/** Eşleşmelerin görüşme sayısı, son görüşme günü ve madde durumları (takip; K-465). */
export async function mentorshipAggregates(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, MentorshipAggregate>> {
  const result = new Map<string, MentorshipAggregate>()
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return result
  for (const id of wanted) result.set(id, { meetingCount: 0, lastMeetingDate: null, items: [] })
  const [meetings, items] = await Promise.all([
    db
      .select({
        mentorshipId: teacherMentorshipMeetings.mentorshipId,
        total: count(),
        last: max(teacherMentorshipMeetings.meetingDate),
      })
      .from(teacherMentorshipMeetings)
      .where(
        and(
          meetingOf(institutionId),
          inArray(teacherMentorshipMeetings.mentorshipId, wanted),
          isNull(teacherMentorshipMeetings.archivedAt),
        ),
      )
      .groupBy(teacherMentorshipMeetings.mentorshipId),
    db
      .select({
        mentorshipId: teacherMentorshipChecklistItems.mentorshipId,
        required: teacherMentorshipChecklistItems.required,
        completedAt: teacherMentorshipChecklistItems.completedAt,
      })
      .from(teacherMentorshipChecklistItems)
      .where(
        and(itemOf(institutionId), inArray(teacherMentorshipChecklistItems.mentorshipId, wanted)),
      ),
  ])
  for (const row of meetings) {
    const entry = result.get(row.mentorshipId)
    if (entry !== undefined) {
      entry.meetingCount = row.total
      entry.lastMeetingDate = row.last
    }
  }
  for (const row of items)
    result.get(row.mentorshipId)?.items.push({
      required: row.required,
      completedAt: row.completedAt?.toISOString() ?? null,
    })
  return result
}

/** Özet için bütün eşleşmelerin kimliği ve durumu (arşivsiz). */
export async function listMentorshipStates(
  db: Database,
  institutionId: string,
): Promise<{ id: string; status: MentorshipStatus; startDate: string }[]> {
  return db
    .select({
      id: teacherMentorships.id,
      status: teacherMentorships.status,
      startDate: teacherMentorships.startDate,
    })
    .from(teacherMentorships)
    .where(and(mentorshipOf(institutionId), isNull(teacherMentorships.archivedAt)))
}

export async function insertMentorship(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    mentorMembershipId: string
    menteeMembershipId: string
    onboardingOfferId: string | null
    startDate: string
    endDate: string
    checklist: { id: string; label: string; required: boolean }[]
    userId: string
    now: Date
  },
): Promise<void> {
  const { now, userId, checklist, ...rest } = input
  await tx.insert(teacherMentorships).values({
    institutionId,
    ...rest,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  if (checklist.length > 0)
    await tx.insert(teacherMentorshipChecklistItems).values(
      checklist.map((item, position) => ({
        institutionId,
        id: item.id,
        mentorshipId: input.id,
        position,
        label: item.label,
        required: item.required,
        createdAt: now,
        updatedAt: now,
      })),
    )
}

/**
 * Eşleşme satırının sürümünü ilerletir; yalnız süren eşleşmede ve sürüm tutarsa (`false` 409).
 * Görüşme, madde işareti ve kapanış bu sürümle sıraya girer.
 */
export async function bumpMentorship(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    close?: {
      status: Exclude<MentorshipStatus, 'active'>
      closedOn: string
      endReason: string | null
      userId: string
    }
  },
): Promise<boolean> {
  const rows = await tx
    .update(teacherMentorships)
    .set({
      ...(input.close === undefined
        ? {}
        : {
            status: input.close.status,
            closedOn: input.close.closedOn,
            endReason: input.close.endReason,
            closedByUserId: input.close.userId,
          }),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        mentorshipOf(institutionId),
        eq(teacherMentorships.id, input.id),
        eq(teacherMentorships.version, input.expectedVersion),
        eq(teacherMentorships.status, 'active'),
      ),
    )
    .returning({ id: teacherMentorships.id })
  return rows.length === 1
}

// --- Görüşme ve madde ----------------------------------------------------------------------------

export interface StoredMentorshipMeeting {
  id: string
  meetingDate: string
  durationMinutes: number
  topic: string
  note: string | null
  nextStep: string | null
  createdAt: string
}

/** Eşleşmenin arşivlenmemiş görüşmeleri, yeni gün önce. */
export async function loadMentorshipMeetings(
  db: Database,
  institutionId: string,
  mentorshipId: string,
): Promise<StoredMentorshipMeeting[]> {
  const rows = await db
    .select({
      id: teacherMentorshipMeetings.id,
      meetingDate: teacherMentorshipMeetings.meetingDate,
      durationMinutes: teacherMentorshipMeetings.durationMinutes,
      topic: teacherMentorshipMeetings.topic,
      note: teacherMentorshipMeetings.note,
      nextStep: teacherMentorshipMeetings.nextStep,
      createdAt: teacherMentorshipMeetings.createdAt,
    })
    .from(teacherMentorshipMeetings)
    .where(
      and(
        meetingOf(institutionId),
        eq(teacherMentorshipMeetings.mentorshipId, mentorshipId),
        isNull(teacherMentorshipMeetings.archivedAt),
      ),
    )
    .orderBy(
      desc(teacherMentorshipMeetings.meetingDate),
      desc(teacherMentorshipMeetings.createdAt),
      asc(teacherMentorshipMeetings.id),
    )
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function insertMentorshipMeeting(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    mentorshipId: string
    meetingDate: string
    durationMinutes: number
    topic: string
    note: string | null
    nextStep: string | null
    userId: string
    now: Date
  },
): Promise<void> {
  const { now, userId, ...rest } = input
  await tx.insert(teacherMentorshipMeetings).values({
    institutionId,
    ...rest,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Görüşmenin arşivi; eşleşmenin arşivlenmemiş görüşmesi değilse `false` (404). */
export async function archiveMentorshipMeeting(
  tx: Database,
  institutionId: string,
  input: { mentorshipId: string; meetingId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(teacherMentorshipMeetings)
    .set({
      archivedAt: input.now,
      updatedAt: input.now,
      version: sql`${teacherMentorshipMeetings.version} + 1`,
    })
    .where(
      and(
        meetingOf(institutionId),
        eq(teacherMentorshipMeetings.mentorshipId, input.mentorshipId),
        eq(teacherMentorshipMeetings.id, input.meetingId),
        isNull(teacherMentorshipMeetings.archivedAt),
      ),
    )
    .returning({ id: teacherMentorshipMeetings.id })
  return rows.length === 1
}

export async function mentorshipMeetingExists(
  db: Database,
  institutionId: string,
  mentorshipId: string,
  meetingId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: teacherMentorshipMeetings.id })
    .from(teacherMentorshipMeetings)
    .where(
      and(
        meetingOf(institutionId),
        eq(teacherMentorshipMeetings.mentorshipId, mentorshipId),
        eq(teacherMentorshipMeetings.id, meetingId),
        isNull(teacherMentorshipMeetings.archivedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface StoredChecklistItem {
  id: string
  position: number
  label: string
  required: boolean
  completedAt: string | null
  completedByName: string | null
}

const completedUser = alias(users, 'checklist_completed_user')

/** Eşleşmenin maddeleri, sırasıyla; işaretleyenin adı birlikte (kim ve ne zaman; K-465). */
export async function loadMentorshipChecklist(
  db: Database,
  institutionId: string,
  mentorshipId: string,
): Promise<StoredChecklistItem[]> {
  const rows = await db
    .select({
      id: teacherMentorshipChecklistItems.id,
      position: teacherMentorshipChecklistItems.position,
      label: teacherMentorshipChecklistItems.label,
      required: teacherMentorshipChecklistItems.required,
      completedAt: teacherMentorshipChecklistItems.completedAt,
      completedByName: completedUser.name,
    })
    .from(teacherMentorshipChecklistItems)
    .leftJoin(
      completedUser,
      eq(completedUser.id, teacherMentorshipChecklistItems.completedByUserId),
    )
    .where(
      and(itemOf(institutionId), eq(teacherMentorshipChecklistItems.mentorshipId, mentorshipId)),
    )
    .orderBy(asc(teacherMentorshipChecklistItems.position))
  return rows.map((row) => ({ ...row, completedAt: row.completedAt?.toISOString() ?? null }))
}

/** Maddeyi işaretler ya da işaretini kaldırır (`completed: null`). */
export async function setChecklistItem(
  tx: Database,
  institutionId: string,
  input: {
    mentorshipId: string
    itemId: string
    completed: { userId: string } | null
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(teacherMentorshipChecklistItems)
    .set({
      completedAt: input.completed === null ? null : input.now,
      completedByUserId: input.completed?.userId ?? null,
      updatedAt: input.now,
      version: sql`${teacherMentorshipChecklistItems.version} + 1`,
    })
    .where(
      and(
        itemOf(institutionId),
        eq(teacherMentorshipChecklistItems.mentorshipId, input.mentorshipId),
        eq(teacherMentorshipChecklistItems.id, input.itemId),
      ),
    )
    .returning({ id: teacherMentorshipChecklistItems.id })
  return rows.length === 1
}
