import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'

import type { FastifyBaseLogger } from 'fastify'

import {
  assertFileAllowed,
  FILE_PURPOSES,
  type FilePurpose,
  type FilePurposeRule,
} from '@kampus/school-core/content/taxonomy.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { moduleAvailableFor } from '@kampus/school-core/modules/collection-modules.ts'

import type { Database } from '../db/client.ts'
import {
  attachFileRow,
  detachFileRow,
  findFile,
  insertFile,
  listStaleUnattachedFiles,
  markFileDeleted,
  setFileStatus,
  storageQuotaSetting,
  usedStorageBytes,
  type StoredFile,
} from '../db/files.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RuleViolationError,
} from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { ModuleDisabledError } from '../plugins/modules.ts'
import { meterUpload, StreamLimitError } from '../storage/meter.ts'
import { storageKeyFor, type StorageDriver } from '../storage/storage.ts'
import { actorStudentConsent, actorStudentHasConsent } from './consents.ts'
import { contentTypeMismatch, detectContentType, dispositionFor } from './file-detection.ts'
import { FILE_PURPOSE_ACCESS, fileAttachmentKind } from './file-registry.ts'
import { requestFingerprint } from './idempotency.ts'
import { grantListeningPlay, listeningWindowMs } from './listening-plays.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse } from './operation-runner.ts'

/**
 * Dosya yükleme, erişim, bağlama ve temizlik (F3c2a; ADR 0003 karar 2–6, 13; DOM-KYN-004,
 * DOM-BEC-050, DOM-BEC-053, DOM-YTK-052).
 *
 * Yükleme akışla depoya gider; boyut ve SHA-256 aynı geçişte hesaplanır, tür içerikten bulunur.
 * Kota ve satır yazımı tek transaction'da, kurum kilidi altındadır: eşzamanlı iki yükleme kotayı
 * birlikte aşamaz. Veritabanı yazımı başarısız olursa depodaki nesne silinir.
 *
 * Dosya adı kişisel veri olabilir: log ve denetim kaydına girmez (yalnız alan adları yazılır).
 */

const ENTITY = 'file'
const MB = 1024 * 1024
const GB = 1024 * MB

/** Kurum ayarı yokken kota (ADR 0003 Açık soru 6-a: 50 GB, platform yöneticisi artırır). */
export const DEFAULT_STORAGE_QUOTA_BYTES = 50 * GB

/** Bağlanmamış dosyanın ömrü (karar 5). */
export const UNATTACHED_FILE_TTL_MS = 24 * 60 * 60 * 1000

/** Bağlanmamış dosya temizliğinin bir turda baktığı en çok dosya. */
export const PURGE_BATCH_SIZE = 500

/** Amacın en büyük sınırı: akış bu sınırda kesilir; türe özel sınır tespitten sonra denetlenir. */
export function uploadLimitBytes(purpose: FilePurpose): number {
  const rule: FilePurposeRule = FILE_PURPOSES[purpose]
  return Math.max(rule.maxBytes, ...Object.values(rule.maxBytesByMime ?? {}))
}

/** Bütün amaçların en büyüğü: multipart eklentisinin üst sınırı. */
export const MAX_UPLOAD_BYTES = Math.max(
  ...(Object.keys(FILE_PURPOSES) as FilePurpose[]).map(uploadLimitBytes),
)

export const FILE_MESSAGES = {
  file_too_large: 'Dosya bu amaç için izin verilen boyutu aşıyor.',
  file_empty: 'Dosya boş.',
  file_type_not_allowed: 'Bu dosya türü bu amaç için kabul edilmez.',
  file_type_mismatch: 'Dosyanın içeriği adındaki veya bildirilen türle uyuşmuyor.',
  storage_quota_exceeded: 'Kurumunuzun dosya depolama alanı doldu. Yöneticinize başvurun.',
  consent_required: 'Ses kaydı için gerekli onay bulunmuyor; görev yüz yüze değerlendirilecek.',
  file_processing: 'Dosya henüz işleniyor. Biraz sonra yeniden deneyin.',
} as const

export class FileTooLargeError extends AppError {
  constructor() {
    super(413, 'file_too_large', FILE_MESSAGES.file_too_large)
    this.name = 'FileTooLargeError'
  }
}

/** Yanıta giden dosya görünümü (`FileResponse`). */
export function fileView(row: StoredFile) {
  return {
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    durationMs: row.durationMs,
    originalName: row.originalName,
    attached: row.attachedId !== null,
    createdAt: row.createdAt.toISOString(),
    rowVersion: row.version,
  }
}

/** Amacın modülü kurumda var ve açık mı (`requireModule` ile aynı sıra: yok 404, kapalı 403). */
async function assertPurposeModule(
  db: Database,
  ctx: ServiceContext,
  purpose: FilePurpose,
): Promise<void> {
  const module = FILE_PURPOSE_ACCESS[purpose].module
  if (module === null) return
  const institution = await getInstitutionModules(db, ctx.institutionId)
  if (institution && !moduleAvailableFor(module, institution.type)) {
    ctx.log.info({ event: 'module.unavailable_denied', module })
    throw new NotFoundError()
  }
  if (institution?.modules[module] !== true) {
    ctx.log.info({ event: 'module.disabled_denied', module })
    throw new ModuleDisabledError()
  }
}

/**
 * Yüklemeden önceki denetim: modül, rol ve rıza. Akış başlamadan çağrılır; reddedilen istekte
 * depoya hiçbir şey yazılmaz.
 */
export async function assertCanUpload(ctx: ServiceContext, purpose: FilePurpose): Promise<void> {
  await assertPurposeModule(ctx.db, ctx, purpose)
  const access = FILE_PURPOSE_ACCESS[purpose]
  if (!(access.uploaders as readonly string[]).includes(ctx.actor.role)) {
    ctx.log.info({ event: 'file.upload_role_denied', purpose, role: ctx.actor.role })
    throw new ForbiddenError()
  }
  // Rıza gereken amaçta (konuşma kaydı) yükleyen öğrencinin kendi kaydı için geçerli rıza aranır:
  // 18 yaş altında velayet sahibi velinin, 18 ve üstünde öğrencinin kendi rızası; süresi dolmuş,
  // geri çekilmiş ya da etkin itirazlı rıza sayılmaz (karar 9, DOM-BEC-050, DOM-YTK-061). Rıza
  // yoksa görev yüz yüze değerlendirmeye düşer.
  const rule: FilePurposeRule = FILE_PURPOSES[purpose]
  if (rule.requiresConsent === true && !(await actorStudentHasConsent(ctx, 'speaking_recording'))) {
    ctx.log.info({ event: 'file.upload_consent_missing', purpose })
    throw new AppError(403, 'consent_required', FILE_MESSAGES.consent_required)
  }
}

export interface UploadInput {
  purpose: FilePurpose
  /** Multipart dosya akışı; servis sonuna kadar tüketir veya hata verir. */
  stream: Readable
  /** Multipart eklentisinin kendi sınırına takılıp akışı kestiyse `true` (yedek denetim). */
  truncated: () => boolean
  declaredMime: string | null
  /** Temizlenmiş özgün ad (`sanitizeFileName`). */
  fileName: string | null
  /** `Idempotency-Key` (zorunlu; özet içerikten hesaplanır). */
  idempotencyKey: string
  path: string
}

/**
 * Yüklemede tutulmayacak nesneyi siler. Silme hatası asıl hatayı (413, 422, veritabanı hatası)
 * örtmez; anahtarla loglanır (anahtar kişisel veri taşımaz, karar 4) ve nesne satırsız kalır.
 * TODO(F3c2-orphans): satırsız nesneler (silme hatası ya da nesne yazımıyla satır yazımı arasında
 * süreç çökmesi) yalnız satırları tarayan `purgeUnattachedFiles` ile bulunmaz. Sürücüye
 * `list(prefix)` eklenip kurum öneki (`<kurum>/`) altında satırı olmayan ve 24 saatten eski
 * nesneler periyodik işte (`src/jobs`, kurum başına) silinir (karar 5); KVKK silme başvurusu da bu
 * taramaya dayanır.
 */
async function discardObject(storage: StorageDriver, key: string, log: FastifyBaseLogger) {
  try {
    await storage.delete(key)
  } catch (error) {
    log.error({ event: 'file.discard_object_failed', storageKey: key, err: error })
  }
}

/** Akışı depoya yazar; sınır aşılırsa yarım nesne kalmaz ve 413 döner. */
async function storeStream(
  storage: StorageDriver,
  key: string,
  input: UploadInput,
  log: FastifyBaseLogger,
) {
  const metered = meterUpload(input.stream, uploadLimitBytes(input.purpose))
  try {
    await storage.put(key, metered.stream, { contentType: 'application/octet-stream' })
  } catch (error) {
    await discardObject(storage, key, log)
    if (error instanceof StreamLimitError) throw new FileTooLargeError()
    throw error
  }
  if (input.truncated()) {
    await discardObject(storage, key, log)
    throw new FileTooLargeError()
  }
  return metered.result()
}

/**
 * Dosya yükleme (ADR 0003 karar 2, 3; DOM-KYN-004). Sıra: modül/rol/rıza (akıştan önce) → akış
 * (boyut 413) → boş dosya 422 → içerikten tür (422 `file_type_not_allowed`/`file_type_mismatch`)
 * → türe özel boyut 413 → transaction: kota 422 `storage_quota_exceeded`, satır, denetim. Hata
 * olursa depodaki nesne silinir; aynı anahtarla tekrarlanan istek ilk yanıtı döndürür ve ikinci
 * nesne silinir.
 */
export async function uploadFile(
  ctx: ServiceContext,
  storage: StorageDriver,
  input: UploadInput,
): Promise<CommandResponse> {
  const { purpose } = input
  await assertCanUpload(ctx, purpose)
  const fileId = randomUUID()
  const storageKey = storageKeyFor({
    institutionId: ctx.institutionId,
    purpose,
    fileId,
    now: ctx.now,
  })
  const stored = await storeStream(storage, storageKey, input, ctx.log)
  let keep = false
  try {
    if (stored.byteSize === 0) throw new RuleViolationError('file_empty', FILE_MESSAGES.file_empty)
    const contentType = await detectContentType(stored.head)
    if (contentType === null)
      throw new RuleViolationError('file_type_not_allowed', FILE_MESSAGES.file_type_not_allowed)
    if (contentTypeMismatch(contentType, { mime: input.declaredMime, fileName: input.fileName }))
      throw new RuleViolationError('file_type_mismatch', FILE_MESSAGES.file_type_mismatch)
    try {
      assertFileAllowed(purpose, { contentType, byteSize: stored.byteSize })
    } catch (error) {
      if (error instanceof DomainError && error.code === 'file_too_large')
        throw new FileTooLargeError()
      if (error instanceof DomainError)
        throw new RuleViolationError(error.code, error.message, { cause: error })
      throw error
    }
    const out: { body?: unknown } = {}
    const fingerprint = requestFingerprint('POST', input.path, {
      purpose,
      contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      fileName: input.fileName,
    })
    const response = await runCommand<null>(
      ctx,
      {
        action: 'file.upload',
        collections: [],
        entity: { type: ENTITY, id: fileId },
        load: async (tx) => {
          // Kurum kilidi alınmış durumda (çalıştırıcı): eşzamanlı yüklemeler sırayla sayılır.
          const quota =
            (await storageQuotaSetting(tx, ctx.institutionId)) ?? DEFAULT_STORAGE_QUOTA_BYTES
          const used = await usedStorageBytes(tx, ctx.institutionId)
          if (used + stored.byteSize > quota)
            throw new RuleViolationError(
              'storage_quota_exceeded',
              FILE_MESSAGES.storage_quota_exceeded,
            )
          return { run: () => null }
        },
        after: async (tx) => {
          const row = await insertFile(
            tx,
            ctx.institutionId,
            {
              id: fileId,
              purpose,
              storageKey,
              contentType,
              byteSize: stored.byteSize,
              sha256: stored.sha256,
              originalName: input.fileName,
              uploadedByUserId: ctx.actor.userId,
            },
            ctx.now,
          )
          await audit(tx, ctx, 'file.upload', fileId, [
            'purpose',
            'contentType',
            'byteSize',
            'sha256',
            'originalName',
          ])
          out.body = { data: fileView(row) }
        },
      },
      () => {
        if (out.body === undefined) throw new Error('file was not written')
        return { statusCode: 201, body: out.body }
      },
      { key: input.idempotencyKey, fingerprint },
    )
    keep = !response.replayed
    ctx.log.info({
      event: 'file.uploaded',
      purpose,
      byteSize: stored.byteSize,
      replayed: response.replayed,
    })
    return response
  } finally {
    if (!keep) await discardObject(storage, storageKey, ctx.log)
  }
}

async function audit(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  fileId: string,
  fields: string[],
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: ENTITY,
    entityId: fileId,
    changes: { fields },
    createdAt: ctx.now,
  })
}

/**
 * Kişinin görebildiği dosya (karar 6). Bağlı dosya bağlı kaydın okuma kuralından geçer
 * (`FileAttachmentKind.canRead`); bağlanmamış dosyayı yalnız yükleyen görür. Yok, başka kurum,
 * silinmiş/reddedilmiş veya kapsam dışı 404; amacın modülü kapalıysa 403 `module_disabled`.
 * Sıra kapsam → modüldür: modül kapalıyken de kapsam dışı dosya 404 alır, 403 yalnız dosyayı
 * görebilecek kişiye döner (varlık ipucu verilmez).
 */
async function readableFile(
  tx: Database,
  ctx: ServiceContext,
  fileId: string,
): Promise<StoredFile> {
  const row = await findFile(tx, ctx.institutionId, fileId)
  if (!row || row.status === 'deleted' || row.status === 'rejected') throw new NotFoundError()
  if (row.attachedType === null || row.attachedId === null) {
    if (row.uploadedByUserId !== ctx.actor.userId) throw new NotFoundError()
  } else {
    const kind = fileAttachmentKind(row.attachedType)
    if (!kind || !kind.purposes.includes(row.purpose)) {
      ctx.log.error({ event: 'file.unknown_attachment', attachedType: row.attachedType })
      throw new NotFoundError()
    }
    if (!(await kind.canRead(tx, ctx, row.attachedId, row))) throw new NotFoundError()
  }
  // İşlemin bağlantısıyla: PGlite tek bağlantılıdır, `ctx.db` burada beklerdi.
  await assertPurposeModule(tx, ctx, row.purpose)
  return row
}

export async function getFile(ctx: ServiceContext, fileId: string) {
  return ctx.db.transaction(async (tx) => fileView(await readableFile(tx, ctx, fileId)))
}

/**
 * Kısa ömürlü imzalı indirme bağlantısı (karar 6). Tarama/dönüşüm sürerken (`processing`)
 * bağlantı verilmez (409 `file_processing`). Teslim ve konuşma kaydında her üretim
 * `file.access` olarak denetime yazılır (DOM-BEC-053, DOM-YTK-052).
 *
 * Dinleme kaydının bağlantısı kayıt süresi + 60 sn yaşar, en az 5 dk; süre ölçülmemişse 16 dk
 * (`listeningWindowMs`). Dinleme hakkı (IST-045, DOM-BEC-005) burada, bağlantıyla aynı
 * transaction'da sayılır (`grantListeningPlay`): hak bitince 422 `listening_plays_exhausted`, süren
 * deneme yokken açık görevde 422 `listening_attempt_required`. Yeniden bağlantı penceresinde bitiş
 * anı ilk sayımın bitişidir; imzalama başarısız olursa sayım da yazılmaz. Sayım bugün devrede
 * değildir: atama dolu hakkı reddeder (`TODO(dinleme-icerik-bagi)`).
 */
export async function getFileUrl(ctx: ServiceContext, storage: StorageDriver, fileId: string) {
  return ctx.db.transaction(async (tx) => {
    const row = await readableFile(tx, ctx, fileId)
    if (row.status === 'processing')
      throw new AppError(409, 'file_processing', FILE_MESSAGES.file_processing)
    const access = FILE_PURPOSE_ACCESS[row.purpose]
    const listening = await grantListeningPlay(tx, ctx, row)
    // Dinleme kaydının bağlantısı kaydın sonuna kadar yaşar (kayıt süresi + 60 sn, en az 5 dk).
    const ttlMs =
      row.purpose === 'listening_audio'
        ? listeningWindowMs(row.durationMs)
        : access.linkTtlSeconds * 1000
    const expiresAt = listening?.expiresAt ?? new Date(ctx.now.getTime() + ttlMs)
    const url = await storage.signedGetUrl(row.storageKey, {
      institutionId: row.institutionId,
      fileId: row.id,
      expiresAt,
      disposition: dispositionFor(row.contentType),
    })
    if (access.auditAccess) await audit(tx, ctx, 'file.access', row.id, [])
    return {
      url,
      expiresAt: expiresAt.toISOString(),
      listening:
        listening === null
          ? null
          : {
              attemptId: listening.attemptId,
              limit: listening.limit,
              used: listening.used,
              remaining: listening.remaining,
              counted: listening.counted,
            },
    }
  })
}

/**
 * İmzalı indirmenin hedefi (`disk` sürücüsü): belirteç yalnız kurum, dosya kimliği, bitiş ve
 * disposition taşır; ad ve tür buradan, `files` satırından okunur. Silinmiş veya reddedilmiş
 * dosya bulunmaz (404): bağlantı süresi içinde olsa da silinen dosya indirilemez.
 */
export async function findDownloadableFile(
  db: Database,
  institutionId: string,
  fileId: string,
): Promise<StoredFile | null> {
  const row = await findFile(db, institutionId, fileId)
  if (!row || row.status === 'deleted' || row.status === 'rejected') return null
  return row
}

export const ATTACH_MESSAGES = {
  file_unavailable: 'Eklenen dosya bulunamadı. Dosyayı yeniden yükleyin.',
  file_not_ready: 'Dosya henüz kullanıma hazır değil.',
  file_purpose_mismatch: 'Bu dosya bu kayda eklenemez.',
  file_already_attached: 'Bu dosya başka bir kayda eklenmiş.',
} as const

/**
 * Saklama sonu gelmiş (imhaya işaretli) dosya: `retention_until <= now`. Rıza geri çekilince
 * yüklenmiş kayda bu işaret düşer (DOM-YTK-059); dosya yeni rızadan sonra da bağlanamaz, imha işi
 * (`files.purge-expired`) siler.
 */
export function isPurgeDue(row: Pick<StoredFile, 'retentionUntil'>, now: Date): boolean {
  return row.retentionUntil !== null && row.retentionUntil.getTime() <= now.getTime()
}

/**
 * Dosyayı kayda bağlar (karar 5): bağlayan işlem (teslim, kaynak sürümü, soru; F4b4) kendi
 * transaction'ında çağırır. Dosya aynı kurumda, aynı yükleyicinin, `ready` ve bağsız olmalı;
 * amacı kayıt türünün kabul ettikleri arasında olmalı. Başkasının, olmayan ya da saklama sonu
 * gelmiş (imhaya işaretli, `isPurgeDue`) dosya ayırt edilmez (422 `file_unavailable`; kullanıcı
 * yeniden yükler).
 *
 * Rıza gereken amaçta (konuşma kaydı; karar 9, DOM-BEC-050, DOM-YTK-059, DOM-YTK-061) veri sahibi
 * çağırandan alınmaz (`dataSubjectId` yok sayılır): yükleyenin `student` bağlantısından türetilir
 * ve o öğrencinin geçerli rızası bağlama anında yeniden denetlenir. Rıza yoksa (yükleme sürerken
 * geri çekilmiş olabilir) 403 `consent_required` ve hiçbir kayıt değişmez.
 *
 * Saklama sonu (`retentionUntil`, karar 13) bağlayan işlem amaca ve kurum türüne göre hesaplayıp
 * verir (konuşma kaydında core `recordingRetentionUntil`, DOM-BEC-052); daha erken bir işaret
 * korunur. TODO(F3c2-retention): ödev ve el yazısı teslim dosyasının süresi (Açık soru 3)
 * doğrulanınca o işlemler de verir; o zamana kadar boş kalır ve imha işi onlara dokunmaz.
 */
export async function attachFile(
  tx: Database,
  ctx: ServiceContext,
  input: {
    fileId: string
    attachedType: string
    attachedId: string
    dataSubjectId: string | null
    retentionUntil?: Date | null
  },
): Promise<StoredFile> {
  const kind = fileAttachmentKind(input.attachedType)
  if (!kind) throw new Error(`unknown file attachment type: ${input.attachedType}`)
  const row = await findFile(tx, ctx.institutionId, input.fileId, { lock: true })
  if (
    !row ||
    row.uploadedByUserId !== ctx.actor.userId ||
    row.status === 'deleted' ||
    row.status === 'rejected'
  )
    throw new RuleViolationError('file_unavailable', ATTACH_MESSAGES.file_unavailable)
  if (!kind.purposes.includes(row.purpose))
    throw new RuleViolationError('file_purpose_mismatch', ATTACH_MESSAGES.file_purpose_mismatch)
  if (row.attachedId !== null)
    throw new AppError(409, 'file_already_attached', ATTACH_MESSAGES.file_already_attached)
  if (row.status !== 'ready')
    throw new RuleViolationError('file_not_ready', ATTACH_MESSAGES.file_not_ready)
  let dataSubjectId = input.dataSubjectId
  const rule: FilePurposeRule = FILE_PURPOSES[row.purpose]
  if (rule.requiresConsent === true) {
    const consent = await actorStudentConsent(tx, ctx, 'speaking_recording')
    if (!consent.valid || consent.studentId === null) {
      ctx.log.info({ event: 'file.attach_consent_missing', purpose: row.purpose })
      throw new AppError(403, 'consent_required', FILE_MESSAGES.consent_required)
    }
    dataSubjectId = consent.studentId
  }
  // Rıza denetiminden sonra: geri çekilmiş rıza 403 kalır, yeni rızayla eski işaretli kayıt 422.
  if (isPurgeDue(row, ctx.now))
    throw new RuleViolationError('file_unavailable', ATTACH_MESSAGES.file_unavailable)
  const updated = await attachFileRow(
    tx,
    ctx.institutionId,
    row,
    {
      type: input.attachedType,
      id: input.attachedId,
      dataSubjectId,
      retentionUntil: input.retentionUntil ?? null,
    },
    ctx.now,
  )
  if (!updated) throw new ConflictError()
  return updated
}

/**
 * Dosyanın kayıtla bağını kaldırır (karar 5'in tersi): bağlayan işlem kayıttan düşen dosya için
 * kendi transaction'ında çağırır (ör. yeniden teslimde çıkarılan dosya, DOM-AKD-072). Yalnız bu
 * kayda bağlı dosyanın bağı kalkar; olmayan, silinmiş ya da başka kayda bağlı dosyaya dokunulmaz
 * (eski kayıtta dosya kimliği `files` satırı olmadan da bulunabilir). Bağı kalkan dosya artık
 * kaydın okuma kuralıyla açılmaz, yalnız yükleyen görür; yeni bir imha işi yoktur, karar 5'in
 * bağlanmamış dosya temizliği (`purgeUnattachedFiles`, yüklemeden 24 saat sonra) siler.
 */
export async function detachFile(
  tx: Database,
  ctx: ServiceContext,
  input: { fileId: string; attachedType: string; attachedId: string },
): Promise<void> {
  const row = await findFile(tx, ctx.institutionId, input.fileId, { lock: true })
  if (!row || row.attachedType !== input.attachedType || row.attachedId !== input.attachedId) return
  if (!(await detachFileRow(tx, ctx.institutionId, row, ctx.now))) throw new ConflictError()
}

/**
 * Denetim sonucu (karar 7, 8): `pending`/`processing` dosya `ready` olur ya da reddedilir;
 * reddedilen dosyanın nesnesi silinir. Ret kaydı nesne silinmeden önce yazılır; nesne silinemezse
 * satır `rejected` kalır (indirilemez, kotaya sayılmaz), hata `file.reject_object_failed` olarak
 * yalnız kimliklerle loglanır ve asıl hata olduğu gibi fırlatılır (yutulmaz; çağıran iş hatayı
 * görür). Aynı dosya için ret yeniden bildirilirse (iş yeniden denemesi) durum ve denetim
 * değişmeden yalnız nesne silme yeniden çalışır; `ready` bildirimi 409 `file_already_checked`
 * kalır. Hiç yeniden denenmeyen nesne `TODO(F3c2-orphans)` taramasıyla silinir.
 * TODO(F3c2-scan): `file.scan` işi (ClamAV) ve `sharp` meta veri temizliği bu fonksiyonu çağırır
 * (OG-092). Kuyruk altyapısı `src/jobs`'tadır; iş, kurum başına zamanlanmış işten farklı olarak
 * yüklemeden sonra `{ institutionId, fileId }` yüküyle kuyruğa konur. O gelene kadar tarama
 * yoktur ve dosya `pending` kalır (yalnız yükleyen okur, bağlanamaz).
 */
export async function recordFileCheck(
  db: Database,
  storage: StorageDriver,
  input: {
    institutionId: string
    fileId: string
    outcome: 'ready' | 'rejected'
    now: Date
    log: FastifyBaseLogger
  },
): Promise<StoredFile> {
  const row = await db.transaction(async (tx) => {
    const current = await findFile(tx, input.institutionId, input.fileId, { lock: true })
    if (!current) throw new NotFoundError()
    // Yeniden deneme: önceki ret kaydı yazılmış ama nesne silinememişse durum ve denetim
    // değişmez, yalnız nesne silme yeniden çalışır (silme idempotenttir).
    if (current.status === 'rejected' && input.outcome === 'rejected') return current
    if (current.status !== 'pending' && current.status !== 'processing')
      throw new AppError(409, 'file_already_checked', 'Dosya zaten denetlendi.')
    const updated = await setFileStatus(tx, input.institutionId, current, input.outcome, input.now)
    if (!updated) throw new ConflictError()
    await tx.insert(auditLog).values({
      institutionId: input.institutionId,
      action: input.outcome === 'ready' ? 'file.ready' : 'file.reject',
      entityType: ENTITY,
      entityId: current.id,
      changes: { fields: ['status'] },
      createdAt: input.now,
    })
    return updated
  })
  if (row.status === 'rejected') {
    try {
      await storage.delete(row.storageKey)
    } catch (error) {
      // Dosya adı ve içerik loglanmaz; kimlikler kişisel veri taşımaz.
      input.log.error({
        event: 'file.reject_object_failed',
        institutionId: row.institutionId,
        fileId: row.id,
        err: error,
      })
      throw error
    }
  }
  return row
}

/**
 * Kurumun 24 saatte bağlanmayan (veya reddedilen) dosyalarının temizliği (karar 5, 13): nesne
 * silinir, satır `deleted` kalır ve özgün ad silinir; her dosya `file.purge` olarak denetime
 * yazılır. Satır kilitlenip `deleted` yazıldıktan sonra nesne silinir: aynı anda bağlanan dosyanın
 * nesnesi silinemez (bağlama da satırı kilitler ve `deleted` dosyayı reddeder). Nesne silinemezse
 * satır yine `deleted` kalır, hata loglanır (kimlik dışında bilgi yok). En çok `limit` dosyaya
 * bakar; silinen dosya sayısını döndürür. Saatlik `files.purge-unattached` işi
 * (`src/jobs/files-purge.ts`) kurum başına çağırır.
 */
export async function purgeUnattachedFiles(input: {
  db: Database
  storage: StorageDriver
  institutionId: string
  now: Date
  log: FastifyBaseLogger
  limit?: number
}): Promise<number> {
  const { db, storage, now, log } = input
  const before = new Date(now.getTime() - UNATTACHED_FILE_TTL_MS)
  const stale = await listStaleUnattachedFiles(
    db,
    input.institutionId,
    before,
    input.limit ?? PURGE_BATCH_SIZE,
  )
  let purged = 0
  for (const candidate of stale) {
    const done = await db.transaction(async (tx) => {
      const current = await findFile(tx, candidate.institutionId, candidate.id, { lock: true })
      // Bu arada bağlanan veya silinen dosyaya dokunulmaz.
      if (!current || current.attachedId !== null || current.status === 'deleted') return false
      if (!(await markFileDeleted(tx, current.institutionId, current, now))) return false
      await tx.insert(auditLog).values({
        institutionId: current.institutionId,
        action: 'file.purge',
        entityType: ENTITY,
        entityId: current.id,
        changes: { fields: ['status', 'deletedAt', 'originalName'] },
        createdAt: now,
      })
      return true
    })
    if (!done) continue
    purged += 1
    try {
      await storage.delete(candidate.storageKey)
    } catch (error) {
      log.error({
        event: 'file.purge_object_failed',
        institutionId: input.institutionId,
        fileId: candidate.id,
        err: error,
      })
    }
  }
  log.info({ event: 'file.purged', institutionId: input.institutionId, count: purged })
  return purged
}
