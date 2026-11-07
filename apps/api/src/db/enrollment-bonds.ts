import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import type { ParentBond } from '@kampus/school-core/lib/enrollment.ts'

import type { Database } from './client.ts'
import { memberships } from './schema/auth.ts'
import { membershipLinks } from './schema/membership-links.ts'
import { studentGuardians } from './schema/student-guardians.ts'

/**
 * Veli kayıtlarının (`parents`) kurumdaki etkin veli–öğrenci bağları; kesin kayıtta seçilen ya da
 * önerilen velinin bir öğrencisinde velayetsiz ya da iletişim kısıtlı olup olmadığı bunlardan
 * okunur (core `hasNonCustodialBond`; DOM-ILT-070, -074). Bağ veli kaydının `studentIds` listesinde
 * olmayan öğrenciye de kurulabildiği için (`POST /students/:studentId/guardians`) veli kimliğiyle
 * sorgulanır. Arşivli bağ okunmaz; yalnız kural için gereken alanlar döner.
 */
export async function loadParentBonds(
  db: Database,
  institutionId: string,
  parentIds: readonly string[],
): Promise<(ParentBond & { parentId: string })[]> {
  if (parentIds.length === 0) return []
  const rows = await db
    .select({
      parentId: studentGuardians.parentId,
      custody: studentGuardians.custody,
      contactRestricted: studentGuardians.isContactRestricted,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.institutionId, institutionId),
        isNull(studentGuardians.archivedAt),
        inArray(studentGuardians.parentId, [...new Set(parentIds)]),
      ),
    )
    .orderBy(asc(studentGuardians.parentId), asc(studentGuardians.id))
  return rows.flatMap((row) => (row.parentId === null ? [] : [{ ...row, parentId: row.parentId }]))
}

/**
 * Kurumun bütün etkin veli kaydı bağları: toplu aktarımda (IST-007) hangi velinin eşleşeceği dosya
 * çözülmeden bilinmez, kural (`hasNonCustodialBond`) satır satır bu listeye bakar.
 */
export async function loadInstitutionParentBonds(
  db: Database,
  institutionId: string,
): Promise<(ParentBond & { parentId: string })[]> {
  const rows = await db
    .select({
      parentId: studentGuardians.parentId,
      custody: studentGuardians.custody,
      contactRestricted: studentGuardians.isContactRestricted,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.institutionId, institutionId),
        isNull(studentGuardians.archivedAt),
        isNotNull(studentGuardians.parentId),
      ),
    )
  return rows.flatMap((row) => (row.parentId === null ? [] : [{ ...row, parentId: row.parentId }]))
}

/**
 * Veli kaydının kurumdaki etkin veli hesabı (DOM-KAY-013, ON-128). Hesap, kaydın etkin bağlarına
 * davetle yazılan üyeliktir (`student_guardians.membership_id`, DOM-YTK-071); üyelik bu kurumun,
 * `veli` rolünde ve devre dışı değilse döner. Kayıt ile hesap tek kişiye eşlenir (core
 * `requireSameGuardian`); yine de birden çok hesap görünürse hangisinin velinin olduğu
 * bilinemediği için hesap verilmez (kapalı başarısız) ve bağ hesapsız kurulur.
 */
export async function findParentAccount(
  db: Database,
  institutionId: string,
  parentId: string,
): Promise<string | null> {
  const rows = await db
    .selectDistinct({ membershipId: memberships.id })
    .from(studentGuardians)
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, studentGuardians.membershipId),
        eq(memberships.institutionId, institutionId),
      ),
    )
    .where(
      and(
        eq(studentGuardians.institutionId, institutionId),
        isNull(studentGuardians.archivedAt),
        eq(studentGuardians.parentId, parentId),
        isNotNull(studentGuardians.membershipId),
        eq(memberships.role, 'veli'),
        isNull(memberships.deactivatedAt),
      ),
    )
    .limit(2)
  return rows.length === 1 && rows[0] !== undefined ? rows[0].membershipId : null
}

/**
 * Veli hesabına yeni çocuğun bağlantısını yazar (`membership_links` `child`). Daha önce
 * kaldırılmış (arşivli) aynı bağlantı varsa yeniden etkinleşir; okuma kapsamını velayetli ve
 * kısıtsız bağla birlikte verir (core `guardedActorLinks`).
 */
export async function linkChildToAccount(
  tx: Database,
  institutionId: string,
  membershipId: string,
  studentId: string,
  now: Date,
): Promise<void> {
  await tx
    .insert(membershipLinks)
    .values({ institutionId, membershipId, kind: 'child', recordId: studentId })
    .onConflictDoUpdate({
      target: [
        membershipLinks.institutionId,
        membershipLinks.membershipId,
        membershipLinks.kind,
        membershipLinks.recordId,
      ],
      set: { archivedAt: null, updatedAt: now, version: sql`${membershipLinks.version} + 1` },
      setWhere: isNotNull(membershipLinks.archivedAt),
    })
}
