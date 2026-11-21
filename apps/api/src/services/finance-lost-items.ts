import { randomUUID } from 'node:crypto'

import {
  assertLostItemDisposal,
  assertLostItemOpen,
  FINANCE_LOST_ITEM_ROLES,
  LOST_ITEM_FAMILY_ROLES,
  LOST_ITEM_HANDOVER_PHOTO_DAYS,
  LOST_ITEM_PHOTO_PURPOSE,
  lostItemCreateSchema,
  lostItemDisposalSchema,
  lostItemHandoverSchema,
  lostItemPhotoSchema,
  lostItemRetentionDueOn,
  lostItemSettingsSchema,
  lostItemUpdateSchema,
  lostReportCreateSchema,
  lostReportMatchSchema,
  planLostItemHandover,
  planLostItemPhotoAdd,
  planLostItemRecord,
  planLostItemSettings,
  planLostItemUpdate,
  planLostReport,
  planLostReportClose,
  planLostReportMatch,
  planLostReportUnmatch,
  type LostItemCategory,
  type LostItemDisposalTarget,
  type LostReportStatus,
} from '@kampus/school-core/lib/finance-lost-items.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { extendFileRetention, findFile } from '../db/files.ts'
import {
  disposeLostItem,
  findLostItem,
  findLostReport,
  insertLostItem,
  insertLostReport,
  listItemPhotos,
  listLostItems,
  listLostReports,
  listPendingItems,
  listRetentionDueItems,
  loadLostItemSettings,
  loadLostItemsByIds,
  LOST_ITEM_ATTACHMENT,
  lostItemCounts,
  lostReportCounts,
  matchedReportsOf,
  saveLostItemSettings,
  touchLostItem,
  updateLostItem,
  updateLostReport,
  type LostItemPhotoRow,
  type LostItemQuery,
  type StoredLostItem,
  type StoredLostReport,
} from '../db/finance-lost-items.ts'
import { findStaffMember, listStaffMembers } from '../db/finance-pay-rates.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { loadStudentGuardians, type StoredGuardianLink } from '../db/student-guardians.ts'
import { AppError, ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile, getFileUrl } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Kayıp eşya (DOM-FIN-145; ON-171; K-490…K-492). Kural core `lib/finance-lost-items.ts`'tedir;
 * servis kurum kilidi altında eşyayı, bildirimi, veli bağını ve ayarı yükler, tek transaction'da
 * yazar ve denetime alan adlarını düşer (tanım, ad ve gerekçe yazılmaz). Fotoğraflar platform dosya
 * altyapısındadır (`attachFile`, bağ türü `lost_item`); bağlantı yalnız bu servisin görünümlerinden
 * üretilir, genel `GET /files/:id/url` yolu 404 alır. Kapanan eşyanın fotoğrafı imhaya işaretlenir
 * (`files.retention_until`), nesneyi platform imha işi siler; burada periyodik iş yoktur. Rol ve
 * modül denetimi rotadadır; aile kapsamı (veli çocuğu, öğrenci kendisi) core kapsamındandır.
 */

const ITEM = 'lost_items'
const REPORT = 'lost_item_reports'
const SETTINGS = 'lost_item_settings'
const DAY_MS = 86_400_000

const isStaff = (role: string) => (FINANCE_LOST_ITEM_ROLES as readonly string[]).includes(role)
const isFamily = (role: string) => (LOST_ITEM_FAMILY_ROLES as readonly string[]).includes(role)

/**
 * Fotoğraf bağlantısı yalnız bu servisin açtığı bağlamda üretilir. Personel bekleyen ve teslim
 * edilmiş eşyanın, aile (galeri açıkken) yalnız bekleyen eşyanın fotoğrafını açar (K-491).
 */
const photoReads = new WeakSet<ServiceContext>()

defineFileAttachment(LOST_ITEM_ATTACHMENT, {
  purposes: [LOST_ITEM_PHOTO_PURPOSE],
  canRead: async (tx, ctx, itemId) => {
    if (!photoReads.has(ctx)) return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    const item = await findLostItem(tx, ctx.institutionId, itemId)
    if (item === null) return false
    if (isStaff(ctx.actor.role)) return item.status === 'pending' || item.status === 'handed_over'
    if (!isFamily(ctx.actor.role) || item.status !== 'pending') return false
    return (await loadLostItemSettings(tx, ctx.institutionId)).familyGalleryEnabled
  },
})

// --- Görünüm -------------------------------------------------------------------------------------

async function studentNames(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(ids)], {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
}

interface ItemContext {
  members: ReadonlyMap<string, string>
  photos: ReadonlyMap<string, LostItemPhotoRow[]>
  matched: ReadonlyMap<string, StoredLostReport>
  students: ReadonlyMap<string, string | null>
  retentionDays: number
  today: string
}

async function itemContext(
  db: Database,
  ctx: ServiceContext,
  rows: readonly StoredLostItem[],
): Promise<ItemContext> {
  const ids = rows.map((row) => row.id)
  const memberIds = rows.flatMap((row) =>
    [row.finderMembershipId, row.handedOverByMembershipId, row.disposedByMembershipId].filter(
      (id): id is string => id !== null,
    ),
  )
  const [members, photos, matched, settings] = await Promise.all([
    memberNames(db, ctx.institutionId, memberIds),
    listItemPhotos(db, ctx.institutionId, ids),
    matchedReportsOf(db, ctx.institutionId, ids),
    loadLostItemSettings(db, ctx.institutionId),
  ])
  const students = await studentNames(db, ctx, [
    ...[...matched.values()].map((report) => report.studentId),
    ...rows.flatMap((row) => (row.recipientStudentId === null ? [] : [row.recipientStudentId])),
  ])
  return {
    members,
    photos,
    matched,
    students,
    retentionDays: settings.retentionDays,
    today: dayKey(ctx.now),
  }
}

const nameOf = (names: ReadonlyMap<string, string>, id: string | null) =>
  id === null ? null : (names.get(id) ?? null)

/** Liste satırı (personel): fotoğraf sayısı, eşlenen bildirim ve saklama sonu. */
function itemRow(row: StoredLostItem, context: ItemContext) {
  const report = context.matched.get(row.id)
  const retentionDueOn = lostItemRetentionDueOn(row.foundOn, context.retentionDays)
  return {
    id: row.id,
    description: row.description,
    category: row.category,
    foundLocation: row.foundLocation,
    foundOn: row.foundOn,
    storageLocation: row.storageLocation,
    status: row.status,
    finderMembershipId: row.finderMembershipId,
    finderName: nameOf(context.members, row.finderMembershipId),
    photoCount: context.photos.get(row.id)?.length ?? 0,
    matchedReport:
      report === undefined
        ? null
        : {
            id: report.id,
            studentId: report.studentId,
            studentName: context.students.get(report.studentId) ?? null,
            version: report.version,
          },
    retentionDueOn,
    retentionDue: row.status === 'pending' && retentionDueOn <= context.today,
    recipientType: row.recipientType,
    recipientName: row.recipientName,
    handedOverAt: row.handedOverAt,
    disposedAt: row.disposedAt,
    version: row.version,
  }
}

type PhotoView = {
  fileId: string
  contentType: string
  byteSize: number
  url: string | null
  expiresAt: string | null
}

/** İmzalı bağlantılar; dosya artık açılamıyorsa (imha, işleniyor) bağlantı boş döner. */
async function signPhotos(
  ctx: ServiceContext,
  storage: StorageDriver | null,
  photos: readonly LostItemPhotoRow[],
): Promise<PhotoView[]> {
  const views: PhotoView[] = []
  if (storage !== null) photoReads.add(ctx)
  for (const photo of photos) {
    const base = { fileId: photo.fileId, contentType: photo.contentType, byteSize: photo.byteSize }
    if (storage === null) {
      views.push({ ...base, url: null, expiresAt: null })
      continue
    }
    try {
      const link = await getFileUrl(ctx, storage, photo.fileId)
      views.push({ ...base, url: link.url, expiresAt: link.expiresAt })
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      ctx.log.info({ event: 'finance.lost_item.photo_unavailable', code: error.code })
      views.push({ ...base, url: null, expiresAt: null })
    }
  }
  return views
}

/**
 * Ayrıntı (personel): satır, teslim ve bağış ayrıntısı, fotoğraflar. `storage` verilirse
 * fotoğrafların imzalı bağlantısı da döner; bağlantı transaction dışında üretilir (PGlite tek
 * bağlantılıdır), yazma yanıtlarında bağlantı boştur.
 */
async function itemDetail(
  db: Database,
  ctx: ServiceContext,
  id: string,
  storage: StorageDriver | null,
) {
  const row = await findLostItem(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const context = await itemContext(db, ctx, [row])
  const photos = await signPhotos(ctx, storage, context.photos.get(row.id) ?? [])
  return {
    ...itemRow(row, context),
    photos,
    recipientStudentId: row.recipientStudentId,
    recipientStudentName:
      row.recipientStudentId === null
        ? null
        : (context.students.get(row.recipientStudentId) ?? null),
    recipientGuardianLinkId: row.recipientGuardianLinkId,
    handedOverByName: nameOf(context.members, row.handedOverByMembershipId),
    disposalReason: row.disposalReason,
    disposedByName: nameOf(context.members, row.disposedByMembershipId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function reportRow(
  report: StoredLostReport,
  names: ReadonlyMap<string, string | null>,
  items: ReadonlyMap<string, StoredLostItem>,
  staff: boolean,
) {
  const item = report.matchedItemId === null ? undefined : items.get(report.matchedItemId)
  return {
    id: report.id,
    studentId: report.studentId,
    studentName: names.get(report.studentId) ?? null,
    description: report.description,
    category: report.category,
    lostOn: report.lostOn,
    status: report.status,
    reporterRole: report.reporterRole,
    createdAt: report.createdAt,
    returnedAt: report.returnedAt,
    // Aile yalnız durumu görür; eşleşen eşyanın yeri ve tanımı personeldedir (K-491).
    matchedItem:
      !staff || item === undefined
        ? null
        : {
            id: item.id,
            description: item.description,
            category: item.category,
            storageLocation: item.storageLocation,
            status: item.status,
          },
    version: report.version,
  }
}

async function reportsView(db: Database, ctx: ServiceContext, rows: readonly StoredLostReport[]) {
  const staff = isStaff(ctx.actor.role)
  const [names, items] = await Promise.all([
    studentNames(
      db,
      ctx,
      rows.map((row) => row.studentId),
    ),
    staff
      ? loadLostItemsByIds(
          db,
          ctx.institutionId,
          rows.flatMap((row) => (row.matchedItemId === null ? [] : [row.matchedItemId])),
        )
      : Promise.resolve([]),
  ])
  const byId = new Map(items.map((item) => [item.id, item]))
  return rows.map((row) => reportRow(row, names, byId, staff))
}

async function reportView(db: Database, ctx: ServiceContext, id: string) {
  const report = await findLostReport(db, ctx.institutionId, id)
  if (report === null) throw new NotFoundError()
  const [view] = await reportsView(db, ctx, [report])
  if (view === undefined) throw new NotFoundError()
  return view
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listLostItemsFor(ctx: ServiceContext, query: LostItemQuery) {
  const { items, total } = await listLostItems(ctx.db, ctx.institutionId, query)
  const context = await itemContext(ctx.db, ctx, items)
  return { items: items.map((row) => itemRow(row, context)), total }
}

export function getLostItemFor(ctx: ServiceContext, storage: StorageDriver, id: string) {
  return itemDetail(ctx.db, ctx, id, storage)
}

export async function lostItemSummaryFor(ctx: ServiceContext) {
  const settings = await loadLostItemSettings(ctx.db, ctx.institutionId)
  const today = dayKey(ctx.now)
  const [items, reports] = await Promise.all([
    lostItemCounts(ctx.db, ctx.institutionId, { today, retentionDays: settings.retentionDays }),
    lostReportCounts(ctx.db, ctx.institutionId),
  ])
  return {
    date: today,
    pending: items.pending,
    retentionDue: items.due,
    openReports: reports.open,
    matchedReports: reports.matched,
    retentionDays: settings.retentionDays,
  }
}

/** Bulan kişi seçimi: kurumun etkin personeli, ada göre. */
export function listLostItemFindersFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  return listStaffMembers(ctx.db, ctx.institutionId, { ...query, status: 'active' })
}

/** Veli bağlarının adları: hesap (üyelik) adı, yoksa veli kaydının adı. */
async function guardianNames(
  db: Database,
  ctx: ServiceContext,
  links: readonly StoredGuardianLink[],
): Promise<Map<string, string | null>> {
  const membershipIds = links.flatMap((link) =>
    link.membershipId === null ? [] : [link.membershipId],
  )
  const parentIds = links.flatMap((link) => (link.parentId === null ? [] : [link.parentId]))
  const [members, parents] = await Promise.all([
    memberNames(db, ctx.institutionId, membershipIds),
    loadRecordsByIds(db, ctx.institutionId, 'parents', [...new Set(parentIds)], {
      includeArchived: true,
    }),
  ])
  const parentName = new Map(
    parents.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
  return new Map(
    links.map((link) => [
      link.id,
      (link.membershipId === null ? undefined : members.get(link.membershipId)) ??
        (link.parentId === null ? null : (parentName.get(link.parentId) ?? null)),
    ]),
  )
}

/** Teslim formu: öğrenci ve etkin veli bağları; kısıtlı veli teslim alamaz (DOM-ILT-072). */
export async function lostItemRecipientsFor(ctx: ServiceContext, studentId: string) {
  const names = await studentNames(ctx.db, ctx, [studentId])
  const [student] = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [studentId])
  if (student === undefined) throw new NotFoundError()
  const links = await loadStudentGuardians(ctx.db, ctx.institutionId, studentId)
  const guardianName = await guardianNames(ctx.db, ctx, links)
  return {
    studentId,
    studentName: names.get(studentId) ?? null,
    guardians: links.map((link) => ({
      guardianLinkId: link.id,
      name: guardianName.get(link.id) ?? null,
      relationship: link.relationship,
      canReceive: !link.contactRestricted,
    })),
  }
}

/** Aile kapsamındaki öğrenciler (veli çocukları, öğrenci kendisi); personelde `undefined`. */
async function familyStudents(ctx: ServiceContext): Promise<readonly string[] | undefined> {
  if (!isFamily(ctx.actor.role)) return undefined
  return [...(await readScope(ctx)).studentIds]
}

export async function listLostReportsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: LostReportStatus | undefined
  },
) {
  const studentIds = await familyStudents(ctx)
  const { items, total } = await listLostReports(ctx.db, ctx.institutionId, {
    ...query,
    studentIds,
  })
  return { items: await reportsView(ctx.db, ctx, items), total }
}

/**
 * Aile galerisi (K-491): bekleyen eşyaların yalnız kategorisi, bulunma günü ve fotoğrafı; tanım,
 * yer ve bulan kişi dönmez. Galeri kurum ayarıyla kapalıysa liste boştur.
 */
export async function lostItemGalleryFor(
  ctx: ServiceContext,
  storage: StorageDriver,
  query: { page: number; pageSize: number; category?: LostItemCategory | undefined },
) {
  const settings = await loadLostItemSettings(ctx.db, ctx.institutionId)
  if (!settings.familyGalleryEnabled) return { items: [], total: 0, enabled: false }
  const { items, total } = await listPendingItems(ctx.db, ctx.institutionId, query)
  const photos = await listItemPhotos(
    ctx.db,
    ctx.institutionId,
    items.map((row) => row.id),
  )
  const views = []
  for (const row of items)
    views.push({
      id: row.id,
      category: row.category,
      foundOn: row.foundOn,
      photos: (await signPhotos(ctx, storage, photos.get(row.id) ?? [])).map(
        ({ fileId, url, expiresAt }) => ({ fileId, url, expiresAt }),
      ),
    })
  return { items: views, total, enabled: true }
}

export async function listLostItemRetentionFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) {
  const settings = await loadLostItemSettings(ctx.db, ctx.institutionId)
  const { items, total } = await listRetentionDueItems(ctx.db, ctx.institutionId, {
    ...query,
    retentionDays: settings.retentionDays,
    today: dayKey(ctx.now),
  })
  const context = await itemContext(ctx.db, ctx, items)
  return {
    items: items.map((row) => itemRow(row, context)),
    total,
    retentionDays: settings.retentionDays,
  }
}

export function lostItemSettingsFor(ctx: ServiceContext) {
  return loadLostItemSettings(ctx.db, ctx.institutionId)
}

// --- Yazma: bulunan eşya -------------------------------------------------------------------------

async function finderOf(
  tx: Database,
  ctx: ServiceContext,
  membershipId: string | null | undefined,
) {
  if (membershipId === null || membershipId === undefined) return undefined
  return findStaffMember(tx, ctx.institutionId, membershipId)
}

const attachPhoto = (tx: Database, ctx: ServiceContext, itemId: string, fileId: string) =>
  attachFile(tx, ctx, {
    fileId,
    attachedType: LOST_ITEM_ATTACHMENT,
    attachedId: itemId,
    dataSubjectId: null,
  })

/** Kapanan eşyanın fotoğraflarını `until` anında imhaya işaretler; daha erken işaret korunur. */
async function schedulePhotoPurge(
  tx: Database,
  ctx: ServiceContext,
  photos: readonly LostItemPhotoRow[],
  until: Date,
) {
  for (const photo of photos) {
    const row = await findFile(tx, ctx.institutionId, photo.fileId, { lock: true })
    if (row === null || row.status === 'deleted') continue
    if (row.retentionUntil !== null && row.retentionUntil <= until) continue
    if ((await extendFileRetention(tx, ctx.institutionId, row, until, ctx.now)) === null)
      throw new ConflictError()
  }
}

async function loadItemForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const item = await findLostItem(tx, ctx.institutionId, id)
  if (item === null) throw new NotFoundError()
  if (item.version !== expectedVersion) throw new ConflictError()
  return item
}

/**
 * Bulunan eşya kaydı (K-490): bulan personel doğrulanır, fotoğraflar (en çok üç) aynı işlemde
 * eşyaya bağlanır. Denetime alan adları. `Idempotency-Key` rotada zorunlu. 201.
 */
export function createLostItemCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ITEM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_item.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = lostItemCreateSchema.parse(input)
        const finder = await finderOf(tx, ctx, parsed.finderMembershipId)
        return {
          run: () => {
            planLostItemRecord(parsed, { today: dayKey(ctx.now), finder })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertLostItem(tx, ctx.institutionId, {
          id,
          description: parsed.description,
          category: parsed.category,
          foundLocation: parsed.foundLocation,
          foundOn: parsed.foundOn,
          finderMembershipId: parsed.finderMembershipId,
          storageLocation: parsed.storageLocation,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        for (const fileId of parsed.photoFileIds) await attachPhoto(tx, ctx, id, fileId)
        await auditWork(tx, ctx, 'finance.lost_item.create', entity, [
          'description',
          'category',
          'foundLocation',
          'foundOn',
          'storageLocation',
          ...(parsed.finderMembershipId === null ? [] : ['finderMembershipId']),
          ...(parsed.photoFileIds.length === 0 ? [] : ['photos']),
        ])
        body = { data: await itemDetail(tx, ctx, id, null) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzeltme (K-490): yalnız bekleyen eşyada. `If-Match` eşya sürümü. */
export function updateLostItemCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_item.update',
      collections: [],
      entity,
      load: async (tx) => {
        const item = await loadItemForWrite(tx, ctx, id, expectedVersion)
        const parsed = lostItemUpdateSchema.parse(input)
        const finder = await finderOf(tx, ctx, parsed.finderMembershipId)
        return {
          run: () => planLostItemUpdate(item, parsed, { today: dayKey(ctx.now), finder }),
        }
      },
      after: async (tx, plan) => {
        const values = Object.fromEntries(plan.changed.map((field) => [field, plan.next[field]]))
        if (
          !(await updateLostItem(tx, ctx.institutionId, {
            id,
            expectedVersion,
            now: ctx.now,
            values,
          }))
        )
          throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lost_item.update', entity, plan.changed)
        body = { data: await itemDetail(tx, ctx, id, null) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Fotoğraf ekleme (K-490): en çok üç; eşyanın sürümü artar. `If-Match` eşya sürümü. */
export function addLostItemPhotoCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_item.photo_add',
      collections: [],
      entity,
      load: async (tx) => {
        const item = await loadItemForWrite(tx, ctx, id, expectedVersion)
        const parsed = lostItemPhotoSchema.parse(input)
        const photos = (await listItemPhotos(tx, ctx.institutionId, [id])).get(id) ?? []
        return {
          run: () => {
            planLostItemPhotoAdd(item, photos.length)
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await attachPhoto(tx, ctx, id, parsed.fileId)
        if (!(await touchLostItem(tx, ctx.institutionId, { id, expectedVersion, now: ctx.now })))
          throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lost_item.photo_add', entity, ['photos'])
        body = { data: await itemDetail(tx, ctx, id, null) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Fotoğraf çıkarma: yalnız bekleyen eşyada ve bu eşyanın fotoğrafında (yoksa 404). Bağı kalkan
 * dosyayı platformun bağsız dosya temizliği siler. `If-Match` eşya sürümü.
 */
export function removeLostItemPhotoCommand(
  ctx: ServiceContext,
  id: string,
  fileId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_item.photo_remove',
      collections: [],
      entity,
      load: async (tx) => {
        const item = await loadItemForWrite(tx, ctx, id, expectedVersion)
        const photos = (await listItemPhotos(tx, ctx.institutionId, [id])).get(id) ?? []
        if (!photos.some((photo) => photo.fileId === fileId)) throw new NotFoundError()
        return { run: () => assertLostItemOpen(item) }
      },
      after: async (tx) => {
        await detachFile(tx, ctx, { fileId, attachedType: LOST_ITEM_ATTACHMENT, attachedId: id })
        if (!(await touchLostItem(tx, ctx.institutionId, { id, expectedVersion, now: ctx.now })))
          throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lost_item.photo_remove', entity, ['photos'])
        body = { data: await itemDetail(tx, ctx, id, null) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Teslim (K-490): teslim alan öğrenci, öğrencinin kısıtsız velisi ya da adıyla başka kişi; adın o
 * anki kopyası ve teslim eden üyelik yazılır. Eşlenen bildirim `returned` olur; fotoğraflar 30
 * gün sonra imhaya işaretlenir. Teslimden sonra eşya değişmez. `If-Match` eşya sürümü.
 */
export function handOverLostItemCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_item.handover',
      collections: [],
      entity,
      load: async (tx) => {
        const item = await loadItemForWrite(tx, ctx, id, expectedVersion)
        const parsed = lostItemHandoverSchema.parse(input)
        const studentName =
          parsed.studentId === null
            ? undefined
            : (await studentNames(tx, ctx, [parsed.studentId])).get(parsed.studentId)
        const studentExists =
          parsed.studentId === null
            ? undefined
            : (await loadRecordsByIds(tx, ctx.institutionId, 'students', [parsed.studentId]))
                .length > 0
        const link =
          parsed.recipientType === 'guardian' && parsed.studentId !== null
            ? ((await loadStudentGuardians(tx, ctx.institutionId, parsed.studentId)).find(
                (row) => row.id === parsed.guardianLinkId,
              ) ?? null)
            : undefined
        const guardianName =
          link === undefined || link === null
            ? null
            : ((await guardianNames(tx, ctx, [link])).get(link.id) ?? null)
        const [photos, matched] = await Promise.all([
          listItemPhotos(tx, ctx.institutionId, [id]),
          matchedReportsOf(tx, ctx.institutionId, [id]),
        ])
        return {
          run: () => {
            planLostItemHandover(item, parsed, { studentExists, guardian: link })
            const recipientName =
              parsed.recipientType === 'other'
                ? (parsed.recipientName ?? '')
                : parsed.recipientType === 'guardian'
                  ? (guardianName ?? 'Veli')
                  : (studentName ?? 'Öğrenci')
            return {
              parsed,
              recipientName,
              photos: photos.get(id) ?? [],
              report: matched.get(id),
            }
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await updateLostItem(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'handed_over',
            recipientType: plan.parsed.recipientType,
            recipientStudentId: plan.parsed.studentId,
            recipientGuardianLinkId: plan.parsed.guardianLinkId,
            recipientName: plan.recipientName,
            handedOverAt: ctx.now,
            handedOverByMembershipId: ctx.actor.membershipId,
          },
        })
        if (!saved) throw new ConflictError()
        if (plan.report !== undefined) {
          const returned = await updateLostReport(tx, ctx.institutionId, {
            id: plan.report.id,
            expectedVersion: plan.report.version,
            now: ctx.now,
            values: { status: 'returned', returnedAt: ctx.now },
          })
          if (!returned) throw new ConflictError()
          await auditWork(
            tx,
            ctx,
            'finance.lost_report.returned',
            { type: REPORT, id: plan.report.id },
            ['status', 'returnedAt'],
          )
        }
        await schedulePhotoPurge(
          tx,
          ctx,
          plan.photos,
          new Date(ctx.now.getTime() + LOST_ITEM_HANDOVER_PHOTO_DAYS * DAY_MS),
        )
        await auditWork(tx, ctx, 'finance.lost_item.handover', entity, [
          'status',
          'recipientType',
          ...(plan.parsed.studentId === null ? [] : ['recipientStudentId']),
          ...(plan.parsed.guardianLinkId === null ? [] : ['recipientGuardianLinkId']),
          'recipientName',
          'handedOverAt',
          'handedOverByMembershipId',
        ])
        body = { data: await itemDetail(tx, ctx, id, null) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Toplu bağış/imha (K-492): seçilen eşyaların hepsi kurala uymalı, biri reddedilirse hiçbiri
 * değişmez; fotoğraflar hemen imhaya işaretlenir. Eşya başına `finance.lost_item.dispose`
 * denetimi (gerekçe yazılmaz). Taze oturum ve `Idempotency-Key` rotada zorunlu.
 */
export function disposeLostItemsCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ITEM, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_item.dispose',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = lostItemDisposalSchema.parse(input)
        const [rows, settings, matched, photos] = await Promise.all([
          loadLostItemsByIds(tx, ctx.institutionId, parsed.itemIds),
          loadLostItemSettings(tx, ctx.institutionId),
          matchedReportsOf(tx, ctx.institutionId, parsed.itemIds),
          listItemPhotos(tx, ctx.institutionId, parsed.itemIds),
        ])
        const found = new Map<string, LostItemDisposalTarget & { version: number }>(
          rows.map((row) => [
            row.id,
            {
              id: row.id,
              status: row.status,
              foundOn: row.foundOn,
              matched: matched.has(row.id),
              version: row.version,
            },
          ]),
        )
        return {
          run: () => {
            assertLostItemDisposal(parsed, found, {
              retentionDays: settings.retentionDays,
              today: dayKey(ctx.now),
            })
            return { parsed, found, photos }
          },
        }
      },
      after: async (tx, { parsed, found, photos }) => {
        for (const itemId of parsed.itemIds) {
          const target = found.get(itemId)
          if (target === undefined) throw new NotFoundError()
          const saved = await disposeLostItem(tx, ctx.institutionId, {
            id: itemId,
            expectedVersion: target.version,
            outcome: parsed.outcome,
            reason: parsed.reason,
            membershipId: ctx.actor.membershipId,
            now: ctx.now,
          })
          if (!saved) throw new ConflictError()
          await schedulePhotoPurge(tx, ctx, photos.get(itemId) ?? [], ctx.now)
          await auditWork(tx, ctx, 'finance.lost_item.dispose', { type: ITEM, id: itemId }, [
            'status',
            'disposedAt',
            'disposalReason',
            'disposedByMembershipId',
          ])
        }
        body = { data: { disposedCount: parsed.itemIds.length, outcome: parsed.outcome } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Ayar (K-491, K-492): gönderilmeyen alan korunur; `If-Match` ayar sürümü (hiç yoksa 1). */
export function setLostItemSettingsCommand(
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
      action: 'finance.lost_item.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = lostItemSettingsSchema.parse(input)
        const current = await loadLostItemSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planLostItemSettings(current, parsed) }
      },
      after: async (tx, plan) => {
        const saved = await saveLostItemSettings(tx, ctx.institutionId, {
          ...plan.next,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lost_item.settings', entity, plan.changed)
        body = { data: await loadLostItemSettings(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Yazma: kayıp bildirimi ----------------------------------------------------------------------

/**
 * Bildirim (K-491): veli yalnız kapsamındaki çocuğu, öğrenci yalnız kendisi için açar; kapsam
 * dışı ya da olmayan öğrenci 404. Kapsam transaction'dan önce okunur. 201.
 */
export async function createLostReportCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const scope = await readScope(ctx)
  const id = randomUUID()
  const entity = { type: REPORT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_report.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = lostReportCreateSchema.parse(input)
        if (!scope.studentIds.has(parsed.studentId)) throw new NotFoundError()
        const exists =
          (await loadRecordsByIds(tx, ctx.institutionId, 'students', [parsed.studentId])).length > 0
        if (!exists) throw new NotFoundError()
        return {
          run: () => {
            planLostReport(parsed, dayKey(ctx.now))
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertLostReport(tx, ctx.institutionId, {
          id,
          studentId: parsed.studentId,
          description: parsed.description,
          category: parsed.category,
          lostOn: parsed.lostOn,
          reportedByUserId: ctx.actor.userId,
          reporterRole: ctx.actor.role,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.lost_report.create', entity, [
          'studentId',
          'description',
          ...(parsed.category === null ? [] : ['category']),
          'lostOn',
        ])
        body = { data: await reportView(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadReportForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  scope: ReadonlySet<string> | undefined,
) {
  const report = await findLostReport(tx, ctx.institutionId, id)
  if (report === null) throw new NotFoundError()
  if (scope !== undefined && !scope.has(report.studentId)) throw new NotFoundError()
  if (report.version !== expectedVersion) throw new ConflictError()
  return report
}

/** Eşleme (K-491): açık bildirim × bekleyen, eşlenmemiş eşya. `If-Match` bildirim sürümü. */
export function matchLostReportCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: REPORT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_report.match',
      collections: [],
      entity,
      load: async (tx) => {
        const report = await loadReportForWrite(tx, ctx, id, expectedVersion, undefined)
        const parsed = lostReportMatchSchema.parse(input)
        const item = await findLostItem(tx, ctx.institutionId, parsed.itemId)
        const matched = await matchedReportsOf(tx, ctx.institutionId, [parsed.itemId])
        return {
          run: () => {
            if (item === null)
              throw new DomainError('lost_item_not_found', 'Eşya bulunamadı.', {
                kind: 'rule',
                path: ['itemId'],
              })
            planLostReportMatch(report, {
              status: item.status,
              matchedReportId: matched.get(item.id)?.id ?? null,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateLostReport(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { status: 'matched', matchedItemId: parsed.itemId, matchedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lost_report.match', entity, [
          'status',
          'matchedItemId',
          'matchedAt',
        ])
        body = { data: await reportView(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Eşlemeyi kaldırma: bildirim yeniden açılır. `If-Match` bildirim sürümü. */
export function unmatchLostReportCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: REPORT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_report.unmatch',
      collections: [],
      entity,
      load: async (tx) => {
        const report = await loadReportForWrite(tx, ctx, id, expectedVersion, undefined)
        return { run: () => planLostReportUnmatch(report) }
      },
      after: async (tx) => {
        const saved = await updateLostReport(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { status: 'open', matchedItemId: null, matchedAt: null },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lost_report.unmatch', entity, [
          'status',
          'matchedItemId',
          'matchedAt',
        ])
        body = { data: await reportView(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Kapatma (K-491): personel (bulunamadı) ya da aile (kendi kapsamındaki bildirim; vazgeçti ya da
 * buldu). Eşleme varsa kalkar. `If-Match` bildirim sürümü.
 */
export async function closeLostReportCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const scope = isFamily(ctx.actor.role) ? (await readScope(ctx)).studentIds : undefined
  const entity = { type: REPORT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.lost_report.close',
      collections: [],
      entity,
      load: async (tx) => {
        const report = await loadReportForWrite(tx, ctx, id, expectedVersion, scope)
        return {
          run: () => {
            planLostReportClose(report)
            return report
          },
        }
      },
      after: async (tx, report) => {
        const saved = await updateLostReport(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'closed',
            closedAt: ctx.now,
            closedByUserId: ctx.actor.userId,
            ...(report.matchedItemId === null ? {} : { matchedItemId: null, matchedAt: null }),
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.lost_report.close', entity, [
          'status',
          'closedAt',
          ...(report.matchedItemId === null ? [] : ['matchedItemId']),
        ])
        body = { data: await reportView(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
