import { randomUUID } from 'node:crypto'

import { addDays } from '@kampus/school-core/lib/academic-years.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  MEAL_KINDS,
  orderedMealKinds,
  type MealKind,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import {
  assertMealCancellationRestorable,
  assertMealSubscriptionArchivable,
  holidayDays,
  mealCancellationCreateSchema,
  mealDailyCount,
  mealMonthSummary,
  mealSubscriptionCalendar,
  mealSubscriptionCreateSchema,
  mealSubscriptionSettingsSchema,
  mealSubscriptionStatus,
  mealSubscriptionUpdateSchema,
  monthRange,
  planMealCancellations,
  planMealSubscriptionCreate,
  planMealSubscriptionSettings,
  planMealSubscriptionUpdate,
  type MealCancelledBy,
  type MealCutoff,
  type MealDietType,
  type MealSubscriptionStatus,
} from '@kampus/school-core/lib/finance-meal-subscriptions.ts'

import type { Database } from '../db/client.ts'
import { loadMealSettings } from '../db/finance-meal-menus.ts'
import {
  findMealCancellation,
  findMealSubscription,
  insertMealCancellations,
  insertMealSubscription,
  listMealSubscriptions,
  loadMealCancellations,
  loadMealCutoff,
  mealSubscriptionsInRange,
  restoreMealCancellation,
  saveMealCutoff,
  studentMealSpans,
  subscriptionCancellations,
  updateMealSubscription,
  type StoredMealCancellation,
  type StoredMealSubscription,
} from '../db/finance-meal-subscriptions.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { institutionHolidaysFor } from './finance-school-calendar.ts'
import { studentCheck, studentNames } from './finance-transport.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Yemek aboneliği ve gün iptali (DOM-FIN-164; ON-150; IST-099; K-547…K-549). Kural core
 * `lib/finance-meal-subscriptions.ts`'tedir; servis kurum kilidi altında yükler ve aynı
 * transaction'da yazar. Tatil okul takviminden (`institutionHolidaysFor`, K-545), öğün kurumun
 * yemek menüsü ayarından okunur. Veli yalnız bağlı çocuğunun aboneliğini okur ve gün iptal eder
 * (core `mealMenus` okuma kuralı ve `scope.studentIds`; başka öğrenci 404). Denetime alan adları
 * yazılır; diyet açıklaması ve günler değer olarak yazılmaz. Rol ve modül (`meals`) rotadadır.
 */

const SUBSCRIPTION = 'meal_subscriptions'
const CANCELLATION = 'meal_subscription_cancellations'
const SETTINGS = 'meal_subscription_settings'
/** Ayrıntı ve aile görünümündeki takvim penceresi: bugün ve sonraki 27 gün. */
const CALENDAR_DAYS = 28

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const cancelledByOf = (ctx: ServiceContext): MealCancelledBy =>
  ctx.actor.role === 'veli' ? 'family' : 'school'

/**
 * Öğrenci → güncel sınıf ve sınıf adları (kapsam kaynağından; arşivli sınıf adı da görünür).
 * Kaynak istek başına önbellektedir; komutlar transaction açılmadan önce yükler (`preloadScope`),
 * böylece işlem içinde ikinci bağlantı gerekmez.
 */
async function classLabels(db: Database, ctx: ServiceContext) {
  const source = await readSource(ctx)
  const studentClass = new Map(source.students.map((row) => [row.id, row.classId]))
  const rows = await loadRecordsByIds(
    db,
    ctx.institutionId,
    'classes',
    [...new Set(source.classes.map((row) => row.id))],
    { includeArchived: true },
  )
  const classNames = new Map(rows.map((row) => [row.id, text(row.data.name) ?? row.id]))
  return {
    classOf: (studentId: string): string | null => studentClass.get(studentId) ?? null,
    nameOf: (classId: string | null): string | null =>
      classId === null ? null : (classNames.get(classId) ?? null),
    studentsOfClass: (classId: string) =>
      source.students.filter((row) => row.classId === classId).map((row) => row.id),
  }
}

async function holidaysIn(db: Database, institutionId: string, from: string, to: string) {
  return holidayDays(await institutionHolidaysFor(db, institutionId, { from, to }), from, to)
}

const cancellationRef = (row: StoredMealCancellation) => ({
  id: row.id,
  mealDate: row.mealDate,
  late: row.late,
  cancelledBy: row.cancelledBy,
  cancelledAt: row.createdAt.toISOString(),
  version: row.version,
})

function subscriptionRow(
  row: StoredMealSubscription,
  labels: { studentName: string; classId: string | null; className: string | null },
  today: string,
) {
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: labels.studentName,
    classId: labels.classId,
    className: labels.className,
    mealKind: row.mealKind,
    startDate: row.startDate,
    endDate: row.endDate,
    weekdays: [...row.weekdays].sort((a, b) => a - b),
    dietType: row.dietType,
    dietNote: row.dietNote,
    status: mealSubscriptionStatus(row, today),
    version: row.version,
  }
}

/** Aboneliğin bugünden başlayan 28 günlük takvimi; iptal bayrakları isteği yapana göre. */
async function calendarOf(
  db: Database,
  ctx: ServiceContext,
  subscription: StoredMealSubscription,
  cutoff: MealCutoff,
  by: MealCancelledBy,
) {
  const today = dayKey(ctx.now)
  const range = { from: today, to: addDays(today, CALENDAR_DAYS - 1) }
  const [holidays, cancellations] = await Promise.all([
    holidaysIn(db, ctx.institutionId, range.from, range.to),
    loadMealCancellations(db, ctx.institutionId, {
      subscriptionIds: [subscription.id],
      ...range,
    }),
  ])
  return mealSubscriptionCalendar(subscription, range, {
    now: ctx.now,
    today,
    by,
    cutoff,
    holidays,
    cancellations: cancellations.map(cancellationRef),
  })
}

async function subscriptionDetail(
  db: Database,
  ctx: ServiceContext,
  subscription: StoredMealSubscription,
) {
  const today = dayKey(ctx.now)
  const [labels, names, cutoff, cancellations] = await Promise.all([
    classLabels(db, ctx),
    studentNames(db, ctx, [subscription.studentId]),
    loadMealCutoff(db, ctx.institutionId),
    subscriptionCancellations(db, ctx.institutionId, subscription.id),
  ])
  const classId = labels.classOf(subscription.studentId)
  return {
    ...subscriptionRow(
      subscription,
      {
        studentName: names.get(subscription.studentId) ?? '—',
        classId,
        className: labels.nameOf(classId),
      },
      today,
    ),
    cutoff: { cutoffDaysBefore: cutoff.cutoffDaysBefore, cutoffTime: cutoff.cutoffTime },
    days: await calendarOf(db, ctx, subscription, cutoff, 'school'),
    cancellations: cancellations.map(cancellationRef),
  }
}

/**
 * Okuma kapsamı ve kaynağı transaction açılmadan önce yüklenir (istek başına önbellek): işlem içi
 * ayrıntı ve veli kapsamı denetimi ikinci bağlantı açmaz.
 */
async function preloadScope(ctx: ServiceContext) {
  await Promise.all([readScope(ctx), readSource(ctx)])
}

async function requireSubscription(db: Database, ctx: ServiceContext, id: string) {
  const subscription = await findMealSubscription(db, ctx.institutionId, id)
  if (subscription === null) throw new NotFoundError()
  return subscription
}

/**
 * Velide abonelik bağlı çocuğun olmalı (başka öğrenci 404, varlık sızmaz); okul rolleri bütün
 * kurumu görür. Veli `mealMenus` okuma kuralından geçer (modül ve rol).
 */
async function requireReachable(db: Database, ctx: ServiceContext, id: string) {
  const subscription = await requireSubscription(db, ctx, id)
  if (ctx.actor.role !== 'veli') return subscription
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'mealMenus')
  if (!scope.studentIds.has(subscription.studentId)) throw new NotFoundError()
  return subscription
}

async function versionedSubscription(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  version: number,
) {
  const subscription = await requireSubscription(tx, ctx, id)
  if (subscription.version !== version) throw new ConflictError()
  return subscription
}

const studentSearch = (value: string) => value.toLocaleLowerCase('tr').trim()

// --- Okuma ---------------------------------------------------------------------------------------

export async function listMealSubscriptionsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: MealSubscriptionStatus | undefined
    mealKind?: MealKind | undefined
    dietType?: MealDietType | undefined
    classId?: string | undefined
  },
) {
  const today = dayKey(ctx.now)
  const labels = await classLabels(ctx.db, ctx)
  const rows = await listMealSubscriptions(ctx.db, ctx.institutionId, {
    today,
    status: query.status,
    mealKind: query.mealKind,
    dietType: query.dietType,
    studentIds: query.classId === undefined ? undefined : labels.studentsOfClass(query.classId),
  })
  const names = await studentNames(
    ctx.db,
    ctx,
    rows.map((row) => row.studentId),
  )
  const search = query.q === undefined ? '' : studentSearch(query.q)
  const items = rows
    .map((row) => {
      const classId = labels.classOf(row.studentId)
      return subscriptionRow(
        row,
        {
          studentName: names.get(row.studentId) ?? '—',
          classId,
          className: labels.nameOf(classId),
        },
        today,
      )
    })
    .filter((row) => search === '' || studentSearch(row.studentName).includes(search))
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, 'tr') ||
        MEAL_KINDS.indexOf(a.mealKind) - MEAL_KINDS.indexOf(b.mealKind) ||
        a.startDate.localeCompare(b.startDate),
    )
  const start = (query.page - 1) * query.pageSize
  return { items: items.slice(start, start + query.pageSize), total: items.length }
}

export async function getMealSubscriptionFor(ctx: ServiceContext, id: string) {
  return subscriptionDetail(ctx.db, ctx, await requireSubscription(ctx.db, ctx, id))
}

export async function mealCutoffFor(ctx: ServiceContext) {
  return loadMealCutoff(ctx.db, ctx.institutionId)
}

/**
 * Veli ve öğrenci görünümü (K-548): kapsamdaki öğrencilerin sürmekte ve başlamamış abonelikleri,
 * bugünden 28 günlük yemek takvimi ve kesim. Veli kesimden önce iptal eder; öğrenci yalnız okur.
 */
export async function listMyMealSubscriptionsFor(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'mealMenus')
  const today = dayKey(ctx.now)
  const cutoff = await loadMealCutoff(ctx.db, ctx.institutionId)
  const head = {
    today,
    cutoff: { cutoffDaysBefore: cutoff.cutoffDaysBefore, cutoffTime: cutoff.cutoffTime },
  }
  const studentIds = [...scope.studentIds]
  const rows = (
    await listMealSubscriptions(ctx.db, ctx.institutionId, { today, studentIds })
  ).filter((row) => row.endDate >= today)
  if (rows.length === 0) return { ...head, subscriptions: [] }
  const names = await studentNames(
    ctx.db,
    ctx,
    rows.map((row) => row.studentId),
  )
  const canWrite = ctx.actor.role === 'veli'
  const subscriptions = await Promise.all(
    rows.map(async (row) => {
      const days = await calendarOf(ctx.db, ctx, row, cutoff, 'family')
      return {
        id: row.id,
        studentId: row.studentId,
        studentName: names.get(row.studentId) ?? '—',
        mealKind: row.mealKind,
        startDate: row.startDate,
        endDate: row.endDate,
        weekdays: [...row.weekdays].sort((a, b) => a - b),
        dietType: row.dietType,
        dietNote: row.dietNote,
        status: mealSubscriptionStatus(row, today),
        days: days.map((day) => ({
          mealDate: day.mealDate,
          status: day.status,
          holidayTitle: day.holidayTitle,
          deadline: day.deadline,
          canCancel: canWrite && day.canCancel,
          canRestore: canWrite && day.canRestore,
          cancellation: day.cancellation,
        })),
      }
    }),
  )
  return {
    ...head,
    subscriptions: subscriptions.sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, 'tr') ||
        MEAL_KINDS.indexOf(a.mealKind) - MEAL_KINDS.indexOf(b.mealKind) ||
        a.startDate.localeCompare(b.startDate),
    ),
  }
}

/**
 * Günlük mutfak sayısı (K-549): seçilen gün × öğün × diyet türü; iptaller düşülmüş, sınıf kırılımı.
 * Öğünler kurumun açık öğünleri ve o gün aboneliği olan öğünlerdir.
 */
export async function mealDailyCountFor(ctx: ServiceContext, query: { date?: string | undefined }) {
  const date = query.date ?? dayKey(ctx.now)
  const [subscriptions, holidays, settings, labels] = await Promise.all([
    mealSubscriptionsInRange(ctx.db, ctx.institutionId, { from: date, to: date }),
    holidaysIn(ctx.db, ctx.institutionId, date, date),
    loadMealSettings(ctx.db, ctx.institutionId),
    classLabels(ctx.db, ctx),
  ])
  const cancellations = await loadMealCancellations(ctx.db, ctx.institutionId, {
    subscriptionIds: subscriptions.map((row) => row.id),
    from: date,
    to: date,
  })
  const count = mealDailyCount(
    date,
    subscriptions.map((row) => ({ ...row, classId: labels.classOf(row.studentId) })),
    {
      mealKinds: orderedMealKinds([
        ...settings.mealKinds,
        ...subscriptions.map((row) => row.mealKind),
      ]),
      holidayTitle: holidays.get(date) ?? null,
      cancellations,
    },
  )
  return {
    ...count,
    classes: count.classes
      .map((entry) => ({ ...entry, className: labels.nameOf(entry.classId) }))
      .sort(
        (a, b) =>
          Number(a.classId === null) - Number(b.classId === null) ||
          (a.className ?? '').localeCompare(b.className ?? '', 'tr', { numeric: true }),
      ),
  }
}

/**
 * Aylık gün özeti (K-549): ayda yemek günü olan her abonelik için abone olunan, tatil, iptal, geç
 * iptal, yemek ve iade/mahsup günü. Tutar yok (ON-087). Öğrenci adına göre sıralı ve sayfalı.
 */
export async function mealMonthlySummaryFor(
  ctx: ServiceContext,
  query: {
    month?: string | undefined
    page: number
    pageSize: number
    q?: string | undefined
    mealKind?: MealKind | undefined
    classId?: string | undefined
  },
) {
  const month = query.month ?? dayKey(ctx.now).slice(0, 7)
  const range = monthRange(month)
  const labels = await classLabels(ctx.db, ctx)
  const [subscriptions, holidays] = await Promise.all([
    mealSubscriptionsInRange(ctx.db, ctx.institutionId, {
      ...range,
      studentIds: query.classId === undefined ? undefined : labels.studentsOfClass(query.classId),
    }),
    holidaysIn(ctx.db, ctx.institutionId, range.from, range.to),
  ])
  const selected = subscriptions.filter(
    (row) => query.mealKind === undefined || row.mealKind === query.mealKind,
  )
  const [cancellations, names] = await Promise.all([
    loadMealCancellations(ctx.db, ctx.institutionId, {
      subscriptionIds: selected.map((row) => row.id),
      ...range,
    }),
    studentNames(
      ctx.db,
      ctx,
      selected.map((row) => row.studentId),
    ),
  ])
  const search = query.q === undefined ? '' : studentSearch(query.q)
  const rows = selected
    .map((row) => {
      const classId = labels.classOf(row.studentId)
      const summary = mealMonthSummary(month, row, {
        holidays,
        cancellations: cancellations.filter((item) => item.subscriptionId === row.id),
      })
      return {
        subscriptionId: row.id,
        studentId: row.studentId,
        studentName: names.get(row.studentId) ?? '—',
        classId,
        className: labels.nameOf(classId),
        mealKind: row.mealKind,
        dietType: row.dietType,
        ...summary,
      }
    })
    .filter((row) => row.subscribedDays + row.holidayDays > 0)
    .filter((row) => search === '' || studentSearch(row.studentName).includes(search))
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, 'tr') ||
        MEAL_KINDS.indexOf(a.mealKind) - MEAL_KINDS.indexOf(b.mealKind),
    )
  const start = (query.page - 1) * query.pageSize
  return { month, items: rows.slice(start, start + query.pageSize), total: rows.length }
}

// --- Yazma ---------------------------------------------------------------------------------------

/** Yeni abonelik (K-547). `Idempotency-Key` rotada zorunlu. 201. */
export async function createMealSubscriptionCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  await preloadScope(ctx)
  const id = randomUUID()
  const entity = { type: SUBSCRIPTION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.meal_subscription.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealSubscriptionCreateSchema.parse(input)
        const [student, settings, existing] = await Promise.all([
          studentCheck(tx, ctx, parsed.studentId),
          loadMealSettings(tx, ctx.institutionId),
          studentMealSpans(tx, ctx.institutionId, parsed.studentId),
        ])
        return {
          run: () =>
            planMealSubscriptionCreate(parsed, {
              today: dayKey(ctx.now),
              student,
              enabledKinds: settings.mealKinds,
              existing,
            }),
        }
      },
      after: async (tx, values) => {
        await insertMealSubscription(tx, ctx.institutionId, {
          id,
          values,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.meal_subscription.create', entity, [
          'studentId',
          'mealKind',
          'startDate',
          'endDate',
          'weekdays',
          'dietType',
          ...(values.dietNote === null ? [] : ['dietNote']),
        ])
        body = { data: await subscriptionDetail(tx, ctx, await requireSubscription(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Abonelik düzenlemesi (K-547): başlamış abonelikte yalnız bitiş günü. `If-Match`. */
export async function updateMealSubscriptionCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  await preloadScope(ctx)
  const entity = { type: SUBSCRIPTION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.meal_subscription.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealSubscriptionUpdateSchema.parse(input)
        const current = await versionedSubscription(tx, ctx, id, expectedVersion)
        const existing = await studentMealSpans(tx, ctx.institutionId, current.studentId, id)
        return {
          run: () =>
            planMealSubscriptionUpdate(current, parsed, { today: dayKey(ctx.now), existing }),
        }
      },
      after: async (tx, plan) => {
        const values = Object.fromEntries(plan.changed.map((key) => [key, plan.values[key]]))
        if (
          !(await updateMealSubscription(tx, ctx.institutionId, {
            id,
            expectedVersion,
            now: ctx.now,
            values,
          }))
        )
          throw new ConflictError()
        await auditWork(tx, ctx, 'finance.meal_subscription.update', entity, plan.changed)
        body = { data: await subscriptionDetail(tx, ctx, await requireSubscription(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Başlamamış aboneliğin arşivi (K-547). `If-Match`. */
export function archiveMealSubscriptionCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SUBSCRIPTION, id }
  return runCommand(
    ctx,
    {
      action: 'finance.meal_subscription.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await versionedSubscription(tx, ctx, id, expectedVersion)
        return { run: () => assertMealSubscriptionArchivable(current, dayKey(ctx.now)) }
      },
      after: async (tx) => {
        const saved = await updateMealSubscription(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.meal_subscription.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

/**
 * Gün iptali (K-548): veli kesimden önce, okul her zaman (kesimden sonra geç iptal). Tatil, geçmiş,
 * yemek günü olmayan ve iptal edilmiş gün reddedilir. `Idempotency-Key` zorunlu. 201.
 */
export async function cancelMealDaysCommand(
  ctx: ServiceContext,
  subscriptionId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  await preloadScope(ctx)
  const entity = { type: SUBSCRIPTION, id: subscriptionId }
  const by = cancelledByOf(ctx)
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.meal_subscription.cancel_days',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealCancellationCreateSchema.parse(input)
        const subscription = await requireReachable(tx, ctx, subscriptionId)
        const sorted = [...parsed.dates].sort()
        const from = sorted[0] ?? dayKey(ctx.now)
        const to = sorted.at(-1) ?? from
        const [cutoff, holidays, cancelled] = await Promise.all([
          loadMealCutoff(tx, ctx.institutionId),
          holidaysIn(tx, ctx.institutionId, from, to),
          loadMealCancellations(tx, ctx.institutionId, {
            subscriptionIds: [subscriptionId],
            from,
            to,
          }),
        ])
        return {
          run: () =>
            planMealCancellations(subscription, parsed, {
              now: ctx.now,
              today: dayKey(ctx.now),
              by,
              cutoff,
              holidays,
              cancelled: new Set(cancelled.map((row) => row.mealDate)),
            }),
        }
      },
      after: async (tx, plan) => {
        const days = plan.map((day) => ({ ...day, id: randomUUID() }))
        await insertMealCancellations(tx, ctx.institutionId, {
          subscriptionId,
          cancelledBy: by,
          cancelledByUserId: ctx.actor.userId,
          days,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.meal_subscription.cancel_days', entity, [
          'mealDate',
          ...(days.some((day) => day.late) ? ['late'] : []),
        ])
        body = {
          data: {
            subscriptionId,
            cancellations: days.map((day) => ({
              id: day.id,
              mealDate: day.mealDate,
              late: day.late,
              cancelledBy: by,
              cancelledAt: ctx.now.toISOString(),
              version: 1,
            })),
          },
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** İptalin geri alınması (K-548): veli kesimden önce, okul gün bitene kadar. `If-Match`. */
export async function restoreMealCancellationCommand(
  ctx: ServiceContext,
  subscriptionId: string,
  cancellationId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  await preloadScope(ctx)
  const entity = { type: CANCELLATION, id: cancellationId }
  const by = cancelledByOf(ctx)
  return runCommand(
    ctx,
    {
      action: 'finance.meal_subscription.restore_day',
      collections: [],
      entity,
      load: async (tx) => {
        await requireReachable(tx, ctx, subscriptionId)
        const cancellation = await findMealCancellation(tx, ctx.institutionId, {
          subscriptionId,
          id: cancellationId,
        })
        if (cancellation === null) throw new NotFoundError()
        if (cancellation.version !== expectedVersion) throw new ConflictError()
        const cutoff = await loadMealCutoff(tx, ctx.institutionId)
        return {
          run: () =>
            assertMealCancellationRestorable(cancellation, {
              now: ctx.now,
              today: dayKey(ctx.now),
              by,
              cutoff,
            }),
        }
      },
      after: async (tx) => {
        const saved = await restoreMealCancellation(tx, ctx.institutionId, {
          id: cancellationId,
          expectedVersion,
          restoredByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.meal_subscription.restore_day', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id: cancellationId } } }),
    idempotency,
  )
}

/** Kesim ayarı (K-548): yalnız yönetici. `If-Match` (hiç kaydedilmediyse 1). */
export function setMealCutoffCommand(
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
      action: 'finance.meal_subscription.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealSubscriptionSettingsSchema.parse(input)
        const current = await loadMealCutoff(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planMealSubscriptionSettings(current, parsed) }
      },
      after: async (tx, cutoff) => {
        const version = await saveMealCutoff(tx, ctx.institutionId, {
          ...cutoff,
          expectedVersion,
          now: ctx.now,
        })
        if (version === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.meal_subscription.settings', entity, [
          'cutoffDaysBefore',
          'cutoffTime',
        ])
        body = { data: { ...cutoff, version } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
