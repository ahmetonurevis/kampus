import { randomUUID } from 'node:crypto'

import {
  FINANCE_STAFF_DOCUMENT_ROLES,
  isLegallySensitiveType,
  isStaffDocumentRestricted,
  missingStaffDocumentTypes,
  planStaffDocument,
  requiredStaffDocumentTypes,
  resolveStaffDocumentSettings,
  STAFF_DOCUMENT_TYPES,
  STAFF_DOCUMENT_WITHIN_DAYS_DEFAULT,
  staffDocumentInputSchema,
  staffDocumentSettingsUpdateSchema,
  staffDocumentStatus,
  type StaffDocumentSettings,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import { addDays } from '@kampus/school-core/lib/finance-opening-watch.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import { findFile } from '../db/files.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import {
  countDocumentAlerts,
  countStaffMissingDocuments,
  findStaffDocument,
  insertStaffDocument,
  listDocumentStaff,
  listStaffDocuments,
  loadCurrentDocumentsOfType,
  loadMemberDocuments,
  loadStaffDocumentSettings,
  staffDocumentExists,
  supersedeStaffDocument,
  upsertStaffDocumentSettings,
  type DocumentDueFilter,
  type StoredStaffDocument,
} from '../db/finance-staff-documents.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { AppError, ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, getFileUrl } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel özlük belgeleri ve geçerlilik takibi (DOM-FIN-113; ON-173). Kural core
 * `lib/finance-staff-documents.ts`'tedir; servis kurum kilidi altında üyeliği, tür ayarlarını ve
 * geçerli belgeleri yükler, aynı transaction'da yazar. Dosya platform altyapısındadır (`attachFile`,
 * amaç `document`, bağ türü `staff_document`). Dosya bağlantısı yalnız bu servisin
 * `staffDocumentFileUrl` işlevinden üretilir ve her üretim `finance.staff_document.file_open`
 * denetimine yazılır (K-374); `GET /files/:id/url` yolundan belge dosyası açılmaz (404).
 * Denetim kaydına alan adları yazılır; not ve dosya adı yazılmaz. Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'staff_documents'
const ATTACHMENT = 'staff_document'
const FILE_OPEN_ACTION = 'finance.staff_document.file_open'

/**
 * Dosya bağlantısı yalnız denetim yazan yoldan üretilir: bu kümede olan bağlam
 * `staffDocumentFileUrl`'in açtığıdır. Dosya altyapısının okuma kuralı (`canRead`) bağlamı burada
 * arar; doğrudan `GET /files/:id` ve `/url` istekleri kümede olmadığından 404 alır.
 */
const auditedOpens = new WeakSet<ServiceContext>()

defineFileAttachment(ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, documentId) => {
    if (!auditedOpens.has(ctx)) return false
    if (!(FINANCE_STAFF_DOCUMENT_ROLES as readonly string[]).includes(ctx.actor.role)) return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true) return false
    return staffDocumentExists(tx, ctx.institutionId, documentId)
  },
})

async function settingsOf(db: Database, institutionId: string): Promise<StaffDocumentSettings> {
  const { stored } = await loadStaffDocumentSettings(db, institutionId)
  return resolveStaffDocumentSettings(stored)
}

type FileInfo = { name: string; byteSize: number } | null

/**
 * Yanıt görünümü (K-374). Gizli (özel nitelikli; listede herkese, ayrıntıda yönetici dışına)
 * belgede yalnız tür, tarihler ve durum döner: dosya bilgisi `null`, `restricted: true`.
 */
export function staffDocumentView(
  doc: StoredStaffDocument,
  options: {
    today: string
    withinDays: number
    sensitive: boolean
    restricted: boolean
    file: FileInfo
  },
) {
  const { status, daysLeft } = staffDocumentStatus(doc, options.today, options.withinDays)
  return {
    id: doc.id,
    membershipId: doc.membershipId,
    documentType: doc.documentType,
    healthReportKind: doc.healthReportKind,
    documentDate: doc.documentDate,
    validUntil: doc.validUntil,
    validUntilSource: doc.validUntilSource,
    status,
    daysLeft,
    sensitive: options.sensitive,
    restricted: options.restricted,
    hasFile: options.restricted ? null : doc.fileId !== null,
    file: options.restricted ? null : options.file,
    note: options.restricted ? null : doc.note,
    replacesId: doc.replacesId,
    supersededAt: doc.supersededAt,
    createdAt: doc.createdAt,
  }
}
export type StaffDocumentView = ReturnType<typeof staffDocumentView>

async function fileInfo(db: Database, institutionId: string, fileId: string | null) {
  if (fileId === null) return null
  const file = await findFile(db, institutionId, fileId)
  if (file === null || file.status === 'deleted' || file.status === 'rejected') return null
  return { name: file.originalName ?? 'belge', byteSize: file.byteSize }
}

// --- Tür ayarları --------------------------------------------------------------------------------

async function settingsBody(db: Database, institutionId: string) {
  const { stored, updatedAt } = await loadStaffDocumentSettings(db, institutionId)
  const settings = resolveStaffDocumentSettings(stored)
  return STAFF_DOCUMENT_TYPES.map((documentType) => ({
    documentType,
    ...settings[documentType],
    sensitiveLocked: isLegallySensitiveType(documentType),
    customized: stored[documentType] !== undefined,
    updatedAt: updatedAt[documentType] ?? null,
  }))
}

export async function getStaffDocumentSettingsFor(ctx: ServiceContext) {
  return settingsBody(ctx.db, ctx.institutionId)
}

/** Tür ayarlarını yazar (K-372); kayıtlı belgelerin bitişi değişmez. */
export function updateStaffDocumentSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: 'staff_document_type_settings', id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_document_type.update',
      collections: [],
      entity,
      load: () => Promise.resolve({ run: () => staffDocumentSettingsUpdateSchema.parse(input) }),
      after: async (tx, settings) => {
        await upsertStaffDocumentSettings(tx, ctx.institutionId, {
          settings,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.staff_document_type.update',
          entity,
          Object.keys(settings).filter((key) => settings[key as keyof typeof settings]),
        )
        body = { data: await settingsBody(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Okuma ---------------------------------------------------------------------------------------

const horizonOf = (today: string, withinDays: number) => addDays(today, withinDays)

/**
 * Geçerlilik takibi (K-373): etkin personelin yerine geçilmemiş belgeleri, bitişi yakın olan önce.
 * `due` süzgeci süresi geçen, `withinDays` gün içinde bitecek ya da ikisi (`attention`). Özel
 * nitelikli belgede yalnız tür ve tarihler döner (K-374).
 */
export async function listStaffDocumentsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    documentType?: (typeof STAFF_DOCUMENT_TYPES)[number] | undefined
    due?: DocumentDueFilter | undefined
    withinDays?: number | undefined
  },
) {
  const today = dayKey(ctx.now)
  const withinDays = query.withinDays ?? STAFF_DOCUMENT_WITHIN_DAYS_DEFAULT
  const settings = await settingsOf(ctx.db, ctx.institutionId)
  const { items, total } = await listStaffDocuments(ctx.db, ctx.institutionId, {
    ...query,
    today,
    horizon: horizonOf(today, withinDays),
  })
  const rows = await Promise.all(
    items.map(async ({ staff, ...doc }) => {
      const sensitive = settings[doc.documentType].sensitive
      const restricted = isStaffDocumentRestricted(sensitive, ctx.actor.role, 'list')
      return {
        ...staffDocumentView(doc, {
          today,
          withinDays,
          sensitive,
          restricted,
          file: restricted ? null : await fileInfo(ctx.db, ctx.institutionId, doc.fileId),
        }),
        staff,
      }
    }),
  )
  return { items: rows, total, withinDays }
}

/** Uyarı sayıları (pano ve liste rozeti): süresi geçen, yaklaşan, zorunlu belgesi eksik personel. */
export async function getStaffDocumentAlertsFor(
  ctx: ServiceContext,
  withinDays: number = STAFF_DOCUMENT_WITHIN_DAYS_DEFAULT,
) {
  const today = dayKey(ctx.now)
  const settings = await settingsOf(ctx.db, ctx.institutionId)
  const [alerts, staffMissing] = await Promise.all([
    countDocumentAlerts(ctx.db, ctx.institutionId, today, horizonOf(today, withinDays)),
    countStaffMissingDocuments(ctx.db, ctx.institutionId, requiredStaffDocumentTypes(settings)),
  ])
  return {
    withinDays,
    expiredCount: alerts.expired,
    expiringCount: alerts.expiring,
    staffMissingCount: staffMissing,
  }
}

/**
 * Personel listesi ve belge özeti: eksik zorunlu türler (yalnız etkin personelde), süresi geçen ve
 * yaklaşan belge sayısı. `missing=true` yalnız eksiği olan etkin personeli verir.
 */
export async function listStaffDocumentStaffFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: 'active' | 'passive' | undefined
    missing: boolean
    withinDays?: number | undefined
  },
) {
  const today = dayKey(ctx.now)
  const withinDays = query.withinDays ?? STAFF_DOCUMENT_WITHIN_DAYS_DEFAULT
  const settings = await settingsOf(ctx.db, ctx.institutionId)
  const { items, total } = await listDocumentStaff(ctx.db, ctx.institutionId, {
    page: query.page,
    pageSize: query.pageSize,
    q: query.q,
    status: query.status,
    missingOf: query.missing ? requiredStaffDocumentTypes(settings) : undefined,
  })
  const docs = await loadMemberDocuments(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.membershipId),
    { currentOnly: true },
  )
  const byMember = new Map<string, StoredStaffDocument[]>()
  for (const doc of docs)
    byMember.set(doc.membershipId, [...(byMember.get(doc.membershipId) ?? []), doc])
  const rows = items.map((member) => {
    const own = byMember.get(member.membershipId) ?? []
    const statuses = own.map((doc) => staffDocumentStatus(doc, today, withinDays).status)
    return {
      ...member,
      documentCount: own.length,
      missingTypes: member.active ? missingStaffDocumentTypes(settings, own) : [],
      expiredCount: member.active ? statuses.filter((status) => status === 'expired').length : 0,
      expiringCount: member.active ? statuses.filter((status) => status === 'expiring').length : 0,
    }
  })
  return { items: rows, total, withinDays }
}

/** Personel üyeliği: yoksa ya da personel değilse (öğrenci, veli) 404. */
async function staffOf(db: Database, ctx: ServiceContext, membershipId: string) {
  const member = await findStaffMember(db, ctx.institutionId, membershipId)
  if (member === null || !isStaffRole(member.role)) throw new NotFoundError()
  return member
}

async function documentBody(
  db: Database,
  ctx: ServiceContext,
  doc: StoredStaffDocument,
  settings: StaffDocumentSettings,
) {
  const sensitive = settings[doc.documentType].sensitive
  const restricted = isStaffDocumentRestricted(sensitive, ctx.actor.role, 'detail')
  return staffDocumentView(doc, {
    today: dayKey(ctx.now),
    withinDays: STAFF_DOCUMENT_WITHIN_DAYS_DEFAULT,
    sensitive,
    restricted,
    file: restricted ? null : await fileInfo(db, ctx.institutionId, doc.fileId),
  })
}

/** Personelin bütün belgeleri (geçmiş dahil) ve eksik zorunlu türleri. */
export async function getStaffDocumentsFor(ctx: ServiceContext, membershipId: string) {
  const member = await staffOf(ctx.db, ctx, membershipId)
  const settings = await settingsOf(ctx.db, ctx.institutionId)
  const docs = await loadMemberDocuments(ctx.db, ctx.institutionId, [membershipId])
  return {
    ...member,
    missingTypes: member.active ? missingStaffDocumentTypes(settings, docs) : [],
    documents: await Promise.all(docs.map((doc) => documentBody(ctx.db, ctx, doc, settings))),
  }
}

// --- Yazma ---------------------------------------------------------------------------------------

/** Yeni belge (K-373): yerine geçilen belge aynı transaction'da geçmiş olur. 201. */
export function createStaffDocumentCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_document.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffDocumentInputSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const settings = await settingsOf(tx, ctx.institutionId)
        const current =
          staff === null
            ? []
            : await loadCurrentDocumentsOfType(
                tx,
                ctx.institutionId,
                parsed.membershipId,
                parsed.documentType,
              )
        return {
          run: () => ({
            parsed,
            settings,
            plan: planStaffDocument(parsed, {
              staff,
              settings,
              current,
              actorRole: ctx.actor.role,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { parsed, settings, plan }) => {
        if (plan.supersedes !== null) {
          const done = await supersedeStaffDocument(tx, ctx.institutionId, {
            id: plan.supersedes,
            now: ctx.now,
          })
          if (!done) throw new ConflictError()
        }
        // Dosya belge satırından önce bağlanır: başkasının, başka kurumun ya da hazır olmayan dosya
        // yabancı anahtar hatası yerine 422 `file_unavailable` (bağlı dosya 409
        // `file_already_attached`) alır; bağ belge kimliğini taşır, yabancı anahtarı yoktur.
        if (parsed.fileId !== null)
          await attachFile(tx, ctx, {
            fileId: parsed.fileId,
            attachedType: ATTACHMENT,
            attachedId: id,
            dataSubjectId: null,
          })
        await insertStaffDocument(tx, ctx.institutionId, {
          id,
          membershipId: parsed.membershipId,
          documentType: parsed.documentType,
          healthReportKind: parsed.healthReportKind,
          documentDate: parsed.documentDate,
          validUntil: plan.validUntil,
          validUntilSource: plan.validUntilSource,
          fileId: parsed.fileId,
          note: parsed.note,
          replacesId: plan.supersedes,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (plan.supersedes !== null)
          await auditWork(
            tx,
            ctx,
            'finance.staff_document.supersede',
            { type: ENTITY, id: plan.supersedes },
            ['supersededAt'],
          )
        await auditWork(
          tx,
          ctx,
          'finance.staff_document.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        const created = await findStaffDocument(tx, ctx.institutionId, id)
        if (created === null) throw new NotFoundError()
        const superseded =
          plan.supersedes === null
            ? null
            : await findStaffDocument(tx, ctx.institutionId, plan.supersedes)
        body = {
          data: {
            document: await documentBody(tx, ctx, created, settings),
            superseded:
              superseded === null ? null : await documentBody(tx, ctx, superseded, settings),
          },
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

// --- Dosya açma ----------------------------------------------------------------------------------

const FILE_MESSAGES = {
  staff_document_no_file: 'Bu belgeye dosya eklenmemiş.',
  staff_document_sensitive_forbidden:
    'Bu belge özel nitelikli kişisel veridir; dosyasını yalnız yönetici açar.',
} as const

/**
 * Belgenin dosyası için kısa ömürlü imzalı bağlantı (K-374). Özel nitelikli belgede yalnız
 * yönetici (ön büro 403). Bağlantı platform `getFileUrl` ile üretilir; üretim başarılı olunca
 * `finance.staff_document.file_open` denetimi yazılır, denetim yazılamazsa bağlantı dönmez.
 */
export async function staffDocumentFileUrl(
  ctx: ServiceContext,
  storage: StorageDriver,
  documentId: string,
) {
  const doc = await findStaffDocument(ctx.db, ctx.institutionId, documentId)
  if (doc === null) throw new NotFoundError()
  const settings = await settingsOf(ctx.db, ctx.institutionId)
  const sensitive = settings[doc.documentType].sensitive
  if (isStaffDocumentRestricted(sensitive, ctx.actor.role, 'detail'))
    throw new AppError(
      403,
      'staff_document_sensitive_forbidden',
      FILE_MESSAGES.staff_document_sensitive_forbidden,
    )
  if (doc.fileId === null)
    throw new RuleViolationError('staff_document_no_file', FILE_MESSAGES.staff_document_no_file)
  const opening: ServiceContext = { ...ctx }
  auditedOpens.add(opening)
  const link = await getFileUrl(opening, storage, doc.fileId)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: FILE_OPEN_ACTION,
    entityType: ENTITY,
    entityId: doc.id,
    // kvkk: dosya adı ve içerik değil, yalnız açılan alanın adı; tür belge kaydından okunur.
    changes: { fields: ['fileId'] },
    createdAt: ctx.now,
  })
  return { url: link.url, expiresAt: link.expiresAt }
}
