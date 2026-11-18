import { randomUUID } from 'node:crypto'

import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  addProspectDocumentSchema,
  assertDocumentHistoryCapacity,
  assertDocumentReviewable,
  assertDocumentTypeCapacity,
  assertDocumentTypeLabelFree,
  assertDocumentTypeUsable,
  assertProspectAcceptsDocuments,
  assertSpecialDocumentConsent,
  canOpenProspectDocument,
  createDocumentTypeSchema,
  defaultProspectDocumentTypes,
  documentConsentGrantor,
  documentRetentionUntil,
  documentTypeSpecialCategory,
  PROSPECT_DOCUMENT_PURPOSE,
  prospectDocumentGaps,
  recordDocumentConsentSchema,
  reviewProspectDocumentSchema,
  updateDocumentTypeSchema,
  type GapDocumentType,
} from '@kampus/school-core/lib/prospect-documents.ts'
import {
  ENROLLED_PROSPECT_STAGE,
  enrollmentDocumentHeld,
} from '@kampus/school-core/lib/enrollment-documents.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { Database } from '../db/client.ts'
import {
  archiveProspectDocuments,
  countProspectDocuments,
  ensureDocumentTypes,
  findActiveDocumentConsent,
  findDocumentType,
  findProspectDocument,
  insertDocumentConsent,
  insertDocumentType,
  insertProspectDocument,
  listDocumentConsents,
  listDocumentTypes,
  listProspectDocumentFiles,
  listProspectDocuments,
  loadGapDocuments,
  loadOpenDocumentProspects,
  reviewProspectDocumentRow,
  supersedeCurrentDocument,
  updateDocumentType,
  withdrawDocumentConsentRow,
  type ProspectDocumentRow,
  type StoredDocumentConsent,
} from '../db/prospect-documents.ts'
import { findRecord } from '../db/records.ts'
import { AppError, ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import {
  applyEnrollmentDocuments,
  documentPurgeHeld,
  scheduleDocumentPurge,
} from './enrollment-document-links.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, getFileUrl } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Aday belgeleri (docs/domain/kayit-ve-crm.md DOM-KAY-043; ON-263). Kurallar core
 * `lib/prospect-documents.ts`'tedir; servis satırları kurum kilidi altında yükler, dosyayı platform
 * dosya altyapısıyla (ADR 0003; amaç `document`) belgeye bağlar ve aynı transaction'da yazar. Rol ve
 * modül (`crm`) rotada, özel nitelikli belgenin dar yetkisi (K-322) burada denetlenir.
 *
 * Dosyanın bağı `attached_type = 'prospect_document'`, `attached_id` belge kimliğidir. Bağlı dosya
 * genel dosya uçlarından (`GET /files/:id`, `/url`) açılmaz: bağlantı yalnız aday belge ucundan
 * üretilir; uç rolü ve özel nitelikli işareti denetler ve her açılışı denetim kaydına
 * `prospect_document.read` olarak yazar (DOM-YTK-052). Denetim kaydına yalnız alan adları yazılır;
 * ret gerekçesi ve dosya adı loglanmaz.
 *
 * Saklama (K-323): yerine yenisi yüklenen belgenin ve vazgeçen adayın belgelerinin dosyası 30 gün
 * sonra, rızası geri çekilen özel nitelikli belgenin dosyası hemen imhaya işaretlenir
 * (`files.retention_until`); nesneyi platform imha işi (`files.purge-expired`) siler.
 */

const ATTACHMENT = 'prospect_document'
const DOCUMENT_ENTITY = 'prospect_documents'
const TYPE_ENTITY = 'prospect_document_types'
const CONSENT_ENTITY = 'prospect_document_consents'

/**
 * Yalnız aday belge ucunun kurduğu okuma bağlamı dosyayı açar (`canRead`). Bağlam nesnesi istek
 * başına kurulur; genel dosya uçlarının bağlamı burada yoktur ve 404 alır.
 */
const documentReads = new WeakSet<ServiceContext>()

defineFileAttachment(ATTACHMENT, {
  purposes: [PROSPECT_DOCUMENT_PURPOSE],
  canRead: async (_tx, ctx) => documentReads.has(ctx),
  // Öğrenciye bağlı kabul edilmiş belge imha edilmez (DOM-KAY-045, K-386).
  purgeHeld: (tx, institutionId, attachedId) => documentPurgeHeld(tx, institutionId, attachedId),
})

const SPECIAL_FORBIDDEN = 'Özel nitelikli belgeyi yalnız yönetici açar ve inceler.'
const FILE_PURGED = 'Belgenin dosyası imha edildi. Belgeyi yeniden yükleyin.'

async function institutionTypeOf(db: Database, ctx: ServiceContext): Promise<InstitutionType> {
  const institution = await getInstitutionModules(db, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  return institution.type
}

/** Kurum ilk kez okuyor ya da yazıyorsa varsayılan tür listesi yazılır (K-320). */
export async function ensureProspectDocumentTypes(db: Database, ctx: ServiceContext) {
  const type = await institutionTypeOf(db, ctx)
  await ensureDocumentTypes(db, ctx.institutionId, defaultProspectDocumentTypes(type), ctx.now)
  return type
}

/** Aday (`records`); olmayan, arşivlenmiş ya da başka kurumun adayı 404. */
async function prospectOf(db: Database, ctx: ServiceContext, prospectId: string) {
  const row = await findRecord(db, ctx.institutionId, 'prospects', prospectId)
  if (row === null) throw new NotFoundError()
  const data = row.data as { stage?: unknown; minor?: unknown; studentId?: unknown }
  const stage = typeof data.stage === 'string' ? data.stage : undefined
  return {
    id: row.id,
    stage,
    minor: typeof data.minor === 'boolean' ? data.minor : undefined,
    // Kesin kayda dönmüş adayın öğrencisi: kabul edilen belge ve rıza ona bağlanır (DOM-KAY-045).
    studentId:
      stage === ENROLLED_PROSPECT_STAGE &&
      typeof data.studentId === 'string' &&
      data.studentId !== ''
        ? data.studentId
        : null,
  }
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString())

const typeView = (type: Awaited<ReturnType<typeof listDocumentTypes>>[number]) => ({
  id: type.id,
  kind: type.kind,
  label: type.label,
  required: type.required,
  stage: type.stage,
  specialCategory: type.specialCategory,
  archived: type.archivedAt !== null,
  version: type.version,
})

const gapType = (type: ReturnType<typeof typeView>): GapDocumentType => ({
  id: type.id,
  label: type.label,
  stage: type.stage,
  required: type.required,
  archived: type.archived,
})

const fileAvailable = (status: string) => status !== 'deleted' && status !== 'rejected'

/**
 * Belgenin istemciye giden görünümü. Özel nitelikli belgeyi açamayan (ön büro) dosya adını ve ret
 * gerekçesini görmez; tür, durum ve tarih görünür.
 */
function documentView(row: ProspectDocumentRow, ctx: ServiceContext) {
  const canOpen = canOpenProspectDocument(ctx.actor.role, row.specialCategory)
  const available = fileAvailable(row.fileStatus)
  // Öğrenciye bağlı belgenin dosyası imha edilmez; vazgeçmeden kalan işaret gösterilmez (K-386).
  const held = enrollmentDocumentHeld({
    linked: row.studentId !== null,
    status: row.status,
    archived: false,
  })
  return {
    id: row.id,
    documentTypeId: row.documentTypeId,
    status: row.status,
    specialCategory: row.specialCategory,
    canOpen: canOpen && available,
    file: {
      status: row.fileStatus,
      available,
      name: canOpen ? row.fileName : null,
      contentType: row.fileContentType,
      byteSize: row.fileByteSize,
      purgeAt: held ? null : iso(row.fileRetentionUntil),
    },
    linkedToStudent: row.studentId !== null,
    linkedAt: iso(row.linkedAt),
    rejectionReason: canOpen ? row.rejectionReason : null,
    uploadedAt: row.createdAt.toISOString(),
    reviewedAt: iso(row.reviewedAt),
    supersededAt: iso(row.supersededAt),
    version: row.version,
  }
}

const consentView = (row: StoredDocumentConsent) => ({
  id: row.id,
  grantor: row.grantor,
  method: row.method,
  grantedAt: row.grantedAt.toISOString(),
  withdrawnAt: iso(row.withdrawnAt),
  version: row.version,
})

// --- Belge türleri ------------------------------------------------------------------------

/** Kurumun belge türleri (arşivlenmemiş), sıraya göre; ilk okumada varsayılan liste yazılır. */
export async function documentTypesFor(ctx: ServiceContext) {
  await ensureProspectDocumentTypes(ctx.db, ctx)
  return (await listDocumentTypes(ctx.db, ctx.institutionId)).map(typeView)
}

async function typeBody(tx: Database, ctx: ServiceContext, id: string) {
  const type = await findDocumentType(tx, ctx.institutionId, id)
  if (type === null) throw new NotFoundError()
  return { data: typeView(type) }
}

/** Yeni belge türü (yönetici; K-320). Ad tekil (409), en çok 30 tür (422). 201. */
export function createDocumentTypeCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: TYPE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'prospect_document_type.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = createDocumentTypeSchema.parse(input)
        await ensureProspectDocumentTypes(tx, ctx)
        const active = await listDocumentTypes(tx, ctx.institutionId)
        return {
          run: () => {
            assertDocumentTypeCapacity(active.length)
            assertDocumentTypeLabelFree(active, data.label)
            return {
              ...data,
              specialCategory: documentTypeSpecialCategory(data.kind, data.specialCategory),
            }
          },
        }
      },
      after: async (tx, data) => {
        await insertDocumentType(tx, ctx.institutionId, { id, ...data, now: ctx.now })
        await auditWork(tx, ctx, 'prospect_document_type.create', entity, Object.keys(data))
        body = await typeBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Belge türü düzeltmesi; tür (`kind`) değişmez, sağlık raporunun işareti kalkmaz (422). 200. */
export function updateDocumentTypeCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TYPE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'prospect_document_type.update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = updateDocumentTypeSchema.parse(input)
        const current = await findDocumentType(tx, ctx.institutionId, id)
        if (current === null || current.archivedAt !== null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const active = await listDocumentTypes(tx, ctx.institutionId)
        return {
          run: () => {
            if (changes.label !== undefined)
              assertDocumentTypeLabelFree(active, changes.label, current.id)
            const specialCategory =
              changes.specialCategory === undefined
                ? undefined
                : documentTypeSpecialCategory(current.kind, changes.specialCategory)
            return {
              ...(changes.label === undefined ? {} : { label: changes.label }),
              ...(changes.required === undefined ? {} : { required: changes.required }),
              ...(changes.stage === undefined ? {} : { stage: changes.stage }),
              ...(specialCategory === undefined ? {} : { specialCategory }),
            }
          },
        }
      },
      after: async (tx, changes) => {
        const saved = await updateDocumentType(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'prospect_document_type.update', entity, Object.keys(changes))
        body = await typeBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Türü arşivler: yeni belge alınmaz, eksik hesabına girmez; var olan belgeler kalır. 200. */
export function archiveDocumentTypeCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TYPE_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'prospect_document_type.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findDocumentType(tx, ctx.institutionId, id)
        if (current === null || current.archivedAt !== null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await updateDocumentType(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: {},
          archive: true,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'prospect_document_type.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Adayın belgeleri ---------------------------------------------------------------------

async function prospectDocumentsBody(db: Database, ctx: ServiceContext, prospectId: string) {
  const prospect = await prospectOf(db, ctx, prospectId)
  const institutionType = await ensureProspectDocumentTypes(db, ctx)
  const types = (await listDocumentTypes(db, ctx.institutionId, { includeArchived: true })).map(
    typeView,
  )
  const rows = await listProspectDocuments(db, ctx.institutionId, prospect.id)
  const consents = await listDocumentConsents(db, ctx.institutionId, prospect.id)
  const active = consents.find((row) => row.withdrawnAt === null) ?? null
  const gaps = prospectDocumentGaps(
    types.map(gapType),
    rows.map((row) => ({
      documentTypeId: row.documentTypeId,
      status: row.status,
      fileAvailable: fileAvailable(row.fileStatus),
    })),
    prospect.stage,
  )
  return {
    prospectId: prospect.id,
    // Belge eklenir mi (açık ya da kayda dönmüş aday); vazgeçen adayda yalnız okuma.
    accepting: prospect.stage !== undefined && acceptsDocuments(prospect.stage),
    types,
    documents: rows.map((row) => documentView(row, ctx)),
    gaps,
    consent: {
      grantor: documentConsentGrantor(prospect, institutionType),
      active: active === null ? null : consentView(active),
      history: consents.map(consentView),
    },
  }
}

function acceptsDocuments(stage: string): boolean {
  try {
    assertProspectAcceptsDocuments(stage)
    return true
  } catch (error) {
    if (error instanceof DomainError) return false
    throw error
  }
}

/**
 * Adayın belgeleri, türleri, eksikleri ve özel nitelikli belge rızası. Olmayan, arşivlenmiş ya da
 * başka kurumun adayı 404.
 */
export async function prospectDocumentsFor(ctx: ServiceContext, prospectId: string) {
  return prospectDocumentsBody(ctx.db, ctx, prospectId)
}

/**
 * Adaya belge ekler (DOM-KAY-043): `POST /files` (amaç `document`) ile yüklenip taramadan geçmiş
 * dosya belgeye bağlanır, türün güncel belgesi `superseded` olur ve dosyası 30 gün sonraya imhaya
 * işaretlenir. Özel nitelikli türde etkin rıza şarttır (422). 201; yanıt adayın belge görünümüdür.
 */
export function addProspectDocumentCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DOCUMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'prospect_document.add',
      collections: [],
      entity,
      load: async (tx) => {
        const data = addProspectDocumentSchema.parse(input)
        const prospect = await prospectOf(tx, ctx, prospectId)
        await ensureProspectDocumentTypes(tx, ctx)
        const found = await findDocumentType(tx, ctx.institutionId, data.documentTypeId)
        const existing = await countProspectDocuments(tx, ctx.institutionId, prospect.id)
        const consent = found?.specialCategory
          ? await findActiveDocumentConsent(tx, ctx.institutionId, prospect.id)
          : null
        return {
          run: () => {
            assertProspectAcceptsDocuments(prospect.stage)
            if (found === null)
              throw new DomainError('document_type_unknown', 'Belge türünü listeden seçin.', {
                path: ['documentTypeId'],
              })
            const type = found
            assertDocumentTypeUsable({ archived: type.archivedAt !== null })
            assertSpecialDocumentConsent(type.specialCategory, consent !== null)
            assertDocumentHistoryCapacity(existing)
            return { fileId: data.fileId, type }
          },
        }
      },
      after: async (tx, { fileId, type }) => {
        await attachFile(tx, ctx, {
          fileId,
          attachedType: ATTACHMENT,
          attachedId: id,
          dataSubjectId: null,
        })
        const replaced = await supersedeCurrentDocument(tx, ctx.institutionId, {
          prospectId,
          documentTypeId: type.id,
          supersededById: id,
          now: ctx.now,
        })
        if (replaced !== null)
          await scheduleDocumentPurge(tx, ctx, replaced, documentRetentionUntil(ctx.now))
        await insertProspectDocument(tx, ctx.institutionId, {
          id,
          prospectId,
          documentTypeId: type.id,
          fileId,
          specialCategory: type.specialCategory,
          uploadedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'prospect_document.add', entity, [
          'prospectId',
          'documentTypeId',
          'fileId',
          ...(replaced === null ? [] : ['superseded']),
        ])
        body = { data: await prospectDocumentsBody(tx, ctx, prospectId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Belge ya da adayı yoksa 404; özel nitelikli belgeyi açamayan rol 403. */
async function openableDocument(
  db: Database,
  ctx: ServiceContext,
  prospectId: string,
  documentId: string,
) {
  const prospect = await prospectOf(db, ctx, prospectId)
  const document = await findProspectDocument(db, ctx.institutionId, prospect.id, documentId)
  if (document === null) throw new NotFoundError()
  if (!canOpenProspectDocument(ctx.actor.role, document.specialCategory))
    throw new AppError(403, 'special_document_forbidden', SPECIAL_FORBIDDEN)
  return { prospect, document }
}

/**
 * Belge incelemesi: kabul ya da gerekçeli ret. Yalnız güncel ve incelemesi bekleyen belge (409);
 * özel nitelikli belgeyi yalnız yönetici inceler (403). 200; yanıt adayın belge görünümüdür.
 */
export function reviewProspectDocumentCommand(
  ctx: ServiceContext,
  prospectId: string,
  documentId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DOCUMENT_ENTITY, id: documentId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'prospect_document.review',
      collections: [],
      entity,
      load: async (tx) => {
        const decision = reviewProspectDocumentSchema.parse(input)
        const { prospect, document } = await openableDocument(tx, ctx, prospectId, documentId)
        if (document.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => {
            assertProspectAcceptsDocuments(prospect.stage)
            assertDocumentReviewable({
              status: document.status,
              fileAvailable: fileAvailable(document.fileStatus),
            })
            return { ...decision, studentId: prospect.studentId }
          },
        }
      },
      after: async (tx, decision) => {
        const saved = await reviewProspectDocumentRow(tx, ctx.institutionId, {
          id: documentId,
          expectedVersion,
          status: decision.decision === 'accept' ? 'accepted' : 'rejected',
          rejectionReason: decision.decision === 'reject' ? decision.reason : null,
          reviewedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          decision.decision === 'accept' ? 'prospect_document.accept' : 'prospect_document.reject',
          entity,
          decision.decision === 'accept' ? ['status'] : ['status', 'rejectionReason'],
        )
        // Kesin kayıttan sonraki karar: kabul öğrenciye bağlar, ret 30 gün sonra imhaya işaretler
        // (DOM-KAY-045, K-384).
        if (decision.studentId !== null)
          await applyEnrollmentDocuments(tx, ctx, {
            prospectId,
            studentId: decision.studentId,
            documentIds: [documentId],
          })
        body = { data: await prospectDocumentsBody(tx, ctx, prospectId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Belgenin kısa ömürlü imzalı bağlantısı (ADR 0003 karar 6; 5 dk). Her üretim aynı
 * transaction'da `prospect_document.read` olarak denetime yazılır (DOM-YTK-052); özel nitelikli
 * belgeyi yalnız yönetici açar (403). Dosyası imha edilmiş belge 422 `prospect_document_file_missing`.
 */
export async function prospectDocumentUrlFor(
  ctx: ServiceContext,
  storage: StorageDriver,
  prospectId: string,
  documentId: string,
) {
  try {
    return await ctx.db.transaction(async (tx) => {
      const { document } = await openableDocument(tx, ctx, prospectId, documentId)
      if (!fileAvailable(document.fileStatus))
        throw new AppError(422, 'prospect_document_file_missing', FILE_PURGED)
      await auditWork(
        tx,
        ctx,
        'prospect_document.read',
        { type: DOCUMENT_ENTITY, id: document.id },
        [],
      )
      const readCtx: ServiceContext = { ...ctx, db: tx }
      documentReads.add(readCtx)
      const link = await getFileUrl(readCtx, storage, document.fileId)
      return { url: link.url, expiresAt: link.expiresAt }
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}

// --- Rıza ---------------------------------------------------------------------------------

/**
 * Özel nitelikli belge için açık rıza kaydı (K-322): ön büro ıslak imzalı formu aldığını işaretler;
 * rızayı veren adaydan türetilir (okulda ve 18 yaş altında veli). Etkin rıza varken 409. 201.
 */
export function recordDocumentConsentCommand(
  ctx: ServiceContext,
  prospectId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CONSENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'prospect_document_consent.grant',
      collections: [],
      entity,
      load: async (tx) => {
        const data = recordDocumentConsentSchema.parse(input)
        const prospect = await prospectOf(tx, ctx, prospectId)
        const institutionType = await institutionTypeOf(tx, ctx)
        const active = await findActiveDocumentConsent(tx, ctx.institutionId, prospect.id)
        return {
          run: () => {
            assertProspectAcceptsDocuments(prospect.stage)
            if (active !== null)
              throw new DomainError(
                'document_consent_exists',
                'Bu aday için açık rıza zaten kayıtlı.',
                { kind: 'conflict' },
              )
            return {
              method: data.method,
              grantor: documentConsentGrantor(prospect, institutionType),
              // Kesin kayıttan sonra alınan rıza öğrenciye de bağlanır (DOM-KAY-045, K-385).
              studentId: prospect.studentId,
            }
          },
        }
      },
      after: async (tx, data) => {
        await insertDocumentConsent(tx, ctx.institutionId, {
          id,
          prospectId,
          ...data,
          grantedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'prospect_document_consent.grant', entity, [
          'grantor',
          'method',
          ...(data.studentId === null ? [] : ['studentId']),
        ])
        body = { data: await prospectDocumentsBody(tx, ctx, prospectId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Rızayı geri çeker (DOM-YTK-059 deseni; tek işlem, anında etkili): aynı satıra geri çekme anı ve
 * personel yazılır, adayın özel nitelikli belgeleri arşivlenir ve dosyaları hemen imhaya işaretlenir.
 * Aşamadan bağımsızdır. Etkin rıza yoksa 409 `document_consent_missing`. 200.
 */
export function withdrawDocumentConsentCommand(
  ctx: ServiceContext,
  prospectId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  let consentId = ''
  return runCommand(
    ctx,
    {
      action: 'prospect_document_consent.withdraw',
      collections: [],
      entity: () => ({ type: CONSENT_ENTITY, id: consentId }),
      load: async (tx) => {
        const prospect = await prospectOf(tx, ctx, prospectId)
        const active = await findActiveDocumentConsent(tx, ctx.institutionId, prospect.id)
        if (active !== null && active.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => {
            if (active === null)
              throw new DomainError(
                'document_consent_missing',
                'Geri çekilecek etkin bir rıza yok.',
                { kind: 'conflict' },
              )
            consentId = active.id
            return active
          },
        }
      },
      after: async (tx, active) => {
        const saved = await withdrawDocumentConsentRow(tx, ctx.institutionId, {
          id: active.id,
          expectedVersion,
          withdrawnByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        const special = await listProspectDocumentFiles(tx, ctx.institutionId, prospectId, {
          specialOnly: true,
        })
        await archiveProspectDocuments(
          tx,
          ctx.institutionId,
          special.map((row) => row.id),
          ctx.now,
        )
        for (const row of special) {
          await scheduleDocumentPurge(tx, ctx, row.fileId, ctx.now)
          await auditWork(
            tx,
            ctx,
            'prospect_document.archive',
            { type: DOCUMENT_ENTITY, id: row.id },
            ['archivedAt'],
          )
        }
        await auditWork(
          tx,
          ctx,
          'prospect_document_consent.withdraw',
          { type: CONSENT_ENTITY, id: active.id },
          ['withdrawnAt'],
        )
        body = { data: await prospectDocumentsBody(tx, ctx, prospectId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Eksik belge listesi ------------------------------------------------------------------

/**
 * Eksik zorunlu belgesi olan açık adaylar (DOM-KAY-043, K-321), ad sırasıyla. `prospectIds` verilirse
 * yalnız onlar (aday listesinin rozeti). Satır aday kimliği, adı, aşaması, kampüsü, eksik türleri ve
 * incelemesi bekleyen belge sayısını taşır; iletişim bilgisi taşımaz.
 */
export async function documentGapsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; prospectIds: readonly string[] | null },
) {
  await ensureProspectDocumentTypes(ctx.db, ctx)
  const types = (await listDocumentTypes(ctx.db, ctx.institutionId)).map(typeView).map(gapType)
  const prospects = await loadOpenDocumentProspects(ctx.db, ctx.institutionId, query.prospectIds)
  const documents = await loadGapDocuments(
    ctx.db,
    ctx.institutionId,
    query.prospectIds === null ? null : prospects.map((prospect) => prospect.id),
  )
  const byProspect = new Map<string, typeof documents>()
  for (const document of documents) {
    const list = byProspect.get(document.prospectId) ?? []
    list.push(document)
    byProspect.set(document.prospectId, list)
  }
  const rows = prospects.flatMap((prospect) => {
    const gaps = prospectDocumentGaps(
      types,
      (byProspect.get(prospect.id) ?? []).map((document) => ({
        documentTypeId: document.documentTypeId,
        status: document.status,
        fileAvailable: fileAvailable(document.fileStatus),
      })),
      prospect.stage,
    )
    return gaps.missing.length === 0 ? [] : [{ prospect, ...gaps }]
  })
  const start = (query.page - 1) * query.pageSize
  return {
    total: rows.length,
    items: rows.slice(start, start + query.pageSize).map((row) => ({
      prospectId: row.prospect.id,
      name: row.prospect.name,
      stage: row.prospect.stage,
      branchId: row.prospect.branchId,
      missing: row.missing,
      awaitingReview: row.awaitingReview,
    })),
  }
}

// --- Aday kapanışı ------------------------------------------------------------------------

/**
 * Vazgeçen adayın belgelerinin dosyaları vazgeçme anından 30 gün sonra imhaya işaretlenir (K-323);
 * aday işlemi (`services/prospects.ts`) aşama değişikliğinin transaction'ında çağırır. İşaret aday
 * yeniden açılsa da kalkmaz: dosya imha edilince belge eksik sayılır ve yeniden istenir.
 */
export async function scheduleLostProspectDocuments(
  tx: Database,
  ctx: ServiceContext,
  prospectId: string,
): Promise<void> {
  const rows = await listProspectDocumentFiles(tx, ctx.institutionId, prospectId)
  const until = documentRetentionUntil(ctx.now)
  for (const row of rows) await scheduleDocumentPurge(tx, ctx, row.fileId, until)
}
