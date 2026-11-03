import { foldSearch, foldSql } from '../db/text-search.ts'
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'

import { roleSchema, type Role } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { memberships, users } from '../db/schema/auth.ts'
import { membershipLinks, type MembershipLinkKind } from '../db/schema/membership-links.ts'
import { records } from '../db/schema/records.ts'

/**
 * Kurum kullanıcıları (yalnız yönetici okur). Parola, oturum, telefon ve IP okunmaz; e-posta
 * yalnız bu uçta, yöneticiye döner. Durum saklanmaz, bağlı kişi kaydından türetilir: üyeliğin
 * (arşivlenmemiş) bağlantısı varsa ve bağlı kişi kayıtlarının hepsi arşivli ya da pasifse
 * (`isActive` false veya `deletedAt` dolu) üyelik `passive`tir; bağlantısı olmayan üyelik
 * (yönetici, ön büro) `active`tir. Yöneticinin pasifleştirdiği üyelik (`deactivatedAt` dolu,
 * DOM-YTK-070; `services/staff-accounts.ts`) her durumda `passive`tir.
 */

export type MemberStatus = 'active' | 'passive'
export type MemberSort = 'name' | '-name' | 'role' | '-role' | 'createdAt' | '-createdAt'

export interface MemberListQuery {
  page: number
  pageSize: number
  q?: string | undefined
  role?: Role | undefined
  status?: MemberStatus | undefined
  sort: MemberSort
}

/** Bağlantı türünün kayıt koleksiyonu: öğretmen `teachers`, öğrenci ve çocuk `students`. */
const linkCollection = sql`case ${membershipLinks.kind} when 'teacher' then 'teachers' else 'students' end`

const passiveExpression = sql<boolean>`(${memberships.deactivatedAt} is not null or (
  (select count(*) from membership_links ml
    where ml.institution_id = ${memberships.institutionId}
      and ml.membership_id = ${memberships.id} and ml.archived_at is null) > 0
  and (select count(*) from membership_links ml
    join records r on r.institution_id = ml.institution_id
      and r.collection = (case ml.kind when 'teacher' then 'teachers' else 'students' end)
      and r.id = ml.record_id
    where ml.institution_id = ${memberships.institutionId}
      and ml.membership_id = ${memberships.id} and ml.archived_at is null
      and r.archived_at is null
      and coalesce(r.data->>'isActive', 'true') <> 'false'
      and r.data->>'deletedAt' is null) = 0
))`

function orderBy(sort: MemberSort): SQL[] {
  const direction = sort.startsWith('-') ? desc : asc
  const key = sort.replace('-', '')
  const primary =
    key === 'role'
      ? direction(memberships.role)
      : key === 'createdAt'
        ? direction(memberships.createdAt)
        : direction(foldSql(users.name))
  return [primary, asc(memberships.id)]
}

/** Kurumun üyeleri; kurum yalnız `institutionId`'den (oturum) gelir. */
export async function listInstitutionMembers(
  db: Database,
  institutionId: string,
  query: MemberListQuery,
  log: FastifyBaseLogger,
  membershipId?: string,
) {
  const filters: SQL[] = [eq(memberships.institutionId, institutionId)]
  if (membershipId !== undefined) filters.push(eq(memberships.id, membershipId))
  if (query.role) filters.push(eq(memberships.role, query.role))
  if (query.q) {
    const needle = foldSearch(query.q)
    filters.push(
      sql`(strpos(${foldSql(users.name)}, ${needle}) > 0 or strpos(${foldSql(users.email)}, ${needle}) > 0)`,
    )
  }
  if (query.status === 'passive') filters.push(passiveExpression)
  if (query.status === 'active') filters.push(sql`not ${passiveExpression}`)
  const where = and(...filters)

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        role: memberships.role,
        passive: passiveExpression,
        deactivatedAt: memberships.deactivatedAt,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(where)
      .orderBy(...orderBy(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(where),
  ])

  const links = await listLinkedNames(
    db,
    institutionId,
    rows.map((row) => row.id),
  )
  const items = rows.flatMap(({ passive, ...row }) => {
    // Rol Better Auth'ta serbest metindir. Tanınmayan değer tek satırı etkiler: satır loglanıp
    // atlanır, yöneticinin bütün listesi düşmez (kimlik doğrulama aynı durumda 403 verir).
    const role = roleSchema.safeParse(row.role)
    if (!role.success) {
      log.warn({ event: 'institution_members.role_unrecognized', membershipId: row.id })
      return []
    }
    return [
      {
        ...row,
        role: role.data,
        status: passive ? ('passive' as const) : ('active' as const),
        links: links.get(row.id) ?? [],
        deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      },
    ]
  })
  return {
    items,
    total: totals?.total ?? 0,
  }
}

export type InstitutionMemberItem = Awaited<
  ReturnType<typeof listInstitutionMembers>
>['items'][number]

/** Tek üyelik, liste satırı biçiminde (yazma yanıtları); kurumda yoksa `null`. */
export async function getInstitutionMember(
  db: Database,
  institutionId: string,
  membershipId: string,
  log: FastifyBaseLogger,
): Promise<InstitutionMemberItem | null> {
  const { items } = await listInstitutionMembers(
    db,
    institutionId,
    { page: 1, pageSize: 1, sort: 'name' },
    log,
    membershipId,
  )
  return items[0] ?? null
}

/** Sayfadaki üyeliklerin bağlı kişi adları; yalnız ad ve tür okunur, kayıt kimliği dönmez. */
async function listLinkedNames(db: Database, institutionId: string, membershipIds: string[]) {
  const byMembership = new Map<string, { kind: MembershipLinkKind; name: string | null }[]>()
  if (membershipIds.length === 0) return byMembership
  const rows = await db
    .select({
      membershipId: membershipLinks.membershipId,
      kind: membershipLinks.kind,
      name: sql<string | null>`${records.data}->>'name'`,
    })
    .from(membershipLinks)
    .leftJoin(
      records,
      and(
        eq(records.institutionId, membershipLinks.institutionId),
        eq(records.collection, linkCollection),
        eq(records.id, membershipLinks.recordId),
      ),
    )
    .where(
      and(
        eq(membershipLinks.institutionId, institutionId),
        inArray(membershipLinks.membershipId, membershipIds),
        isNull(membershipLinks.archivedAt),
      ),
    )
    .orderBy(asc(membershipLinks.kind), asc(membershipLinks.recordId))
  for (const row of rows) {
    const list = byMembership.get(row.membershipId) ?? []
    list.push({ kind: row.kind, name: row.name })
    byMembership.set(row.membershipId, list)
  }
  return byMembership
}
