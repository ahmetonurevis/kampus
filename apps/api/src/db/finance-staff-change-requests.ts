import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'

import type {
  StaffChangeKind,
  StaffChangeStatus,
  StoredStaffChangePayload,
} from '@kampus/school-core/lib/finance-staff-self-service.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffChangeRequests } from './schema/finance-staff-change-requests.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Personel değişiklik talebi deposu (DOM-FIN-166; ON-189). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-self-service.ts`'tedir; depo yalnız okur ve
 * yazar. Yük okumada şemadan servis geçirir; IBAN şifreli kolondadır, depo çözmez.
 */

export interface StoredStaffChangeRequest {
  id: string
  membershipId: string
  name: string
  role: string
  kind: StaffChangeKind
  status: StaffChangeStatus
  payload: unknown
  ibanCiphertext: string | null
  ibanKeyVersion: number | null
  fileId: string | null
  staffDocumentId: string | null
  decidedByName: string | null
  decidedAt: Date | null
  rejectionReason: string | null
  createdAt: Date
  version: number
}

const decider = sql<
  string | null
>`(select ${users.name} from ${users} where ${users.id} = ${staffChangeRequests.decidedByUserId})`

function base(db: Database) {
  return db
    .select({
      id: staffChangeRequests.id,
      membershipId: staffChangeRequests.membershipId,
      name: users.name,
      role: memberships.role,
      kind: staffChangeRequests.kind,
      status: staffChangeRequests.status,
      payload: staffChangeRequests.payload,
      ibanCiphertext: staffChangeRequests.ibanCiphertext,
      ibanKeyVersion: staffChangeRequests.ibanKeyVersion,
      fileId: staffChangeRequests.fileId,
      staffDocumentId: staffChangeRequests.staffDocumentId,
      decidedByName: decider,
      decidedAt: staffChangeRequests.decidedAt,
      rejectionReason: staffChangeRequests.rejectionReason,
      createdAt: staffChangeRequests.createdAt,
      version: staffChangeRequests.version,
    })
    .from(staffChangeRequests)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffChangeRequests.institutionId),
        eq(memberships.id, staffChangeRequests.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
}

export interface StaffChangeRequestQuery {
  page: number
  pageSize: number
  membershipId?: string | undefined
  status?: StaffChangeStatus | undefined
  kind?: StaffChangeKind | undefined
  q?: string | undefined
}

/** Talepler: bekleyenler önce, sonra yeniden eskiye. */
export async function listStaffChangeRequests(
  db: Database,
  institutionId: string,
  query: StaffChangeRequestQuery,
): Promise<{ items: StoredStaffChangeRequest[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    eq(staffChangeRequests.institutionId, institutionId),
    isNull(staffChangeRequests.archivedAt),
    query.membershipId === undefined
      ? undefined
      : eq(staffChangeRequests.membershipId, query.membershipId),
    query.status === undefined ? undefined : eq(staffChangeRequests.status, query.status),
    query.kind === undefined ? undefined : eq(staffChangeRequests.kind, query.kind),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
  ]
  const where = and(...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(staffChangeRequests)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, staffChangeRequests.institutionId),
        eq(memberships.id, staffChangeRequests.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const items = await base(db)
    .where(where)
    .orderBy(
      sql`(${staffChangeRequests.status} = 'pending') desc`,
      desc(staffChangeRequests.createdAt),
      asc(staffChangeRequests.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function findStaffChangeRequest(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStaffChangeRequest | null> {
  const [row] = await base(db)
    .where(
      and(
        eq(staffChangeRequests.institutionId, institutionId),
        eq(staffChangeRequests.id, id),
        isNull(staffChangeRequests.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Personelin bekleyen taleplerinin türleri. */
export async function pendingStaffChangeKinds(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ kind: StaffChangeKind }[]> {
  return db
    .select({ kind: staffChangeRequests.kind })
    .from(staffChangeRequests)
    .where(
      and(
        eq(staffChangeRequests.institutionId, institutionId),
        eq(staffChangeRequests.membershipId, membershipId),
        eq(staffChangeRequests.status, 'pending'),
        isNull(staffChangeRequests.archivedAt),
      ),
    )
}

export async function insertStaffChangeRequest(
  tx: Database,
  institutionId: string,
  row: {
    id: string
    membershipId: string
    kind: StaffChangeKind
    payload: StoredStaffChangePayload
    iban: { ciphertext: string; keyVersion: number } | null
    fileId: string | null
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(staffChangeRequests).values({
    institutionId,
    id: row.id,
    membershipId: row.membershipId,
    kind: row.kind,
    status: 'pending',
    payload: row.payload,
    ibanCiphertext: row.iban?.ciphertext ?? null,
    ibanKeyVersion: row.iban?.keyVersion ?? null,
    fileId: row.fileId,
    requestedByUserId: row.userId,
    createdAt: row.now,
    updatedAt: row.now,
  })
}

/**
 * Bekleyen talebi kapatır (onay, ret ya da geri çekme); sürüm tutmazsa ya da talep artık
 * beklemiyorsa `false`.
 */
export async function closeStaffChangeRequest(
  tx: Database,
  institutionId: string,
  change: {
    id: string
    expectedVersion: number
    status: Exclude<StaffChangeStatus, 'pending'>
    userId: string | null
    rejectionReason: string | null
    staffDocumentId: string | null
    now: Date
  },
): Promise<boolean> {
  const decided = change.status !== 'cancelled'
  const rows = await tx
    .update(staffChangeRequests)
    .set({
      status: change.status,
      decidedByUserId: decided ? change.userId : null,
      decidedAt: decided ? change.now : null,
      rejectionReason: change.rejectionReason,
      staffDocumentId: change.staffDocumentId,
      updatedAt: change.now,
      version: sql`${staffChangeRequests.version} + 1`,
    })
    .where(
      and(
        eq(staffChangeRequests.institutionId, institutionId),
        eq(staffChangeRequests.id, change.id),
        eq(staffChangeRequests.status, 'pending'),
        eq(staffChangeRequests.version, change.expectedVersion),
      ),
    )
    .returning({ id: staffChangeRequests.id })
  return rows.length === 1
}

/** Talebe bağlı dosyası olan talep var mı (dosya bağlantısı okuma kuralı). */
export async function staffChangeRequestExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffChangeRequests.id })
    .from(staffChangeRequests)
    .where(
      and(eq(staffChangeRequests.institutionId, institutionId), eq(staffChangeRequests.id, id)),
    )
    .limit(1)
  return row !== undefined
}
