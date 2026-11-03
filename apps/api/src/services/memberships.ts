import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm'

import { guardedActorLinks } from '@kampus/school-core/lib/guardianship.ts'

import { roleSchema, type Role } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { institutions, memberships, users } from '../db/schema/auth.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { membershipLinks, type MembershipLinkKind } from '../db/schema/membership-links.ts'
import { loadMembershipGuardians } from '../db/student-guardians.ts'
import { effectiveModules, toModuleMap } from './modules.ts'

/**
 * Üyelik okuma fonksiyonları. Kurum kapsamlı olanların ilk parametresi `institutionId`'dir;
 * kullanıcının kendi üyelik listesi kurumlar arası tek okumadır ve yalnız oturum sahibine döner.
 */

export interface MembershipRow {
  id: string
  institutionId: string
  userId: string
  role: string
}

/** Etkin kurumdaki üyelik; her kimlikli istekte okunur. */
export async function findMembership(
  db: Database,
  institutionId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const [row] = await db
    .select({
      id: memberships.id,
      institutionId: memberships.institutionId,
      userId: memberships.userId,
      role: memberships.role,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        eq(memberships.userId, userId),
        // Pasifleştirilen üyelik yok sayılır (DOM-YTK-070): istek 403 `no_active_institution`.
        isNull(memberships.deactivatedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Kurum ve ayarları: etkin modül haritası ve akademik yıl (ayar satırı yoksa `null`). */
export async function getInstitution(db: Database, institutionId: string) {
  const [row] = await db
    .select({
      id: institutions.id,
      name: institutions.name,
      slug: institutions.slug,
      type: institutions.type,
      enabledModules: institutions.enabledModules,
      academicYear: institutionSettings.academicYear,
    })
    .from(institutions)
    .leftJoin(institutionSettings, eq(institutionSettings.institutionId, institutions.id))
    .where(eq(institutions.id, institutionId))
    .limit(1)
  if (!row) return null
  return {
    ...row,
    academicYear: row.academicYear ?? null,
    enabledModules: effectiveModules(toModuleMap(row.enabledModules), row.type),
  }
}

export type MembershipLink = { kind: MembershipLinkKind; recordId: string }

/**
 * Aktörün okuma kapsamı bağlantıları (IST-019; DOM-ILT-070, DOM-ILT-074). Kapsamın tek kaynağıdır:
 * `scopeFor`, `/me` çocuk listesi, bildirim kitlesi, yazışma, pano ve dosya erişimi buradan okur.
 * Veli `child` bağlantısı yalnız velayetli ve kısıtsız veli–öğrenci bağıyla (`student_guardians`)
 * kapsam verir (core `guardedActorLinks`): iletişim kısıtlı ya da velayeti olmayan veli öğrenciyi
 * hiç görmez; kısıt kalkınca yeniden görür. Bağ tablosu yalnız çocuk bağlantısı varsa okunur.
 */
export async function listMembershipLinks(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<MembershipLink[]> {
  const links = await listStoredMembershipLinks(db, institutionId, membershipId)
  if (!links.some((link) => link.kind === 'child')) return links
  const guardians = await loadMembershipGuardians(db, institutionId, membershipId)
  return guardedActorLinks(links, guardians, membershipId)
}

/**
 * Üyeliğin kayıtlı bağlantıları, velayet süzgeci olmadan. Okuma kapsamı için kullanılmaz; yalnız
 * kararı bağ tablosundan ayrıca okuyan yerler içindir (rıza: velayetsiz veliye 403
 * `consent_custody_required`, `services/consents.ts`).
 */
export async function listStoredMembershipLinks(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<MembershipLink[]> {
  return db
    .select({ kind: membershipLinks.kind, recordId: membershipLinks.recordId })
    .from(membershipLinks)
    .where(
      and(
        eq(membershipLinks.institutionId, institutionId),
        eq(membershipLinks.membershipId, membershipId),
        // Arşivlenen bağlantı kapsam vermez (silme = arşiv).
        isNull(membershipLinks.archivedAt),
      ),
    )
    .orderBy(asc(membershipLinks.kind), asc(membershipLinks.recordId))
}

/**
 * Öğrenci kaydına `student` bağlantısıyla bağlı hesapların kullanıcı kimlikleri (rıza geri
 * çekmede öğrencinin yüklediği bağlanmamış dosyaları bulmak için; DOM-YTK-059). Arşivlenmiş
 * bağlantılar da sayılır: bağlantı kapansa da hesabın daha önce yüklediği kayıt öğrencinindir.
 */
export async function listStudentAccountUserIds(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: memberships.userId })
    .from(membershipLinks)
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, membershipLinks.membershipId),
        eq(memberships.institutionId, membershipLinks.institutionId),
      ),
    )
    .where(
      and(
        eq(membershipLinks.institutionId, institutionId),
        eq(membershipLinks.kind, 'student'),
        eq(membershipLinks.recordId, studentId),
      ),
    )
    .orderBy(asc(memberships.userId))
  return rows.map((row) => row.userId)
}

/** Oturum sahibinin bütün kurumlardaki üyelikleri (kurum değiştirme menüsü için). */
export async function listUserMemberships(db: Database, userId: string) {
  return db
    .select({
      id: memberships.id,
      institutionId: memberships.institutionId,
      institutionName: institutions.name,
      institutionType: institutions.type,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
    .where(and(eq(memberships.userId, userId), isNull(memberships.deactivatedAt)))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
}

export async function getUser(db: Database, userId: string) {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row ?? null
}

export interface MembershipListQuery {
  page: number
  pageSize: number
  role?: Role | undefined
}

/** Kurumun üyeleri, sayfalı; sıra kararlı (oluşturma anı, sonra kimlik). */
export async function listInstitutionMemberships(
  db: Database,
  institutionId: string,
  query: MembershipListQuery,
) {
  const filters: SQL[] = [eq(memberships.institutionId, institutionId)]
  if (query.role) filters.push(eq(memberships.role, query.role))
  const where = and(...filters)
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(where)
      .orderBy(asc(memberships.createdAt), asc(memberships.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(memberships).where(where),
  ])
  return {
    // Rol Better Auth'ta serbest metindir; tanınmayan değer veri hatasıdır (500).
    items: rows.map((row) => ({
      ...row,
      role: roleSchema.parse(row.role),
      createdAt: row.createdAt.toISOString(),
    })),
    total: totals?.total ?? 0,
  }
}
