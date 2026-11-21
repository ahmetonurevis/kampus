import { randomUUID } from 'node:crypto'

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  MATERIAL_FEE_KIND,
  type MaterialRecipientKind,
  type MaterialSetFields,
  type MaterialSetItemInput,
} from '@kampus/school-core/lib/finance-material-sets.ts'

import type { Database } from './client.ts'
import { recordFilter } from './records.ts'
import { stockWarehouses } from './schema/finance-inventory.ts'
import {
  materialDeliveries,
  materialDeliveryItems,
  materialSetItems,
  materialSets,
} from './schema/finance-material-sets.ts'
import { invoices } from './schema/invoices.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'
import { records } from './schema/records.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Materyal seti ve teslim deposu (DOM-FIN-080; ON-232). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-material-sets.ts`'tedir. Öğrenci listesi SQL'de
 * sayfalanır: setin hedefindeki etkin öğrenciler ile setin iptal edilmemiş teslimi olan öğrenciler
 * birleşimi; kurumun bütün öğrencisi belleğe yüklenmez.
 */

export interface StoredMaterialSet {
  id: string
  name: string
  academicYear: number
  gradeLevel: number | null
  courseId: string | null
  isActive: boolean
  version: number
  createdAt: string
}

export interface StoredMaterialSetItem extends MaterialSetItemInput {
  position: number
}

const SET_COLUMNS = {
  id: materialSets.id,
  name: materialSets.name,
  academicYear: materialSets.academicYear,
  gradeLevel: materialSets.gradeLevel,
  courseId: materialSets.courseId,
  isActive: materialSets.isActive,
  version: materialSets.version,
  createdAt: materialSets.createdAt,
}
const toSet = (row: Omit<StoredMaterialSet, 'createdAt'> & { createdAt: Date }) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})
const setsOf = (institutionId: string) =>
  and(eq(materialSets.institutionId, institutionId), isNull(materialSets.archivedAt))

/** Kurumun setleri: yeni yıl önce, aynı yılda ada göre. */
export async function loadMaterialSets(
  db: Database,
  institutionId: string,
  filter: { ids?: readonly string[] } = {},
): Promise<StoredMaterialSet[]> {
  if (filter.ids !== undefined && filter.ids.length === 0) return []
  const rows = await db
    .select(SET_COLUMNS)
    .from(materialSets)
    .where(
      and(
        setsOf(institutionId),
        filter.ids === undefined ? undefined : inArray(materialSets.id, [...filter.ids]),
      ),
    )
    .orderBy(
      sql`${materialSets.academicYear} desc`,
      foldSql(materialSets.name),
      asc(materialSets.id),
    )
  return rows.map(toSet)
}

export async function findMaterialSet(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMaterialSet | null> {
  return (await loadMaterialSets(db, institutionId, { ids: [id] }))[0] ?? null
}

/** Setlerin etkin kalemleri, setteki sırayla. */
export async function loadMaterialSetItems(
  db: Database,
  institutionId: string,
  setIds: readonly string[],
): Promise<Map<string, StoredMaterialSetItem[]>> {
  const items = new Map<string, StoredMaterialSetItem[]>()
  if (setIds.length === 0) return items
  const rows = await db
    .select({
      setId: materialSetItems.setId,
      stockItemId: materialSetItems.stockItemId,
      quantity: materialSetItems.quantity,
      position: materialSetItems.position,
    })
    .from(materialSetItems)
    .where(
      and(
        eq(materialSetItems.institutionId, institutionId),
        inArray(materialSetItems.setId, [...new Set(setIds)]),
        isNull(materialSetItems.archivedAt),
      ),
    )
    .orderBy(asc(materialSetItems.setId), asc(materialSetItems.position))
  for (const { setId, ...item } of rows) items.set(setId, [...(items.get(setId) ?? []), item])
  return items
}

async function insertItems(
  tx: Database,
  institutionId: string,
  setId: string,
  items: readonly MaterialSetItemInput[],
  now: Date,
) {
  await tx.insert(materialSetItems).values(
    items.map((item, position) => ({
      institutionId,
      id: randomUUID(),
      setId,
      stockItemId: item.stockItemId,
      quantity: item.quantity,
      position,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export async function insertMaterialSet(
  tx: Database,
  institutionId: string,
  input: MaterialSetFields & { id: string; now: Date },
): Promise<void> {
  await tx.insert(materialSets).values({
    institutionId,
    id: input.id,
    name: input.name,
    academicYear: input.academicYear,
    gradeLevel: input.gradeLevel,
    courseId: input.courseId,
    createdAt: input.now,
    updatedAt: input.now,
  })
  await insertItems(tx, institutionId, input.id, input.items, input.now)
}

/**
 * Seti sürüm koşuluyla düzeltir; kalemler gelirse eski kalemler arşivlenir, yenileri yazılır.
 * Sürüm tutmazsa `false` (409).
 */
export async function updateMaterialSet(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<Omit<MaterialSetFields, 'items'>> & {
      items?: readonly MaterialSetItemInput[] | undefined
      isActive?: boolean | undefined
    }
    now: Date
  },
): Promise<boolean> {
  const { items, ...fields } = input.changes
  const rows = await tx
    .update(materialSets)
    .set({ ...fields, updatedAt: input.now, version: sql`${materialSets.version} + 1` })
    .where(
      and(
        setsOf(institutionId),
        eq(materialSets.id, input.id),
        eq(materialSets.version, input.expectedVersion),
      ),
    )
    .returning({ id: materialSets.id })
  if (rows.length !== 1) return false
  if (items !== undefined) {
    await tx
      .update(materialSetItems)
      .set({ archivedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(materialSetItems.institutionId, institutionId),
          eq(materialSetItems.setId, input.id),
          isNull(materialSetItems.archivedAt),
        ),
      )
    await insertItems(tx, institutionId, input.id, items, input.now)
  }
  return true
}

// --- Öğrenci listesi -----------------------------------------------------------------------------

const classRecord = alias(records, 'class_record')

export type MaterialSetTarget = Pick<
  StoredMaterialSet,
  'id' | 'academicYear' | 'gradeLevel' | 'courseId'
>

/** Öğrenci setin hedefinde mi (etkinlik ayrıca denetlenir): sınıf düzeyi, kur ya da hedefsiz. */
function eligibleMatch(institutionId: string, set: MaterialSetTarget): SQL | undefined {
  if (set.gradeLevel !== null)
    return sql`${classRecord.data} ->> 'grade' = ${String(set.gradeLevel)}`
  if (set.courseId !== null)
    return sql`exists (select 1 from ${languageGroupMembers} inner join ${languageGroups} on ${languageGroups.institutionId} = ${languageGroupMembers.institutionId} and ${languageGroups.id} = ${languageGroupMembers.groupId} where ${languageGroupMembers.institutionId} = ${institutionId} and ${languageGroupMembers.studentId} = ${records.id} and ${languageGroupMembers.archivedAt} is null and ${languageGroupMembers.status} = 'active' and ${languageGroups.archivedAt} is null and ${languageGroups.state} <> 'cancelled' and ${languageGroups.courseId} = ${set.courseId})`
  return undefined
}

/** Setin yılında kitap ve kırtasiye ücret kalemi olan öğrenci (K-207). */
function feeMatch(institutionId: string, academicYear: number): SQL {
  return sql`exists (select 1 from ${invoices} where ${invoices.institutionId} = ${institutionId} and ${invoices.studentId} = ${records.id} and ${invoices.archivedAt} is null and ${invoices.feeKind} = ${MATERIAL_FEE_KIND} and ${invoices.academicYear} = ${academicYear})`
}

const activeStudent = recordFilter({ kind: 'active', field: 'isActive', active: true })

/**
 * Öğrencinin sınıfı ya da kur grubu (ON-338 teslim tutanağı ve listesi "sınıf / grup"). Kura bağlı
 * sette o kurun etkin grubu önce gelir; diğer sette sınıf, sınıfsız öğrencide (dil okulu) etkin kur
 * grupları ada göre virgülle.
 */
function classOrGroupName(institutionId: string, courseId: string | null) {
  const course = courseId === null ? sql`` : sql` and ${languageGroups.courseId} = ${courseId}`
  const groups = sql`(select string_agg(${languageGroups.name}, ', ' order by ${languageGroups.name}) from ${languageGroupMembers} inner join ${languageGroups} on ${languageGroups.institutionId} = ${languageGroupMembers.institutionId} and ${languageGroups.id} = ${languageGroupMembers.groupId} where ${languageGroupMembers.institutionId} = ${institutionId} and ${languageGroupMembers.studentId} = ${records.id} and ${languageGroupMembers.archivedAt} is null and ${languageGroupMembers.status} = 'active' and ${languageGroups.archivedAt} is null and ${languageGroups.state} <> 'cancelled'${course})`
  const className = sql`${classRecord.data} ->> 'name'`
  return courseId === null
    ? sql<string | null>`coalesce(${className}, ${groups})`
    : sql<string | null>`coalesce(${groups}, ${className})`
}

/** Setin öğrenci evreni: hedefteki etkin öğrenci ya da bu setin iptal edilmemiş teslimi olan öğrenci. */
function studentsFrom(institutionId: string, set: MaterialSetTarget) {
  const eligible = eligibleMatch(institutionId, set)
  return {
    base: and(
      eq(records.institutionId, institutionId),
      eq(records.collection, 'students'),
      isNull(records.archivedAt),
    ),
    universe: sql`((${activeStudent}${eligible === undefined ? sql`` : sql` and ${eligible}`}) or ${materialDeliveries.id} is not null)`,
  }
}

const deliveryJoin = (institutionId: string, setId: string) =>
  and(
    eq(materialDeliveries.institutionId, institutionId),
    eq(materialDeliveries.setId, setId),
    eq(materialDeliveries.studentId, records.id),
    isNull(materialDeliveries.cancelledAt),
    isNull(materialDeliveries.archivedAt),
  )
const classJoin = (institutionId: string) =>
  and(
    eq(classRecord.institutionId, institutionId),
    eq(classRecord.collection, 'classes'),
    sql`${classRecord.id} = ${records.data} ->> 'classId'`,
    isNull(classRecord.archivedAt),
  )

export interface MaterialStudentQuery {
  q?: string | undefined
  status?: 'delivered' | 'pending' | undefined
  fee?: 'charged' | 'none' | undefined
  signature?: 'received' | 'missing' | undefined
  offset: number
  limit: number
}

export interface MaterialStudentRow {
  id: string
  name: string
  number: string | null
  className: string | null
  hasMaterialFee: boolean
  deliveryId: string | null
}

/** Setin öğrenci sayfası: ada göre (Türkçe harf duyarsız), aynı adda kimlikle sabit sıra. */
export async function loadMaterialStudentPage(
  db: Database,
  institutionId: string,
  set: MaterialSetTarget,
  query: MaterialStudentQuery,
): Promise<{ rows: MaterialStudentRow[]; total: number }> {
  const { base, universe } = studentsFrom(institutionId, set)
  const name = sql<string>`coalesce(${records.data} ->> 'name', '')`
  const number = sql<string | null>`${records.data} ->> 'number'`
  const fee = feeMatch(institutionId, set.academicYear)
  const where = and(
    base,
    universe,
    query.status === 'delivered' ? isNotNull(materialDeliveries.id) : undefined,
    query.status === 'pending' ? isNull(materialDeliveries.id) : undefined,
    query.fee === 'charged' ? fee : undefined,
    query.fee === 'none' ? sql`not ${fee}` : undefined,
    query.signature === 'received' ? eq(materialDeliveries.signatureReceived, true) : undefined,
    query.signature === 'missing' ? eq(materialDeliveries.signatureReceived, false) : undefined,
    query.q === undefined
      ? undefined
      : sql`(strpos(${foldSql(name)}, ${foldSearch(query.q)}) > 0 or strpos(coalesce(${number}, ''), ${query.q}) > 0)`,
  )
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: records.id,
        name,
        number,
        className: classOrGroupName(institutionId, set.courseId),
        hasMaterialFee: sql<boolean>`${fee}`,
        deliveryId: materialDeliveries.id,
      })
      .from(records)
      .leftJoin(classRecord, classJoin(institutionId))
      .leftJoin(materialDeliveries, deliveryJoin(institutionId, set.id))
      .where(where)
      .orderBy(foldSql(name), asc(records.id))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ total: count() })
      .from(records)
      .leftJoin(classRecord, classJoin(institutionId))
      .leftJoin(materialDeliveries, deliveryJoin(institutionId, set.id))
      .where(where),
  ])
  return { rows, total: counted?.total ?? 0 }
}

/** Setin öğrenci ve teslim sayısı (liste satırı). */
export async function countMaterialStudents(
  db: Database,
  institutionId: string,
  set: MaterialSetTarget,
): Promise<{ studentCount: number; deliveredCount: number }> {
  const { base, universe } = studentsFrom(institutionId, set)
  const [row] = await db
    .select({ studentCount: count(), deliveredCount: count(materialDeliveries.id) })
    .from(records)
    .leftJoin(classRecord, classJoin(institutionId))
    .leftJoin(materialDeliveries, deliveryJoin(institutionId, set.id))
    .where(and(base, universe))
  return { studentCount: row?.studentCount ?? 0, deliveredCount: row?.deliveredCount ?? 0 }
}

/** Teslim edilecek öğrenci: var mı, etkin mi, setin hedefinde mi. */
export async function loadDeliveryStudent(
  db: Database,
  institutionId: string,
  set: MaterialSetTarget,
  studentId: string,
): Promise<{ id: string; name: string; isActive: boolean; isEligible: boolean } | null> {
  const eligible = eligibleMatch(institutionId, set)
  const [row] = await db
    .select({
      id: records.id,
      name: sql<string>`coalesce(${records.data} ->> 'name', '')`,
      isActive: sql<boolean>`${activeStudent}`,
      isEligible: eligible === undefined ? sql<boolean>`true` : sql<boolean>`${eligible}`,
    })
    .from(records)
    .leftJoin(classRecord, classJoin(institutionId))
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        isNull(records.archivedAt),
        eq(records.id, studentId),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Teslim tutanağındaki öğrenci bilgisi (ON-338): numara, sınıf ya da kur grubu ve setin yılında
 * kitap ve kırtasiye ücret kalemi olup olmadığı (K-207; tutar ve ödeme durumu değil). Arşivlenmiş
 * öğrenci de okunur ki eski teslimin tutanağı alınabilsin.
 */
export async function loadDeliveryStudentFacts(
  db: Database,
  institutionId: string,
  set: Pick<StoredMaterialSet, 'academicYear' | 'courseId'>,
  ids: readonly string[],
): Promise<
  Map<string, { number: string | null; className: string | null; hasMaterialFee: boolean }>
> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({
      id: records.id,
      number: sql<string | null>`${records.data} ->> 'number'`,
      className: classOrGroupName(institutionId, set.courseId),
      hasMaterialFee: sql<boolean>`${feeMatch(institutionId, set.academicYear)}`,
    })
    .from(records)
    .leftJoin(classRecord, classJoin(institutionId))
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        inArray(records.id, [...new Set(ids)]),
      ),
    )
  return new Map(rows.map(({ id, ...facts }) => [id, facts]))
}

/** Öğrenci adları (teslim yanıtı). */
export async function loadStudentNames(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: records.id, name: sql<string>`coalesce(${records.data} ->> 'name', '')` })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        inArray(records.id, [...new Set(ids)]),
      ),
    )
  return new Map(rows.map((row) => [row.id, row.name]))
}

// --- Teslim --------------------------------------------------------------------------------------

export interface StoredMaterialDelivery {
  id: string
  setId: string
  studentId: string
  warehouseId: string
  warehouseName: string
  deliveryDate: string
  recipientKind: MaterialRecipientKind
  guardianId: string | null
  recipientName: string | null
  signatureReceived: boolean
  signatureRecordedAt: string | null
  note: string | null
  createdByUserId: string
  createdAt: string
  cancelledAt: string | null
  cancelledByUserId: string | null
  cancelReason: string | null
  version: number
}

const DELIVERY_COLUMNS = {
  id: materialDeliveries.id,
  setId: materialDeliveries.setId,
  studentId: materialDeliveries.studentId,
  warehouseId: materialDeliveries.warehouseId,
  warehouseName: stockWarehouses.name,
  deliveryDate: materialDeliveries.deliveryDate,
  recipientKind: materialDeliveries.recipientKind,
  guardianId: materialDeliveries.guardianId,
  recipientName: materialDeliveries.recipientName,
  signatureReceived: materialDeliveries.signatureReceived,
  signatureRecordedAt: materialDeliveries.signatureRecordedAt,
  note: materialDeliveries.note,
  createdByUserId: materialDeliveries.createdByUserId,
  createdAt: materialDeliveries.createdAt,
  cancelledAt: materialDeliveries.cancelledAt,
  cancelledByUserId: materialDeliveries.cancelledByUserId,
  cancelReason: materialDeliveries.cancelReason,
  version: materialDeliveries.version,
}
const iso = (value: Date | null) => (value === null ? null : value.toISOString())

/** Teslimler (iptal edilenler dahil); verilen kimlik sırasıyla değil, oluşturma sırasıyla. */
export async function loadMaterialDeliveries(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredMaterialDelivery[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select(DELIVERY_COLUMNS)
    .from(materialDeliveries)
    .innerJoin(
      stockWarehouses,
      and(
        eq(stockWarehouses.institutionId, materialDeliveries.institutionId),
        eq(stockWarehouses.id, materialDeliveries.warehouseId),
      ),
    )
    .where(
      and(
        eq(materialDeliveries.institutionId, institutionId),
        isNull(materialDeliveries.archivedAt),
        inArray(materialDeliveries.id, [...new Set(ids)]),
      ),
    )
    .orderBy(asc(materialDeliveries.createdAt), asc(materialDeliveries.id))
  return rows.map((row) => ({
    ...row,
    signatureRecordedAt: iso(row.signatureRecordedAt),
    createdAt: row.createdAt.toISOString(),
    cancelledAt: iso(row.cancelledAt),
  }))
}

/**
 * Öğrencilerin bu setteki son iptal edilmiş teslimi (iptal tutanağı düğmesi, ON-338): iptal anı
 * yeni olan önce, eşitlikte kimlik.
 */
export async function loadLastCancelledDeliveries(
  db: Database,
  institutionId: string,
  setId: string,
  studentIds: readonly string[],
): Promise<Map<string, { id: string; deliveryDate: string; cancelledAt: string }>> {
  const last = new Map<string, { id: string; deliveryDate: string; cancelledAt: string }>()
  if (studentIds.length === 0) return last
  const rows = await db
    .select({
      id: materialDeliveries.id,
      studentId: materialDeliveries.studentId,
      deliveryDate: materialDeliveries.deliveryDate,
      cancelledAt: materialDeliveries.cancelledAt,
    })
    .from(materialDeliveries)
    .where(
      and(
        eq(materialDeliveries.institutionId, institutionId),
        eq(materialDeliveries.setId, setId),
        inArray(materialDeliveries.studentId, [...new Set(studentIds)]),
        isNotNull(materialDeliveries.cancelledAt),
        isNull(materialDeliveries.archivedAt),
      ),
    )
    .orderBy(desc(materialDeliveries.cancelledAt), desc(materialDeliveries.id))
  for (const row of rows)
    if (row.cancelledAt !== null && !last.has(row.studentId))
      last.set(row.studentId, {
        id: row.id,
        deliveryDate: row.deliveryDate,
        cancelledAt: row.cancelledAt.toISOString(),
      })
  return last
}

/** Öğrenciye bu setin iptal edilmemiş teslimi var mı. */
export async function hasLiveDelivery(
  db: Database,
  institutionId: string,
  setId: string,
  studentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: materialDeliveries.id })
    .from(materialDeliveries)
    .where(
      and(
        eq(materialDeliveries.institutionId, institutionId),
        eq(materialDeliveries.setId, setId),
        eq(materialDeliveries.studentId, studentId),
        isNull(materialDeliveries.cancelledAt),
        isNull(materialDeliveries.archivedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Setin iptal edilmemiş teslimi var mı (yıl ve hedef kilidi, K-208). */
export async function setHasDeliveries(
  db: Database,
  institutionId: string,
  setId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: materialDeliveries.id })
    .from(materialDeliveries)
    .where(
      and(
        eq(materialDeliveries.institutionId, institutionId),
        eq(materialDeliveries.setId, setId),
        isNull(materialDeliveries.cancelledAt),
        isNull(materialDeliveries.archivedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface NewMaterialDelivery {
  id: string
  setId: string
  studentId: string
  warehouseId: string
  deliveryDate: string
  recipientKind: MaterialRecipientKind
  guardianId: string | null
  recipientName: string | null
  signatureReceived: boolean
  note: string | null
  lines: readonly { stockItemId: string; quantity: number; stockMovementId: string }[]
}

/** Teslimi ve kalemlerini yazar; stok çıkışları önceden yazılmış olmalıdır (yabancı anahtar). */
export async function insertMaterialDelivery(
  tx: Database,
  institutionId: string,
  input: NewMaterialDelivery & { createdByUserId: string; now: Date },
): Promise<void> {
  const { lines, now, ...delivery } = input
  await tx.insert(materialDeliveries).values({
    ...delivery,
    institutionId,
    signatureRecordedAt: delivery.signatureReceived ? now : null,
    signatureRecordedByUserId: delivery.signatureReceived ? delivery.createdByUserId : null,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(materialDeliveryItems).values(
    lines.map((line, position) => ({
      institutionId,
      id: randomUUID(),
      deliveryId: delivery.id,
      position,
      stockItemId: line.stockItemId,
      quantity: line.quantity,
      stockMovementId: line.stockMovementId,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** Teslimlerin kalemleri (stok kartı, adet ve stok çıkışı), setteki sırayla. */
export async function loadMaterialDeliveryItems(
  db: Database,
  institutionId: string,
  deliveryIds: readonly string[],
): Promise<Map<string, { stockItemId: string; quantity: number; stockMovementId: string }[]>> {
  const items = new Map<
    string,
    { stockItemId: string; quantity: number; stockMovementId: string }[]
  >()
  if (deliveryIds.length === 0) return items
  const rows = await db
    .select({
      deliveryId: materialDeliveryItems.deliveryId,
      stockItemId: materialDeliveryItems.stockItemId,
      quantity: materialDeliveryItems.quantity,
      stockMovementId: materialDeliveryItems.stockMovementId,
    })
    .from(materialDeliveryItems)
    .where(
      and(
        eq(materialDeliveryItems.institutionId, institutionId),
        inArray(materialDeliveryItems.deliveryId, [...new Set(deliveryIds)]),
      ),
    )
    .orderBy(asc(materialDeliveryItems.deliveryId), asc(materialDeliveryItems.position))
  for (const { deliveryId, ...item } of rows)
    items.set(deliveryId, [...(items.get(deliveryId) ?? []), item])
  return items
}

const liveDelivery = (institutionId: string, id: string, expectedVersion: number) =>
  and(
    eq(materialDeliveries.institutionId, institutionId),
    eq(materialDeliveries.id, id),
    eq(materialDeliveries.version, expectedVersion),
    isNull(materialDeliveries.cancelledAt),
    isNull(materialDeliveries.archivedAt),
  )

/** Teslimi iptal eder; sürüm tutmazsa ya da zaten iptal edildiyse `false` (409). */
export async function cancelMaterialDelivery(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; reason: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(materialDeliveries)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.userId,
      cancelReason: input.reason,
      updatedAt: input.now,
      version: sql`${materialDeliveries.version} + 1`,
    })
    .where(liveDelivery(institutionId, input.id, input.expectedVersion))
    .returning({ id: materialDeliveries.id })
  return rows.length === 1
}

/** Kâğıt imzasının alındığını işler; sürüm tutmazsa `false` (409). */
export async function markMaterialDeliverySigned(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(materialDeliveries)
    .set({
      signatureReceived: true,
      signatureRecordedAt: input.now,
      signatureRecordedByUserId: input.userId,
      updatedAt: input.now,
      version: sql`${materialDeliveries.version} + 1`,
    })
    .where(
      and(
        liveDelivery(institutionId, input.id, input.expectedVersion),
        ne(materialDeliveries.signatureReceived, true),
      ),
    )
    .returning({ id: materialDeliveries.id })
  return rows.length === 1
}
