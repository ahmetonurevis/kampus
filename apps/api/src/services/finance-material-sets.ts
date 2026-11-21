import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  GUARDIAN_RELATIONSHIPS,
  type GuardianRelationship,
} from '@kampus/school-core/lib/guardianship.ts'
import {
  materialSetActions,
  materialSetStudentsCsv,
  planMaterialDelivery,
  planMaterialDeliveryCancel,
  planMaterialDeliverySignature,
  planMaterialSet,
  planMaterialSetUpdate,
  type DeliveryGuardian,
  type MaterialSetContext,
} from '@kampus/school-core/lib/finance-material-sets.ts'

import type { Database } from '../db/client.ts'
import { loadCourseNames } from '../db/finance-budget.ts'
import {
  cancelStockMovements,
  insertStockMovements,
  loadStockItemsByIds,
} from '../db/finance-inventory.ts'
import {
  cancelMaterialDelivery,
  countMaterialStudents,
  findMaterialSet,
  hasLiveDelivery,
  insertMaterialDelivery,
  insertMaterialSet,
  loadDeliveryStudent,
  loadDeliveryStudentFacts,
  loadLastCancelledDeliveries,
  loadMaterialDeliveries,
  loadMaterialDeliveryItems,
  loadMaterialSetItems,
  loadMaterialSets,
  loadMaterialStudentPage,
  loadStudentNames,
  markMaterialDeliverySigned,
  setHasDeliveries,
  updateMaterialSet,
  type MaterialStudentQuery,
  type StoredMaterialDelivery,
  type StoredMaterialSet,
} from '../db/finance-material-sets.ts'
import { purchaseActorNames } from '../db/finance-purchase-requests.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { loadGuardianAccounts } from '../db/student-guardians.ts'
import { foldSearch } from '../db/text-search.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { movementContext } from './finance-inventory.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Kitap ve materyal seti dağıtımı (DOM-FIN-080; ON-232). Kural core `lib/finance-material-sets.ts`'
 * tedir; servis kurum kilidi altında seti, öğrenciyi, velileri ve ilgili ürün × depo hareketlerini
 * yükler, core kuralıyla denetler ve aynı transaction'da yazar: teslim stok çıkışlarıyla birlikte
 * yazılır, eşzamanlı iki teslim aynı stoğu birlikte tüketemez (K-181). Rol ve modül denetimi
 * rotadadır. Öğrenci adı yalnız yönetici ve ön büroya gider (rota rolleri).
 */

const SET = 'material_sets'
const DELIVERY = 'material_deliveries'
const MOVEMENT = 'stock_movements'

interface Page {
  page: number
  pageSize: number
}

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : undefined
}
const uuidLike = (value: string | undefined) =>
  value !== undefined && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined

async function institutionType(tx: Database, ctx: ServiceContext) {
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  return institution.type
}

// --- Set -----------------------------------------------------------------------------------------

async function setRows(db: Database, ctx: ServiceContext, sets: readonly StoredMaterialSet[]) {
  const [items, courses, counts] = await Promise.all([
    loadMaterialSetItems(
      db,
      ctx.institutionId,
      sets.map((set) => set.id),
    ),
    loadCourseNames(
      db,
      ctx.institutionId,
      sets.flatMap((set) => (set.courseId === null ? [] : [set.courseId])),
    ),
    Promise.all(sets.map((set) => countMaterialStudents(db, ctx.institutionId, set))),
  ])
  return sets.map((set, index) => ({
    id: set.id,
    name: set.name,
    academicYear: set.academicYear,
    gradeLevel: set.gradeLevel,
    courseId: set.courseId,
    courseName: set.courseId === null ? null : (courses.get(set.courseId) ?? null),
    isActive: set.isActive,
    itemCount: items.get(set.id)?.length ?? 0,
    studentCount: counts[index]?.studentCount ?? 0,
    deliveredCount: counts[index]?.deliveredCount ?? 0,
    version: set.version,
  }))
}

export interface MaterialSetListQuery extends Page {
  q?: string | undefined
  academicYear?: number | undefined
  status?: 'active' | 'inactive' | undefined
}

/** Setler: yeni yıl önce, aynı yılda ada göre; öğrenci ve teslim sayısıyla. */
export async function listMaterialSetsFor(ctx: ServiceContext, query: MaterialSetListQuery) {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filtered = (await loadMaterialSets(ctx.db, ctx.institutionId)).filter(
    (set) =>
      (search === undefined || foldSearch(set.name).includes(search)) &&
      (query.academicYear === undefined || set.academicYear === query.academicYear) &&
      (query.status === undefined || set.isActive === (query.status === 'active')),
  )
  const page = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
  return { items: await setRows(ctx.db, ctx, page), total: filtered.length }
}

async function setDetail(db: Database, ctx: ServiceContext, id: string) {
  const set = await findMaterialSet(db, ctx.institutionId, id)
  if (set === null) throw new NotFoundError()
  const [[row], items, hasDeliveries] = await Promise.all([
    setRows(db, ctx, [set]),
    loadMaterialSetItems(db, ctx.institutionId, [id]),
    setHasDeliveries(db, ctx.institutionId, id),
  ])
  const lines = items.get(id) ?? []
  const cards = new Map(
    (
      await loadStockItemsByIds(
        db,
        ctx.institutionId,
        lines.map((line) => line.stockItemId),
      )
    ).map((item) => [item.id, item]),
  )
  if (row === undefined) throw new NotFoundError()
  return {
    ...row,
    hasDeliveries,
    items: lines.map((line) => {
      const card = cards.get(line.stockItemId)
      return {
        stockItemId: line.stockItemId,
        code: card?.code ?? '',
        name: card?.name ?? '',
        unit: card?.unit ?? 'piece',
        isActive: card?.isActive ?? false,
        quantity: line.quantity,
      }
    }),
  }
}

export const getMaterialSetFor = (ctx: ServiceContext, id: string) => setDetail(ctx.db, ctx, id)

const itemIdsOf = (input: unknown): string[] => {
  if (typeof input !== 'object' || input === null) return []
  const items = (input as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  return items.flatMap((item: unknown) => {
    const id = uuidLike(field(item, 'stockItemId'))
    return id === undefined ? [] : [id]
  })
}

async function setContext(
  tx: Database,
  ctx: ServiceContext,
  input: unknown,
): Promise<MaterialSetContext> {
  const courseId = uuidLike(field(input, 'courseId'))
  const [type, sets, items, courses] = await Promise.all([
    institutionType(tx, ctx),
    loadMaterialSets(tx, ctx.institutionId),
    loadStockItemsByIds(tx, ctx.institutionId, itemIdsOf(input)),
    courseId === undefined
      ? new Map<string, string>()
      : loadCourseNames(tx, ctx.institutionId, [courseId]),
  ])
  return {
    institutionType: type,
    sets,
    items: new Map(items.map((item) => [item.id, item])),
    courseIds: new Set(courses.keys()),
  }
}

/** Yeni set (DOM-FIN-080). 201. */
export function createMaterialSetCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: SET, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'material_set.create',
      collections: [],
      entity,
      load: async (tx) => {
        const context = await setContext(tx, ctx, input)
        return { run: () => planMaterialSet(input, context) }
      },
      after: async (tx, data) => {
        await insertMaterialSet(tx, ctx.institutionId, { ...data, id, now: ctx.now })
        await auditWork(tx, ctx, 'material_set.create', entity, Object.keys(data))
        body = { data: await setDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Set düzeltmesi ve pasifleştirme (K-208). */
export function updateMaterialSetCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SET, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'material_set.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findMaterialSet(tx, ctx.institutionId, id)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const [context, hasDeliveries] = await Promise.all([
          setContext(tx, ctx, input),
          setHasDeliveries(tx, ctx.institutionId, id),
        ])
        return { run: () => planMaterialSetUpdate(current, input, { ...context, hasDeliveries }) }
      },
      after: async (tx, changes) => {
        const saved = await updateMaterialSet(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'material_set.update', entity, Object.keys(changes))
        body = { data: await setDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Öğrenci listesi -----------------------------------------------------------------------------

async function deliveryViews(
  db: Database,
  ctx: ServiceContext,
  deliveries: readonly StoredMaterialDelivery[],
) {
  const [items, students, sets, names] = await Promise.all([
    loadMaterialDeliveryItems(
      db,
      ctx.institutionId,
      deliveries.map((delivery) => delivery.id),
    ),
    loadStudentNames(
      db,
      ctx.institutionId,
      deliveries.map((delivery) => delivery.studentId),
    ),
    loadMaterialSets(db, ctx.institutionId, {
      ids: [...new Set(deliveries.map((delivery) => delivery.setId))],
    }),
    purchaseActorNames(
      db,
      ctx.institutionId,
      deliveries.flatMap((delivery) =>
        delivery.cancelledByUserId === null
          ? [delivery.createdByUserId]
          : [delivery.createdByUserId, delivery.cancelledByUserId],
      ),
    ),
  ])
  const cards = new Map(
    (
      await loadStockItemsByIds(
        db,
        ctx.institutionId,
        [...items.values()].flat().map((item) => item.stockItemId),
      )
    ).map((item) => [item.id, item]),
  )
  const setOf = new Map(sets.map((set) => [set.id, set]))
  // Öğrenci bilgisi setin yılına (ücret kalemi) ve kuruna (grup) göredir; teslimler sete göre okunur.
  const facts = new Map(
    await Promise.all(
      sets.map(
        async (set) =>
          [
            set.id,
            await loadDeliveryStudentFacts(
              db,
              ctx.institutionId,
              set,
              deliveries
                .filter((delivery) => delivery.setId === set.id)
                .map((delivery) => delivery.studentId),
            ),
          ] as const,
      ),
    ),
  )
  const actions = materialSetActions(ctx.actor.role)
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  return deliveries.map((delivery) => {
    const live = delivery.cancelledAt === null
    const set = setOf.get(delivery.setId)
    const student = facts.get(delivery.setId)?.get(delivery.studentId)
    return {
      id: delivery.id,
      setId: delivery.setId,
      setName: set?.name ?? '',
      academicYear: set?.academicYear ?? 0,
      studentId: delivery.studentId,
      studentName: students.get(delivery.studentId) ?? '',
      studentNumber: student?.number ?? null,
      className: student?.className ?? null,
      hasMaterialFee: student?.hasMaterialFee ?? false,
      warehouseId: delivery.warehouseId,
      warehouseName: delivery.warehouseName,
      deliveryDate: delivery.deliveryDate,
      recipientKind: delivery.recipientKind,
      recipientName: delivery.recipientName,
      signatureReceived: delivery.signatureReceived,
      signatureRecordedAt: delivery.signatureRecordedAt,
      note: delivery.note,
      items: (items.get(delivery.id) ?? []).map((item) => {
        const card = cards.get(item.stockItemId)
        return {
          stockItemId: item.stockItemId,
          code: card?.code ?? '',
          name: card?.name ?? '',
          unit: card?.unit ?? 'piece',
          quantity: item.quantity,
        }
      }),
      createdAt: delivery.createdAt,
      createdByName: nameOf(delivery.createdByUserId),
      cancelledAt: delivery.cancelledAt,
      cancelledByName: nameOf(delivery.cancelledByUserId),
      cancelReason: delivery.cancelReason,
      actions: {
        cancel: actions.cancel && live,
        sign: actions.sign && live && !delivery.signatureReceived,
      },
      version: delivery.version,
    }
  })
}

type StudentQuery = Omit<MaterialStudentQuery, 'offset' | 'limit'>

async function studentRows(
  db: Database,
  ctx: ServiceContext,
  set: StoredMaterialSet,
  query: MaterialStudentQuery,
) {
  const { rows, total } = await loadMaterialStudentPage(db, ctx.institutionId, set, query)
  const [live, cancelled] = await Promise.all([
    loadMaterialDeliveries(
      db,
      ctx.institutionId,
      rows.flatMap((row) => (row.deliveryId === null ? [] : [row.deliveryId])),
    ),
    loadLastCancelledDeliveries(
      db,
      ctx.institutionId,
      set.id,
      rows.map((row) => row.id),
    ),
  ])
  const deliveries = new Map(live.map((delivery) => [delivery.id, delivery]))
  const actions = materialSetActions(ctx.actor.role)
  return {
    total,
    items: rows.map((row) => {
      const delivery = row.deliveryId === null ? undefined : deliveries.get(row.deliveryId)
      return {
        studentId: row.id,
        studentName: row.name,
        studentNumber: row.number,
        className: row.className,
        hasMaterialFee: row.hasMaterialFee,
        delivery:
          delivery === undefined
            ? null
            : {
                id: delivery.id,
                deliveryDate: delivery.deliveryDate,
                recipientKind: delivery.recipientKind,
                recipientName: delivery.recipientName,
                signatureReceived: delivery.signatureReceived,
                warehouseName: delivery.warehouseName,
                version: delivery.version,
              },
        cancelledDelivery: cancelled.get(row.id) ?? null,
        actions: {
          deliver: actions.deliver && delivery === undefined && set.isActive,
          sign: actions.sign && delivery !== undefined && !delivery.signatureReceived,
          cancel: actions.cancel && delivery !== undefined,
        },
      }
    }),
  }
}

async function requireSet(db: Database, ctx: ServiceContext, setId: string) {
  const set = await findMaterialSet(db, ctx.institutionId, setId)
  if (set === null) throw new NotFoundError()
  return set
}

/** Setin öğrencileri: hedefteki etkin öğrenciler ve teslim alanlar, ada göre (DOM-FIN-080). */
export async function listMaterialStudentsFor(
  ctx: ServiceContext,
  setId: string,
  query: StudentQuery & Page,
) {
  const set = await requireSet(ctx.db, ctx, setId)
  const { page, pageSize, ...filters } = query
  return studentRows(ctx.db, ctx, set, {
    ...filters,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  })
}

const CSV_BATCH = 500

/**
 * Setin öğrenci listesi CSV'si (K-209): süzgeçle eşleşen bütün satırlar. Öğrenci adı kişisel
 * veridir: denetim kaydına `finance.material_set_export` düşer (alan adı yok, set kimliği).
 */
export async function materialStudentsCsvFor(
  ctx: ServiceContext,
  setId: string,
  query: StudentQuery,
): Promise<{ csv: string; filename: string }> {
  const set = await requireSet(ctx.db, ctx, setId)
  const rows: Awaited<ReturnType<typeof studentRows>>['items'] = []
  for (let offset = 0; ; offset += CSV_BATCH) {
    const page = await studentRows(ctx.db, ctx, set, { ...query, offset, limit: CSV_BATCH })
    rows.push(...page.items)
    if (page.items.length < CSV_BATCH) break
  }
  const csv = materialSetStudentsCsv(
    rows.map((row) => ({
      studentNumber: row.studentNumber,
      studentName: row.studentName,
      className: row.className,
      hasMaterialFee: row.hasMaterialFee,
      delivery: row.delivery,
    })),
  )
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.material_set_export',
    entityType: SET,
    entityId: set.id,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { csv, filename: `materyal-seti-${String(set.academicYear)}-${dayKey(ctx.now)}.csv` }
}

// --- Teslim alan ---------------------------------------------------------------------------------

/** Öğrencinin etkin veli bağları ve adları; kısıt bilgisi core denetimi içindir. */
async function guardiansOf(
  db: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<(DeliveryGuardian & { relationship: GuardianRelationship })[]> {
  const links = await loadGuardianAccounts(db, ctx.institutionId, [studentId])
  const [parents, users] = await Promise.all([
    loadRecordsByIds(
      db,
      ctx.institutionId,
      'parents',
      links.flatMap((link) => (link.parentId === null ? [] : [link.parentId])),
    ),
    purchaseActorNames(
      db,
      ctx.institutionId,
      links.flatMap((link) => (link.userId === null ? [] : [link.userId])),
    ),
  ])
  const parentName = new Map(
    parents.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : '']),
  )
  return links.map((link) => ({
    id: link.id,
    name:
      (link.parentId === null ? undefined : parentName.get(link.parentId)) ||
      (link.userId === null ? undefined : users.get(link.userId)) ||
      GUARDIAN_RELATIONSHIPS[link.relationship].label,
    relationship: link.relationship,
    isContactRestricted: link.contactRestricted,
  }))
}

/**
 * Teslim formundaki kayıtlı veliler (K-206): iletişim kısıtlı veli listelenmez. Olmayan, arşivli ya
 * da başka kurumun öğrencisi 404.
 */
export async function listMaterialRecipientsFor(ctx: ServiceContext, studentId: string) {
  const names = await loadStudentNames(ctx.db, ctx.institutionId, [studentId])
  if (!names.has(studentId)) throw new NotFoundError()
  return (await guardiansOf(ctx.db, ctx, studentId))
    .filter((guardian) => !guardian.isContactRestricted)
    .map(({ id, name, relationship }) => ({ id, name, relationship }))
}

// --- Teslim --------------------------------------------------------------------------------------

/**
 * Teslim ayrıntısı (iptal edilmiş dahil; ON-338 teslim tutanağı). Olmayan ya da başka kurumun teslimi
 * 404.
 */
export async function getMaterialDeliveryFor(ctx: ServiceContext, id: string) {
  return (await deliveryBody(ctx.db, ctx, id)).data
}

async function deliveryBody(tx: Database, ctx: ServiceContext, id: string) {
  const [view] = await deliveryViews(
    tx,
    ctx,
    await loadMaterialDeliveries(tx, ctx.institutionId, [id]),
  )
  if (view === undefined) throw new NotFoundError()
  return { data: view }
}

/**
 * Teslim (DOM-FIN-080): set, öğrenci, veli ve stok kurum kilidi altında yüklenir; teslim ve setin
 * kalemleri kadar `delivery` stok çıkışı tek işlemde yazılır. 201.
 */
export function createMaterialDeliveryCommand(
  ctx: ServiceContext,
  setId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DELIVERY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'material_delivery.create',
      collections: [],
      entity,
      load: async (tx) => {
        const set = await requireSet(tx, ctx, setId)
        const items = (await loadMaterialSetItems(tx, ctx.institutionId, [setId])).get(setId) ?? []
        const studentId = field(input, 'studentId') ?? ''
        const warehouseId = uuidLike(field(input, 'warehouseId'))
        const [student, guardians, delivered, stock] = await Promise.all([
          studentId === '' ? null : loadDeliveryStudent(tx, ctx.institutionId, set, studentId),
          studentId === '' ? [] : guardiansOf(tx, ctx, studentId),
          studentId === '' ? false : hasLiveDelivery(tx, ctx.institutionId, setId, studentId),
          movementContext(
            tx,
            ctx,
            items.map((item) => item.stockItemId),
            warehouseId === undefined
              ? []
              : items.map((item) => ({ itemId: item.stockItemId, warehouseId })),
          ),
        ])
        return {
          run: () =>
            planMaterialDelivery(input, {
              ...stock,
              today: dayKey(ctx.now),
              set: { id: set.id, name: set.name, isActive: set.isActive, items },
              student: student ?? undefined,
              guardians: new Map(guardians.map((guardian) => [guardian.id, guardian])),
              delivered,
            }),
        }
      },
      after: async (tx, { data, recipientName, lines }) => {
        const movements = lines.map((line) => ({ ...line, movementId: randomUUID() }))
        await insertStockMovements(tx, ctx.institutionId, {
          movements: movements.map((line) => ({
            id: line.movementId,
            itemId: line.itemId,
            warehouseId: data.warehouseId,
            type: 'delivery',
            quantity: line.quantity,
            movementDate: data.deliveryDate,
            reason: null,
            note: null,
            transferId: null,
            receiptId: null,
            receiptItemId: null,
          })),
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await insertMaterialDelivery(tx, ctx.institutionId, {
          id,
          setId,
          studentId: data.studentId,
          warehouseId: data.warehouseId,
          deliveryDate: data.deliveryDate,
          recipientKind: data.recipientKind,
          guardianId: data.guardianId,
          recipientName,
          signatureReceived: data.signatureReceived,
          note: data.note,
          lines: movements.map((line) => ({
            stockItemId: line.itemId,
            quantity: line.quantity,
            stockMovementId: line.movementId,
          })),
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'material_delivery.create', entity, [
          'setId',
          'studentId',
          'warehouseId',
          'deliveryDate',
          'recipientKind',
          ...(data.guardianId === null ? [] : ['guardianId']),
          ...(recipientName === null ? [] : ['recipientName']),
          'signatureReceived',
          ...(data.note === null ? [] : ['note']),
        ])
        for (const line of movements)
          await auditWork(
            tx,
            ctx,
            'stock_movement.delivery',
            { type: MOVEMENT, id: line.movementId },
            ['itemId', 'warehouseId', 'quantity', 'movementDate'],
          )
        body = await deliveryBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function requireDelivery(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const [delivery] = await loadMaterialDeliveries(tx, ctx.institutionId, [id])
  if (delivery === undefined) throw new NotFoundError()
  if (delivery.version !== version) throw new ConflictError()
  return delivery
}

/** Teslim iptali (K-209): teslim ve stok çıkışları birlikte, aynı gerekçeyle. */
export function cancelMaterialDeliveryCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DELIVERY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'material_delivery.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const delivery = await requireDelivery(tx, ctx, id, expectedVersion)
        return { run: () => planMaterialDeliveryCancel(delivery, input) }
      },
      after: async (tx, reason) => {
        const saved = await cancelMaterialDelivery(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        const movementIds = (
          (await loadMaterialDeliveryItems(tx, ctx.institutionId, [id])).get(id) ?? []
        ).map((item) => item.stockMovementId)
        if (
          !(await cancelStockMovements(tx, ctx.institutionId, {
            ids: movementIds,
            cancelledByUserId: ctx.actor.userId,
            cancelReason: reason,
            now: ctx.now,
          }))
        )
          throw new ConflictError()
        await auditWork(tx, ctx, 'material_delivery.cancel', entity, [
          'cancelledAt',
          'cancelReason',
        ])
        for (const movementId of movementIds)
          await auditWork(tx, ctx, 'stock_movement.cancel', { type: MOVEMENT, id: movementId }, [
            'cancelledAt',
            'cancelReason',
          ])
        body = await deliveryBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Kâğıt imzası sonradan getirildi (K-206). */
export function signMaterialDeliveryCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DELIVERY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'material_delivery.sign',
      collections: [],
      entity,
      load: async (tx) => {
        const delivery = await requireDelivery(tx, ctx, id, expectedVersion)
        return { run: () => planMaterialDeliverySignature(delivery) }
      },
      after: async (tx) => {
        const saved = await markMaterialDeliverySigned(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'material_delivery.sign', entity, [
          'signatureReceived',
          'signatureRecordedAt',
        ])
        body = await deliveryBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
