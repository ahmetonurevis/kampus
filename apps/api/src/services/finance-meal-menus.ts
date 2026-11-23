import { randomUUID } from 'node:crypto'

import {
  assertMealMenuArchivable,
  assertMealMenuPublishable,
  assertMealMenuUnpublishable,
  familyMenuFor,
  MEAL_KINDS,
  mealDayTotals,
  mealMenuCreateSchema,
  mealMenuSettingsSchema,
  mealMenuUpdateSchema,
  mealWeekEnd,
  mealWeekStartOf,
  orderedMealKinds,
  planMealMenuCreate,
  planMealMenuSettings,
  planMealMenuUpdate,
  type BranchCheck,
  type MealItemValue,
  type MealMenuStatus,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  archiveMealSlot,
  findMealMenu,
  insertMealCorrections,
  insertMealItems,
  insertMealMenu,
  listMealMenus,
  loadMealCorrections,
  loadMealItems,
  loadMealSettings,
  mealItemCounts,
  mealMenuExists,
  publishedMealMenus,
  saveMealSettings,
  updateMealMenu,
  type StoredMealItem,
  type StoredMealMenu,
} from '../db/finance-meal-menus.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { studentNames } from './finance-transport.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Yemek menüsü, besin değeri ve alerjen matrisi (DOM-FIN-157; ON-090, ON-149; IST-099;
 * K-526…K-528). Kural core `lib/finance-meal-menus.ts`'tedir; servis kurum kilidi altında yükler
 * ve aynı transaction'da yazar. Denetime alan adları yazılır (yemek adı ve gerekçe yazılmaz). Veli
 * ve öğrenci yalnız yayımlanmış menüyü, kapsamdaki öğrencilerin kampüsü için okur (core
 * `mealMenus` kuralı, `scope.branchIds`). Rol ve modül (`meals`) rotadadır.
 */

const MENU = 'meal_menus'
const SETTINGS = 'meal_menu_settings'

async function branchNames(db: Database, institutionId: string, ids: readonly (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  if (wanted.length === 0) return new Map<string, string>()
  const rows = await loadRecordsByIds(db, institutionId, 'branches', wanted, {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : row.id]),
  )
}

async function branchCheck(
  db: Database,
  institutionId: string,
  branchId: string | null,
): Promise<BranchCheck> {
  if (branchId === null) return undefined
  const [row] = await loadRecordsByIds(db, institutionId, 'branches', [branchId])
  return row === undefined ? null : { name: typeof row.data.name === 'string' ? row.data.name : '' }
}

// --- Görünüm -------------------------------------------------------------------------------------

/** Haftanın yedi günü; her gün kalemi olan öğünler ve günlük toplam (K-528). */
function weekDays(weekStart: string, items: readonly StoredMealItem[]) {
  return mealDayTotals(weekStart, items).map((totals) => {
    const day = items.filter((item) => item.menuDate === totals.menuDate)
    return {
      menuDate: totals.menuDate,
      meals: MEAL_KINDS.flatMap((mealKind) => {
        const rows = day
          .filter((item) => item.mealKind === mealKind)
          .sort((a, b) => a.position - b.position)
        return rows.length === 0
          ? []
          : [
              {
                mealKind,
                items: rows.map((item) => ({
                  id: item.id,
                  position: item.position,
                  name: item.name,
                  allergens: [...item.allergens],
                  nutrition: item.nutrition,
                })),
              },
            ]
      }),
      // Yanıt şeması `menuDate` alanını toplamdan ayıklar.
      totals,
    }
  })
}

const menuHead = (menu: StoredMealMenu, names: ReadonlyMap<string, string>) => ({
  id: menu.id,
  weekStart: menu.weekStart,
  weekEnd: mealWeekEnd(menu.weekStart),
  branchId: menu.branchId,
  branchName: menu.branchId === null ? null : (names.get(menu.branchId) ?? null),
  status: menu.status,
  publishedAt: menu.publishedAt?.toISOString() ?? null,
  version: menu.version,
})

async function menuDetail(db: Database, ctx: ServiceContext, menu: StoredMealMenu) {
  const [names, items, corrections] = await Promise.all([
    branchNames(db, ctx.institutionId, [menu.branchId]),
    loadMealItems(db, ctx.institutionId, [menu.id]),
    loadMealCorrections(db, ctx.institutionId, menu.id),
  ])
  return {
    ...menuHead(menu, names),
    days: weekDays(menu.weekStart, items),
    corrections: corrections.map((row) => ({
      id: row.id,
      menuDate: row.menuDate,
      mealKind: row.mealKind,
      reason: row.reason,
      correctedAt: row.createdAt.toISOString(),
    })),
  }
}

async function requireMenu(db: Database, ctx: ServiceContext, id: string) {
  const menu = await findMealMenu(db, ctx.institutionId, id)
  if (menu === null) throw new NotFoundError()
  return menu
}

async function versionedMenu(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const menu = await requireMenu(tx, ctx, id)
  if (menu.version !== version) throw new ConflictError()
  return menu
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listMealMenusFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    status?: MealMenuStatus | undefined
    branchId?: string | undefined
    from?: string | undefined
  },
) {
  const { items, total } = await listMealMenus(ctx.db, ctx.institutionId, query)
  const [names, counts] = await Promise.all([
    branchNames(
      ctx.db,
      ctx.institutionId,
      items.map((menu) => menu.branchId),
    ),
    mealItemCounts(
      ctx.db,
      ctx.institutionId,
      items.map((menu) => menu.id),
    ),
  ])
  return {
    items: items.map((menu) => ({
      ...menuHead(menu, names),
      itemCount: counts.get(menu.id)?.items ?? 0,
      dayCount: counts.get(menu.id)?.days ?? 0,
    })),
    total,
  }
}

export async function getMealMenuFor(ctx: ServiceContext, id: string) {
  return menuDetail(ctx.db, ctx, await requireMenu(ctx.db, ctx, id))
}

export async function mealSettingsFor(ctx: ServiceContext) {
  const settings = await loadMealSettings(ctx.db, ctx.institutionId)
  return { mealKinds: orderedMealKinds(settings.mealKinds), version: settings.version }
}

/**
 * Veli ve öğrenci görünümü (K-526): kapsamdaki öğrencilerin kampüsleri için haftanın yayımlanmış
 * menüsü; kampüsün kendi menüsü yoksa bütün kampüs menüsü. Taslak görünmez. Aynı menüyü gören
 * öğrenciler tek menüde toplanır.
 */
export async function listMyMealMenusFor(ctx: ServiceContext, query: { weekStart?: string }) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'mealMenus')
  const weekStart = mealWeekStartOf(query.weekStart ?? dayKey(ctx.now))
  const source = await readSource(ctx)
  const classBranch = new Map(source.classes.map((row) => [row.id, row.branchId]))
  const students = source.students
    .filter((student) => scope.studentIds.has(student.id))
    .map((student) => ({ id: student.id, branchId: classBranch.get(student.classId) ?? null }))
  const empty = { weekStart, weekEnd: mealWeekEnd(weekStart), menus: [] }
  if (students.length === 0) return empty
  const menus = await publishedMealMenus(
    ctx.db,
    ctx.institutionId,
    weekStart,
    students.flatMap((student) => (student.branchId === null ? [] : [student.branchId])),
  )
  const shown = new Map<string, { menu: StoredMealMenu; studentIds: string[] }>()
  for (const student of students) {
    const menu = familyMenuFor(menus, student.branchId)
    if (menu === undefined) continue
    const entry = shown.get(menu.id) ?? { menu, studentIds: [] }
    entry.studentIds.push(student.id)
    shown.set(menu.id, entry)
  }
  if (shown.size === 0) return empty
  const entries = [...shown.values()]
  const [names, items, namesOfStudents] = await Promise.all([
    branchNames(
      ctx.db,
      ctx.institutionId,
      entries.map((entry) => entry.menu.branchId),
    ),
    loadMealItems(
      ctx.db,
      ctx.institutionId,
      entries.map((entry) => entry.menu.id),
    ),
    studentNames(
      ctx.db,
      ctx,
      entries.flatMap((entry) => entry.studentIds),
    ),
  ])
  return {
    ...empty,
    menus: entries
      .map(({ menu, studentIds }) => ({
        id: menu.id,
        branchId: menu.branchId,
        branchName: menu.branchId === null ? null : (names.get(menu.branchId) ?? null),
        publishedAt: menu.publishedAt?.toISOString() ?? null,
        students: studentIds
          .map((studentId) => ({ studentId, studentName: namesOfStudents.get(studentId) ?? '—' }))
          .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr')),
        days: weekDays(
          menu.weekStart,
          items.filter((item) => item.menuId === menu.id),
        ),
      }))
      .sort((a, b) => (a.branchName ?? '').localeCompare(b.branchName ?? '', 'tr')),
  }
}

// --- Yazma ---------------------------------------------------------------------------------------

const withIds = (items: readonly MealItemValue[]) =>
  items.map((item) => ({ ...item, id: randomUUID() }))

/**
 * Yeni haftalık menü ya da başka haftadan kopya (K-526): taslak açılır. `Idempotency-Key` rotada
 * zorunlu. 201.
 */
export function createMealMenuCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: MENU, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.meal_menu.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealMenuCreateSchema.parse(input)
        const branchId = parsed.branchId ?? null
        const [branch, exists, settings, sourceMenu] = await Promise.all([
          branchCheck(tx, ctx.institutionId, branchId),
          mealMenuExists(tx, ctx.institutionId, parsed.weekStart, branchId),
          loadMealSettings(tx, ctx.institutionId),
          parsed.copyFromMenuId === undefined
            ? null
            : findMealMenu(tx, ctx.institutionId, parsed.copyFromMenuId),
        ])
        const sourceItems =
          sourceMenu === null ? [] : await loadMealItems(tx, ctx.institutionId, [sourceMenu.id])
        return {
          run: () => ({
            parsed,
            branchId,
            plan: planMealMenuCreate(parsed, {
              today: dayKey(ctx.now),
              branch,
              exists,
              enabledKinds: settings.mealKinds,
              source:
                sourceMenu === null
                  ? null
                  : { weekStart: sourceMenu.weekStart, items: sourceItems },
            }),
          }),
        }
      },
      after: async (tx, { parsed, branchId, plan }) => {
        await insertMealMenu(tx, ctx.institutionId, {
          id,
          weekStart: parsed.weekStart,
          branchId,
          copiedFromMenuId: parsed.copyFromMenuId ?? null,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await insertMealItems(tx, ctx.institutionId, {
          menuId: id,
          items: withIds(plan.items),
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.meal_menu.create', entity, [
          'weekStart',
          'branchId',
          ...(parsed.copyFromMenuId === undefined ? [] : ['copyFromMenuId', 'items']),
        ])
        body = { data: await menuDetail(tx, ctx, await requireMenu(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Hücre düzenlemesi (K-527): gönderilen gün × öğün hücreleri yeniden yazılır (eski kalemler
 * arşivlenir). Yayımlanmış menünün geçmiş günü yalnız yöneticinin gerekçesiyle düzelir ve
 * düzeltme kaydı açılır. `If-Match`.
 */
export function updateMealMenuCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: MENU, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.meal_menu.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealMenuUpdateSchema.parse(input)
        const menu = await versionedMenu(tx, ctx, id, expectedVersion)
        const [items, settings] = await Promise.all([
          loadMealItems(tx, ctx.institutionId, [id]),
          loadMealSettings(tx, ctx.institutionId),
        ])
        return {
          run: () => ({
            parsed,
            plan: planMealMenuUpdate({ ...menu, items }, parsed, {
              today: dayKey(ctx.now),
              enabledKinds: settings.mealKinds,
              role: ctx.actor.role,
            }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        if (
          !(await updateMealMenu(tx, ctx.institutionId, {
            id,
            expectedVersion,
            now: ctx.now,
            values: {},
          }))
        )
          throw new ConflictError()
        for (const slot of plan.slots) {
          await archiveMealSlot(tx, ctx.institutionId, { menuId: id, ...slot, now: ctx.now })
          await insertMealItems(tx, ctx.institutionId, {
            menuId: id,
            items: withIds(slot.items),
            now: ctx.now,
          })
        }
        if (plan.corrections.length > 0 && parsed.correctionReason !== undefined) {
          await insertMealCorrections(tx, ctx.institutionId, {
            menuId: id,
            reason: parsed.correctionReason,
            correctedByUserId: ctx.actor.userId,
            slots: plan.corrections.map((slot) => ({ ...slot, id: randomUUID() })),
            now: ctx.now,
          })
          await auditWork(tx, ctx, 'finance.meal_menu.correct', entity, [
            'slots',
            'correctionReason',
          ])
        } else await auditWork(tx, ctx, 'finance.meal_menu.update', entity, ['slots'])
        body = { data: await menuDetail(tx, ctx, await requireMenu(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yayımlama (K-527): yalnız yemeği olan taslak. `If-Match`. */
export function publishMealMenuCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return statusCommand(ctx, id, expectedVersion, idempotency, 'publish')
}

/** Yayımdan kaldırma (K-527): yalnız hafta başlamadan. `If-Match`. */
export function unpublishMealMenuCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return statusCommand(ctx, id, expectedVersion, idempotency, 'unpublish')
}

function statusCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
  kind: 'publish' | 'unpublish',
): Promise<CommandResponse> {
  const entity = { type: MENU, id }
  const action = `finance.meal_menu.${kind}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const menu = await versionedMenu(tx, ctx, id, expectedVersion)
        const counts = await mealItemCounts(tx, ctx.institutionId, [id])
        return {
          run: () =>
            kind === 'publish'
              ? assertMealMenuPublishable(menu.status, counts.get(id)?.items ?? 0)
              : assertMealMenuUnpublishable(menu, dayKey(ctx.now)),
        }
      },
      after: async (tx) => {
        const saved = await updateMealMenu(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values:
            kind === 'publish'
              ? { status: 'published', publishedAt: ctx.now, publishedByUserId: ctx.actor.userId }
              : { status: 'draft', publishedAt: null, publishedByUserId: null },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, ['status', 'publishedAt'])
        body = { data: await menuDetail(tx, ctx, await requireMenu(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Taslak menünün arşivi (K-527); yayımlanmış menü silinmez. `If-Match`. */
export function archiveMealMenuCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: MENU, id }
  return runCommand(
    ctx,
    {
      action: 'finance.meal_menu.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const menu = await versionedMenu(tx, ctx, id, expectedVersion)
        return { run: () => assertMealMenuArchivable(menu.status) }
      },
      after: async (tx) => {
        const saved = await updateMealMenu(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.meal_menu.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

/** Öğün ayarı (K-526): yalnız yönetici. `If-Match` (hiç kaydedilmediyse 1). */
export function setMealSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.meal_menu.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealMenuSettingsSchema.parse(input)
        const current = await loadMealSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planMealMenuSettings(current.mealKinds, parsed) }
      },
      after: async (tx, mealKinds) => {
        const version = await saveMealSettings(tx, ctx.institutionId, {
          mealKinds,
          expectedVersion,
          now: ctx.now,
        })
        if (version === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.meal_menu.settings', entity, ['mealKinds'])
        body = { data: { mealKinds, version } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
