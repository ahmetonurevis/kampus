import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import type { GuardianDraft, GuardianLink } from '@kampus/school-core/lib/guardianship.ts'

import type { Database } from './client.ts'
import { studentGuardians } from './schema/student-guardians.ts'

/**
 * Veli–öğrenci bağı deposu (IST-019; DOM-ILT-070…075). Kurum kapsamlıdır: ilk parametre
 * `institutionId`; arşivli (kaldırılmış) bağ okunmaz ve velayet, rıza ya da kapsam vermez.
 * Satır core `GuardianLink` biçimine çevrilir; kolon adları veritabanı kuralına göredir
 * (`is_contact_restricted` ↔ `contactRestricted`, `is_pickup_authorized` ↔ `canPickUp`).
 */

type GuardianRow = typeof studentGuardians.$inferSelect

export type StoredGuardianLink = GuardianLink & {
  createdAt: string
  updatedAt: string
  rowVersion: number
}

const toLink = (row: GuardianRow): StoredGuardianLink => ({
  id: row.id,
  studentId: row.studentId,
  parentId: row.parentId,
  membershipId: row.membershipId,
  relationship: row.relationship,
  custody: row.custody,
  contactRestricted: row.isContactRestricted,
  isPayer: row.isPayer,
  canPickUp: row.isPickupAuthorized,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  rowVersion: row.version,
})

const columnsOf = (bond: GuardianDraft) => ({
  studentId: bond.studentId,
  parentId: bond.parentId,
  membershipId: bond.membershipId,
  relationship: bond.relationship,
  custody: bond.custody,
  isContactRestricted: bond.contactRestricted,
  isPayer: bond.isPayer,
  isPickupAuthorized: bond.canPickUp,
})

const active = (institutionId: string) =>
  and(eq(studentGuardians.institutionId, institutionId), isNull(studentGuardians.archivedAt))

/** Öğrencinin etkin bağları, kuruluş sırasıyla. */
export async function loadStudentGuardians(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<StoredGuardianLink[]> {
  const rows = await db
    .select()
    .from(studentGuardians)
    .where(and(active(institutionId), eq(studentGuardians.studentId, studentId)))
    .orderBy(asc(studentGuardians.createdAt), asc(studentGuardians.id))
  return rows.map(toLink)
}

/** Veli hesabının (üyelik) etkin bağları; rıza velayeti ve okuma kapsamı bunları okur. */
export async function loadMembershipGuardians(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredGuardianLink[]> {
  const rows = await db
    .select()
    .from(studentGuardians)
    .where(and(active(institutionId), eq(studentGuardians.membershipId, membershipId)))
    .orderBy(asc(studentGuardians.studentId), asc(studentGuardians.id))
  return rows.map(toLink)
}

/**
 * Veli kaydının ya da hesabının kurumdaki etkin bağları (bütün öğrencilerde); bağ kurarken kayıt
 * ile hesabın aynı kişiye ait olduğu bunlardan denetlenir (core `planGuardianLink`).
 */
export async function loadIdentityGuardians(
  db: Database,
  institutionId: string,
  identity: { parentId: string; membershipId: string },
): Promise<StoredGuardianLink[]> {
  const rows = await db
    .select()
    .from(studentGuardians)
    .where(
      and(
        active(institutionId),
        or(
          eq(studentGuardians.parentId, identity.parentId),
          eq(studentGuardians.membershipId, identity.membershipId),
        ),
      ),
    )
    .orderBy(asc(studentGuardians.createdAt), asc(studentGuardians.id))
  return rows.map(toLink)
}

export async function insertGuardianLink(
  tx: Database,
  institutionId: string,
  link: GuardianDraft & { id: string },
  now: Date,
): Promise<void> {
  await tx.insert(studentGuardians).values({
    institutionId,
    id: link.id,
    ...columnsOf(link),
    createdAt: now,
    updatedAt: now,
  })
}

/** Bağı bütün olarak yazar; sürüm tutmazsa `false` (409). */
export async function updateGuardianLink(
  tx: Database,
  institutionId: string,
  link: GuardianLink & { rowVersion: number },
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(studentGuardians)
    .set({ ...columnsOf(link), updatedAt: now, version: sql`${studentGuardians.version} + 1` })
    .where(
      and(
        active(institutionId),
        eq(studentGuardians.id, link.id),
        eq(studentGuardians.version, link.rowVersion),
      ),
    )
    .returning({ id: studentGuardians.id })
  return rows.length === 1
}

/** Bağı kaldırır (arşiv); sürüm tutmazsa `false` (409). */
export async function archiveGuardianLink(
  tx: Database,
  institutionId: string,
  link: { id: string; rowVersion: number },
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(studentGuardians)
    .set({ archivedAt: now, updatedAt: now, version: sql`${studentGuardians.version} + 1` })
    .where(
      and(
        active(institutionId),
        eq(studentGuardians.id, link.id),
        eq(studentGuardians.version, link.rowVersion),
      ),
    )
    .returning({ id: studentGuardians.id })
  return rows.length === 1
}

/**
 * Tohum ve hesap açılışı için: verilen bağları ekler; aynı kimlik ya da aynı öğrenci–veli bağı
 * varsa dokunmaz (idempotent, sonradan değişen bağ ezilmez). Arşivli bağ da sayılır: kaldırılmış
 * bağ hesap bağlantısı yeniden eklenince velayetli yeni bağ olarak dirilmez (DOM-ILT-071). Kısmi
 * tekil indeksler arşivli satırı görmediğinden denetim burada yapılır; çağıran kurum kilidi
 * altında tek transaction'da çağırır (`ensureMembershipLinks`).
 */
export async function ensureGuardianLinks(
  db: Database,
  institutionId: string,
  links: readonly (GuardianDraft & { id: string })[],
): Promise<void> {
  if (links.length === 0) return
  const studentIds = [...new Set(links.map((link) => link.studentId))]
  const known = await db
    .select({
      studentId: studentGuardians.studentId,
      parentId: studentGuardians.parentId,
      membershipId: studentGuardians.membershipId,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.institutionId, institutionId),
        inArray(studentGuardians.studentId, studentIds),
      ),
    )
  const fresh = links.filter(
    (link) =>
      !known.some(
        (row) =>
          row.studentId === link.studentId &&
          ((link.parentId !== null && row.parentId === link.parentId) ||
            (link.membershipId !== null && row.membershipId === link.membershipId)),
      ),
  )
  if (fresh.length === 0) return
  await db
    .insert(studentGuardians)
    .values(fresh.map((link) => ({ institutionId, id: link.id, ...columnsOf(link) })))
    .onConflictDoNothing()
}
