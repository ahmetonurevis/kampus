import { and, eq, inArray } from 'drizzle-orm'

import type { MealKind } from '@kampus/school-core/lib/finance-meal-menus.ts'

import type { Database } from './client.ts'
import { mealAllergyChecks } from './schema/finance-meal-allergy-checks.ts'

/**
 * Yemekhane alerji onayı deposu (DOM-FIN-162; ON-151; K-543). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Satır yalnız eklenir; güncelleme ve silme sunulmaz (tetikleyici de reddeder).
 */

export interface StoredMealAllergyCheck {
  id: string
  studentId: string
  serviceDate: string
  mealKind: MealKind
  menuId: string
  acknowledgedByMembershipId: string
  createdAt: Date
}

const COLUMNS = {
  id: mealAllergyChecks.id,
  studentId: mealAllergyChecks.studentId,
  serviceDate: mealAllergyChecks.serviceDate,
  mealKind: mealAllergyChecks.mealKind,
  menuId: mealAllergyChecks.menuId,
  acknowledgedByMembershipId: mealAllergyChecks.acknowledgedByMembershipId,
  createdAt: mealAllergyChecks.createdAt,
}

/** Günün öğününde verilen öğrencilerin işaretleri. */
export async function listMealAllergyChecks(
  db: Database,
  institutionId: string,
  slot: { serviceDate: string; mealKind: MealKind; studentIds: readonly string[] },
): Promise<StoredMealAllergyCheck[]> {
  if (slot.studentIds.length === 0) return []
  return db
    .select(COLUMNS)
    .from(mealAllergyChecks)
    .where(
      and(
        eq(mealAllergyChecks.institutionId, institutionId),
        inArray(mealAllergyChecks.studentId, [...new Set(slot.studentIds)]),
        eq(mealAllergyChecks.serviceDate, slot.serviceDate),
        eq(mealAllergyChecks.mealKind, slot.mealKind),
      ),
    )
}

export async function findMealAllergyCheck(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMealAllergyCheck | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(mealAllergyChecks)
    .where(and(eq(mealAllergyChecks.institutionId, institutionId), eq(mealAllergyChecks.id, id)))
    .limit(1)
  return row ?? null
}

export async function insertMealAllergyCheck(
  tx: Database,
  institutionId: string,
  input: Omit<StoredMealAllergyCheck, 'createdAt'> & { now: Date },
) {
  const { now, ...values } = input
  await tx
    .insert(mealAllergyChecks)
    .values({ institutionId, ...values, createdAt: now, updatedAt: now })
}
