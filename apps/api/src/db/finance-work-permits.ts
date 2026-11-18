import { and, asc, count, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm'

import type {
  WorkPermitStatus,
  WorkPermitType,
} from '@kampus/school-core/lib/finance-work-permits.ts'
import { WORK_PERMIT_TEACHER_ROLE } from '@kampus/school-core/lib/finance-work-permits.ts'

import type { Database } from './client.ts'
import { academicYears } from './schema/academic-years.ts'
import { memberships, users } from './schema/auth.ts'
import { teacherWorkPermits } from './schema/finance-work-permits.ts'
import { languageGroups } from './schema/language-groups.ts'
import { membershipLinks } from './schema/membership-links.ts'
import { records } from './schema/records.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Öğretmen çalışma onayı deposu (DOM-FIN-114; ON-174). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-work-permits.ts`'tedir; depo yalnız okur ve yazar.
 * İptal edilmiş (arşivli) kayıt okunmaz. Uçlar yalnız yöneticiye açıktır (K-377).
 */

export interface StoredWorkPermit {
  id: string
  membershipId: string
  teacherName: string
  permitType: WorkPermitType
  branch: string
  status: WorkPermitStatus
  applicationDate: string | null
  approvalDate: string | null
  approvalNumber: string | null
  validUntil: string | null
  rejectionDate: string | null
  rejectionReason: string | null
  documentFileId: string | null
  note: string | null
  createdAt: string
  version: number
}

const COLUMNS = {
  id: teacherWorkPermits.id,
  membershipId: teacherWorkPermits.membershipId,
  teacherName: users.name,
  permitType: teacherWorkPermits.permitType,
  branch: teacherWorkPermits.branch,
  status: teacherWorkPermits.status,
  applicationDate: teacherWorkPermits.applicationDate,
  approvalDate: teacherWorkPermits.approvalDate,
  approvalNumber: teacherWorkPermits.approvalNumber,
  validUntil: teacherWorkPermits.validUntil,
  rejectionDate: teacherWorkPermits.rejectionDate,
  rejectionReason: teacherWorkPermits.rejectionReason,
  documentFileId: teacherWorkPermits.documentFileId,
  note: teacherWorkPermits.note,
  createdAt: teacherWorkPermits.createdAt,
  version: teacherWorkPermits.version,
}

type Row = Omit<StoredWorkPermit, 'createdAt'> & { createdAt: Date }
const toPermit = (row: Row): StoredWorkPermit => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(eq(teacherWorkPermits.institutionId, institutionId), isNull(teacherWorkPermits.archivedAt))

/** Kaydın üyeliği ve kullanıcı adı (üyelik silinemez: yabancı anahtar `restrict`). */
const joined = (db: Database) =>
  db
    .select(COLUMNS)
    .from(teacherWorkPermits)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, teacherWorkPermits.institutionId),
        eq(memberships.id, teacherWorkPermits.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))

export async function findWorkPermit(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredWorkPermit | null> {
  const [row] = await joined(db)
    .where(and(ofInstitution(institutionId), eq(teacherWorkPermits.id, id)))
    .limit(1)
  return row === undefined ? null : toPermit(row)
}

/** Öğretmenlerin iptal edilmemiş bütün kayıtları (yeni açılan önce). */
export async function loadTeacherWorkPermits(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<StoredWorkPermit[]> {
  if (membershipIds.length === 0) return []
  const rows = await joined(db)
    .where(
      and(
        ofInstitution(institutionId),
        inArray(teacherWorkPermits.membershipId, [...new Set(membershipIds)]),
      ),
    )
    .orderBy(desc(teacherWorkPermits.createdAt), asc(teacherWorkPermits.id))
  return rows.map(toPermit)
}

export interface WorkPermitQuery {
  page: number
  pageSize: number
  membershipId?: string | undefined
  /** Saklanan durum ya da hesaplanan `expired` (onaylı ve bitişi bugünden önce). */
  state?: WorkPermitStatus | 'expired' | undefined
  q?: string | undefined
  today: string
}

/** Kayıt listesi: yeni açılan önce; `q` öğretmen adında ve branşta arar. */
export async function listWorkPermits(
  db: Database,
  institutionId: string,
  query: WorkPermitQuery,
): Promise<{ items: StoredWorkPermit[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const expired = and(
    eq(teacherWorkPermits.status, 'approved'),
    lt(teacherWorkPermits.validUntil, query.today),
  )
  const stateFilter: SQL | undefined =
    query.state === undefined
      ? undefined
      : query.state === 'expired'
        ? expired
        : query.state === 'approved'
          ? and(
              eq(teacherWorkPermits.status, 'approved'),
              sql`(${teacherWorkPermits.validUntil} is null or ${gte(teacherWorkPermits.validUntil, query.today)})`,
            )
          : eq(teacherWorkPermits.status, query.state)
  const where = and(
    ofInstitution(institutionId),
    query.membershipId === undefined
      ? undefined
      : eq(teacherWorkPermits.membershipId, query.membershipId),
    stateFilter,
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(users.name)}, ${search}) > 0 or strpos(${foldSql(teacherWorkPermits.branch)}, ${search}) > 0)`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(teacherWorkPermits)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, teacherWorkPermits.institutionId),
        eq(memberships.id, teacherWorkPermits.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await joined(db)
    .where(where)
    .orderBy(desc(teacherWorkPermits.createdAt), asc(teacherWorkPermits.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toPermit), total: totalRow?.total ?? 0 }
}

export interface Teacher {
  membershipId: string
  name: string
  role: string
  active: boolean
}

/** Kurumdaki üyelik (ad, rol, etkin mi); yoksa `null`. */
export async function findMember(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<Teacher | null> {
  const [row] = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  if (row === undefined) return null
  const { deactivatedAt, ...member } = row
  return { ...member, active: deactivatedAt === null }
}

/**
 * Kurumun etkin öğretmenleri ada göre (takip listesi; K-375). Kurumdaki öğretmen sayısı sınırlıdır:
 * durum süzgeci hesaplanan özete dayandığından liste serviste süzülüp sayfalanır.
 */
export async function listActiveTeachers(
  db: Database,
  institutionId: string,
  q: string | undefined,
): Promise<Teacher[]> {
  const search = q === undefined ? undefined : foldSearch(q)
  const rows = await db
    .select({ membershipId: memberships.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        eq(memberships.role, WORK_PERMIT_TEACHER_ROLE),
        isNull(memberships.deactivatedAt),
        search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
      ),
    )
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
  return rows.map((row) => ({ ...row, active: true }))
}

/**
 * Ders programında görevli öğretmen üyelikleri (K-376): `[fromAt, toAt)` aralığında iptal
 * edilmemiş dersi olan (öğretmen kaydı `membership_links` ile bağlı; `schedule` kaydının
 * `teacherId`'si) ya da bitmemiş, iptal edilmemiş dil grubunun öğretmeni olan üyelikler.
 */
export async function loadTeachingMemberships(
  db: Database,
  institutionId: string,
  window: { fromAt: string; toAt: string; today: string },
): Promise<Set<string>> {
  const lessonDate = sql<string>`${records.data} ->> 'date'`
  const [lessons, groups] = await Promise.all([
    db
      .selectDistinct({ membershipId: membershipLinks.membershipId })
      .from(membershipLinks)
      .innerJoin(
        records,
        and(
          eq(records.institutionId, membershipLinks.institutionId),
          eq(records.collection, 'schedule'),
          sql`${records.data} ->> 'teacherId' = ${membershipLinks.recordId}`,
        ),
      )
      .where(
        and(
          eq(membershipLinks.institutionId, institutionId),
          eq(membershipLinks.kind, 'teacher'),
          isNull(membershipLinks.archivedAt),
          isNull(records.archivedAt),
          sql`coalesce(${records.data} ->> 'cancelledAt', '') = ''`,
          sql`${lessonDate} >= ${window.fromAt}`,
          sql`${lessonDate} < ${window.toAt}`,
        ),
      ),
    db
      .selectDistinct({ membershipId: languageGroups.teacherMembershipId })
      .from(languageGroups)
      .where(
        and(
          eq(languageGroups.institutionId, institutionId),
          isNull(languageGroups.archivedAt),
          ne(languageGroups.state, 'cancelled'),
          gte(languageGroups.endDate, window.today),
          sql`${languageGroups.startDate} < ${window.toAt.slice(0, 10)}`,
        ),
      ),
  ])
  const ids = new Set<string>()
  for (const row of [...lessons, ...groups])
    if (row.membershipId !== null) ids.add(row.membershipId)
  return ids
}

/** Kurumun eğitim yılı aralıkları (varsayılan geçerlilik bitişi; K-376). */
export async function loadSchoolYearRanges(
  db: Database,
  institutionId: string,
): Promise<{ startDate: string; endDate: string }[]> {
  return db
    .select({ startDate: academicYears.startDate, endDate: academicYears.endDate })
    .from(academicYears)
    .where(and(eq(academicYears.institutionId, institutionId), isNull(academicYears.archivedAt)))
    .orderBy(asc(academicYears.startDate))
}

export interface WorkPermitInsert {
  id: string
  membershipId: string
  permitType: WorkPermitType
  branch: string
  status: WorkPermitStatus
  applicationDate: string | null
  note: string | null
  createdByUserId: string
  now: Date
}

export async function insertWorkPermit(
  tx: Database,
  institutionId: string,
  input: WorkPermitInsert,
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(teacherWorkPermits).values({
    ...fields,
    institutionId,
    createdAt: now,
    updatedAt: now,
  })
}

export type WorkPermitChanges = Partial<{
  permitType: WorkPermitType
  branch: string
  status: WorkPermitStatus
  applicationDate: string | null
  approvalDate: string | null
  approvalNumber: string | null
  validUntil: string | null
  rejectionDate: string | null
  rejectionReason: string | null
  documentFileId: string | null
  note: string | null
  archivedAt: Date
  cancelReason: string
  cancelledByUserId: string
}>

/** Kısmi güncelleme; sürüm tutmazsa `false` (409). */
export async function updateWorkPermit(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: WorkPermitChanges; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(teacherWorkPermits)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(teacherWorkPermits.id, input.id),
        eq(teacherWorkPermits.version, input.expectedVersion),
      ),
    )
    .returning({ id: teacherWorkPermits.id })
  return rows.length === 1
}

/** Dosya bağının okuma denetimi: kayıt kurumda ve iptal edilmemiş mi. */
export async function workPermitExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: teacherWorkPermits.id })
    .from(teacherWorkPermits)
    .where(and(ofInstitution(institutionId), eq(teacherWorkPermits.id, id)))
    .limit(1)
  return row !== undefined
}
