import { randomUUID } from 'node:crypto'

import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { WageType } from '@kampus/school-core/lib/finance-pay-rates.ts'
import type { StaffDocumentType } from '@kampus/school-core/lib/finance-staff-documents.ts'
import type {
  JobOfferStatus,
  OnboardingStepDraft,
  OnboardingStepKind,
  OrientationStep,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'
import { STAFF_ROLES, type StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { fixedAssetAssignments } from './schema/finance-fixed-asset-assignments.ts'
import {
  staffJobOffers,
  staffOnboardingSettings,
  staffOnboardingSteps,
} from './schema/finance-staff-onboarding.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * İş teklifi ve işe başlama listesi deposu (DOM-FIN-121; ON-179). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-staff-onboarding.ts`'tedir; depo yalnız okur ve yazar.
 * Uçlar yalnız yöneticiye açıktır (K-412).
 */

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredOnboardingSettings {
  orientationSteps: OrientationStep[]
  updatedAt: string
  version: number
}

export async function loadOnboardingSettings(
  db: Database,
  institutionId: string,
): Promise<StoredOnboardingSettings | null> {
  const [row] = await db
    .select({
      orientationSteps: staffOnboardingSettings.orientationSteps,
      updatedAt: staffOnboardingSettings.updatedAt,
      version: staffOnboardingSettings.version,
    })
    .from(staffOnboardingSettings)
    .where(eq(staffOnboardingSettings.institutionId, institutionId))
    .limit(1)
  return row === undefined ? null : { ...row, updatedAt: row.updatedAt.toISOString() }
}

/** Ayarı yazar; ilk yazmada satır açılır. Sürüm tutmazsa `false` (409). */
export async function saveOnboardingSettings(
  tx: Database,
  institutionId: string,
  input: {
    orientationSteps: OrientationStep[]
    expectedVersion: number | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  if (input.expectedVersion === null) {
    const rows = await tx
      .insert(staffOnboardingSettings)
      .values({
        institutionId,
        orientationSteps: input.orientationSteps,
        updatedByUserId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: staffOnboardingSettings.institutionId })
    return rows.length === 1
  }
  const rows = await tx
    .update(staffOnboardingSettings)
    .set({
      orientationSteps: input.orientationSteps,
      updatedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(staffOnboardingSettings.institutionId, institutionId),
        eq(staffOnboardingSettings.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffOnboardingSettings.institutionId })
  return rows.length === 1
}

// --- Teklif --------------------------------------------------------------------------------------

export interface StoredJobOffer {
  id: string
  membershipId: string | null
  /** Bağlı üyeliğin kullanıcı adı; bağlı değilse `null`. */
  memberName: string | null
  candidateName: string | null
  candidateEmail: string | null
  candidatePhone: string | null
  position: string
  staffRole: StaffRole
  startDate: string
  wageType: WageType
  offeredAmountCents: number
  respondBy: string | null
  note: string | null
  status: JobOfferStatus
  sentOn: string | null
  acceptedOn: string | null
  closedOn: string | null
  closeReason: string | null
  createdAt: string
  version: number
}

const memberUsers = alias(users, 'offer_member_users')

const OFFER_COLUMNS = {
  id: staffJobOffers.id,
  membershipId: staffJobOffers.membershipId,
  memberName: memberUsers.name,
  candidateName: staffJobOffers.candidateName,
  candidateEmail: staffJobOffers.candidateEmail,
  candidatePhone: staffJobOffers.candidatePhone,
  position: staffJobOffers.position,
  staffRole: staffJobOffers.staffRole,
  startDate: staffJobOffers.startDate,
  wageType: staffJobOffers.wageType,
  offeredAmountCents: staffJobOffers.offeredAmountCents,
  respondBy: staffJobOffers.respondBy,
  note: staffJobOffers.note,
  status: staffJobOffers.status,
  sentOn: staffJobOffers.sentOn,
  acceptedOn: staffJobOffers.acceptedOn,
  closedOn: staffJobOffers.closedOn,
  closeReason: staffJobOffers.closeReason,
  createdAt: staffJobOffers.createdAt,
  version: staffJobOffers.version,
}

type OfferRow = Omit<StoredJobOffer, 'createdAt'> & { createdAt: Date }
const toOffer = (row: OfferRow): StoredJobOffer => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(eq(staffJobOffers.institutionId, institutionId), isNull(staffJobOffers.archivedAt))

const offerMemberJoin = and(
  eq(memberships.institutionId, staffJobOffers.institutionId),
  eq(memberships.id, staffJobOffers.membershipId),
)

const joinedOffers = (db: Database) =>
  db
    .select(OFFER_COLUMNS)
    .from(staffJobOffers)
    .leftJoin(memberships, offerMemberJoin)
    .leftJoin(memberUsers, eq(memberUsers.id, memberships.userId))

export async function findJobOffer(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredJobOffer | null> {
  const [row] = await joinedOffers(db)
    .where(and(ofInstitution(institutionId), eq(staffJobOffers.id, id)))
    .limit(1)
  return row === undefined ? null : toOffer(row)
}

export interface JobOfferQuery {
  page: number
  pageSize: number
  status?: JobOfferStatus | undefined
  q?: string | undefined
}

/** Teklif listesi: işe başlama günü yakın olan önce; `q` aday ya da personel adında ve pozisyonda. */
export async function listJobOffers(
  db: Database,
  institutionId: string,
  query: JobOfferQuery,
): Promise<{ items: StoredJobOffer[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    ofInstitution(institutionId),
    query.status === undefined ? undefined : eq(staffJobOffers.status, query.status),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(sql`coalesce(${staffJobOffers.candidateName}, ${memberUsers.name}, '')`)}, ${search}) > 0
          or strpos(${foldSql(staffJobOffers.position)}, ${search}) > 0)`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(staffJobOffers)
    .leftJoin(memberships, offerMemberJoin)
    .leftJoin(memberUsers, eq(memberUsers.id, memberships.userId))
    .where(where)
  const rows = await joinedOffers(db)
    .where(where)
    .orderBy(desc(staffJobOffers.startDate), desc(staffJobOffers.createdAt), asc(staffJobOffers.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toOffer), total: totalRow?.total ?? 0 }
}

export interface JobOfferInsert {
  id: string
  membershipId: string | null
  candidateName: string | null
  candidateEmail: string | null
  candidatePhone: string | null
  position: string
  staffRole: StaffRole
  startDate: string
  wageType: WageType
  offeredAmountCents: number
  respondBy: string | null
  note: string | null
  createdByUserId: string
  now: Date
}

export async function insertJobOffer(
  tx: Database,
  institutionId: string,
  input: JobOfferInsert,
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(staffJobOffers).values({
    ...fields,
    institutionId,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  })
}

export type JobOfferChanges = Partial<{
  membershipId: string | null
  candidateName: string | null
  candidateEmail: string | null
  candidatePhone: string | null
  position: string
  staffRole: StaffRole
  startDate: string
  wageType: WageType
  offeredAmountCents: number
  respondBy: string | null
  note: string | null
  status: JobOfferStatus
  sentOn: string
  acceptedOn: string
  closedOn: string
  closeReason: string | null
}>

/** Kısmi güncelleme ve sürüm artışı (adım değişikliğinde boş `changes`); tutmazsa `false` (409). */
export async function updateJobOffer(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: JobOfferChanges; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffJobOffers)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffJobOffers.id, input.id),
        eq(staffJobOffers.version, input.expectedVersion),
      ),
    )
    .returning({ id: staffJobOffers.id })
  return rows.length === 1
}

/** Üyeliğe bağlı, kabul edilmiş (açık olabilecek) diğer tekliflerin kimlikleri. */
export async function acceptedOffersOfMember(
  db: Database,
  institutionId: string,
  membershipId: string,
  exceptOfferId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: staffJobOffers.id })
    .from(staffJobOffers)
    .where(
      and(
        ofInstitution(institutionId),
        eq(staffJobOffers.membershipId, membershipId),
        eq(staffJobOffers.status, 'accepted'),
        ne(staffJobOffers.id, exceptOfferId),
      ),
    )
  return rows.map((row) => row.id)
}

// --- Adımlar -------------------------------------------------------------------------------------

export interface StoredOnboardingStep {
  id: string
  offerId: string
  position: number
  kind: OnboardingStepKind
  documentType: StaffDocumentType | null
  label: string
  required: boolean
  responsibleMembershipId: string | null
  responsibleName: string | null
  dueDate: string | null
  completedOn: string | null
  completedAt: string | null
  note: string | null
}

const responsibleMemberships = alias(memberships, 'step_responsible_memberships')
const responsibleUsers = alias(users, 'step_responsible_users')

/** Tekliflerin adımları, sırasıyla; sorumlunun adı birlikte. */
export async function loadOnboardingSteps(
  db: Database,
  institutionId: string,
  offerIds: readonly string[],
): Promise<StoredOnboardingStep[]> {
  if (offerIds.length === 0) return []
  const rows = await db
    .select({
      id: staffOnboardingSteps.id,
      offerId: staffOnboardingSteps.offerId,
      position: staffOnboardingSteps.position,
      kind: staffOnboardingSteps.kind,
      documentType: staffOnboardingSteps.documentType,
      label: staffOnboardingSteps.label,
      required: staffOnboardingSteps.required,
      responsibleMembershipId: staffOnboardingSteps.responsibleMembershipId,
      responsibleName: responsibleUsers.name,
      dueDate: staffOnboardingSteps.dueDate,
      completedOn: staffOnboardingSteps.completedOn,
      completedAt: staffOnboardingSteps.completedAt,
      note: staffOnboardingSteps.note,
    })
    .from(staffOnboardingSteps)
    .leftJoin(
      responsibleMemberships,
      and(
        eq(responsibleMemberships.institutionId, staffOnboardingSteps.institutionId),
        eq(responsibleMemberships.id, staffOnboardingSteps.responsibleMembershipId),
      ),
    )
    .leftJoin(responsibleUsers, eq(responsibleUsers.id, responsibleMemberships.userId))
    .where(
      and(
        eq(staffOnboardingSteps.institutionId, institutionId),
        isNull(staffOnboardingSteps.archivedAt),
        inArray(staffOnboardingSteps.offerId, [...new Set(offerIds)]),
      ),
    )
    .orderBy(asc(staffOnboardingSteps.offerId), asc(staffOnboardingSteps.position))
  return rows.map((row) => ({ ...row, completedAt: row.completedAt?.toISOString() ?? null }))
}

export async function insertOnboardingSteps(
  tx: Database,
  institutionId: string,
  input: { offerId: string; steps: readonly OnboardingStepDraft[]; userId: string; now: Date },
): Promise<void> {
  if (input.steps.length === 0) return
  await tx.insert(staffOnboardingSteps).values(
    input.steps.map((step, position) => ({
      institutionId,
      id: randomUUID(),
      offerId: input.offerId,
      position,
      kind: step.kind,
      documentType: step.documentType,
      label: step.label,
      required: step.required,
      dueDate: step.dueDate,
      completedOn: step.completedOn,
      completedAt: step.completedOn === null ? null : input.now,
      completedByUserId: step.completedOn === null ? null : input.userId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

export type OnboardingStepChanges = Partial<{
  responsibleMembershipId: string | null
  dueDate: string | null
  completedOn: string | null
  completedAt: Date | null
  completedByUserId: string | null
  note: string | null
}>

export async function updateOnboardingStep(
  tx: Database,
  institutionId: string,
  input: { offerId: string; stepId: string; changes: OnboardingStepChanges; now: Date },
): Promise<void> {
  await tx
    .update(staffOnboardingSteps)
    .set({
      ...input.changes,
      updatedAt: input.now,
      version: sql`${staffOnboardingSteps.version} + 1`,
    })
    .where(
      and(
        eq(staffOnboardingSteps.institutionId, institutionId),
        eq(staffOnboardingSteps.offerId, input.offerId),
        eq(staffOnboardingSteps.id, input.stepId),
      ),
    )
}

// --- Üyelikler -----------------------------------------------------------------------------------

export interface OnboardingMemberRow {
  membershipId: string
  name: string
  role: string
  active: boolean
}

/** Kurumdaki üyelik (ad, rol, etkin mi); yoksa `null`. */
export async function findOnboardingMember(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<OnboardingMemberRow | null> {
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

/** Seçim listesi: kurumun etkin personeli ada göre (sorumlu ve hesap bağlama). */
export async function listOnboardingStaff(
  db: Database,
  institutionId: string,
): Promise<OnboardingMemberRow[]> {
  const rows = await db
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
    .limit(500)
  return rows.map((row) => ({ ...row, active: true }))
}

/** Personele teslim edilmiş, iade edilmemiş zimmet sayısı (DOM-FIN-086). */
export async function countOpenStaffAssets(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(fixedAssetAssignments)
    .where(
      and(
        eq(fixedAssetAssignments.institutionId, institutionId),
        eq(fixedAssetAssignments.membershipId, membershipId),
        isNull(fixedAssetAssignments.returnedAt),
        isNull(fixedAssetAssignments.archivedAt),
      ),
    )
  return row?.total ?? 0
}
