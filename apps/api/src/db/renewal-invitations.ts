import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { RenewalInvitationResponse } from '@kampus/school-core/lib/renewal-invitations.ts'

import type { Database } from './client.ts'
import { renewalInvitations } from './schema/renewal-invitations.ts'

/** Yenileme daveti deposu (DOM-KAY-027); her sorgu kurum kapsamlıdır, arşivli satır okunmaz. */

const COLUMNS = {
  id: renewalInvitations.id,
  studentId: renewalInvitations.studentId,
  academicYear: renewalInvitations.academicYear,
  response: renewalInvitations.response,
  responseNote: renewalInvitations.responseNote,
  respondedAt: renewalInvitations.respondedAt,
  createdAt: renewalInvitations.createdAt,
  version: renewalInvitations.version,
}

type InvitationRow = {
  id: string
  studentId: string
  academicYear: number
  response: string | null
  responseNote: string | null
  respondedAt: Date | null
  createdAt: Date
  version: number
}

export type StoredRenewalInvitation = Omit<InvitationRow, 'response'> & {
  response: RenewalInvitationResponse | null
}

/** `response` sütunu `check` kısıtıyla yalnız core değerlerini taşır. */
const toInvitation = (row: InvitationRow): StoredRenewalInvitation => ({
  ...row,
  response: row.response as RenewalInvitationResponse | null,
})

const active = (institutionId: string) =>
  and(eq(renewalInvitations.institutionId, institutionId), isNull(renewalInvitations.archivedAt))

export async function findRenewalInvitation(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredRenewalInvitation | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(renewalInvitations)
    .where(and(active(institutionId), eq(renewalInvitations.id, id)))
    .limit(1)
  return row ? toInvitation(row) : null
}

/** Öğrencinin hedef yıldaki daveti; yenileme önizlemesinin uyarısı bunu okur. */
export async function findStudentRenewalInvitation(
  db: Database,
  institutionId: string,
  studentId: string,
  academicYear: number,
): Promise<StoredRenewalInvitation | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(renewalInvitations)
    .where(
      and(
        active(institutionId),
        eq(renewalInvitations.studentId, studentId),
        eq(renewalInvitations.academicYear, academicYear),
      ),
    )
    .limit(1)
  return row ? toInvitation(row) : null
}

/** Seçili öğrencilerden hedef yılda daveti olanlar. */
export async function invitedStudentIds(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
  academicYear: number,
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set()
  const rows = await db
    .select({ studentId: renewalInvitations.studentId })
    .from(renewalInvitations)
    .where(
      and(
        active(institutionId),
        eq(renewalInvitations.academicYear, academicYear),
        inArray(renewalInvitations.studentId, [...studentIds]),
      ),
    )
  return new Set(rows.map((row) => row.studentId))
}

/** Süzgece uyan davetler, yeni önce. `studentIds` verilirse kapsam odur; boş liste satır vermez. */
export async function listRenewalInvitations(
  db: Database,
  institutionId: string,
  filter: { academicYear?: number | undefined; studentIds?: readonly string[] | undefined },
): Promise<StoredRenewalInvitation[]> {
  if (filter.studentIds?.length === 0) return []
  const rows = await db
    .select(COLUMNS)
    .from(renewalInvitations)
    .where(
      and(
        active(institutionId),
        filter.academicYear === undefined
          ? undefined
          : eq(renewalInvitations.academicYear, filter.academicYear),
        filter.studentIds === undefined
          ? undefined
          : inArray(renewalInvitations.studentId, [...filter.studentIds]),
      ),
    )
    .orderBy(desc(renewalInvitations.createdAt), desc(renewalInvitations.id))
  return rows.map(toInvitation)
}

export async function insertRenewalInvitations(
  db: Database,
  institutionId: string,
  input: {
    invitations: readonly { id: string; studentId: string }[]
    academicYear: number
    invitedByUserId: string
    now: Date
  },
): Promise<void> {
  await db.insert(renewalInvitations).values(
    input.invitations.map((invitation) => ({
      institutionId,
      id: invitation.id,
      studentId: invitation.studentId,
      academicYear: input.academicYear,
      invitedByUserId: input.invitedByUserId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

/** Yanıtı yazar; sürüm tutmazsa `false` (409). */
export async function saveRenewalInvitationResponse(
  db: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    response: RenewalInvitationResponse
    note: string | null
    respondedByUserId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await db
    .update(renewalInvitations)
    .set({
      response: input.response,
      responseNote: input.note,
      respondedByUserId: input.respondedByUserId,
      respondedAt: input.now,
      updatedAt: input.now,
      version: sql`${renewalInvitations.version} + 1`,
    })
    .where(
      and(
        active(institutionId),
        eq(renewalInvitations.id, input.id),
        eq(renewalInvitations.version, input.expectedVersion),
      ),
    )
    .returning({ id: renewalInvitations.id })
  return rows.length > 0
}
