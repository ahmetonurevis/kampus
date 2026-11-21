import { and, asc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import {
  DEFAULT_MEDICATION_SETTINGS,
  type DoseCorrectionKind,
  type DoseRecordKind,
  type MedicationSettings,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { infirmaryMedicationAdministrations } from './schema/finance-infirmary.ts'
import {
  infirmaryMedicationDoseCorrections,
  infirmaryMedicationSettings,
  infirmaryMedicationSkips,
} from './schema/finance-infirmary-schedule.ts'

/**
 * İlaç çizelgesi, atlama ve düzeltme deposu (DOM-FIN-152; ON-161). Kurum kapsamlıdır: ilk
 * parametre `institutionId`. Kural core `lib/finance-infirmary-schedule.ts`'tedir; şifreleme ve
 * çözme servistedir, depo şifreli değeri olduğu gibi okur ve yazar. Atlama ve düzeltme yalnız
 * eklenir (tetikleyici); depo güncelleme sunmaz.
 */

const a = infirmaryMedicationAdministrations
const s = infirmaryMedicationSkips
const k = infirmaryMedicationDoseCorrections
const iso = (value: Date) => value.toISOString()

/** Kayıt süzgeci: talepler ya da öğrenciler (en az biri) ve isteğe bağlı gün aralığı (dahil). */
export interface DoseRecordFilter {
  consentIds?: readonly string[] | undefined
  studentIds?: readonly string[] | undefined
  fromDay?: string | undefined
  toDay?: string | undefined
}

function recordWhere(
  institutionId: string,
  columns: {
    institutionId: AnyPgColumn
    consentId: AnyPgColumn
    studentId: AnyPgColumn
    doseDay: AnyPgColumn
  },
  filter: DoseRecordFilter,
): SQL | undefined {
  return and(
    eq(columns.institutionId, institutionId),
    filter.consentIds === undefined
      ? undefined
      : inArray(columns.consentId, [...new Set(filter.consentIds)]),
    filter.studentIds === undefined
      ? undefined
      : inArray(columns.studentId, [...new Set(filter.studentIds)]),
    filter.fromDay === undefined ? undefined : gte(columns.doseDay, filter.fromDay),
    filter.toDay === undefined ? undefined : lte(columns.doseDay, filter.toDay),
  )
}

const isEmpty = (filter: DoseRecordFilter) =>
  filter.consentIds?.length === 0 ||
  filter.studentIds?.length === 0 ||
  (filter.consentIds === undefined && filter.studentIds === undefined)

// --- Uygulama (okuma) ----------------------------------------------------------------------------

export interface StoredDoseAdministration {
  id: string
  consentId: string
  studentId: string
  doseDay: string
  scheduledTime: string
  administeredAt: string
  administeredByMembershipId: string
  replacesId: string | null
  recordedByUserId: string
  healthCiphertext: string
  healthKeyVersion: number
  createdAt: string
}

const ADMINISTRATION_COLUMNS = {
  id: a.id,
  consentId: a.consentId,
  studentId: a.studentId,
  doseDay: a.doseDay,
  scheduledTime: a.scheduledTime,
  administeredAt: a.administeredAt,
  administeredByMembershipId: a.administeredByMembershipId,
  replacesId: a.replacesAdministrationId,
  recordedByUserId: a.recordedByUserId,
  healthCiphertext: a.healthCiphertext,
  healthKeyVersion: a.healthKeyVersion,
  createdAt: a.createdAt,
}

type AdministrationRow = Omit<StoredDoseAdministration, 'administeredAt' | 'createdAt'> & {
  administeredAt: Date
  createdAt: Date
}
const toAdministration = (row: AdministrationRow): StoredDoseAdministration => ({
  ...row,
  administeredAt: iso(row.administeredAt),
  createdAt: iso(row.createdAt),
})

/** Süzgece uyan uygulamalar (yazılış sırasıyla; zincir ve düzeltme için). */
export async function loadDoseAdministrations(
  db: Database,
  institutionId: string,
  filter: DoseRecordFilter,
): Promise<StoredDoseAdministration[]> {
  if (isEmpty(filter)) return []
  const rows = await db
    .select(ADMINISTRATION_COLUMNS)
    .from(a)
    .where(recordWhere(institutionId, a, filter))
    .orderBy(asc(a.createdAt), asc(a.id))
  return rows.map(toAdministration)
}

export async function findDoseAdministration(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredDoseAdministration | null> {
  const [row] = await db
    .select(ADMINISTRATION_COLUMNS)
    .from(a)
    .where(and(eq(a.institutionId, institutionId), eq(a.id, id)))
    .limit(1)
  return row === undefined ? null : toAdministration(row)
}

// --- Atlama --------------------------------------------------------------------------------------

export interface StoredSkip {
  id: string
  consentId: string
  studentId: string
  doseDay: string
  scheduledTime: string
  replacesId: string | null
  recordedByUserId: string
  healthCiphertext: string
  healthKeyVersion: number
  createdAt: string
}

const SKIP_COLUMNS = {
  id: s.id,
  consentId: s.consentId,
  studentId: s.studentId,
  doseDay: s.doseDay,
  scheduledTime: s.scheduledTime,
  replacesId: s.replacesSkipId,
  recordedByUserId: s.recordedByUserId,
  healthCiphertext: s.healthCiphertext,
  healthKeyVersion: s.healthKeyVersion,
  createdAt: s.createdAt,
}

type SkipRow = Omit<StoredSkip, 'createdAt'> & { createdAt: Date }
const toSkip = (row: SkipRow): StoredSkip => ({ ...row, createdAt: iso(row.createdAt) })

export async function loadSkips(
  db: Database,
  institutionId: string,
  filter: DoseRecordFilter,
): Promise<StoredSkip[]> {
  if (isEmpty(filter)) return []
  const rows = await db
    .select(SKIP_COLUMNS)
    .from(s)
    .where(recordWhere(institutionId, s, filter))
    .orderBy(asc(s.createdAt), asc(s.id))
  return rows.map(toSkip)
}

export async function findSkip(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSkip | null> {
  const [row] = await db
    .select(SKIP_COLUMNS)
    .from(s)
    .where(and(eq(s.institutionId, institutionId), eq(s.id, id)))
    .limit(1)
  return row === undefined ? null : toSkip(row)
}

export async function insertSkip(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    consentId: string
    studentId: string
    doseDay: string
    scheduledTime: string
    replacesId: string | null
    healthCiphertext: string
    healthKeyVersion: number
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(s).values({
    institutionId,
    id: input.id,
    consentId: input.consentId,
    studentId: input.studentId,
    doseDay: input.doseDay,
    scheduledTime: input.scheduledTime,
    replacesSkipId: input.replacesId,
    healthCiphertext: input.healthCiphertext,
    healthKeyVersion: input.healthKeyVersion,
    recordedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

// --- Düzeltme ------------------------------------------------------------------------------------

export interface StoredCorrection {
  id: string
  consentId: string
  targetKind: DoseRecordKind
  targetId: string
  kind: DoseCorrectionKind
  administeredAt: string | null
  administeredByMembershipId: string | null
  correctedByUserId: string
  healthCiphertext: string
  healthKeyVersion: number
  createdAt: string
}

/** Kayıtların düzeltmeleri, yazılış sırasıyla (etkin değer bu sırayla uygulanır). */
export async function loadCorrections(
  db: Database,
  institutionId: string,
  targets: { administrationIds: readonly string[]; skipIds: readonly string[] },
): Promise<StoredCorrection[]> {
  const conditions = [
    ...(targets.administrationIds.length === 0
      ? []
      : [inArray(k.administrationId, [...new Set(targets.administrationIds)])]),
    ...(targets.skipIds.length === 0 ? [] : [inArray(k.skipId, [...new Set(targets.skipIds)])]),
  ]
  if (conditions.length === 0) return []
  const rows = await db
    .select({
      id: k.id,
      consentId: k.consentId,
      targetKind: k.targetKind,
      administrationId: k.administrationId,
      skipId: k.skipId,
      kind: k.kind,
      administeredAt: k.administeredAt,
      administeredByMembershipId: k.administeredByMembershipId,
      correctedByUserId: k.correctedByUserId,
      healthCiphertext: k.healthCiphertext,
      healthKeyVersion: k.healthKeyVersion,
      createdAt: k.createdAt,
    })
    .from(k)
    .where(and(eq(k.institutionId, institutionId), or(...conditions)))
    .orderBy(asc(k.createdAt), asc(k.id))
  return rows.map(({ administrationId, skipId, ...row }) => ({
    ...row,
    targetId: administrationId ?? skipId ?? '',
    administeredAt: row.administeredAt === null ? null : iso(row.administeredAt),
    createdAt: iso(row.createdAt),
  }))
}

export async function insertCorrection(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    consentId: string
    targetKind: DoseRecordKind
    targetId: string
    kind: DoseCorrectionKind
    administeredAt: string | null
    administeredByMembershipId: string | null
    healthCiphertext: string
    healthKeyVersion: number
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(k).values({
    institutionId,
    id: input.id,
    consentId: input.consentId,
    targetKind: input.targetKind,
    administrationId: input.targetKind === 'administration' ? input.targetId : null,
    skipId: input.targetKind === 'skip' ? input.targetId : null,
    kind: input.kind,
    administeredAt: input.administeredAt === null ? null : new Date(input.administeredAt),
    administeredByMembershipId: input.administeredByMembershipId,
    healthCiphertext: input.healthCiphertext,
    healthKeyVersion: input.healthKeyVersion,
    correctedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

// --- Adlar ---------------------------------------------------------------------------------------

/** Kurumda üyeliği olan kullanıcıların adları (kaydı yazan, düzelten). */
export async function memberUserNames(
  db: Database,
  institutionId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.institutionId, institutionId)),
    )
    .where(inArray(users.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredMedicationSettings extends MedicationSettings {
  /** `If-Match` sürümü; ayar hiç kaydedilmediyse 1. */
  version: number
}

const m = infirmaryMedicationSettings

export async function loadMedicationSettings(
  db: Database,
  institutionId: string,
): Promise<StoredMedicationSettings> {
  const [row] = await db
    .select({ lateToleranceMinutes: m.lateToleranceMinutes, version: m.version })
    .from(m)
    .where(eq(m.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_MEDICATION_SETTINGS, version: 1 }
}

/** Ayarı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveMedicationSettings(
  tx: Database,
  institutionId: string,
  input: MedicationSettings & { expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = { lateToleranceMinutes: input.lateToleranceMinutes, updatedAt: input.now }
  const [updated] = await tx
    .update(m)
    .set({ ...values, version: sql`${m.version} + 1` })
    .where(and(eq(m.institutionId, institutionId), eq(m.version, input.expectedVersion)))
    .returning({ version: m.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(m)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: m.version })
  return created?.version ?? null
}
