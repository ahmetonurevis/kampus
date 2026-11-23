import { randomUUID } from 'node:crypto'

import {
  FINANCE_TRANSPORT_DOCUMENT_ROLES,
  isCurrentDriverDocument,
  isSensitiveTransportDocumentType,
  isTransportDocumentRestricted,
  planTransportDocument,
  planTransportDocumentSettings,
  transportDocumentInputSchema,
  transportDocumentSettingsSchema,
  transportDocumentStatus,
  vehicleFitness,
  type TransportDocumentSubject,
  type TransportDocumentType,
} from '@kampus/school-core/lib/finance-transport-documents.ts'
import { addDays } from '@kampus/school-core/lib/finance-opening-watch.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findFile } from '../db/files.ts'
import {
  findTransportDocument,
  insertTransportDocument,
  listTransportDocuments,
  loadCountedDocuments,
  loadCurrentDocumentsOfType,
  loadDocumentRows,
  loadLiveVehicles,
  loadTransportDocumentSettings,
  loadVehicleRoutes,
  saveTransportDocumentSettings,
  supersedeTransportDocument,
  transportDocumentExists,
  type TransportDocumentDue,
  type TransportDocumentListRow,
} from '../db/finance-transport-documents.ts'
import { findVehicle } from '../db/finance-transport.ts'
import { AppError, ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, getFileUrl } from './files.ts'
import { memberCheck } from './finance-transport.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Servis aracı ve personeli belgeleri (DOM-FIN-147; ON-147; K-496…K-498). Kural core
 * `lib/finance-transport-documents.ts`'tedir; servis kurum kilidi altında aracı, üyeliği, dosyayı ve
 * aynı türün geçerli belgesini yükler, aynı transaction'da yazar. Dosya platform altyapısındadır
 * (`attachFile`, bağ türü `transport_document`); bağlantı yalnız `transportDocumentFileUrl`'den
 * üretilir ve her üretim `finance.transport.document_file_open` denetimine yazılır, genel
 * `GET /files/:id/url` yolu 404 alır. Denetime alan adları yazılır; sürücü adı, numara ve dosya adı
 * yazılmaz. Rol ve modül (`finance`, `transport`) denetimi rotadadır.
 */

const ENTITY = 'transport_documents'
const SETTINGS = 'transport_document_settings'
const ATTACHMENT = 'transport_document'
const FILE_OPEN_ACTION = 'finance.transport.document_file_open'

/** Dosya bağlantısı yalnız denetim yazan yolun açtığı bağlamda üretilir. */
const auditedOpens = new WeakSet<ServiceContext>()

defineFileAttachment(ATTACHMENT, {
  // Platformda ön büronun yükleyebildiği görsel amacı yoktur; görseli geçişte yönetici
  // `question_image` ile yükler (kayıp eşya K-490 ile aynı), PDF `document` amacıdır.
  purposes: ['document', 'question_image'],
  canRead: async (tx, ctx, documentId) => {
    if (!auditedOpens.has(ctx)) return false
    if (!(FINANCE_TRANSPORT_DOCUMENT_ROLES as readonly string[]).includes(ctx.actor.role))
      return false
    const institution = await getInstitutionModules(tx, ctx.institutionId)
    if (institution?.modules.finance !== true || institution.modules.transport !== true)
      return false
    return transportDocumentExists(tx, ctx.institutionId, documentId)
  },
})

const horizonOf = (today: string, warningDays: number) => addDays(today, warningDays)

type FileInfo = { name: string; byteSize: number } | null

async function fileInfo(db: Database, institutionId: string, fileId: string | null) {
  if (fileId === null) return null
  const file = await findFile(db, institutionId, fileId)
  if (file === null || file.status === 'deleted' || file.status === 'rejected') return null
  return { name: file.originalName ?? 'belge', byteSize: file.byteSize }
}

/** Belge uyarıya ve uygunluğa sayılıyor mu (şimdiki sürücü, etkin personel, geçmiş değil). */
function isCounted(doc: TransportDocumentListRow): boolean {
  if (doc.supersededAt !== null) return false
  switch (doc.subjectKind) {
    case 'vehicle':
      return doc.vehiclePlate !== null
    case 'driver':
      return (
        doc.vehicleDriverName !== null &&
        isCurrentDriverDocument(doc.driverName, doc.vehicleDriverName)
      )
    case 'staff':
      return doc.staffActive === true
    default:
      return doc.subjectKind satisfies never
  }
}

/**
 * Yanıt görünümü (K-497): özel nitelikli türde (adli sicil, psikoteknik) yönetici dışındakine
 * dosya bilgisi dönmez (`restricted: true`). `counted: false` belge uyarıya sayılmaz (önceki
 * sürücünün, pasif personelin ya da arşivli aracın belgesi, yerine geçilen belge).
 */
function documentView(
  doc: TransportDocumentListRow,
  options: { today: string; warningDays: number; role: string; file: FileInfo },
) {
  const { status, daysLeft } = transportDocumentStatus(doc, options.today, options.warningDays)
  const restricted = isTransportDocumentRestricted(doc.documentType, options.role)
  return {
    id: doc.id,
    subject: doc.subjectKind,
    vehicleId: doc.vehicleId,
    vehiclePlate: doc.vehiclePlate,
    membershipId: doc.membershipId,
    subjectName: doc.subjectKind === 'driver' ? doc.driverName : doc.staffName,
    counted: isCounted(doc),
    documentType: doc.documentType,
    documentNumber: doc.documentNumber,
    licenseClass: doc.licenseClass,
    startDate: doc.startDate,
    endDate: doc.endDate,
    status,
    daysLeft,
    sensitive: isSensitiveTransportDocumentType(doc.documentType),
    restricted,
    hasFile: restricted ? null : doc.fileId !== null,
    file: restricted ? null : options.file,
    replacesId: doc.replacesId,
    supersededAt: doc.supersededAt,
    createdAt: doc.createdAt,
  }
}

async function documentBodies(
  db: Database,
  ctx: ServiceContext,
  rows: readonly TransportDocumentListRow[],
  warningDays: number,
) {
  const today = dayKey(ctx.now)
  return Promise.all(
    rows.map(async (doc) =>
      documentView(doc, {
        today,
        warningDays,
        role: ctx.actor.role,
        file: isTransportDocumentRestricted(doc.documentType, ctx.actor.role)
          ? null
          : await fileInfo(db, ctx.institutionId, doc.fileId),
      }),
    ),
  )
}

// --- Ayar ----------------------------------------------------------------------------------------

export function getTransportDocumentSettingsFor(ctx: ServiceContext) {
  return loadTransportDocumentSettings(ctx.db, ctx.institutionId)
}

/** Uyarı penceresi (K-498): `If-Match` ayar sürümü (hiç kaydedilmediyse 1). */
export function setTransportDocumentSettingsCommand(
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
      action: 'finance.transport.document_settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = transportDocumentSettingsSchema.parse(input)
        const current = await loadTransportDocumentSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planTransportDocumentSettings(current, parsed) }
      },
      after: async (tx, plan) => {
        const saved = await saveTransportDocumentSettings(tx, ctx.institutionId, {
          ...plan.next,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.transport.document_settings', entity, plan.changed)
        body = { data: await loadTransportDocumentSettings(tx, ctx.institutionId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Okuma ---------------------------------------------------------------------------------------

/** Belge listesi (K-496, K-497): bitişi yakın önce; `due` süzgeci yalnız sayılan belgelerde. */
export async function listTransportDocumentsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    subject?: TransportDocumentSubject | undefined
    vehicleId?: string | undefined
    membershipId?: string | undefined
    documentType?: TransportDocumentType | undefined
    due?: TransportDocumentDue | undefined
    history: boolean
  },
) {
  const today = dayKey(ctx.now)
  const { warningDays } = await loadTransportDocumentSettings(ctx.db, ctx.institutionId)
  const { items, total } = await listTransportDocuments(ctx.db, ctx.institutionId, {
    ...query,
    today,
    horizon: horizonOf(today, warningDays),
  })
  return { items: await documentBodies(ctx.db, ctx, items, warningDays), total, warningDays }
}

/**
 * Uyarı özeti ve araç uygunluğu (K-498): sayılan belgelerden süresi geçen ve uyarı penceresinde
 * biten belge sayısı; her etkin araç için süresi geçmiş ve yaklaşan zorunlu türler, eksik araç ve
 * sürücü türleri ve aracın etkin güzergâhları. Zorunlu belgesi süresi geçmiş araç `fit: false`
 * ("uygun değil"); atama engellenmez. Araçlar plakaya göre; kurumun araç sayısı sınırlı olduğu
 * için sayfalama yoktur.
 */
export async function getTransportDocumentAlertsFor(ctx: ServiceContext) {
  const today = dayKey(ctx.now)
  const { warningDays } = await loadTransportDocumentSettings(ctx.db, ctx.institutionId)
  const [documents, vehicles] = await Promise.all([
    loadCountedDocuments(ctx.db, ctx.institutionId),
    loadLiveVehicles(ctx.db, ctx.institutionId),
  ])
  const routes = await loadVehicleRoutes(
    ctx.db,
    ctx.institutionId,
    vehicles.map((vehicle) => vehicle.id),
  )
  const statuses = documents.map((doc) => transportDocumentStatus(doc, today, warningDays).status)
  const rows = vehicles.map((vehicle) => {
    const own = documents.filter((doc) => doc.vehicleId === vehicle.id)
    const fitness = vehicleFitness(
      own.filter((doc) => doc.subjectKind === 'vehicle'),
      own.filter((doc) => doc.subjectKind === 'driver'),
      today,
      warningDays,
    )
    return {
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      ...fitness,
      routes: routes
        .filter((route) => route.vehicleId === vehicle.id)
        .map(({ id, name, direction }) => ({ id, name, direction })),
    }
  })
  return {
    warningDays,
    expiredCount: statuses.filter((status) => status === 'expired').length,
    expiringCount: statuses.filter((status) => status === 'expiring').length,
    unfitVehicleCount: rows.filter((row) => !row.fit).length,
    missingVehicleCount: rows.filter(
      (row) => row.missingVehicleTypes.length > 0 || row.missingDriverTypes.length > 0,
    ).length,
    vehicles: rows,
  }
}

// --- Yazma ---------------------------------------------------------------------------------------

/**
 * Yeni belge (K-496, K-497): yerine geçilen belge aynı transaction'da geçmiş olur, dosya bağlanır.
 * `Idempotency-Key` rotada zorunlu. 201.
 */
export function createTransportDocumentCommand(
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
      action: 'finance.transport.document_create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = transportDocumentInputSchema.parse(input)
        const [vehicle, staff, file] = await Promise.all([
          parsed.subject === 'staff' || parsed.vehicleId === null
            ? undefined
            : findVehicle(tx, ctx.institutionId, parsed.vehicleId),
          parsed.subject === 'staff' ? memberCheck(tx, ctx, parsed.membershipId) : undefined,
          parsed.fileId === null ? undefined : findFile(tx, ctx.institutionId, parsed.fileId),
        ])
        const current =
          vehicle === null || staff === null
            ? []
            : await loadCurrentDocumentsOfType(
                tx,
                ctx.institutionId,
                {
                  kind: parsed.subject,
                  vehicleId: parsed.vehicleId,
                  membershipId: parsed.membershipId,
                },
                parsed.documentType,
              )
        return {
          run: () => ({
            parsed,
            plan: planTransportDocument(parsed, {
              vehicle,
              staff,
              file:
                file === undefined || file === null
                  ? file
                  : { mimeType: file.contentType, byteSize: file.byteSize },
              current,
              actorRole: ctx.actor.role,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        if (plan.supersedes !== null) {
          const done = await supersedeTransportDocument(tx, ctx.institutionId, {
            id: plan.supersedes,
            now: ctx.now,
          })
          if (!done) throw new ConflictError()
        }
        // Dosya satırdan önce bağlanır: başkasının, başka kurumun ya da hazır olmayan dosya yabancı
        // anahtar hatası yerine 422 `file_unavailable`, bağlı dosya 409 `file_already_attached`.
        if (parsed.fileId !== null)
          await attachFile(tx, ctx, {
            fileId: parsed.fileId,
            attachedType: ATTACHMENT,
            attachedId: id,
            dataSubjectId: null,
          })
        await insertTransportDocument(tx, ctx.institutionId, {
          id,
          subjectKind: parsed.subject,
          vehicleId: parsed.subject === 'staff' ? null : parsed.vehicleId,
          membershipId: parsed.subject === 'staff' ? parsed.membershipId : null,
          driverName: plan.driverName,
          documentType: parsed.documentType,
          documentNumber: parsed.documentNumber,
          licenseClass: parsed.licenseClass,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          fileId: parsed.fileId,
          replacesId: plan.supersedes,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (plan.supersedes !== null)
          await auditWork(
            tx,
            ctx,
            'finance.transport.document_supersede',
            { type: ENTITY, id: plan.supersedes },
            ['supersededAt'],
          )
        await auditWork(
          tx,
          ctx,
          'finance.transport.document_create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        const { warningDays } = await loadTransportDocumentSettings(tx, ctx.institutionId)
        const rows = await loadDocumentRows(
          tx,
          ctx.institutionId,
          plan.supersedes === null ? [id] : [id, plan.supersedes],
        )
        const views = await documentBodies(tx, ctx, rows, warningDays)
        const created = views.find((view) => view.id === id)
        if (created === undefined) throw new NotFoundError()
        body = {
          data: {
            document: created,
            superseded: views.find((view) => view.id === plan.supersedes) ?? null,
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
  transport_document_no_file: 'Bu belgeye dosya eklenmemiş.',
  transport_document_sensitive_forbidden:
    'Bu belge özel nitelikli kişisel veridir; dosyasını yalnız yönetici açar.',
} as const

/**
 * Belgenin dosyası için kısa ömürlü imzalı bağlantı (K-497). Özel nitelikli belgede yalnız
 * yönetici (ön büro 403). Üretim başarılı olunca `finance.transport.document_file_open` denetimi
 * yazılır; denetim yazılamazsa bağlantı dönmez.
 */
export async function transportDocumentFileUrl(
  ctx: ServiceContext,
  storage: StorageDriver,
  documentId: string,
) {
  const doc = await findTransportDocument(ctx.db, ctx.institutionId, documentId)
  if (doc === null) throw new NotFoundError()
  if (isTransportDocumentRestricted(doc.documentType, ctx.actor.role))
    throw new AppError(
      403,
      'transport_document_sensitive_forbidden',
      FILE_MESSAGES.transport_document_sensitive_forbidden,
    )
  if (doc.fileId === null)
    throw new RuleViolationError(
      'transport_document_no_file',
      FILE_MESSAGES.transport_document_no_file,
    )
  const opening: ServiceContext = { ...ctx }
  auditedOpens.add(opening)
  const link = await getFileUrl(opening, storage, doc.fileId)
  // kvkk: dosya adı ve içerik değil, yalnız açılan alanın adı.
  await auditWork(ctx.db, ctx, FILE_OPEN_ACTION, { type: ENTITY, id: doc.id }, ['fileId'])
  return { url: link.url, expiresAt: link.expiresAt }
}
