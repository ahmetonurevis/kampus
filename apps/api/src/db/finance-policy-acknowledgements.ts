import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import {
  POLICY_AUDIENCE_ROLES,
  type PolicyAckChannel,
  type PolicyAudience,
  type PolicyType,
} from '@kampus/school-core/lib/finance-policy-acknowledgements.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  policyAcknowledgements,
  policyDocuments,
} from './schema/finance-policy-acknowledgements.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Politika belgesi ve okundu onayı deposu (DOM-FIN-127; ON-190). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-policy-acknowledgements.ts`'tedir; depo yalnız okur ve
 * yazar. Belge silinmez (yeni sürüm yerine geçer); onay satırı değişmez (tetikleyici).
 */

export interface StoredPolicyDocument {
  id: string
  seriesId: string
  version: number
  title: string
  policyType: PolicyType
  audience: PolicyAudience
  publishedOn: string
  fileId: string
  replacesId: string | null
  supersededAt: string | null
  createdAt: string
}

const DOCUMENT_COLUMNS = {
  id: policyDocuments.id,
  seriesId: policyDocuments.seriesId,
  version: policyDocuments.versionNumber,
  title: policyDocuments.title,
  policyType: policyDocuments.policyType,
  audience: policyDocuments.audience,
  publishedOn: policyDocuments.publishedOn,
  fileId: policyDocuments.fileId,
  replacesId: policyDocuments.replacesId,
  supersededAt: policyDocuments.supersededAt,
  createdAt: policyDocuments.createdAt,
}

type DocumentRow = Omit<StoredPolicyDocument, 'createdAt' | 'supersededAt'> & {
  createdAt: Date
  supersededAt: Date | null
}
const toDocument = (row: DocumentRow): StoredPolicyDocument => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  supersededAt: row.supersededAt?.toISOString() ?? null,
})

const ofInstitution = (institutionId: string) => eq(policyDocuments.institutionId, institutionId)

export async function findPolicyDocument(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPolicyDocument | null> {
  const [row] = await db
    .select(DOCUMENT_COLUMNS)
    .from(policyDocuments)
    .where(and(ofInstitution(institutionId), eq(policyDocuments.id, id)))
    .limit(1)
  return row === undefined ? null : toDocument(row)
}

export async function policyDocumentExists(db: Database, institutionId: string, id: string) {
  return (await findPolicyDocument(db, institutionId, id)) !== null
}

export async function policyAcknowledgementExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: policyAcknowledgements.id })
    .from(policyAcknowledgements)
    .where(
      and(
        eq(policyAcknowledgements.institutionId, institutionId),
        eq(policyAcknowledgements.id, id),
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface PolicyDocumentQuery {
  page: number
  pageSize: number
  q?: string | undefined
  policyType?: PolicyType | undefined
  status: 'current' | 'all'
}

/** Belgeler: geçerli sürümler (ya da bütün sürümler), en yeni yayın önce. */
export async function listPolicyDocuments(
  db: Database,
  institutionId: string,
  query: PolicyDocumentQuery,
): Promise<{ items: StoredPolicyDocument[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    ofInstitution(institutionId),
    query.status === 'current' ? isNull(policyDocuments.supersededAt) : undefined,
    query.policyType === undefined ? undefined : eq(policyDocuments.policyType, query.policyType),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(policyDocuments.title)}, ${search}) > 0`,
  )
  const [totalRow] = await db.select({ total: count() }).from(policyDocuments).where(where)
  const rows = await db
    .select(DOCUMENT_COLUMNS)
    .from(policyDocuments)
    .where(where)
    .orderBy(
      desc(policyDocuments.publishedOn),
      asc(policyDocuments.title),
      desc(policyDocuments.versionNumber),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toDocument), total: totalRow?.total ?? 0 }
}

/** Geçerli (yerine geçilmemiş) bütün sürümler; personel başına eksik onay hesabı için. */
export async function loadCurrentPolicyDocuments(
  db: Database,
  institutionId: string,
): Promise<StoredPolicyDocument[]> {
  const rows = await db
    .select(DOCUMENT_COLUMNS)
    .from(policyDocuments)
    .where(and(ofInstitution(institutionId), isNull(policyDocuments.supersededAt)))
    .orderBy(desc(policyDocuments.publishedOn), asc(policyDocuments.title))
  return rows.map(toDocument)
}

/** Aynı belgenin bütün sürümleri, en yeni önce. */
export async function loadPolicySeries(
  db: Database,
  institutionId: string,
  seriesId: string,
): Promise<StoredPolicyDocument[]> {
  const rows = await db
    .select(DOCUMENT_COLUMNS)
    .from(policyDocuments)
    .where(and(ofInstitution(institutionId), eq(policyDocuments.seriesId, seriesId)))
    .orderBy(desc(policyDocuments.versionNumber))
  return rows.map(toDocument)
}

export async function insertPolicyDocument(
  tx: Database,
  institutionId: string,
  input: Omit<StoredPolicyDocument, 'supersededAt' | 'createdAt'> & {
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, version, ...fields } = input
  await tx.insert(policyDocuments).values({
    ...fields,
    versionNumber: version,
    institutionId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Sürümü "yerine geçti" yapar; sürüm zaten geçmişse `false`. */
export async function supersedePolicyDocument(
  tx: Database,
  institutionId: string,
  input: { id: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(policyDocuments)
    .set({
      supersededAt: input.now,
      updatedAt: input.now,
      version: sql`${policyDocuments.version} + 1`,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(policyDocuments.id, input.id),
        isNull(policyDocuments.supersededAt),
      ),
    )
    .returning({ id: policyDocuments.id })
  return rows.length === 1
}

// --- Onay ----------------------------------------------------------------------------------------

export interface StoredPolicyAcknowledgement {
  id: string
  policyDocumentId: string
  membershipId: string
  acknowledgedOn: string
  channel: PolicyAckChannel
  scanFileId: string | null
  recordedByUserId: string
  createdAt: string
}

const ACK_COLUMNS = {
  id: policyAcknowledgements.id,
  policyDocumentId: policyAcknowledgements.policyDocumentId,
  membershipId: policyAcknowledgements.membershipId,
  acknowledgedOn: policyAcknowledgements.acknowledgedOn,
  channel: policyAcknowledgements.channel,
  scanFileId: policyAcknowledgements.scanFileId,
  recordedByUserId: policyAcknowledgements.recordedByUserId,
  createdAt: policyAcknowledgements.createdAt,
}
const toAck = (row: Omit<StoredPolicyAcknowledgement, 'createdAt'> & { createdAt: Date }) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

export async function findPolicyAcknowledgement(
  db: Database,
  institutionId: string,
  query: { policyDocumentId: string; membershipId: string },
): Promise<StoredPolicyAcknowledgement | null> {
  const [row] = await db
    .select(ACK_COLUMNS)
    .from(policyAcknowledgements)
    .where(
      and(
        eq(policyAcknowledgements.institutionId, institutionId),
        eq(policyAcknowledgements.policyDocumentId, query.policyDocumentId),
        eq(policyAcknowledgements.membershipId, query.membershipId),
      ),
    )
    .limit(1)
  return row === undefined ? null : toAck(row)
}

export async function insertPolicyAcknowledgement(
  tx: Database,
  institutionId: string,
  input: Omit<StoredPolicyAcknowledgement, 'createdAt'> & { now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(policyAcknowledgements)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Verilen sürümlerin onayları (etkin ya da pasif personel ayrımı çağıranda). */
export async function loadAcknowledgementsOf(
  db: Database,
  institutionId: string,
  query: { documentIds?: string[]; membershipIds?: string[] },
): Promise<StoredPolicyAcknowledgement[]> {
  if (query.documentIds?.length === 0 || query.membershipIds?.length === 0) return []
  const rows = await db
    .select(ACK_COLUMNS)
    .from(policyAcknowledgements)
    .where(
      and(
        eq(policyAcknowledgements.institutionId, institutionId),
        query.documentIds === undefined
          ? undefined
          : inArray(policyAcknowledgements.policyDocumentId, query.documentIds),
        query.membershipIds === undefined
          ? undefined
          : inArray(policyAcknowledgements.membershipId, query.membershipIds),
      ),
    )
  return rows.map(toAck)
}

// --- Personel ------------------------------------------------------------------------------------

export interface PolicyStaff {
  membershipId: string
  name: string
  role: string
}

/** Kurumun etkin personeli (hedef kitle hesabı için), ada göre. */
export async function loadActiveStaff(db: Database, institutionId: string): Promise<PolicyStaff[]> {
  return db
    .select({ membershipId: memberships.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.role, [...STAFF_ROLES]),
        isNull(memberships.deactivatedAt),
      ),
    )
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
}

/**
 * Bir sürümün hedef kitlesindeki etkin personel; `status` onaylayan ya da onaylamayan. Sayfalı,
 * ada göre; onay bilgisi satırla döner.
 */
export async function listPolicyAudienceStaff(
  db: Database,
  institutionId: string,
  query: {
    documentId: string
    audience: PolicyAudience
    status: 'pending' | 'acknowledged'
    q?: string | undefined
    page: number
    pageSize: number
  },
) {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const joinOn = and(
    eq(policyAcknowledgements.institutionId, memberships.institutionId),
    eq(policyAcknowledgements.membershipId, memberships.id),
    eq(policyAcknowledgements.policyDocumentId, query.documentId),
  )
  const filters: (SQL | undefined)[] = [
    eq(memberships.institutionId, institutionId),
    inArray(memberships.role, [...POLICY_AUDIENCE_ROLES[query.audience]]),
    isNull(memberships.deactivatedAt),
    query.status === 'pending'
      ? isNull(policyAcknowledgements.id)
      : sql`${policyAcknowledgements.id} is not null`,
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
  ]
  const where = and(...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(policyAcknowledgements, joinOn)
    .where(where)
  const rows = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      acknowledgementId: policyAcknowledgements.id,
      acknowledgedOn: policyAcknowledgements.acknowledgedOn,
      channel: policyAcknowledgements.channel,
      hasScan: sql<boolean>`${policyAcknowledgements.scanFileId} is not null`,
      scanFileId: policyAcknowledgements.scanFileId,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(policyAcknowledgements, joinOn)
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows, total: totalRow?.total ?? 0 }
}
