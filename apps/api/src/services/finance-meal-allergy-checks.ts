import { randomUUID } from 'node:crypto'

import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'
import {
  assertMealAllergyServiceDate,
  hasMealAllergyWarning,
  MEAL_ALLERGY_DAYS_AHEAD,
  mealAllergyAcknowledgementSchema,
  mealAllergyWarnings,
  planMealAllergyAcknowledgement,
  type MealAllergyWarnings,
  type StudentAllergy,
} from '@kampus/school-core/lib/finance-meal-allergy-checks.ts'
import {
  familyMenuFor,
  mealWeekStartOf,
  orderedMealKinds,
  type MealKind,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import { addDays } from '@kampus/school-core/lib/academic-years.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findMealAllergyCheck,
  insertMealAllergyCheck,
  listMealAllergyChecks,
  type StoredMealAllergyCheck,
} from '../db/finance-meal-allergy-checks.ts'
import {
  loadMealItems,
  loadMealSettings,
  publishedMealMenus,
  type StoredMealItem,
  type StoredMealMenu,
} from '../db/finance-meal-menus.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { HealthProfileIntegrityError, loadHealthProfile } from '../db/health-profiles.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { NotFoundError } from '../errors.ts'
import type { FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { recordHealthRead } from './finance-health-access.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Yemekhane alerji uyarısı (DOM-FIN-162; ON-151; K-541…K-543; H-117). Kural core
 * `lib/finance-meal-allergy-checks.ts`'tedir. Servis seçilen gün, öğün ve sınıfın (ya da sınıf
 * düzeyinin) kayıtlı öğrencileri için kampüslerinin yayımlanmış menüsünü (kampüs menüsü, yoksa
 * bütün kampüs menüsü; `familyMenuFor`) ve sağlık profilinin yalnız alerji listesini (ad, şiddet;
 * Oğuzhan'ın deposu `loadHealthProfile`, yalnız okunur) okur ve eşler. Sağlık profili kopyalanmaz;
 * profilden dışarı yalnız uyarı (kalem, alerjen, şiddet) ve eşlenemeyen alerjinin adı çıkar.
 *
 * Listede görünen her öğrenci aynı transaction'da gerekçesiyle sağlık erişim denetimine düşer
 * (`recordHealthRead`, ON-164); kimse listelenmediyse liste başına bir denetim satırı yazılır.
 * Denetim yazılamazsa yanıt dönmez. Rol ve modül rotadadır.
 */

const TABLE = 'meal_allergy_checks'
const STUDENT = 'students'
const READ_ACTION = 'finance.meal_allergy.roster_read'

export interface MealAllergyDeps {
  cipher: FieldCipher
}

export type MealAllergySelection = { classId: string } | { grade: number }

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

interface ClassFacts {
  id: string
  name: string
  grade: number | null
  branchId: string | null
}

/** Kurumun arşivlenmemiş sınıfları, ada göre. */
async function classesOf(ctx: ServiceContext): Promise<ClassFacts[]> {
  const source = await readSource(ctx)
  const rows = await loadRecordsByIds(
    ctx.db,
    ctx.institutionId,
    'classes',
    source.classes.map((item) => item.id),
  )
  const names = new Map(rows.map((row) => [row.id, text(row.data.name)]))
  return source.classes
    .filter((item) => names.has(item.id))
    .map((item) => ({
      id: item.id,
      name: names.get(item.id) ?? item.id,
      grade: typeof item.grade === 'number' ? item.grade : null,
      branchId: text(item.branchId),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
}

/** Seçim ekranı: sınıflar, sınıf düzeyleri, açık öğünler ve açılabilen gün aralığı; sağlık yok. */
export async function mealAllergyOptionsFor(ctx: ServiceContext) {
  const [classes, settings] = await Promise.all([
    classesOf(ctx),
    loadMealSettings(ctx.db, ctx.institutionId),
  ])
  const today = dayKey(ctx.now)
  return {
    today,
    lastDate: addDays(today, MEAL_ALLERGY_DAYS_AHEAD),
    mealKinds: orderedMealKinds(settings.mealKinds),
    classes: classes.map((item) => ({
      classId: item.id,
      className: item.name,
      grade: item.grade,
    })),
    grades: [...new Set(classes.flatMap((item) => (item.grade === null ? [] : [item.grade])))].sort(
      (a, b) => a - b,
    ),
  }
}

interface StudentFacts {
  id: string
  name: string
  classId: string | null
  active: boolean
}

async function studentFacts(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(ids)])
  return new Map<string, StudentFacts>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: text(row.data.name) ?? '—',
        classId: text(row.data.classId),
        active: row.data.isActive !== false,
      },
    ]),
  )
}

/** Günün öğününde kampüs başına servis edilen kalemler (öğrencinin menüsü `familyMenuFor`). */
async function servedSlots(
  db: Database,
  ctx: ServiceContext,
  serviceDate: string,
  mealKind: MealKind,
  branchIds: readonly (string | null)[],
) {
  const menus = await publishedMealMenus(
    db,
    ctx.institutionId,
    mealWeekStartOf(serviceDate),
    branchIds.filter((id): id is string => id !== null),
  )
  const items = await loadMealItems(
    db,
    ctx.institutionId,
    menus.map((menu) => menu.id),
  )
  const slot = items.filter((item) => item.menuDate === serviceDate && item.mealKind === mealKind)
  return (branchId: string | null): { menu: StoredMealMenu; items: StoredMealItem[] } | null => {
    const menu = familyMenuFor(menus, branchId)
    if (menu === undefined) return null
    const served = slot.filter((item) => item.menuId === menu.id)
    return served.length === 0 ? null : { menu, items: served }
  }
}

type ProfileAllergies = { ok: true; allergies: StudentAllergy[] } | { ok: false }

/**
 * Sağlık profilinin yalnız alerji listesi (ad, şiddet). Profil okunamazsa öğrenci "sağlık bilgisi
 * okunamadı, elle kontrol" diye listelenir (sessizce düşmez); ayrıntı yalnız logdadır.
 */
async function allergiesOf(
  tx: Database,
  ctx: ServiceContext,
  deps: MealAllergyDeps,
  studentId: string,
): Promise<ProfileAllergies> {
  try {
    const profile = await loadHealthProfile(tx, ctx.institutionId, studentId, deps.cipher)
    return {
      ok: true,
      allergies: (profile?.content.allergies ?? []).map(({ name, severity }) => ({
        name,
        severity,
      })),
    }
  } catch (error) {
    if (!(error instanceof HealthProfileIntegrityError)) throw error
    ctx.log.warn(
      { event: 'meal_allergy.profile_unreadable', err: error },
      'health profile unreadable',
    )
    return { ok: false }
  }
}

/**
 * Servis listesi (K-541, K-542): seçilen sınıfın ya da sınıf düzeyinin kayıtlı öğrencilerinden
 * yalnız uyarısı olanlar, sınıf ve ada göre. Olmayan sınıf 404; geçmiş ve 7 günden ileri gün 422.
 * Öğrencinin kampüsünde o gün ve öğünde yayımlanmış yemek yoksa sağlık bilgisi okunmaz, öğrenci
 * `studentsWithoutMenu` sayısına girer.
 */
export async function mealAllergyRosterFor(
  ctx: ServiceContext,
  deps: MealAllergyDeps,
  query: { serviceDate?: string | undefined; mealKind: MealKind; selection: MealAllergySelection },
  reason: HealthAccessReason,
) {
  try {
    const today = dayKey(ctx.now)
    const serviceDate = query.serviceDate ?? today
    assertMealAllergyServiceDate(serviceDate, today)
    const [classes, source] = await Promise.all([classesOf(ctx), readSource(ctx)])
    const pick = query.selection
    const selected =
      'classId' in pick
        ? classes.filter((item) => item.id === pick.classId)
        : classes.filter((item) => item.grade === pick.grade)
    if ('classId' in pick && selected.length === 0) throw new NotFoundError()
    const byClass = new Map(selected.map((item) => [item.id, item]))
    const candidateIds = source.students
      .filter((student) => byClass.has(student.classId))
      .map((student) => student.id)
    return await ctx.db.transaction(async (tx) => {
      const [facts, slotOf] = await Promise.all([
        studentFacts(tx, ctx, candidateIds),
        servedSlots(
          tx,
          ctx,
          serviceDate,
          query.mealKind,
          selected.map((item) => item.branchId),
        ),
      ])
      const students = candidateIds
        .map((id) => facts.get(id))
        .filter(
          (student): student is StudentFacts =>
            student !== undefined &&
            student.active &&
            student.classId !== null &&
            byClass.has(student.classId),
        )
      let withoutMenu = 0
      const menusUsed = new Map<string, StoredMealMenu>()
      const listed: {
        student: StudentFacts
        className: string
        menuId: string
        warnings: MealAllergyWarnings
        profileUnreadable: boolean
      }[] = []
      for (const student of students) {
        const classFacts = byClass.get(student.classId ?? '')
        const slot = slotOf(classFacts?.branchId ?? null)
        if (slot === null) {
          withoutMenu += 1
          continue
        }
        menusUsed.set(slot.menu.id, slot.menu)
        const profile = await allergiesOf(tx, ctx, deps, student.id)
        const warnings = profile.ok
          ? mealAllergyWarnings(profile.allergies, slot.items)
          : { conflicts: [], unmatched: [], severity: null }
        if (profile.ok && !hasMealAllergyWarning(warnings)) continue
        listed.push({
          student,
          className: classFacts?.name ?? student.classId ?? '—',
          menuId: slot.menu.id,
          warnings,
          profileUnreadable: !profile.ok,
        })
      }
      listed.sort(
        (a, b) =>
          a.className.localeCompare(b.className, 'tr', { numeric: true }) ||
          a.student.name.localeCompare(b.student.name, 'tr') ||
          a.student.id.localeCompare(b.student.id),
      )
      const checks = await listMealAllergyChecks(tx, ctx.institutionId, {
        serviceDate,
        mealKind: query.mealKind,
        studentIds: listed.map((row) => row.student.id),
      })
      const checkOf = new Map(checks.map((check) => [check.studentId, check]))
      const names = await memberNames(
        tx,
        ctx.institutionId,
        checks.map((check) => check.acknowledgedByMembershipId),
      )
      const branchRows = await loadRecordsByIds(
        tx,
        ctx.institutionId,
        'branches',
        [...menusUsed.values()].flatMap((menu) => (menu.branchId === null ? [] : [menu.branchId])),
        { includeArchived: true },
      )
      const branchNames = new Map(branchRows.map((row) => [row.id, text(row.data.name)]))
      for (const row of listed)
        await recordHealthRead(tx, ctx, {
          action: READ_ACTION,
          entity: { type: STUDENT, id: row.student.id },
          fields: row.profileUnreadable
            ? ['profileUnreadable']
            : [
                ...(row.warnings.conflicts.length > 0 ? ['conflicts'] : []),
                ...(row.warnings.unmatched.length > 0 ? ['unmatched'] : []),
              ],
          studentId: row.student.id,
          reason,
        })
      const selection =
        'classId' in query.selection
          ? { classId: query.selection.classId, grade: null }
          : { classId: null, grade: query.selection.grade }
      if (listed.length === 0)
        await recordHealthRead(tx, ctx, {
          action: READ_ACTION,
          entity: {
            type: 'meal_allergy_rosters',
            id: `${serviceDate}:${query.mealKind}:${selection.classId ?? `grade-${String(selection.grade)}`}`,
          },
          fields: [],
          studentId: null,
          reason,
        })
      ctx.log.info({
        event: READ_ACTION,
        serviceDate,
        mealKind: query.mealKind,
        count: listed.length,
      })
      return {
        serviceDate,
        mealKind: query.mealKind,
        ...selection,
        className: selection.classId === null ? null : (selected[0]?.name ?? null),
        studentCount: students.length,
        studentsWithoutMenu: withoutMenu,
        menus: [...menusUsed.values()]
          .map((menu) => ({
            menuId: menu.id,
            branchId: menu.branchId,
            branchName: menu.branchId === null ? null : (branchNames.get(menu.branchId) ?? null),
          }))
          .sort((a, b) => (a.branchName ?? '').localeCompare(b.branchName ?? '', 'tr')),
        students: listed.map((row) => {
          const check = checkOf.get(row.student.id)
          return {
            studentId: row.student.id,
            studentName: row.student.name,
            classId: row.student.classId,
            className: row.className,
            severity: row.warnings.severity,
            profileUnreadable: row.profileUnreadable,
            conflicts: row.warnings.conflicts,
            unmatched: row.warnings.unmatched,
            acknowledgement:
              check === undefined
                ? null
                : acknowledgementOf(check, names.get(check.acknowledgedByMembershipId) ?? null),
          }
        }),
      }
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}

function acknowledgementOf(check: StoredMealAllergyCheck, acknowledgedByName: string | null) {
  return {
    id: check.id,
    acknowledgedAt: check.createdAt.toISOString(),
    acknowledgedByMembershipId: check.acknowledgedByMembershipId,
    acknowledgedByName,
  }
}

/**
 * Görevli onayı (K-543): "uyarı görüldü, alternatif verildi". Yalnız bugünün öğününde, kayıtlı ve
 * o öğünde uyarısı olan öğrenci için; öğrenci × gün × öğün başına bir kez. Uyarı denetimi için
 * sağlık profili okunur ama yanıtta sağlık bilgisi dönmez (gerekçe istenmez). Denetim
 * `finance.meal_allergy.acknowledge` (alan adları). `Idempotency-Key` rotada zorunlu. 201.
 */
export async function acknowledgeMealAllergyCommand(
  ctx: ServiceContext,
  deps: MealAllergyDeps,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  // Kapsam kaynağı işlemden önce okunur: tek bağlantılı sürücüde işlem içinden `ctx.db` bekler.
  const source = await readSource(ctx)
  const classBranch = new Map(source.classes.map((item) => [item.id, text(item.branchId)]))
  const id = randomUUID()
  const entity = { type: TABLE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.meal_allergy.acknowledge',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = mealAllergyAcknowledgementSchema.parse(input)
        const today = dayKey(ctx.now)
        const facts = await studentFacts(tx, ctx, [parsed.studentId])
        const student = facts.get(parsed.studentId)
        const [existing, warning] = await Promise.all([
          listMealAllergyChecks(tx, ctx.institutionId, {
            serviceDate: parsed.serviceDate,
            mealKind: parsed.mealKind,
            studentIds: [parsed.studentId],
          }),
          student === undefined || !student.active || parsed.serviceDate !== today
            ? null
            : studentWarning(tx, ctx, deps, {
                studentId: student.id,
                branchId: classBranch.get(student.classId ?? '') ?? null,
                serviceDate: parsed.serviceDate,
                mealKind: parsed.mealKind,
              }),
        ])
        return {
          run: () =>
            planMealAllergyAcknowledgement(parsed, {
              today,
              student: student === undefined ? null : { active: student.active },
              exists: existing.length > 0,
              menuId: warning?.menuId ?? null,
              hasWarning: warning?.hasWarning ?? false,
            }),
        }
      },
      after: async (tx, planned) => {
        await insertMealAllergyCheck(tx, ctx.institutionId, {
          id,
          studentId: planned.studentId,
          serviceDate: planned.serviceDate,
          mealKind: planned.mealKind,
          menuId: planned.menuId,
          acknowledgedByMembershipId: ctx.actor.membershipId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.meal_allergy.acknowledge', entity, [
          'studentId',
          'serviceDate',
          'mealKind',
        ])
        const saved = await findMealAllergyCheck(tx, ctx.institutionId, id)
        if (saved === null) throw new Error('meal allergy check insert returned no row')
        const names = await memberNames(tx, ctx.institutionId, [saved.acknowledgedByMembershipId])
        body = {
          data: {
            studentId: saved.studentId,
            serviceDate: saved.serviceDate,
            mealKind: saved.mealKind,
            menuId: saved.menuId,
            ...acknowledgementOf(saved, names.get(saved.acknowledgedByMembershipId) ?? null),
          },
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Öğrencinin bu öğündeki menüsü ve uyarısı var mı (profil okunamıyorsa uyarı var sayılır). */
async function studentWarning(
  tx: Database,
  ctx: ServiceContext,
  deps: MealAllergyDeps,
  target: { studentId: string; branchId: string | null; serviceDate: string; mealKind: MealKind },
): Promise<{ menuId: string; hasWarning: boolean } | null> {
  const slotOf = await servedSlots(tx, ctx, target.serviceDate, target.mealKind, [target.branchId])
  const slot = slotOf(target.branchId)
  if (slot === null) return null
  const profile = await allergiesOf(tx, ctx, deps, target.studentId)
  return {
    menuId: slot.menu.id,
    hasWarning:
      !profile.ok || hasMealAllergyWarning(mealAllergyWarnings(profile.allergies, slot.items)),
  }
}
