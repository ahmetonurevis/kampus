import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'

import {
  DEFAULT_TRANSPORT_DOCUMENT_SETTINGS,
  type DrivingLicenseClass,
  type TransportDocumentSettings,
  type TransportDocumentSubject,
  type TransportDocumentType,
} from '@kampus/school-core/lib/finance-transport-documents.ts'
import type { TransportDirection } from '@kampus/school-core/lib/finance-transport.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  transportDocuments,
  transportDocumentSettings,
} from './schema/finance-transport-documents.ts'
import { transportRoutes, transportVehicles } from './schema/finance-transport.ts'

/**
 * Servis belgesi deposu (DOM-FIN-147; ON-147). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Arşivli aracın belgeleri listeye ve uyarılara girmez; "sayılan" belge yerine geçilmemiş, aracı
 * etkin, sürücü belgesinde şimdiki sürücünün ve personel belgesinde etkin üyenin belgesidir.
 * Kural core `lib/finance-transport-documents.ts`'tedir; depo yalnız okur ve yazar.
 */

export interface StoredTransportDocument {
  id: string
  subjectKind: TransportDocumentSubject
  vehicleId: string | null
  membershipId: string | null
  driverName: string | null
  documentType: TransportDocumentType
  documentNumber: string | null
  licenseClass: DrivingLicenseClass | null
  startDate: string
  endDate: string | null
  fileId: string | null
  replacesId: string | null
  supersededAt: string | null
  createdAt: string
}

const COLUMNS = {
  id: transportDocuments.id,
  subjectKind: transportDocuments.subjectKind,
  vehicleId: transportDocuments.vehicleId,
  membershipId: transportDocuments.membershipId,
  driverName: transportDocuments.driverName,
  documentType: transportDocuments.documentType,
  documentNumber: transportDocuments.documentNumber,
  licenseClass: transportDocuments.licenseClass,
  startDate: transportDocuments.startDate,
  endDate: transportDocuments.endDate,
  fileId: transportDocuments.fileId,
  replacesId: transportDocuments.replacesId,
  supersededAt: transportDocuments.supersededAt,
  createdAt: transportDocuments.createdAt,
}
type Row = Omit<StoredTransportDocument, 'createdAt' | 'supersededAt'> & {
  createdAt: Date
  supersededAt: Date | null
}
const toDocument = (row: Row): StoredTransportDocument => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  supersededAt: row.supersededAt?.toISOString() ?? null,
})

const ofInstitution = (institutionId: string) => eq(transportDocuments.institutionId, institutionId)

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredTransportDocumentSettings extends TransportDocumentSettings {
  /** `If-Match` sürümü; ayar hiç kaydedilmediyse 1. */
  version: number
}

export async function loadTransportDocumentSettings(
  db: Database,
  institutionId: string,
): Promise<StoredTransportDocumentSettings> {
  const [row] = await db
    .select({
      warningDays: transportDocumentSettings.warningDays,
      version: transportDocumentSettings.version,
    })
    .from(transportDocumentSettings)
    .where(eq(transportDocumentSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_TRANSPORT_DOCUMENT_SETTINGS, version: 1 }
}

/** Ayarı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveTransportDocumentSettings(
  tx: Database,
  institutionId: string,
  input: TransportDocumentSettings & { expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = { warningDays: input.warningDays, updatedAt: input.now }
  const [updated] = await tx
    .update(transportDocumentSettings)
    .set({ ...values, version: sql`${transportDocumentSettings.version} + 1` })
    .where(
      and(
        eq(transportDocumentSettings.institutionId, institutionId),
        eq(transportDocumentSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: transportDocumentSettings.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(transportDocumentSettings)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: transportDocumentSettings.version })
  return created?.version ?? null
}

// --- Belge ---------------------------------------------------------------------------------------

export async function findTransportDocument(db: Database, institutionId: string, id: string) {
  const [row] = await db
    .select(COLUMNS)
    .from(transportDocuments)
    .where(and(ofInstitution(institutionId), eq(transportDocuments.id, id)))
    .limit(1)
  return row === undefined ? null : toDocument(row)
}

export async function transportDocumentExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  return (await findTransportDocument(db, institutionId, id)) !== null
}

/**
 * Öznenin bu türdeki yerine geçilmemiş belgeleri, en yeni başlangıç önce. Sürücüde aracın bütün
 * sürücü belgeleri döner: yeni sürücünün belgesi önceki sürücününkinin yerine geçer.
 */
export async function loadCurrentDocumentsOfType(
  db: Database,
  institutionId: string,
  subject: {
    kind: TransportDocumentSubject
    vehicleId: string | null
    membershipId: string | null
  },
  documentType: TransportDocumentType,
) {
  const owner =
    subject.kind === 'staff'
      ? eq(transportDocuments.membershipId, subject.membershipId ?? '')
      : and(
          eq(transportDocuments.subjectKind, subject.kind),
          eq(transportDocuments.vehicleId, subject.vehicleId ?? ''),
        )
  return db
    .select({ id: transportDocuments.id, startDate: transportDocuments.startDate })
    .from(transportDocuments)
    .where(
      and(
        ofInstitution(institutionId),
        owner,
        eq(transportDocuments.documentType, documentType),
        isNull(transportDocuments.supersededAt),
      ),
    )
    .orderBy(desc(transportDocuments.startDate), desc(transportDocuments.createdAt))
}

export async function insertTransportDocument(
  tx: Database,
  institutionId: string,
  input: Omit<StoredTransportDocument, 'supersededAt' | 'createdAt'> & {
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...values } = input
  await tx
    .insert(transportDocuments)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

/** Belgeyi "yerine geçti" yapar; yeni belge yazılmadan önce. Zaten geçmişse `false`. */
export async function supersedeTransportDocument(
  tx: Database,
  institutionId: string,
  input: { id: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(transportDocuments)
    .set({
      supersededAt: input.now,
      updatedAt: input.now,
      version: sql`${transportDocuments.version} + 1`,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(transportDocuments.id, input.id),
        isNull(transportDocuments.supersededAt),
      ),
    )
    .returning({ id: transportDocuments.id })
  return rows.length === 1
}

// --- Liste ---------------------------------------------------------------------------------------

export type TransportDocumentDue = 'expired' | 'expiring' | 'attention' | 'valid'

export interface TransportDocumentListQuery {
  page: number
  pageSize: number
  subject?: TransportDocumentSubject | undefined
  vehicleId?: string | undefined
  membershipId?: string | undefined
  documentType?: TransportDocumentType | undefined
  due?: TransportDocumentDue | undefined
  /** `true` ise yerine geçilen belgeler de döner (geçmiş). */
  history: boolean
  today: string
  /** Uyarı penceresinin son günü (bugün + gün). */
  horizon: string
}

/** Belgenin öznesi: araç plakası ve sürücü adı, personel adı ve etkinliği. */
export interface TransportDocumentSubjectInfo {
  vehiclePlate: string | null
  vehicleDriverName: string | null
  staffName: string | null
  staffActive: boolean | null
}

export type TransportDocumentListRow = StoredTransportDocument & TransportDocumentSubjectInfo

const joinedFrom = (db: Database) =>
  db
    .select({
      ...COLUMNS,
      vehiclePlate: transportVehicles.plate,
      vehicleDriverName: transportVehicles.driverName,
      staffName: users.name,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(transportDocuments)
    .leftJoin(
      transportVehicles,
      and(
        eq(transportVehicles.institutionId, transportDocuments.institutionId),
        eq(transportVehicles.id, transportDocuments.vehicleId),
        isNull(transportVehicles.archivedAt),
      ),
    )
    .leftJoin(
      memberships,
      and(
        eq(memberships.institutionId, transportDocuments.institutionId),
        eq(memberships.id, transportDocuments.membershipId),
      ),
    )
    .leftJoin(users, eq(users.id, memberships.userId))

/** Arşivli aracın belgesi dışarıda kalır. */
const liveSubject = () =>
  or(eq(transportDocuments.subjectKind, 'staff'), isNotNull(transportVehicles.id))

/** Uyarı ve uygunluğa sayılan belge (yerine geçilmemiş, şimdiki sürücü, etkin personel). */
const counted = () =>
  and(
    isNull(transportDocuments.supersededAt),
    or(
      eq(transportDocuments.subjectKind, 'vehicle'),
      and(
        eq(transportDocuments.subjectKind, 'driver'),
        eq(transportDocuments.driverName, transportVehicles.driverName),
      ),
      and(eq(transportDocuments.subjectKind, 'staff'), isNull(memberships.deactivatedAt)),
    ),
  )

function dueCondition(due: TransportDocumentDue | undefined, today: string, horizon: string) {
  const end = transportDocuments.endDate
  switch (due) {
    case undefined:
      return undefined
    case 'expired':
      return and(counted(), lt(end, today))
    case 'expiring':
      return and(counted(), gte(end, today), lte(end, horizon))
    case 'attention':
      return and(counted(), lte(end, horizon))
    case 'valid':
      return and(counted(), or(isNull(end), sql`${end} > ${horizon}`))
    default:
      return due satisfies never
  }
}

type JoinedRow = Row & {
  vehiclePlate: string | null
  vehicleDriverName: string | null
  staffName: string | null
  deactivatedAt: Date | null
}
const toListRow = ({
  vehiclePlate,
  vehicleDriverName,
  staffName,
  deactivatedAt,
  ...row
}: JoinedRow) => ({
  ...toDocument(row),
  vehiclePlate,
  vehicleDriverName,
  staffName,
  staffActive: row.subjectKind === 'staff' ? deactivatedAt === null : null,
})

/** Belge listesi: bitişi en yakın önce (süresiz en sonda), sayfalı. */
export async function listTransportDocuments(
  db: Database,
  institutionId: string,
  query: TransportDocumentListQuery,
): Promise<{ items: TransportDocumentListRow[]; total: number }> {
  const where = and(
    ofInstitution(institutionId),
    liveSubject(),
    query.history ? undefined : isNull(transportDocuments.supersededAt),
    query.subject === undefined ? undefined : eq(transportDocuments.subjectKind, query.subject),
    query.vehicleId === undefined ? undefined : eq(transportDocuments.vehicleId, query.vehicleId),
    query.membershipId === undefined
      ? undefined
      : eq(transportDocuments.membershipId, query.membershipId),
    query.documentType === undefined
      ? undefined
      : eq(transportDocuments.documentType, query.documentType),
    dueCondition(query.due, query.today, query.horizon),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(transportDocuments)
    .leftJoin(
      transportVehicles,
      and(
        eq(transportVehicles.institutionId, transportDocuments.institutionId),
        eq(transportVehicles.id, transportDocuments.vehicleId),
        isNull(transportVehicles.archivedAt),
      ),
    )
    .leftJoin(
      memberships,
      and(
        eq(memberships.institutionId, transportDocuments.institutionId),
        eq(memberships.id, transportDocuments.membershipId),
      ),
    )
    .where(where)
  const rows = await joinedFrom(db)
    .where(where)
    .orderBy(
      sql`${transportDocuments.endDate} asc nulls last`,
      desc(transportDocuments.createdAt),
      asc(transportDocuments.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toListRow), total: totalRow?.total ?? 0 }
}

/** Uyarı ve uygunluk için sayılan bütün belgeler (etkin araç ve etkin personel). */
export async function loadCountedDocuments(
  db: Database,
  institutionId: string,
): Promise<TransportDocumentListRow[]> {
  const rows = await joinedFrom(db).where(
    and(ofInstitution(institutionId), liveSubject(), counted()),
  )
  return rows.map(toListRow)
}

/** Kurumun arşivlenmemiş araçları (uygunluk özeti için; plaka sırasıyla). */
export async function loadLiveVehicles(db: Database, institutionId: string) {
  return db
    .select({
      id: transportVehicles.id,
      plate: transportVehicles.plate,
      driverName: transportVehicles.driverName,
    })
    .from(transportVehicles)
    .where(
      and(eq(transportVehicles.institutionId, institutionId), isNull(transportVehicles.archivedAt)),
    )
    .orderBy(asc(transportVehicles.plate))
}

/** Araçların etkin güzergâhları. */
export async function loadVehicleRoutes(
  db: Database,
  institutionId: string,
  vehicleIds: readonly string[],
): Promise<{ id: string; name: string; direction: TransportDirection; vehicleId: string }[]> {
  if (vehicleIds.length === 0) return []
  return db
    .select({
      id: transportRoutes.id,
      name: transportRoutes.name,
      direction: transportRoutes.direction,
      vehicleId: transportRoutes.vehicleId,
    })
    .from(transportRoutes)
    .where(
      and(
        eq(transportRoutes.institutionId, institutionId),
        isNull(transportRoutes.archivedAt),
        inArray(transportRoutes.vehicleId, [...new Set(vehicleIds)]),
      ),
    )
    .orderBy(asc(transportRoutes.direction), asc(transportRoutes.name))
}

/** Belgeleri özne bilgisiyle yükler (yanıt görünümü için; arşivli araç ve geçmiş dahil). */
export async function loadDocumentRows(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<TransportDocumentListRow[]> {
  if (ids.length === 0) return []
  const rows = await joinedFrom(db).where(
    and(ofInstitution(institutionId), inArray(transportDocuments.id, [...new Set(ids)])),
  )
  return rows.map(toListRow)
}
