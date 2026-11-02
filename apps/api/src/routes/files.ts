import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES, ValidationError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { DOWNLOAD_PATH, type DiskStorage } from '../storage/disk.ts'
import { contentDisposition, sanitizeFileName } from '../services/file-detection.ts'
import {
  findDownloadableFile,
  getFile,
  getFileUrl,
  MAX_UPLOAD_BYTES,
  uploadFile,
} from '../services/files.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandHeadersSchema } from './commands.schemas.ts'
import {
  downloadErrors,
  fileDownloadQuerySchema,
  fileParamsSchema,
  filePurposeSchema,
  fileReadErrors,
  fileUrlErrors,
  fileResponseSchema,
  fileUploadBodySchema,
  fileUrlResponseSchema,
  uploadErrors,
} from './files.schemas.ts'

/**
 * Dosya uçları (F3c2a; ADR 0003 karar 2–6; DOM-KYN-004, DOM-BEC-053). Yükleme, dosya bilgisi,
 * imzalı bağlantı ve `disk` sürücüsünün imzalı indirme ucu. Amaca göre rol ve modül serviste
 * denetlenir (`FILE_PURPOSE_ACCESS`); rota yalnız oturumlu kurum üyesini ister.
 */

const ALL_ROLES: readonly Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']

const LINK_MESSAGES = {
  link_expired: 'İndirme bağlantısının süresi doldu. Dosyayı yeniden açın.',
  invalid_signature: 'İndirme bağlantısı geçersiz.',
} as const

const UPLOAD_ACCESS =
  'Roller amaca göre: `submission` ve `speaking_recording` öğrenci; `material`, `question_image`, `listening_audio` yönetici ve öğretmen (modül `learning`, kapalıysa 403 `module_disabled`); `document` yönetici ve ön büro. Diğer roller 403.'

const READ_ACCESS =
  'Bağlı dosya bağlı kaydın okuma kuralından geçer (ADR 0003 karar 6); bağlanmamış dosyayı yalnız yükleyen görür. Kaynak sürümüne bağlı dosyayı (materyal, dinleme kaydı, soru görseli; DOM-KYN-006) dosyaya bağ açan sürümlerden birini okuyabilen görür: öğrenci ve veli yalnız kendisine paylaşılmış yayındaki sürümün dosyasını. O sürümlerden birine (soru görselinde soruyu içeren quize) atanmış görevi gören de açar (DOM-YTK-028). Kaldırılan kaynağa bağlı dosya kopyalar ve görevler dahil hiçbir yoldan açılmaz (DOM-KYN-051). Yok, başka kurum, silinmiş veya kapsam dışı 404; amacın modülü kapalıysa 403 `module_disabled`.'

export function registerFileRoutes(app: FastifyInstance, storage: DiskStorage) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const member = [app.requireRole(ALL_ROLES)]

  typed.post(
    '/api/v1/files',
    {
      preValidation: member,
      schema: {
        operationId: 'uploadFile',
        tags: ['files'],
        summary: 'Dosya yükle',
        description: `Tek dosya, \`multipart/form-data\`: önce \`purpose\`, sonra \`file\` alanı (DOM-KYN-004; ADR 0003 karar 2, 3). Dosya akışla depoya yazılır; boyut ve SHA-256 aynı geçişte hesaplanır. Tür içerikten (sihirli bayt) bulunur: amaçta olmayan tür 422 \`file_type_not_allowed\`, bildirilen tür veya ad uzantısı içerikle çelişirse 422 \`file_type_mismatch\`, boş dosya 422 \`file_empty\`. Amacın (türe özel) boyut sınırı aşılırsa akış kesilir, nesne silinir, 413 \`file_too_large\`. Kurum kotası aşılırsa 422 \`storage_quota_exceeded\`. Konuşma kaydı yükleyen öğrencinin kendi kaydı için geçerli rıza ister (18 yaş altında velayet sahibi velinin, 18 ve üstünde kendi rızası; geri çekilmiş, süresi dolmuş ya da itirazlı rıza sayılmaz): yoksa 403 \`consent_required\` (DOM-BEC-050, DOM-YTK-061). Multipart olmayan gövde 415. Tarayıcı açıkken (üretimde zorunlu) ses dışı dosya \`processing\` başlar: \`file.scan\` işi ClamAV ile tarar, temiz dosya \`ready\` olur, zararlı dosya \`rejected\` olur ve silinir; tarayıcıya ulaşılamazsa dosya \`processing\` kalır ve tarama yeniden denenir (ADR 0003 karar 8). Tarayıcı kapalıyken (\`FILE_SCANNER=off\`, yalnız üretim dışı) dosya \`pending\` kalır ve bağlanamaz. Bağlanmayan dosya 24 saat sonra silinir. Ses (\`speaking_recording\`, \`listening_audio\`) \`processing\` başlar: \`media.transcode\` işi AAC-LC/M4A'ya (mono, 48 kHz) çevirir, süreyi (\`durationMs\`) ölçer ve dosyayı \`ready\` yapar (tür \`audio/mp4\` olur); boş, tamamen sessiz, çözülemeyen ya da sınırı aşan kayıt \`rejected\` olur (ADR 0003 karar 10). İşlenirken bağlantı 409 \`file_processing\`; istemci durumu \`GET /files/{fileId}\` ile izler. Kurum kimliği oturumdan gelir. \`Idempotency-Key\` zorunlu (aynı anahtar + aynı içerik ilk yanıtı tekrarlar); \`If-Match\` desteklenmez. Başarı 201 ve dosyanın \`Location\`'ı. Özgün ad log ve denetim kaydına yazılmaz. ${UPLOAD_ACCESS}`,
        consumes: ['multipart/form-data'],
        body: fileUploadBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: fileResponseSchema, ...uploadErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const idempotency = idempotencyOf(request, true)
      if (idempotency === null) throw new Error('idempotency key is required')
      if (!request.isMultipart())
        throw new AppError(415, 'unsupported_media_type', MESSAGES.unsupported_media_type)
      const part = await request.file({
        limits: { files: 1, fields: 2, parts: 3, fieldSize: 100, fileSize: MAX_UPLOAD_BYTES + 1 },
      })
      if (!part) throw invalidPart(['file'], 'Dosya gerekli.')
      const purposeField = part.fields['purpose']
      const purposeValue =
        purposeField && !Array.isArray(purposeField) && purposeField.type === 'field'
          ? purposeField.value
          : undefined
      const purpose = filePurposeSchema.safeParse(purposeValue)
      if (!purpose.success) {
        part.file.resume()
        throw invalidPart(['purpose'], 'Dosya amacı geçersiz veya dosyadan sonra gönderildi.')
      }
      const result = await uploadFile(
        contextOf(request),
        storage,
        {
          purpose: purpose.data,
          stream: part.file,
          truncated: () => part.file.truncated,
          declaredMime: part.mimetype || null,
          fileName: sanitizeFileName(part.filename),
          idempotencyKey: idempotency.key,
          path: '/api/v1/files',
        },
        { transcode: app.media.scheduler, scan: app.fileScan.scheduler },
      )
      if (result.replayed) reply.header('idempotent-replayed', 'true')
      // Yalnız başarılı (201) yanıt saklanır; tekrar da 201 döner.
      reply.status(201)
      // Tekrarlanan yanıt veritabanından gelir; biçim dışıysa 500 olur, istemciye gitmez.
      const body = fileResponseSchema.parse(result.body)
      reply.header('location', `/api/v1/files/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/files/:fileId',
    {
      preValidation: member,
      schema: {
        operationId: 'getFile',
        tags: ['files'],
        summary: 'Dosya bilgisi',
        description: `Dosyanın meta verisi ve durumu (ADR 0003 karar 4). ${READ_ACCESS}`,
        params: fileParamsSchema,
        response: { 200: fileResponseSchema, ...fileReadErrors },
      },
    },
    async (request) => ({ data: await getFile(contextOf(request), request.params.fileId) }),
  )

  typed.get(
    '/api/v1/files/:fileId/url',
    {
      preValidation: member,
      schema: {
        operationId: 'getFileUrl',
        tags: ['files'],
        summary: 'İmzalı indirme bağlantısı',
        description: `Kısa ömürlü imzalı GET bağlantısı (ADR 0003 karar 6): varsayılan 5 dk, konuşma kaydında 2 dk, dinleme kaydında kayıt süresi + 60 sn (en az 5 dk; süre ölçülmemişse 16 dk). Tür ve \`Content-Disposition\` (belge \`attachment\`, görsel/ses/görüntü \`inline\`) imzaya dahildir. Dosya işlenirken 409 \`file_processing\`. Teslim ve konuşma kaydında her bağlantı üretimi denetim kaydına \`file.access\` olarak yazılır (DOM-BEC-053, DOM-YTK-052). Dinleme hakkı altyapısı (IST-045, DOM-BEC-005; bugün devrede değil, atama dolu hakkı 422 \`listening_plays_unavailable\` ile reddeder): öğrenci, hakkı sınırlı atamanın içerik sürümüne bağlı \`listening_audio\` kaydını süren denemesinde istediğinde hak deneme × kayıt başına sayılır ve yanıtın \`listening\` alanında döner; hak bitince 422 \`listening_plays_exhausted\`, süren deneme yokken teslimi açık görevde 422 \`listening_attempt_required\`. Son sayımın bağlantısı geçerliyken yeni istek sayılmaz, aynı bitiş anıyla bağlantı döner; aralık istekleri sayılmaz. Öğretmen, yönetici ve veli bağlantısı, sınırsız atamanın denemesi ve teslim kapandıktan sonraki bağlantı sayılmaz. ${READ_ACCESS}`,
        params: fileParamsSchema,
        response: { 200: fileUrlResponseSchema, ...fileUrlErrors },
      },
    },
    async (request) => ({
      data: await getFileUrl(contextOf(request), storage, request.params.fileId),
    }),
  )

  // Oturum istemez: bağlantı `<img>`/`<audio>` ve indirmede doğrudan açılır; yetki imzadadır.
  typed.get(
    DOWNLOAD_PATH,
    {
      schema: {
        operationId: 'downloadFile',
        tags: ['files'],
        summary: 'İmzalı indirme (disk sürücüsü)',
        description:
          '`disk` sürücüsünde `GET /api/v1/files/{fileId}/url` bağlantısının hedefi; oturum istemez, yetki HMAC imzasındadır. Süresi geçmiş bağlantı 403 `link_expired`, bozuk veya değiştirilmiş bağlantı 403 `invalid_signature`, silinmiş veya reddedilmiş dosya ve silinmiş nesne 404. Bağlantı özgün adı taşımaz (KVKK: URL vekil loguna ve tarayıcı geçmişine girer); ad ve tür dosya kaydından okunur. Yanıt dosyanın kendisidir (`Cache-Control: no-store`); `Cross-Origin-Resource-Policy: cross-origin` ile web başka kökenden `<img>`/`<audio>` olarak gömebilir.',
        querystring: fileDownloadQuerySchema,
        response: {
          200: z.unknown().describe('Dosya içeriği (ikili; türü `Content-Type` başlığında)'),
          ...downloadErrors,
        },
      },
    },
    async (request, reply) => {
      const check = storage.verify(request.query.token, app.clock())
      if (!check.ok) {
        const code = check.reason === 'expired' ? 'link_expired' : 'invalid_signature'
        request.log.info({ event: 'file.download_denied', reason: check.reason })
        throw new AppError(403, code, LINK_MESSAGES[code])
      }
      const { object } = check
      const row = await findDownloadableFile(app.db, object.institutionId, object.fileId)
      const opened = row ? await storage.open(row.storageKey) : null
      if (!row || !opened) throw new AppError(404, 'not_found', MESSAGES.not_found)
      // Helmet varsayılanı `Cross-Origin-Resource-Policy: same-origin`; bağlantı API kökeninde
      // üretilir, web başka kökenden `<img>`/`<audio>` ile açar. Yetki imzadadır (S3 ön imzalı
      // bağlantısı da CORP göndermez); CORP burada yalnız gömmeyi engellerdi.
      reply
        .header('cross-origin-resource-policy', 'cross-origin')
        .header('content-type', row.contentType)
        .header('content-length', String(opened.byteSize))
        .header('content-disposition', contentDisposition(object.disposition, row.originalName))
      return reply.send(opened.stream)
    },
  )
}

function invalidPart(path: string[], message: string): ValidationError {
  return new ValidationError([{ path: ['body', ...path], code: 'invalid_value', message }])
}
