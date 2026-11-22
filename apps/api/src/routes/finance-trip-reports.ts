import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  TRIP_REPORT_AUTHOR_ROLES,
  TRIP_REPORT_FAMILY_ROLES,
  TRIP_REPORT_ROLES,
  tripEvaluationSchema,
  tripReportCreateSchema,
  tripReportPhotoSchema,
  tripReportPhotoUpdateSchema,
  tripReportReturnSchema,
  tripReportTransitionSchema,
  tripReportUpdateSchema,
} from '@kampus/school-core/lib/finance-trip-reports.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  addTripReportPhotoCommand,
  createTripEvaluationCommand,
  createTripReportCommand,
  getTripReportFor,
  listMyTripReportsFor,
  listTripReportsFor,
  removeTripReportPhotoCommand,
  transitionTripReportCommand,
  updateTripReportCommand,
  updateTripReportPhotoCommand,
} from '../services/finance-trip-reports.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  myTripReportsResponse,
  tripEvaluationResponse,
  tripReportListQuery,
  tripReportListResponse,
  tripReportParams,
  tripReportPhotoParams,
  tripReportResponse,
} from './finance-trip-reports.schemas.ts'

/**
 * Gezi sonrası rapor, rızalı fotoğraf ve katılımcı değerlendirmesi uçları (docs/domain/finans.md
 * DOM-FIN-158; ON-158; K-529…K-531; IST-017). Modül `finance`. Rapor yönetici, ön büro (okur) ve
 * planın görevlisi öğretmen (yazar; görevlisi olmadığı plan 404); onay ve iade yönetici. Aile
 * `GET /finance/trip-reports/my` ile yayımlanmış fotoğrafları görür, `POST /finance/trip-evaluations`
 * ile değerlendirir. Sıra: 401 → 403 modül → 403 rol → başlık → 400 → işlem. Açılış, fotoğraf ve
 * değerlendirme `Idempotency-Key`; düzeltme, geçiş ve fotoğraf düzeltme/kaldırma `If-Match` ister.
 */

const URL = '/api/v1/finance/trip-plans/:planId/report'
const READ =
  'Rol: `yonetici`, `onburo`, `ogretmen` (öğretmen yalnız görevlisi olduğu planı görür; değilse 404; K-529). Modül `finance`.'
const WRITE =
  'Rol: `yonetici`, `ogretmen` (planın görevlisi; değilse 404); ön büro 403 (K-529). Modül `finance`.'
const DECIDE = 'Rol: `yonetici` (K-529). Modül `finance`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceTripReportRoutes(app: FastifyInstance, storage: StorageDriver) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guard = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const readers = guard(TRIP_REPORT_ROLES)
  const writers = guard(TRIP_REPORT_AUTHOR_ROLES)
  const family = guard(TRIP_REPORT_FAMILY_ROLES)
  const tags = ['finance-trip-plans']
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })

  typed.get(
    '/api/v1/finance/trip-reports',
    {
      preValidation: readers,
      schema: {
        operationId: 'listTripReports',
        tags,
        summary: 'Gezi raporlarını listele',
        description: `Biten geziler (onaylı plan dönüş anı geçmiş ya da tamamlanmış) ve raporlarının durumu: \`missing\` (yazılmadı), \`draft\`, \`submitted\`, \`approved\`, \`returned\`. Onay bekleyenler önce, sonra yeni dönüş önce. Satır rapor metni taşımaz; fotoğraf ve değerlendirme sayısı vardır. Öğretmen yalnız görevlisi olduğu planları görür. ${READ}`,
        querystring: tripReportListQuery,
        response: { 200: tripReportListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status } = request.query
      const { items, total } = await listTripReportsFor(contextOf(request), {
        page,
        pageSize,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/trip-reports/my',
    {
      preValidation: family,
      schema: {
        operationId: 'listMyTripReports',
        tags,
        summary: 'Çocuğumun gezi fotoğrafları ve değerlendirmesi',
        description:
          'Veli bağlı çocuklarının, öğrenci kendinin katıldığı (kapanan yoklama turunda "var") ve dönüşü son bir yıl içinde biten geziler: onaylı raporun yayımlanmış fotoğrafları ve değerlendirme durumu (dönüşten 30 gün açık, gezi başına bir kez). Fotoğraf yayımı okuma anında hesaplanır: etiketli herkesin geçerli `photo_video_sharing` rızası yoksa ya da rıza geri çekildiyse fotoğraf dönmez (K-530, IST-017). Etiket, rıza durumu, rapor metni ve başka ailelerin yanıtları dönmez. Rol: `veli`, `ogrenci`. Modül `finance`.',
        response: { 200: myTripReportsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyTripReportsFor(contextOf(request), storage) }),
  )

  typed.post(
    '/api/v1/finance/trip-evaluations',
    {
      preValidation: [...family, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTripEvaluation',
        tags,
        summary: 'Geziyi değerlendir',
        description:
          'Geziye katılan öğrenci (kendisi) ya da velisi (çocuğu için) 1–5 puan ve isteğe bağlı yorum (≤ 500) verir; gezide kişi başına bir kez (409 `trip_evaluation_exists`). Kapsam dışı öğrenci ya da gezi 404 `trip_evaluation_student_not_found`; katılmayan 422 `trip_evaluation_not_attended`; gezi bitmeden 422 `trip_evaluation_not_open`, dönüşten 30 gün sonra 422 `trip_evaluation_closed`. Yorum personele ad ve rol olmadan, en az 5 yanıtta gösterilir (K-531). Değerlendirme değişmez. Denetim `finance.trip_evaluation.create` (puan ve yorum yazılmaz). `Idempotency-Key` zorunlu; başarı 201. Rol: `veli`, `ogrenci`. Modül `finance`.',
        headers: createHeaders,
        body: tripEvaluationSchema,
        response: { 201: tripEvaluationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTripEvaluationCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripEvaluationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    URL,
    {
      preValidation: readers,
      schema: {
        operationId: 'getTripReport',
        tags,
        summary: 'Gezi raporu',
        description: `Plan özeti, rapor (yoksa \`null\` ve \`canCreate\`), bağlı kaza tutanakları (yalnız an, tür, yer, durum; ayrıntı tutanaktadır), fotoğraflar (etiketli öğrenci ve rıza var/yok, yayım durumu okuma anında; imzalı geçici bağlantı), katılım (gezi günü yoklamasından; gönderimde dondurulur) ve değerlendirme özeti (5'ten az yanıtta gizli, yorum adsız). Raporu yazabilene etiket ve tutanak seçenekleri döner. Olmayan ya da başka kurumun planı 404. ${READ}`,
        params: tripReportParams,
        response: { 200: tripReportResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getTripReportFor(contextOf(request), request.params.planId, storage),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...writers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTripReport',
        tags,
        summary: 'Gezi raporu aç',
        description: `Biten gezi için taslak açar: gerçekleşme özeti, olay notu, kaza tutanağı bağları (en çok 10; kurumda değilse 422 \`trip_report_incident_not_found\`, olay anı gezi dışında 422 \`trip_report_incident_outside_trip\`) ve kazanım/değerlendirme; metinler taslakta boş kalabilir. Plan onaylı ya da tamamlanmış olmalı (422 \`trip_report_plan_not_eligible\`) ve gezi bitmiş olmalı (422 \`trip_report_trip_not_finished\`); planın raporu varsa 409 \`trip_report_exists\`. Denetim \`finance.trip_report.create\` (alan adları). \`Idempotency-Key\` zorunlu; başarı 201. ${WRITE}`,
        headers: createHeaders,
        params: tripReportParams,
        body: tripReportCreateSchema,
        response: { 201: tripReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTripReportCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    URL,
    {
      preValidation: [...writers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTripReport',
        tags,
        summary: 'Gezi raporunu düzelt',
        description: `Verilen alanlar değişir; yalnız taslak ve iade edilmiş rapor (422 \`trip_report_locked\`; onaylanan rapor değişmez). Değişiklik yoksa 422 \`trip_report_unchanged\`. Tutanak bağları bütün olarak yazılır. Denetim \`finance.trip_report.update\`. \`If-Match\` raporun sürümü; tutmazsa 409. ${WRITE}`,
        headers: versionHeaders,
        params: tripReportParams,
        body: tripReportUpdateSchema,
        response: { 200: tripReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateTripReportCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripReportResponse.parse(sendBody(reply, result))
    },
  )

  const transition = (
    verb: 'submit' | 'approve' | 'return',
    meta: { operationId: string; summary: string; description: string },
  ) =>
    typed.post(
      `${URL}/${verb}`,
      {
        preValidation: [
          ...(verb === 'submit' ? writers : guard(['yonetici'])),
          requireIfMatch(),
          captureInput(),
        ],
        schema: {
          ...meta,
          tags,
          headers: versionHeaders,
          params: tripReportParams,
          body: verb === 'return' ? tripReportReturnSchema : tripReportTransitionSchema,
          response: { 200: tripReportResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await transitionTripReportCommand(
          contextOf(request),
          request.params.planId,
          verb,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return tripReportResponse.parse(sendBody(reply, result))
      },
    )

  transition('submit', {
    operationId: 'submitTripReport',
    summary: 'Gezi raporunu onaya gönder',
    description: `Taslak ya da iade edilmiş rapor onaya gider; gerçekleşme özeti ve kazanım metni en az 20 karakter olmalı (422 \`trip_report_incomplete\`). Katılan ve katılmayan sayısı gezi günü yoklamasının kapanan turlarından dondurulur; önceki iade gerekçesi düşer. Gövde boş nesnedir. Denetim \`finance.trip_report.submit\`. \`If-Match\` raporun sürümü. ${WRITE}`,
  })
  transition('approve', {
    operationId: 'approveTripReport',
    summary: 'Gezi raporunu onayla',
    description: `Onay bekleyen raporu onaylar (değilse 422 \`trip_report_not_submitted\`); onaylanan rapor, tutanak bağları ve fotoğrafları değişmez (veritabanında tetikleyici). Rızası tam fotoğraflar ailelere yayımlanır. Gövde boş nesnedir. Denetim \`finance.trip_report.approve\`. \`If-Match\` raporun sürümü. ${DECIDE}`,
  })
  transition('return', {
    operationId: 'returnTripReport',
    summary: 'Gezi raporunu iade et',
    description: `Onay bekleyen raporu gerekçeyle (5–500) iade eder (değilse 422 \`trip_report_not_submitted\`); yazan düzeltip yeniden gönderir. Gerekçe denetime ve loga yazılmaz. Denetim \`finance.trip_report.return\`. \`If-Match\` raporun sürümü. ${DECIDE}`,
  })

  typed.post(
    `${URL}/photos`,
    {
      preValidation: [...writers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'addTripReportPhoto',
        tags,
        summary: 'Gezi raporuna fotoğraf ekle',
        description: `\`POST /files\` ile \`question_image\` amacıyla yüklenmiş (jpg/png/webp, 2 MB; yükleme \`learning\` modülü ister) ve taramadan geçmiş dosyayı rapora bağlar. Görünen öğrenciler etiketlenir (gezinin katılımcısı; değilse 422 \`trip_report_photo_student_not_participant\`) ya da \`noStudentsVisible\` işaretlenir (ikisi birden ya da hiçbiri 400). \`shareWithFamilies\` aileye yayım isteğidir; yayım yalnız rapor onaylı ve etiketli herkesin geçerli \`photo_video_sharing\` rızası varken olur, rızası olmayan öğrencinin fotoğrafı iç arşivde kalır (K-530, IST-017). Yalnız düzeltilebilir rapor (422 \`trip_report_locked\`); en çok 20 fotoğraf (422 \`trip_report_photos_full\`); başkasının dosyası ya da bağlı dosya 422/409. Denetim \`finance.trip_report.photo_add\`. \`Idempotency-Key\` zorunlu; başarı 201. ${WRITE}`,
        headers: createHeaders,
        params: tripReportParams,
        body: tripReportPhotoSchema,
        response: { 201: tripReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await addTripReportPhotoCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${URL}/photos/:photoId`,
    {
      preValidation: [...writers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTripReportPhoto',
        tags,
        summary: 'Fotoğrafın etiketini ve yayım isteğini düzelt',
        description: `Verilen alanlar değişir (açıklama, etiketler, \`noStudentsVisible\`, \`shareWithFamilies\`); etiket kuralı birleşik değerde denetlenir (422 \`trip_report_photo_tags_required\`). Değişiklik yoksa 422 \`trip_report_photo_unchanged\`; yalnız düzeltilebilir rapor. Denetim \`finance.trip_report.photo_update\`. \`If-Match\` fotoğrafın sürümü. ${WRITE}`,
        headers: versionHeaders,
        params: tripReportPhotoParams,
        body: tripReportPhotoUpdateSchema,
        response: { 200: tripReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateTripReportPhotoCommand(
        contextOf(request),
        request.params.planId,
        request.params.photoId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${URL}/photos/:photoId`,
    {
      preValidation: [...writers, requireIfMatch()],
      schema: {
        operationId: 'removeTripReportPhoto',
        tags,
        summary: 'Fotoğrafı rapordan kaldır',
        description: `Fotoğraf ve etiketleri arşivlenir, dosya bağı çözülür; yalnız düzeltilebilir rapor (422 \`trip_report_locked\`). Denetim \`finance.trip_report.photo_remove\`. \`If-Match\` fotoğrafın sürümü. ${WRITE}`,
        headers: versionHeaders,
        params: tripReportPhotoParams,
        response: { 200: tripReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await removeTripReportPhotoCommand(
        contextOf(request),
        request.params.planId,
        request.params.photoId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripReportResponse.parse(sendBody(reply, result))
    },
  )
}
