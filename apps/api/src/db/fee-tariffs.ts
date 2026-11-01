import { and, count, desc, eq, sql } from 'drizzle-orm'

import type { FeeDiscount, FeeItem, FeeTariffStatus } from '@kampus/school-core/lib/fee-tariffs.ts'

import type { Database } from './client.ts'
import { feeTariffs } from './schema/fee-tariffs.ts'

/** Ücret tarifesi deposu (ADR 0006 karar 8). İlk parametreler veritabanı ve `institutionId`'dir. */

export interface StoredFeeTariff {
  id: string
  academicYear: number
  versionNumber: number
  status: FeeTariffStatus
  items: FeeItem[]
  discounts: FeeDiscount[]
  announcedDate: string | null
  mebbisRecordedDate: string | null
  publishedAt: Date | null
  version: number
}

const COLUMNS = {
  id: feeTariffs.id,
  academicYear: feeTariffs.academicYear,
  versionNumber: feeTariffs.versionNumber,
  status: feeTariffs.status,
  items: feeTariffs.items,
  discounts: feeTariffs.discounts,
  announcedDate: feeTariffs.announcedDate,
  mebbisRecordedDate: feeTariffs.mebbisRecordedDate,
  publishedAt: feeTariffs.publishedAt,
  version: feeTariffs.version,
}

function stored(row: { status: string } & Omit<StoredFeeTariff, 'status'>): StoredFeeTariff {
  return { ...row, status: row.status as FeeTariffStatus }
}

export async function findFeeTariff(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredFeeTariff | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(feeTariffs)
    .where(and(eq(feeTariffs.institutionId, institutionId), eq(feeTariffs.id, id)))
    .limit(1)
  return row ? stored(row) : null
}

export async function tariffVersionsOfYear(
  db: Database,
  institutionId: string,
  academicYear: number,
): Promise<{ versionNumber: number; status: FeeTariffStatus }[]> {
  const rows = await db
    .select({ versionNumber: feeTariffs.versionNumber, status: feeTariffs.status })
    .from(feeTariffs)
    .where(
      and(eq(feeTariffs.institutionId, institutionId), eq(feeTariffs.academicYear, academicYear)),
    )
  return rows.map((row) => ({ ...row, status: row.status as FeeTariffStatus }))
}

export async function listFeeTariffs(
  db: Database,
  institutionId: string,
  query: { academicYear?: number | undefined; page: number; pageSize: number },
): Promise<{ items: StoredFeeTariff[]; total: number }> {
  const where = and(
    eq(feeTariffs.institutionId, institutionId),
    query.academicYear === undefined ? undefined : eq(feeTariffs.academicYear, query.academicYear),
  )
  const [totalRow] = await db.select({ total: count() }).from(feeTariffs).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(feeTariffs)
    .where(where)
    .orderBy(desc(feeTariffs.academicYear), desc(feeTariffs.versionNumber))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(stored), total: totalRow?.total ?? 0 }
}

export async function insertFeeTariff(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    academicYear: number
    versionNumber: number
    items: FeeItem[]
    discounts: FeeDiscount[]
    now: Date
  },
): Promise<void> {
  await tx.insert(feeTariffs).values({
    institutionId,
    id: input.id,
    academicYear: input.academicYear,
    versionNumber: input.versionNumber,
    status: 'draft',
    items: input.items,
    discounts: input.discounts,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Yalnız taslak ve beklenen sürüm güncellenir; tutmazsa `false`. */
export async function updateFeeTariffItems(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    items: FeeItem[]
    discounts: FeeDiscount[]
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(feeTariffs)
    .set({
      items: input.items,
      discounts: input.discounts,
      version: sql`${feeTariffs.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(feeTariffs.institutionId, institutionId),
        eq(feeTariffs.id, input.id),
        eq(feeTariffs.status, 'draft'),
        eq(feeTariffs.version, input.expectedVersion),
      ),
    )
    .returning({ id: feeTariffs.id })
  return rows.length === 1
}

/** Önceki yayındaki sürümü aynı işlemde `superseded` yapar, taslağı yayımlar. */
export async function applyFeeTariffPublish(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    academicYear: number
    expectedVersion: number
    announcedDate: string
    mebbisRecordedDate: string | null
    publishedByUserId: string
    now: Date
  },
): Promise<boolean> {
  await tx
    .update(feeTariffs)
    .set({
      status: 'superseded',
      version: sql`${feeTariffs.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(feeTariffs.institutionId, institutionId),
        eq(feeTariffs.academicYear, input.academicYear),
        eq(feeTariffs.status, 'published'),
      ),
    )
  const rows = await tx
    .update(feeTariffs)
    .set({
      status: 'published',
      announcedDate: input.announcedDate,
      mebbisRecordedDate: input.mebbisRecordedDate,
      publishedByUserId: input.publishedByUserId,
      publishedAt: input.now,
      version: sql`${feeTariffs.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(feeTariffs.institutionId, institutionId),
        eq(feeTariffs.id, input.id),
        eq(feeTariffs.status, 'draft'),
        eq(feeTariffs.version, input.expectedVersion),
      ),
    )
    .returning({ id: feeTariffs.id })
  return rows.length === 1
}

/** Eğitim yılının yayındaki tarifesi; yoksa `null` (DOM-FIN-002). */
export async function findPublishedTariff(
  db: Database,
  institutionId: string,
  academicYear: number,
): Promise<StoredFeeTariff | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(feeTariffs)
    .where(
      and(
        eq(feeTariffs.institutionId, institutionId),
        eq(feeTariffs.academicYear, academicYear),
        eq(feeTariffs.status, 'published'),
      ),
    )
    .limit(1)
  return row ? stored(row) : null
}
