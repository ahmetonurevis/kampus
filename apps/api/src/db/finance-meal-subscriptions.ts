import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm'

import type { MealKind } from '@kampus/school-core/lib/finance-meal-menus.ts'
import {
  DEFAULT_MEAL_CUTOFF,
  type MealCancelledBy,
  type MealCutoff,
  type MealDietType,
  type MealSubscriptionChange,
  type MealSubscriptionFields,
  type MealSubscriptionSpan,
} from '@kampus/school-core/lib/finance-meal-subscriptions.ts'

import type { Database } from './client.ts'
import {
  mealSubscriptionCancellations,
  mealSubscriptions,
  mealSubscriptionSettings,
} from './schema/finance-meal-subscriptions.ts'

/**
 * Yemek aboneliği deposu (DOM-FIN-164; ON-150). Kurum kapsamlıdır: ilk parametre `institutionId`;
 * arşivli abonelik ve geri alınmış iptal okunmaz. Kural core `lib/finance-meal-subscriptions.ts`'tedir.
 */

export interface StoredMealSubscription extends MealSubscriptionFields {
  id: string
  createdAt: Date
  version: number
}

export interface StoredMealCancellation {
  id: string
  subscriptionId: string
  mealDate: string
  late: boolean
  cancelledBy: MealCancelledBy
  cancelledByUserId: string
  createdAt: Date
  version: number
}

const SUBSCRIPTION = {
  id: mealSubscriptions.id,
  studentId: mealSubscriptions.studentId,
  mealKind: mealSubscriptions.mealKind,
  startDate: mealSubscriptions.startDate,
  endDate: mealSubscriptions.endDate,
  weekdays: mealSubscriptions.weekdays,
  dietType: mealSubscriptions.dietType,
  dietNote: mealSubscriptions.dietNote,
  createdAt: mealSubscriptions.createdAt,
  version: mealSubscriptions.version,
}

const CANCELLATION = {
  id: mealSubscriptionCancellations.id,
  subscriptionId: mealSubscriptionCancellations.subscriptionId,
  mealDate: mealSubscriptionCancellations.mealDate,
  late: mealSubscriptionCancellations.late,
  cancelledBy: mealSubscriptionCancellations.cancelledBy,
  cancelledByUserId: mealSubscriptionCancellations.cancelledByUserId,
  createdAt: mealSubscriptionCancellations.createdAt,
  version: mealSubscriptionCancellations.version,
}

const liveSubscriptions = (institutionId: string) =>
  and(eq(mealSubscriptions.institutionId, institutionId), isNull(mealSubscriptions.archivedAt))
const liveCancellations = (institutionId: string) =>
  and(
    eq(mealSubscriptionCancellations.institutionId, institutionId),
    isNull(mealSubscriptionCancellations.archivedAt),
  )

// --- Abonelik ------------------------------------------------------------------------------------

export async function findMealSubscription(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMealSubscription | null> {
  const [row] = await db
    .select(SUBSCRIPTION)
    .from(mealSubscriptions)
    .where(and(liveSubscriptions(institutionId), eq(mealSubscriptions.id, id)))
    .limit(1)
  return row ?? null
}

/**
 * Süzgece uyan etkin abonelikler; sıralama ve sayfalama serviste (öğrenci adına göre). Durum
 * süzgeci `today` ile: başlamadı, sürüyor, bitti.
 */
export async function listMealSubscriptions(
  db: Database,
  institutionId: string,
  query: {
    today: string
    status?: 'upcoming' | 'active' | 'ended' | undefined
    mealKind?: MealKind | undefined
    dietType?: MealDietType | undefined
    studentIds?: readonly string[] | undefined
  },
): Promise<StoredMealSubscription[]> {
  const status: SQL | undefined =
    query.status === 'upcoming'
      ? sql`${mealSubscriptions.startDate} > ${query.today}`
      : query.status === 'ended'
        ? sql`${mealSubscriptions.endDate} < ${query.today}`
        : query.status === 'active'
          ? and(
              lte(mealSubscriptions.startDate, query.today),
              gte(mealSubscriptions.endDate, query.today),
            )
          : undefined
  if (query.studentIds !== undefined && query.studentIds.length === 0) return []
  return db
    .select(SUBSCRIPTION)
    .from(mealSubscriptions)
    .where(
      and(
        liveSubscriptions(institutionId),
        status,
        query.mealKind === undefined ? undefined : eq(mealSubscriptions.mealKind, query.mealKind),
        query.dietType === undefined ? undefined : eq(mealSubscriptions.dietType, query.dietType),
        query.studentIds === undefined
          ? undefined
          : inArray(mealSubscriptions.studentId, [...new Set(query.studentIds)]),
      ),
    )
    .orderBy(asc(mealSubscriptions.startDate), asc(mealSubscriptions.id))
}

/** `from`…`to` aralığına değen etkin abonelikler (isteğe bağlı öğrenciler). */
export async function mealSubscriptionsInRange(
  db: Database,
  institutionId: string,
  range: { from: string; to: string; studentIds?: readonly string[] | undefined },
): Promise<StoredMealSubscription[]> {
  if (range.studentIds !== undefined && range.studentIds.length === 0) return []
  return db
    .select(SUBSCRIPTION)
    .from(mealSubscriptions)
    .where(
      and(
        liveSubscriptions(institutionId),
        lte(mealSubscriptions.startDate, range.to),
        gte(mealSubscriptions.endDate, range.from),
        range.studentIds === undefined
          ? undefined
          : inArray(mealSubscriptions.studentId, [...new Set(range.studentIds)]),
      ),
    )
    .orderBy(asc(mealSubscriptions.startDate), asc(mealSubscriptions.id))
}

/** Öğrencinin etkin abonelikleri (çakışma denetimi); `exceptId` hariç. */
export async function studentMealSpans(
  db: Database,
  institutionId: string,
  studentId: string,
  exceptId?: string,
): Promise<MealSubscriptionSpan[]> {
  return db
    .select({
      id: mealSubscriptions.id,
      mealKind: mealSubscriptions.mealKind,
      startDate: mealSubscriptions.startDate,
      endDate: mealSubscriptions.endDate,
    })
    .from(mealSubscriptions)
    .where(
      and(
        liveSubscriptions(institutionId),
        eq(mealSubscriptions.studentId, studentId),
        exceptId === undefined ? undefined : ne(mealSubscriptions.id, exceptId),
      ),
    )
}

export async function insertMealSubscription(
  tx: Database,
  institutionId: string,
  input: { id: string; values: MealSubscriptionFields; createdByUserId: string; now: Date },
) {
  await tx.insert(mealSubscriptions).values({
    institutionId,
    id: input.id,
    ...input.values,
    weekdays: [...input.values.weekdays],
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Aboneliği sürüm koşuluyla günceller ve sürümü artırır; tutmazsa `false` (409). */
export async function updateMealSubscription(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<MealSubscriptionChange & { archivedAt: Date }>
  },
): Promise<boolean> {
  const values =
    input.values.weekdays === undefined
      ? input.values
      : { ...input.values, weekdays: [...input.values.weekdays] }
  const rows = await tx
    .update(mealSubscriptions)
    .set({ ...values, updatedAt: input.now, version: sql`${mealSubscriptions.version} + 1` })
    .where(
      and(
        liveSubscriptions(institutionId),
        eq(mealSubscriptions.id, input.id),
        eq(mealSubscriptions.version, input.expectedVersion),
      ),
    )
    .returning({ id: mealSubscriptions.id })
  return rows.length === 1
}

// --- İptal ---------------------------------------------------------------------------------------

/** Aboneliklerin etkin iptalleri (isteğe bağlı gün aralığı); gün sırasıyla. */
export async function loadMealCancellations(
  db: Database,
  institutionId: string,
  query: {
    subscriptionIds?: readonly string[] | undefined
    from?: string | undefined
    to?: string | undefined
  },
): Promise<StoredMealCancellation[]> {
  if (query.subscriptionIds !== undefined && query.subscriptionIds.length === 0) return []
  return db
    .select(CANCELLATION)
    .from(mealSubscriptionCancellations)
    .where(
      and(
        liveCancellations(institutionId),
        query.subscriptionIds === undefined
          ? undefined
          : inArray(mealSubscriptionCancellations.subscriptionId, [
              ...new Set(query.subscriptionIds),
            ]),
        query.from === undefined
          ? undefined
          : gte(mealSubscriptionCancellations.mealDate, query.from),
        query.to === undefined ? undefined : lte(mealSubscriptionCancellations.mealDate, query.to),
      ),
    )
    .orderBy(asc(mealSubscriptionCancellations.mealDate), asc(mealSubscriptionCancellations.id))
}

export async function findMealCancellation(
  db: Database,
  institutionId: string,
  input: { subscriptionId: string; id: string },
): Promise<StoredMealCancellation | null> {
  const [row] = await db
    .select(CANCELLATION)
    .from(mealSubscriptionCancellations)
    .where(
      and(
        liveCancellations(institutionId),
        eq(mealSubscriptionCancellations.subscriptionId, input.subscriptionId),
        eq(mealSubscriptionCancellations.id, input.id),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function insertMealCancellations(
  tx: Database,
  institutionId: string,
  input: {
    subscriptionId: string
    cancelledBy: MealCancelledBy
    cancelledByUserId: string
    days: readonly { id: string; mealDate: string; late: boolean }[]
    now: Date
  },
) {
  if (input.days.length === 0) return
  await tx.insert(mealSubscriptionCancellations).values(
    input.days.map((day) => ({
      institutionId,
      id: day.id,
      subscriptionId: input.subscriptionId,
      mealDate: day.mealDate,
      late: day.late,
      cancelledBy: input.cancelledBy,
      cancelledByUserId: input.cancelledByUserId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

/** İptali geri alır (arşiv, geri alanla); sürüm tutmazsa `false` (409). */
export async function restoreMealCancellation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; restoredByUserId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(mealSubscriptionCancellations)
    .set({
      archivedAt: input.now,
      restoredByUserId: input.restoredByUserId,
      updatedAt: input.now,
      version: sql`${mealSubscriptionCancellations.version} + 1`,
    })
    .where(
      and(
        liveCancellations(institutionId),
        eq(mealSubscriptionCancellations.id, input.id),
        eq(mealSubscriptionCancellations.version, input.expectedVersion),
      ),
    )
    .returning({ id: mealSubscriptionCancellations.id })
  return rows.length === 1
}

/** Aboneliğin bütün etkin iptalleri, yeni gün önce (ayrıntı görünümü). */
export async function subscriptionCancellations(
  db: Database,
  institutionId: string,
  subscriptionId: string,
): Promise<StoredMealCancellation[]> {
  return db
    .select(CANCELLATION)
    .from(mealSubscriptionCancellations)
    .where(
      and(
        liveCancellations(institutionId),
        eq(mealSubscriptionCancellations.subscriptionId, subscriptionId),
      ),
    )
    .orderBy(desc(mealSubscriptionCancellations.mealDate))
}

// --- Ayar ----------------------------------------------------------------------------------------

export async function loadMealCutoff(
  db: Database,
  institutionId: string,
): Promise<MealCutoff & { version: number }> {
  const [row] = await db
    .select({
      cutoffDaysBefore: mealSubscriptionSettings.cutoffDaysBefore,
      cutoffTime: mealSubscriptionSettings.cutoffTime,
      version: mealSubscriptionSettings.version,
    })
    .from(mealSubscriptionSettings)
    .where(eq(mealSubscriptionSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_MEAL_CUTOFF, version: 1 }
}

/** Kesimi sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveMealCutoff(
  tx: Database,
  institutionId: string,
  input: MealCutoff & { expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = {
    cutoffDaysBefore: input.cutoffDaysBefore,
    cutoffTime: input.cutoffTime,
    updatedAt: input.now,
  }
  const [updated] = await tx
    .update(mealSubscriptionSettings)
    .set({ ...values, version: sql`${mealSubscriptionSettings.version} + 1` })
    .where(
      and(
        eq(mealSubscriptionSettings.institutionId, institutionId),
        eq(mealSubscriptionSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: mealSubscriptionSettings.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(mealSubscriptionSettings)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: mealSubscriptionSettings.version })
  return created?.version ?? null
}
