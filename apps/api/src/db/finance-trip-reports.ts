import { and, asc, count, desc, eq, exists, inArray, isNull, lte, max, or, sql } from 'drizzle-orm'

import type { ConsentRecord } from '@kampus/school-core/lib/consents.ts'
import type { FileStatus } from '@kampus/school-core/content/taxonomy.ts'
import type { IncidentKind, IncidentStatus } from '@kampus/school-core/lib/finance-incidents.ts'
import type {
  TripReportListStatus,
  TripReportStatus,
} from '@kampus/school-core/lib/finance-trip-reports.ts'
import type { TripPlanStatus } from '@kampus/school-core/lib/finance-trip-plans.ts'

import type { Database } from './client.ts'
import { users } from './schema/auth.ts'
import { files } from './schema/files.ts'
import { incidentReports } from './schema/finance-incidents.ts'
import { tripPlanStaff, tripPlans } from './schema/finance-trip-plans.ts'
import {
  tripEvaluations,
  tripReportIncidents,
  tripReportPhotos,
  tripReportPhotoTags,
  tripReports,
} from './schema/finance-trip-reports.ts'
import { consents } from './schema/privacy.ts'
import { studentIdentities } from './schema/student-identities.ts'

/**
 * Gezi sonrası rapor deposu (DOM-FIN-158; ON-158). Kurum kapsamlıdır: ilk parametre
 * `institutionId`; arşivli satır okunmaz. Kural core `lib/finance-trip-reports.ts`'tedir; depo yalnız
 * okur ve yazar. Sürümlü güncelleme tutmazsa `false` döner (servis 409 verir). Onaylanan raporun
 * satırlarını tetikleyici korur.
 */

/** Fotoğraf dosyalarının bağ türü (`files.attached_type`). */
export const TRIP_REPORT_ATTACHMENT = 'trip_report'

const r = tripReports
const ri = tripReportIncidents
const p = tripReportPhotos
const pt = tripReportPhotoTags
const e = tripEvaluations

// --- Rapor ---------------------------------------------------------------------------------------

export interface StoredTripReport {
  id: string
  planId: string
  status: TripReportStatus
  summary: string | null
  incidentNote: string | null
  outcomeNote: string | null
  createdByUserId: string
  submittedAt: Date | null
  submittedByUserId: string | null
  attendanceSource: 'trip_day' | 'none' | null
  rosterCount: number | null
  attendedCount: number | null
  absentCount: number | null
  decidedAt: Date | null
  decidedByUserId: string | null
  returnReason: string | null
  createdAt: Date
  updatedAt: Date
  version: number
}

const REPORT_COLUMNS = {
  id: r.id,
  planId: r.planId,
  status: r.status,
  summary: r.summary,
  incidentNote: r.incidentNote,
  outcomeNote: r.outcomeNote,
  createdByUserId: r.createdByUserId,
  submittedAt: r.submittedAt,
  submittedByUserId: r.submittedByUserId,
  attendanceSource: r.attendanceSource,
  rosterCount: r.rosterCount,
  attendedCount: r.attendedCount,
  absentCount: r.absentCount,
  decidedAt: r.decidedAt,
  decidedByUserId: r.decidedByUserId,
  returnReason: r.returnReason,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  version: r.version,
}

/** Planın etkin raporu; yoksa `null`. */
export async function findTripReport(
  db: Database,
  institutionId: string,
  planId: string,
): Promise<StoredTripReport | null> {
  const [row] = await db
    .select(REPORT_COLUMNS)
    .from(r)
    .where(and(eq(r.institutionId, institutionId), eq(r.planId, planId), isNull(r.archivedAt)))
    .limit(1)
  return row ?? null
}

/** Rapor kimliğiyle (dosya bağlantısı okuma kuralı için). */
export async function findTripReportById(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredTripReport | null> {
  const [row] = await db
    .select(REPORT_COLUMNS)
    .from(r)
    .where(and(eq(r.institutionId, institutionId), eq(r.id, id), isNull(r.archivedAt)))
    .limit(1)
  return row ?? null
}

export async function insertTripReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    planId: string
    summary: string | null
    incidentNote: string | null
    outcomeNote: string | null
    userId: string
    now: Date
  },
) {
  const { userId, now, ...values } = input
  await tx.insert(r).values({
    ...values,
    institutionId,
    status: 'draft',
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

export type TripReportChangesRow = Partial<
  Pick<
    typeof r.$inferInsert,
    | 'status'
    | 'summary'
    | 'incidentNote'
    | 'outcomeNote'
    | 'submittedAt'
    | 'submittedByUserId'
    | 'attendanceSource'
    | 'rosterCount'
    | 'attendedCount'
    | 'absentCount'
    | 'decidedAt'
    | 'decidedByUserId'
    | 'returnReason'
  >
>

export async function updateTripReport(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: TripReportChangesRow; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(r)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(r.institutionId, institutionId),
        eq(r.id, input.id),
        isNull(r.archivedAt),
        eq(r.version, input.expectedVersion),
      ),
    )
    .returning({ id: r.id })
  return rows.length === 1
}

/** Raporun etkin kaza tutanağı bağları, yazılış sırasıyla. */
export async function loadReportIncidentIds(
  db: Database,
  institutionId: string,
  reportId: string,
): Promise<string[]> {
  const rows = await db
    .select({ incidentId: ri.incidentId })
    .from(ri)
    .where(
      and(eq(ri.institutionId, institutionId), eq(ri.reportId, reportId), isNull(ri.archivedAt)),
    )
    .orderBy(asc(ri.createdAt), asc(ri.id))
  return rows.map((row) => row.incidentId)
}

/** Bağ listesini bütün olarak yazar: etkin satırlar arşivlenir, yeni liste eklenir. */
export async function replaceReportIncidents(
  tx: Database,
  institutionId: string,
  input: { reportId: string; incidentIds: readonly string[]; now: Date; ids: () => string },
) {
  await tx
    .update(ri)
    .set({ archivedAt: input.now, updatedAt: input.now, version: sql`${ri.version} + 1` })
    .where(
      and(
        eq(ri.institutionId, institutionId),
        eq(ri.reportId, input.reportId),
        isNull(ri.archivedAt),
      ),
    )
  if (input.incidentIds.length === 0) return
  await tx.insert(ri).values(
    input.incidentIds.map((incidentId) => ({
      institutionId,
      id: input.ids(),
      reportId: input.reportId,
      incidentId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

export interface TripIncidentFacts {
  id: string
  occurredAt: string
  kind: IncidentKind
  location: string
  status: IncidentStatus
}

const INCIDENT_COLUMNS = {
  id: incidentReports.id,
  occurredAt: incidentReports.occurredAt,
  kind: incidentReports.kind,
  location: incidentReports.location,
  status: incidentReports.status,
}
const toIncident = (row: {
  id: string
  occurredAt: Date
  kind: IncidentKind
  location: string
  status: IncidentStatus
}): TripIncidentFacts => ({ ...row, occurredAt: row.occurredAt.toISOString() })

/** Kaza tutanaklarının bağ için gerekli düz bilgisi (anlatım ve sağlık grubu okunmaz). */
export async function findIncidentFacts(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, TripIncidentFacts>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select(INCIDENT_COLUMNS)
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.institutionId, institutionId),
        inArray(incidentReports.id, [...new Set(ids)]),
      ),
    )
  return new Map(rows.map((row) => [row.id, toIncident(row)]))
}

/** Gezi süresinde olmuş kaza tutanakları (bağ seçenekleri), olay sırasıyla; en çok 50. */
export async function listIncidentsBetween(
  db: Database,
  institutionId: string,
  from: Date,
  to: Date,
): Promise<TripIncidentFacts[]> {
  const rows = await db
    .select(INCIDENT_COLUMNS)
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.institutionId, institutionId),
        sql`${incidentReports.occurredAt} between ${from} and ${to}`,
      ),
    )
    .orderBy(asc(incidentReports.occurredAt), asc(incidentReports.id))
    .limit(50)
  return rows.map(toIncident)
}

// --- Fotoğraf ------------------------------------------------------------------------------------

export interface StoredReportPhoto {
  id: string
  fileId: string
  caption: string | null
  noStudentsVisible: boolean
  shareWithFamilies: boolean
  position: number
  contentType: string
  byteSize: number
  fileStatus: FileStatus
  studentIds: string[]
  version: number
}

/** Raporların etkin fotoğrafları ve etiketleri, sırasıyla. */
export async function loadReportPhotos(
  db: Database,
  institutionId: string,
  reportIds: readonly string[],
): Promise<Map<string, StoredReportPhoto[]>> {
  const byReport = new Map<string, StoredReportPhoto[]>()
  if (reportIds.length === 0) return byReport
  const ids = [...new Set(reportIds)]
  const [photos, tags] = await Promise.all([
    db
      .select({
        id: p.id,
        reportId: p.reportId,
        fileId: p.fileId,
        caption: p.caption,
        noStudentsVisible: p.noStudentsVisible,
        shareWithFamilies: p.shareWithFamilies,
        position: p.position,
        contentType: files.contentType,
        byteSize: files.byteSize,
        fileStatus: files.status,
        version: p.version,
      })
      .from(p)
      .innerJoin(files, and(eq(files.institutionId, p.institutionId), eq(files.id, p.fileId)))
      .where(
        and(eq(p.institutionId, institutionId), inArray(p.reportId, ids), isNull(p.archivedAt)),
      )
      .orderBy(asc(p.position), asc(p.id)),
    db
      .select({ photoId: pt.photoId, studentId: pt.studentId })
      .from(pt)
      .where(
        and(eq(pt.institutionId, institutionId), inArray(pt.reportId, ids), isNull(pt.archivedAt)),
      )
      .orderBy(asc(pt.createdAt), asc(pt.id)),
  ])
  const tagsOf = new Map<string, string[]>()
  for (const tag of tags)
    tagsOf.set(tag.photoId, [...(tagsOf.get(tag.photoId) ?? []), tag.studentId])
  for (const { reportId, ...photo } of photos) {
    const list = byReport.get(reportId) ?? []
    list.push({ ...photo, studentIds: tagsOf.get(photo.id) ?? [] })
    byReport.set(reportId, list)
  }
  return byReport
}

export async function nextReportPhotoPosition(
  tx: Database,
  institutionId: string,
  reportId: string,
) {
  const [row] = await tx
    .select({ max: max(p.position) })
    .from(p)
    .where(and(eq(p.institutionId, institutionId), eq(p.reportId, reportId)))
  return row?.max === null || row?.max === undefined ? 0 : row.max + 1
}

export async function insertReportPhoto(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    reportId: string
    fileId: string
    caption: string | null
    noStudentsVisible: boolean
    shareWithFamilies: boolean
    position: number
    userId: string
    now: Date
  },
) {
  const { userId, now, ...values } = input
  await tx
    .insert(p)
    .values({ ...values, institutionId, createdByUserId: userId, createdAt: now, updatedAt: now })
}

export async function updateReportPhoto(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<{
      caption: string | null
      noStudentsVisible: boolean
      shareWithFamilies: boolean
    }>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(p)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(p.institutionId, institutionId),
        eq(p.id, input.id),
        isNull(p.archivedAt),
        eq(p.version, input.expectedVersion),
      ),
    )
    .returning({ id: p.id })
  return rows.length === 1
}

export async function archiveReportPhoto(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(p)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(p.institutionId, institutionId),
        eq(p.id, input.id),
        isNull(p.archivedAt),
        eq(p.version, input.expectedVersion),
      ),
    )
    .returning({ id: p.id })
  return rows.length === 1
}

/** Fotoğrafın etiketlerini bütün olarak yazar: kalkanlar arşivlenir, yeniler eklenir. */
export async function replacePhotoTags(
  tx: Database,
  institutionId: string,
  input: {
    reportId: string
    photoId: string
    studentIds: readonly string[]
    current: readonly string[]
    now: Date
    ids: () => string
  },
) {
  const removed = input.current.filter((id) => !input.studentIds.includes(id))
  const added = input.studentIds.filter((id) => !input.current.includes(id))
  if (removed.length > 0)
    await tx
      .update(pt)
      .set({ archivedAt: input.now, updatedAt: input.now, version: sql`${pt.version} + 1` })
      .where(
        and(
          eq(pt.institutionId, institutionId),
          eq(pt.photoId, input.photoId),
          isNull(pt.archivedAt),
          inArray(pt.studentId, removed),
        ),
      )
  if (added.length > 0)
    await tx.insert(pt).values(
      added.map((studentId) => ({
        institutionId,
        id: input.ids(),
        reportId: input.reportId,
        photoId: input.photoId,
        studentId,
        createdAt: input.now,
        updatedAt: input.now,
      })),
    )
}

// --- Rıza ----------------------------------------------------------------------------------------

/**
 * Öğrencilerin fotoğraf paylaşım rızası satırları (`consents`, IST-017; geçmiş dahil, core
 * `hasValidConsent` karar verir) ve rızanın erginlik hesabı için güncel doğum tarihleri. Toplu
 * okumadır: fotoğraf etiketlerinin rızası okuma anında tek sorguyla denetlenir.
 */
export async function loadStudentConsents(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
  purpose: ConsentRecord['purpose'],
): Promise<Map<string, ConsentRecord[]>> {
  const found = new Map<string, ConsentRecord[]>()
  if (studentIds.length === 0) return found
  const rows = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.institutionId, institutionId),
        eq(consents.subjectKind, 'student'),
        eq(consents.purpose, purpose),
        inArray(consents.subjectId, [...new Set(studentIds)]),
        isNull(consents.archivedAt),
      ),
    )
    .orderBy(asc(consents.givenAt), asc(consents.id))
  for (const row of rows) {
    const record: ConsentRecord = {
      id: row.id,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      purpose: row.purpose,
      decision: row.decision,
      grantedByUserId: row.grantedByUserId,
      grantorRelation: row.grantorRelation,
      textId: row.textId,
      textVersion: row.textVersion,
      channel: row.channel,
      givenAt: row.givenAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      withdrawnByUserId: row.withdrawnByUserId,
      withdrawalReason: row.withdrawalReason,
    }
    found.set(row.subjectId, [...(found.get(row.subjectId) ?? []), record])
  }
  return found
}

/** Öğrencilerin kimlik tablosundaki doğum tarihleri (varsa kayıttakinden önce gelir). */
export async function loadStudentBirthDates(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map()
  const rows = await db
    .select({ studentId: studentIdentities.studentId, birthDate: studentIdentities.birthDate })
    .from(studentIdentities)
    .where(
      and(
        eq(studentIdentities.institutionId, institutionId),
        inArray(studentIdentities.studentId, [...new Set(studentIds)]),
      ),
    )
  return new Map(rows.map((row) => [row.studentId, row.birthDate]))
}

// --- Değerlendirme -------------------------------------------------------------------------------

export async function insertTripEvaluation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    planId: string
    studentId: string
    membershipId: string
    respondentRole: string
    score: number
    comment: string | null
    now: Date
  },
) {
  const { now, ...values } = input
  await tx.insert(e).values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

export interface StoredTripEvaluation {
  id: string
  planId: string
  studentId: string
  membershipId: string
  score: number
  comment: string | null
  createdAt: Date
}

const EVALUATION_COLUMNS = {
  id: e.id,
  planId: e.planId,
  studentId: e.studentId,
  membershipId: e.membershipId,
  score: e.score,
  comment: e.comment,
  createdAt: e.createdAt,
}

/** Gezinin değerlendirmeleri, yazılış sırasıyla. */
export async function loadPlanEvaluations(
  db: Database,
  institutionId: string,
  planId: string,
): Promise<StoredTripEvaluation[]> {
  return db
    .select(EVALUATION_COLUMNS)
    .from(e)
    .where(and(eq(e.institutionId, institutionId), eq(e.planId, planId)))
    .orderBy(asc(e.createdAt), asc(e.id))
}

/** Üyeliğin verdiği değerlendirmeler (verilirse yalnız bu gezilerde). */
export async function loadMembershipEvaluations(
  db: Database,
  institutionId: string,
  membershipId: string,
  planIds?: readonly string[],
): Promise<StoredTripEvaluation[]> {
  if (planIds?.length === 0) return []
  return db
    .select(EVALUATION_COLUMNS)
    .from(e)
    .where(
      and(
        eq(e.institutionId, institutionId),
        eq(e.membershipId, membershipId),
        planIds === undefined ? undefined : inArray(e.planId, [...new Set(planIds)]),
      ),
    )
}

/** Gezilerin değerlendirme sayıları (liste satırı). */
export async function countPlanEvaluations(
  db: Database,
  institutionId: string,
  planIds: readonly string[],
): Promise<Map<string, number>> {
  if (planIds.length === 0) return new Map()
  const rows = await db
    .select({ planId: e.planId, total: count() })
    .from(e)
    .where(and(eq(e.institutionId, institutionId), inArray(e.planId, [...new Set(planIds)])))
    .groupBy(e.planId)
  return new Map(rows.map((row) => [row.planId, row.total]))
}

// --- Liste ---------------------------------------------------------------------------------------

export interface TripReportListQuery {
  page: number
  pageSize: number
  status?: TripReportListStatus | undefined
  /** Yalnız bu üyeliğin görevli olduğu planlar (öğretmen, K-529). */
  staffMembershipId?: string | undefined
  now: Date
}

export interface TripReportListRow {
  planId: string
  planSequence: number
  planName: string
  planStatus: TripPlanStatus
  departureAt: Date
  returnAt: Date
  reportId: string | null
  reportStatus: TripReportStatus | null
  authorName: string | null
  submittedAt: Date | null
  decidedAt: Date | null
  reportVersion: number | null
}

/**
 * Biten geziler ve raporları (K-529): onaylı plan dönüş anı geçmişse, tamamlanmış plan her zaman.
 * Raporu açılmamış gezi `missing` satırıdır. Onay bekleyenler önce, sonra yeni dönüş önce.
 */
export async function listTripReportRows(
  db: Database,
  institutionId: string,
  query: TripReportListQuery,
): Promise<{ items: TripReportListRow[]; total: number }> {
  const finished = or(
    eq(tripPlans.status, 'completed'),
    and(eq(tripPlans.status, 'approved'), lte(tripPlans.returnAt, query.now)),
  )
  const status =
    query.status === undefined
      ? undefined
      : query.status === 'missing'
        ? isNull(r.id)
        : eq(r.status, query.status)
  const staff =
    query.staffMembershipId === undefined
      ? undefined
      : exists(
          db
            .select({ one: sql`1` })
            .from(tripPlanStaff)
            .where(
              and(
                eq(tripPlanStaff.institutionId, tripPlans.institutionId),
                eq(tripPlanStaff.planId, tripPlans.id),
                eq(tripPlanStaff.membershipId, query.staffMembershipId),
                isNull(tripPlanStaff.archivedAt),
              ),
            ),
        )
  const where = and(
    eq(tripPlans.institutionId, institutionId),
    isNull(tripPlans.archivedAt),
    finished,
    status,
    staff,
  )
  const reportJoin = and(
    eq(r.institutionId, tripPlans.institutionId),
    eq(r.planId, tripPlans.id),
    isNull(r.archivedAt),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(tripPlans)
    .leftJoin(r, reportJoin)
    .where(where)
  const author = users
  const rows = await db
    .select({
      planId: tripPlans.id,
      planSequence: tripPlans.sequence,
      planName: tripPlans.name,
      planStatus: tripPlans.status,
      departureAt: tripPlans.departureAt,
      returnAt: tripPlans.returnAt,
      reportId: r.id,
      reportStatus: r.status,
      authorName: author.name,
      submittedAt: r.submittedAt,
      decidedAt: r.decidedAt,
      reportVersion: r.version,
    })
    .from(tripPlans)
    .leftJoin(r, reportJoin)
    .leftJoin(author, eq(author.id, r.createdByUserId))
    .where(where)
    .orderBy(
      sql`case when ${r.status} = 'submitted' then 0 else 1 end`,
      desc(tripPlans.returnAt),
      desc(tripPlans.sequence),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows, total: totalRow?.total ?? 0 }
}

/** Kullanıcı adları (rapor yazan, gönderen, karar veren). */
export async function reportUserNames(
  db: Database,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}
