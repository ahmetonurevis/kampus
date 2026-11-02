import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  groupNameKey,
  groupRoomKey,
  type GroupMember,
  type LanguageGroup,
  type WaitlistEntry,
} from '@kampus/school-core/lib/language-groups.ts'

import type { Database } from './client.ts'
import { memberships } from './schema/auth.ts'
import { progressionDecisions } from './schema/cefr.ts'
import {
  languageGroupMembers,
  languageGroups,
  languageGroupWaitlist,
} from './schema/language-groups.ts'

/**
 * Dil okulu grup deposu (IST-077; DOM-DIL-008, -040…043). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kurumun grupları dönem başına onlarcadır: çakışma ve ad tekilliği kurumun bütün
 * gruplarını ister, okuma süzgeci ve sayfalama serviste core ile yapılır.
 * TODO(grup-yukleme): grup sayısı binleri bulursa çakışma yüklemesi `end_date >= bugün` ile daraltılır.
 */

type GroupRow = typeof languageGroups.$inferSelect

export type StoredGroup = LanguageGroup & { rowVersion: number; updatedAt: string }

const iso = (value: Date | null) => (value === null ? null : value.toISOString())
const at = (value: string | null) => (value === null ? null : new Date(value))

function toGroup(row: GroupRow): StoredGroup {
  return {
    id: row.id,
    courseId: row.courseId,
    name: row.name,
    ageBand: row.ageBand,
    teacherMembershipId: row.teacherMembershipId,
    delivery: row.delivery,
    room: row.room,
    schedule: row.schedule,
    startDate: row.startDate,
    endDate: row.endDate,
    capacity: row.capacity,
    state: row.state,
    openedAt: iso(row.openedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    mergedIntoGroupId: row.mergedIntoGroupId,
    rowVersion: row.version,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Kurumun bütün grupları (iptal edilenler dahil; görünürlük ve süzgeç servistedir). */
export async function loadGroups(db: Database, institutionId: string): Promise<StoredGroup[]> {
  const rows = await db
    .select()
    .from(languageGroups)
    .where(and(eq(languageGroups.institutionId, institutionId), isNull(languageGroups.archivedAt)))
  return rows.map(toGroup)
}

/** Grupların arşivlenmemiş kursiyerleri; `groupIds` verilmezse kurumun hepsi. */
export async function loadGroupMembers(
  db: Database,
  institutionId: string,
  groupIds?: readonly string[],
): Promise<GroupMember[]> {
  if (groupIds !== undefined && groupIds.length === 0) return []
  const rows = await db
    .select({
      groupId: languageGroupMembers.groupId,
      studentId: languageGroupMembers.studentId,
      status: languageGroupMembers.status,
      joinedAt: languageGroupMembers.joinedAt,
    })
    .from(languageGroupMembers)
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        isNull(languageGroupMembers.archivedAt),
        groupIds === undefined ? undefined : inArray(languageGroupMembers.groupId, [...groupIds]),
      ),
    )
    .orderBy(asc(languageGroupMembers.joinedAt), asc(languageGroupMembers.studentId))
  return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }))
}

/** Öğrencilerin arşivlenmemiş grup üyelikleri (öğrenci ve veli okuma kapsamı). */
export async function loadMembershipsOfStudents(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<GroupMember[]> {
  if (studentIds.length === 0) return []
  const rows = await db
    .select({
      groupId: languageGroupMembers.groupId,
      studentId: languageGroupMembers.studentId,
      status: languageGroupMembers.status,
      joinedAt: languageGroupMembers.joinedAt,
    })
    .from(languageGroupMembers)
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        isNull(languageGroupMembers.archivedAt),
        inArray(languageGroupMembers.studentId, [...studentIds]),
      ),
    )
  return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }))
}

export type StoredWaitlistEntry = WaitlistEntry & { createdAt: string }

/** Kurların arşivlenmemiş bekleme satırları (grup ve kur sırası birlikte). */
export async function loadWaitlist(
  db: Database,
  institutionId: string,
  courseIds: readonly string[],
): Promise<StoredWaitlistEntry[]> {
  if (courseIds.length === 0) return []
  const rows = await db
    .select()
    .from(languageGroupWaitlist)
    .where(
      and(
        eq(languageGroupWaitlist.institutionId, institutionId),
        isNull(languageGroupWaitlist.archivedAt),
        inArray(languageGroupWaitlist.courseId, [...courseIds]),
      ),
    )
    .orderBy(asc(languageGroupWaitlist.requestedAt), asc(languageGroupWaitlist.id))
  return rows.map((row) => ({
    id: row.id,
    courseId: row.courseId,
    groupId: row.groupId,
    studentId: row.studentId,
    prospectId: row.prospectId,
    requestedAt: row.requestedAt.toISOString(),
    status: row.status,
    offerGroupId: row.offerGroupId,
    offeredAt: iso(row.offeredAt),
    offerExpiresAt: iso(row.offerExpiresAt),
    createdAt: row.createdAt.toISOString(),
  }))
}

/** Kurumun `ogretmen` rolündeki üyelikleri (grubun öğretmeni bunlardan biridir). */
export async function loadTeacherMembershipIds(
  db: Database,
  institutionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.role, 'ogretmen')))
  return rows.map((row) => row.id)
}

/** Grubun yazılan kolonları; anahtarlar core'dan türetilir. */
const columns = (group: LanguageGroup) => ({
  courseId: group.courseId,
  name: group.name,
  nameKey: groupNameKey(group.name),
  ageBand: group.ageBand,
  teacherMembershipId: group.teacherMembershipId,
  delivery: group.delivery,
  room: group.room,
  roomKey: group.room === null ? null : groupRoomKey(group.room),
  schedule: group.schedule.map((slot) => ({ weekday: slot.weekday, startTime: slot.startTime })),
  startDate: group.startDate,
  endDate: group.endDate,
  capacity: group.capacity,
  state: group.state,
  openedAt: at(group.openedAt),
  cancelledAt: at(group.cancelledAt),
  cancelReason: group.cancelReason,
  mergedIntoGroupId: group.mergedIntoGroupId,
})

export async function insertGroup(
  tx: Database,
  institutionId: string,
  group: LanguageGroup,
  now: Date,
): Promise<void> {
  await tx
    .insert(languageGroups)
    .values({ institutionId, id: group.id, ...columns(group), createdAt: now, updatedAt: now })
}

/** Grubun yeni hâlini yazar ve sürümü artırır; `expectedVersion` tutmazsa `false` (409). */
export async function saveGroup(
  tx: Database,
  institutionId: string,
  group: LanguageGroup,
  expectedVersion: number,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(languageGroups)
    .set({ ...columns(group), updatedAt: now, version: sql`${languageGroups.version} + 1` })
    .where(
      and(
        eq(languageGroups.institutionId, institutionId),
        eq(languageGroups.id, group.id),
        eq(languageGroups.version, expectedVersion),
      ),
    )
    .returning({ id: languageGroups.id })
  return rows.length === 1
}

/**
 * Birleştirmede kursiyer taşıma (DOM-DIL-042): kaynak grubun bütün satırları arşivlenir (geçmiş
 * kalır), taşınan kursiyerlere hedefte aynı durumla yeni satır yazılır.
 *
 * Kur sonu kararı (DOM-DIL-070) kayıt satırına bağlıdır (`progression_decisions`, migration 0034)
 * ve yeni satıra taşınmaz:
 * - Taşınan kursiyerin açık (`pending`) kararı varsa birleştirme 422 `progression_pending` ile
 *   reddedilir; hiçbir şey yazılmadan önce denetlenir ve işlem geri alınır. Açık karar eski kayıtta
 *   kalsaydı yeni kayıtta core `progression_pending` denetimi atlanır, ikinci karar açılabilirdi.
 *   Koordinatör önce onaylar ya da reddeder.
 * - Onaylı ya da reddedilmiş karar arşivlenen eski kayıtta geçmiş olarak kalır; kursiyerin geçmişi
 *   (`listProgressionDecisions({ learnerId })`) onu gösterir, yeni kaydın kararları boş başlar.
 */
export async function moveGroupMembers(
  tx: Database,
  institutionId: string,
  input: { sourceGroupId: string; targetGroupId: string; members: readonly GroupMember[] },
  now: Date,
): Promise<void> {
  const movedStudents = input.members.map((member) => member.studentId)
  if (movedStudents.length > 0) {
    const [pending] = await tx
      .select({ id: progressionDecisions.id })
      .from(progressionDecisions)
      .innerJoin(
        languageGroupMembers,
        and(
          eq(languageGroupMembers.institutionId, progressionDecisions.institutionId),
          eq(languageGroupMembers.id, progressionDecisions.enrollmentId),
        ),
      )
      .where(
        and(
          eq(progressionDecisions.institutionId, institutionId),
          eq(progressionDecisions.groupId, input.sourceGroupId),
          inArray(progressionDecisions.learnerId, movedStudents),
          eq(progressionDecisions.status, 'pending'),
          isNull(progressionDecisions.archivedAt),
          isNull(languageGroupMembers.archivedAt),
        ),
      )
      .limit(1)
    if (pending !== undefined)
      throw new DomainError(
        'progression_pending',
        'Taşınacak bir kursiyerin onay bekleyen kur sonu kararı var; karar sonuçlanmadan gruplar birleştirilemez.',
        { kind: 'rule' },
      )
  }
  await tx
    .update(languageGroupMembers)
    .set({ archivedAt: now, updatedAt: now, version: sql`${languageGroupMembers.version} + 1` })
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        eq(languageGroupMembers.groupId, input.sourceGroupId),
        isNull(languageGroupMembers.archivedAt),
      ),
    )
  if (input.members.length === 0) return
  await tx.insert(languageGroupMembers).values(
    input.members.map((member) => ({
      institutionId,
      id: randomUUID(),
      groupId: input.targetGroupId,
      studentId: member.studentId,
      status: member.status,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/**
 * Kaynağın grup sırası hedefe geçer (DOM-DIL-043): kapanan grubun bekleyenleri birleşen grubun
 * sırasına aktarılır; istek anı korunur, sıra değişmez. Kaynağa yapılmış teklifler aktarılmaz
 * (hedefin kapasitesine sayılmamıştır); kayıt akışı onları sonuçlandırır (ON-058).
 */
export async function moveGroupWaitlist(
  tx: Database,
  institutionId: string,
  input: { sourceGroupId: string; targetGroupId: string },
  now: Date,
): Promise<void> {
  await tx
    .update(languageGroupWaitlist)
    .set({
      groupId: input.targetGroupId,
      updatedAt: now,
      version: sql`${languageGroupWaitlist.version} + 1`,
    })
    .where(
      and(
        eq(languageGroupWaitlist.institutionId, institutionId),
        eq(languageGroupWaitlist.groupId, input.sourceGroupId),
        eq(languageGroupWaitlist.status, 'waiting'),
        isNull(languageGroupWaitlist.archivedAt),
      ),
    )
}
