import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'

import {
  DEFAULT_MEAL_KINDS,
  type MealItemValue,
  type MealKind,
  type MealMenuStatus,
} from '@kampus/school-core/lib/finance-meal-menus.ts'

import type { Database } from './client.ts'
import {
  mealMenuCorrections,
  mealMenuItems,
  mealMenus,
  mealMenuSettings,
} from './schema/finance-meal-menus.ts'

/**
 * Yemek menüsü deposu (DOM-FIN-157; ON-090, ON-149). Kurum kapsamlıdır: ilk parametre
 * `institutionId`; arşivli menü ve kalem okunmaz. Kural core `lib/finance-meal-menus.ts`'tedir.
 */

export interface StoredMealMenu {
  id: string
  weekStart: string
  branchId: string | null
  status: MealMenuStatus
  publishedAt: Date | null
  createdAt: Date
  version: number
}

export interface StoredMealItem extends MealItemValue {
  id: string
  menuId: string
}

const MENU = {
  id: mealMenus.id,
  weekStart: mealMenus.weekStart,
  branchId: mealMenus.branchId,
  status: mealMenus.status,
  publishedAt: mealMenus.publishedAt,
  createdAt: mealMenus.createdAt,
  version: mealMenus.version,
}

const liveMenus = (institutionId: string) =>
  and(eq(mealMenus.institutionId, institutionId), isNull(mealMenus.archivedAt))
const liveItems = (institutionId: string) =>
  and(eq(mealMenuItems.institutionId, institutionId), isNull(mealMenuItems.archivedAt))

// --- Menü ----------------------------------------------------------------------------------------

export async function findMealMenu(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMealMenu | null> {
  const [row] = await db
    .select(MENU)
    .from(mealMenus)
    .where(and(liveMenus(institutionId), eq(mealMenus.id, id)))
    .limit(1)
  return row ?? null
}

/** Aynı hafta ve kampüste etkin menü var mı (kampüssüz menü kendi başına bir kampüs sayılır). */
export async function mealMenuExists(
  db: Database,
  institutionId: string,
  weekStart: string,
  branchId: string | null,
): Promise<boolean> {
  const [row] = await db
    .select({ id: mealMenus.id })
    .from(mealMenus)
    .where(
      and(
        liveMenus(institutionId),
        eq(mealMenus.weekStart, weekStart),
        branchId === null ? isNull(mealMenus.branchId) : eq(mealMenus.branchId, branchId),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function listMealMenus(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    status?: MealMenuStatus | undefined
    branchId?: string | undefined
    from?: string | undefined
  },
): Promise<{ items: StoredMealMenu[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    liveMenus(institutionId),
    query.status === undefined ? undefined : eq(mealMenus.status, query.status),
    query.branchId === undefined
      ? undefined
      : query.branchId === 'all'
        ? isNull(mealMenus.branchId)
        : eq(mealMenus.branchId, query.branchId),
    query.from === undefined ? undefined : sql`${mealMenus.weekStart} >= ${query.from}`,
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(mealMenus).where(where)
  const items = await db
    .select(MENU)
    .from(mealMenus)
    .where(where)
    .orderBy(desc(mealMenus.weekStart), asc(mealMenus.branchId), asc(mealMenus.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

/** Haftanın yayımlanmış menüleri (bütün kampüsler ve verilen kampüsler). */
export async function publishedMealMenus(
  db: Database,
  institutionId: string,
  weekStart: string,
  branchIds: readonly string[],
): Promise<StoredMealMenu[]> {
  return db
    .select(MENU)
    .from(mealMenus)
    .where(
      and(
        liveMenus(institutionId),
        eq(mealMenus.weekStart, weekStart),
        eq(mealMenus.status, 'published'),
        branchIds.length === 0
          ? isNull(mealMenus.branchId)
          : or(isNull(mealMenus.branchId), inArray(mealMenus.branchId, [...new Set(branchIds)])),
      ),
    )
}

export async function insertMealMenu(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    weekStart: string
    branchId: string | null
    copiedFromMenuId: string | null
    createdByUserId: string
    now: Date
  },
) {
  await tx.insert(mealMenus).values({
    institutionId,
    id: input.id,
    weekStart: input.weekStart,
    branchId: input.branchId,
    copiedFromMenuId: input.copiedFromMenuId,
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Menü satırını sürüm koşuluyla günceller ve sürümü artırır; tutmazsa `false` (409). */
export async function updateMealMenu(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      status: MealMenuStatus
      publishedAt: Date | null
      publishedByUserId: string | null
      archivedAt: Date
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(mealMenus)
    .set({ ...input.values, updatedAt: input.now, version: sql`${mealMenus.version} + 1` })
    .where(
      and(
        liveMenus(institutionId),
        eq(mealMenus.id, input.id),
        eq(mealMenus.version, input.expectedVersion),
      ),
    )
    .returning({ id: mealMenus.id })
  return rows.length === 1
}

// --- Kalem ---------------------------------------------------------------------------------------

type ItemRow = typeof mealMenuItems.$inferSelect

function itemOf(row: ItemRow): StoredMealItem {
  return {
    id: row.id,
    menuId: row.menuId,
    menuDate: row.menuDate,
    mealKind: row.mealKind,
    position: row.position,
    name: row.name,
    allergens: row.allergens,
    nutrition:
      row.energyKcal === null ||
      row.proteinDg === null ||
      row.fatDg === null ||
      row.carbohydrateDg === null
        ? null
        : {
            energyKcal: row.energyKcal,
            proteinDg: row.proteinDg,
            fatDg: row.fatDg,
            carbohydrateDg: row.carbohydrateDg,
            fiberDg: row.fiberDg,
            saltDg: row.saltDg,
          },
  }
}

/** Menülerin etkin kalemleri; gün, öğün ve sıraya göre. */
export async function loadMealItems(
  db: Database,
  institutionId: string,
  menuIds: readonly string[],
): Promise<StoredMealItem[]> {
  if (menuIds.length === 0) return []
  const rows = await db
    .select()
    .from(mealMenuItems)
    .where(and(liveItems(institutionId), inArray(mealMenuItems.menuId, [...new Set(menuIds)])))
    .orderBy(asc(mealMenuItems.menuDate), asc(mealMenuItems.mealKind), asc(mealMenuItems.position))
  return rows.map(itemOf)
}

/** Menü başına etkin kalem sayısı ve kalemli gün sayısı. */
export async function mealItemCounts(
  db: Database,
  institutionId: string,
  menuIds: readonly string[],
): Promise<Map<string, { items: number; days: number }>> {
  if (menuIds.length === 0) return new Map()
  const rows = await db
    .select({
      menuId: mealMenuItems.menuId,
      items: count(),
      days: sql<number>`count(distinct ${mealMenuItems.menuDate})::int`,
    })
    .from(mealMenuItems)
    .where(and(liveItems(institutionId), inArray(mealMenuItems.menuId, [...new Set(menuIds)])))
    .groupBy(mealMenuItems.menuId)
  return new Map(rows.map((row) => [row.menuId, { items: row.items, days: row.days }]))
}

/** Hücrenin etkin kalemlerini arşivler (düzenleme ve düzeltme öncesi). */
export async function archiveMealSlot(
  tx: Database,
  institutionId: string,
  input: { menuId: string; menuDate: string; mealKind: MealKind; now: Date },
) {
  await tx
    .update(mealMenuItems)
    .set({
      archivedAt: input.now,
      updatedAt: input.now,
      version: sql`${mealMenuItems.version} + 1`,
    })
    .where(
      and(
        liveItems(institutionId),
        eq(mealMenuItems.menuId, input.menuId),
        eq(mealMenuItems.menuDate, input.menuDate),
        eq(mealMenuItems.mealKind, input.mealKind),
      ),
    )
}

export async function insertMealItems(
  tx: Database,
  institutionId: string,
  input: { menuId: string; items: readonly (MealItemValue & { id: string })[]; now: Date },
) {
  if (input.items.length === 0) return
  await tx.insert(mealMenuItems).values(
    input.items.map((item) => ({
      institutionId,
      id: item.id,
      menuId: input.menuId,
      menuDate: item.menuDate,
      mealKind: item.mealKind,
      position: item.position,
      name: item.name,
      allergens: [...item.allergens],
      energyKcal: item.nutrition?.energyKcal ?? null,
      proteinDg: item.nutrition?.proteinDg ?? null,
      fatDg: item.nutrition?.fatDg ?? null,
      carbohydrateDg: item.nutrition?.carbohydrateDg ?? null,
      fiberDg: item.nutrition?.fiberDg ?? null,
      saltDg: item.nutrition?.saltDg ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

// --- Düzeltme ------------------------------------------------------------------------------------

export async function insertMealCorrections(
  tx: Database,
  institutionId: string,
  input: {
    menuId: string
    reason: string
    correctedByUserId: string
    slots: readonly { id: string; menuDate: string; mealKind: MealKind }[]
    now: Date
  },
) {
  if (input.slots.length === 0) return
  await tx.insert(mealMenuCorrections).values(
    input.slots.map((slot) => ({
      institutionId,
      id: slot.id,
      menuId: input.menuId,
      menuDate: slot.menuDate,
      mealKind: slot.mealKind,
      reason: input.reason,
      correctedByUserId: input.correctedByUserId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

export async function loadMealCorrections(db: Database, institutionId: string, menuId: string) {
  return db
    .select({
      id: mealMenuCorrections.id,
      menuDate: mealMenuCorrections.menuDate,
      mealKind: mealMenuCorrections.mealKind,
      reason: mealMenuCorrections.reason,
      correctedByUserId: mealMenuCorrections.correctedByUserId,
      createdAt: mealMenuCorrections.createdAt,
    })
    .from(mealMenuCorrections)
    .where(
      and(
        eq(mealMenuCorrections.institutionId, institutionId),
        eq(mealMenuCorrections.menuId, menuId),
      ),
    )
    .orderBy(desc(mealMenuCorrections.createdAt), asc(mealMenuCorrections.menuDate))
}

// --- Ayar ----------------------------------------------------------------------------------------

export async function loadMealSettings(
  db: Database,
  institutionId: string,
): Promise<{ mealKinds: MealKind[]; version: number }> {
  const [row] = await db
    .select({ mealKinds: mealMenuSettings.mealKinds, version: mealMenuSettings.version })
    .from(mealMenuSettings)
    .where(eq(mealMenuSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { mealKinds: [...DEFAULT_MEAL_KINDS], version: 1 }
}

/** Ayarı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveMealSettings(
  tx: Database,
  institutionId: string,
  input: { mealKinds: readonly MealKind[]; expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = { mealKinds: [...input.mealKinds], updatedAt: input.now }
  const [updated] = await tx
    .update(mealMenuSettings)
    .set({ ...values, version: sql`${mealMenuSettings.version} + 1` })
    .where(
      and(
        eq(mealMenuSettings.institutionId, institutionId),
        eq(mealMenuSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: mealMenuSettings.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(mealMenuSettings)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: mealMenuSettings.version })
  return created?.version ?? null
}
