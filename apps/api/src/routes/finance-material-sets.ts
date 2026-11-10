import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cancelMaterialDeliverySchema,
  MATERIAL_DELIVERY_CANCEL_ROLES,
  MATERIAL_DELIVERY_ROLES,
  MATERIAL_SET_MANAGE_ROLES,
  MATERIAL_SET_READ_ROLES,
  materialDeliverySchema,
  materialSetSchema,
  updateMaterialSetSchema,
} from '@kampus/school-core/lib/finance-material-sets.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelMaterialDeliveryCommand,
  createMaterialDeliveryCommand,
  createMaterialSetCommand,
  getMaterialDeliveryFor,
  getMaterialSetFor,
  listMaterialRecipientsFor,
  listMaterialSetsFor,
  listMaterialStudentsFor,
  materialStudentsCsvFor,
  signMaterialDeliveryCommand,
  updateMaterialSetCommand,
} from '../services/finance-material-sets.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  materialDeliveryParams,
  materialDeliveryResponse,
  materialRecipientQuery,
  materialRecipientResponse,
  materialSetListQuery,
  materialSetListResponse,
  materialSetParams,
  materialSetResponse,
  materialStudentListResponse,
  materialStudentQuery,
} from './finance-material-sets.schemas.ts'

/**
 * Materyal seti uçları (docs/domain/finans.md DOM-FIN-080; ON-232). Modül `finance`. Okuma, teslim
 * ve imza işareti yönetici ve ön büro; set tanımı ve teslim iptali yalnız yönetici (K-205). Sıra:
 * 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Öğrenci listesi CSV'si öğrenci adı taşıdığı
 * için taze oturum ister, kullanıcı başına dakikada 10 dosyadır ve denetime düşer.
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-205). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-205). Modül `finance`.'
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceMaterialSetRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-inventory']
  const SETS = '/api/v1/finance/material-sets'
  const DELIVERIES = '/api/v1/finance/material-deliveries'

  typed.get(
    SETS,
    {
      preValidation: guarded(MATERIAL_SET_READ_ROLES),
      schema: {
        operationId: 'listMaterialSets',
        tags,
        summary: 'Materyal setlerini listele',
        description: `Yeni eğitim yılı önce, aynı yılda ada göre; pasifler dahil. Her satır kalem sayısını, hedefteki etkin öğrenci ile teslim alan öğrencilerin sayısını ve iptal edilmemiş teslim sayısını taşır (DOM-FIN-080). ${READERS}`,
        querystring: materialSetListQuery,
        response: { 200: materialSetListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listMaterialSetsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    SETS,
    {
      preValidation: [...guarded(MATERIAL_SET_MANAGE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createMaterialSet',
        tags,
        summary: 'Materyal seti tanımla',
        description: `Ad (eğitim yılında tekil: 409 \`material_set_name_exists\`), eğitim yılı, isteğe bağlı hedef (okulda \`gradeLevel\` 5–12, dil okulunda \`courseId\`; kurum türüne uymazsa 422 \`material_set_target_unavailable\`, kur yoksa 422 \`material_set_course_not_found\`) ve 1–30 kalem (etkin stok kartı ve öğrenci başına 1–100 adet; kart bir kez). Pasif ya da olmayan kart 422 \`stock_item_inactive\`, \`stock_item_not_found\` (DOM-FIN-080). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: materialSetSchema,
        response: { 201: materialSetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMaterialSetCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = materialSetResponse.parse(sendBody(reply, result))
      reply.header('location', `${SETS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${SETS}/:setId`,
    {
      preValidation: guarded(MATERIAL_SET_READ_ROLES),
      schema: {
        operationId: 'getMaterialSet',
        tags,
        summary: 'Materyal seti ayrıntısı',
        description: `Set, kalemleri (stok kartı, birim, adet) ve sayılar. Olmayan ya da başka kurumun seti 404. ${READERS}`,
        params: materialSetParams,
        response: { 200: materialSetResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getMaterialSetFor(contextOf(request), request.params.setId),
    }),
  )

  typed.patch(
    `${SETS}/:setId`,
    {
      preValidation: [...guarded(MATERIAL_SET_MANAGE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateMaterialSet',
        tags,
        summary: 'Materyal setini düzelt ya da pasifleştir',
        description: `Kısmi düzeltme. Ad, kalemler ve durum her zaman değişir; kalemler bütün olarak yeniden yazılır, önceki teslimler kendi kalemlerini korur. İptal edilmemiş teslimi olan setin eğitim yılı ve hedefi değişmez (422 \`material_set_has_deliveries\`, K-208). Pasif sete teslim yazılmaz. Sürüm tutmazsa 409 \`version_conflict\`; \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: materialSetParams,
        body: updateMaterialSetSchema,
        response: { 200: materialSetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateMaterialSetCommand(
        contextOf(request),
        request.params.setId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return materialSetResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${SETS}/:setId/students`,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `material-set-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...guarded(MATERIAL_SET_READ_ROLES), freshForCsv],
      schema: {
        operationId: 'listMaterialSetStudents',
        tags,
        summary: 'Setin teslim edilen ve edilmeyen öğrencileri',
        description: `Setin hedefindeki (sınıf düzeyi, kur; hedefsizse bütün) etkin öğrenciler ile seti teslim almış öğrenciler, ada göre. Satırda öğrenci adı, numarası, sınıfı, setin yılında kitap ve kırtasiye ücret kalemi olup olmadığı (\`hasMaterialFee\`; ödeme durumu değil, K-207), iptal edilmemiş teslim ve bu setteki son iptal edilmiş teslim (\`cancelledDelivery\`; iptal tutanağı, K-218). Kura bağlı sette sınıf yerine o kurun grubu, sınıfsız öğrencide etkin kur grupları yazılır. Durum, ücret kalemi, imza ve ad/numara aramasıyla süzülür. \`Accept: text/csv\` ile süzgeçle eşleşen bütün satırlar CSV iner (\`;\` ayırıcı, UTF-8 BOM, formül kaçışı); taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.material_set_export\` (K-209). Olmayan ya da başka kurumun seti 404. ${READERS}`,
        params: materialSetParams,
        querystring: materialStudentQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: materialStudentListResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { page, pageSize, ...filters } = request.query
      if (wantsCsv(request)) {
        const { csv, filename } = await materialStudentsCsvFor(ctx, request.params.setId, filters)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      const { items, total } = await listMaterialStudentsFor(ctx, request.params.setId, {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${SETS}/:setId/deliveries`,
    {
      preValidation: [...guarded(MATERIAL_DELIVERY_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createMaterialDelivery',
        tags,
        summary: 'Öğrenciye seti teslim et',
        description: `Teslim alan (\`student\` öğrencinin kendisi, \`guardian\` kayıtlı veli \`guardianId\`, \`other\` adı yazılan kişi \`recipientName\`), teslim günü (bugünden sonra olamaz: 422 \`material_delivery_date_future\`), depo ve kâğıt imza işareti. Seçilen depodan setin her kalemi için teslim gününde \`delivery\` stok çıkışı tek işlemde yazılır; stok o gün ve sonrasında yetmezse 422 \`stock_insufficient\` (mesajda çıkılabilecek en çok miktar, K-181), pasif depo ya da kart 422. Pasif set 422 \`material_set_inactive\`; olmayan ya da etkin olmayan öğrenci 422 \`material_delivery_student_not_found\`; hedef dışı öğrenci 422 \`material_delivery_student_not_eligible\`; iptal edilmemiş teslimi olan öğrenci 409 \`material_delivery_exists\`; öğrenciye bağlı olmayan veli 422 \`material_delivery_guardian_not_found\`, iletişim kısıtlı veli 422 \`material_delivery_guardian_restricted\` (K-206). Ödenmemiş materyal ücreti teslimi engellemez (K-207). \`Idempotency-Key\` zorunlu. Olmayan ya da başka kurumun seti 404. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: materialSetParams,
        body: materialDeliverySchema,
        response: { 201: materialDeliveryResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMaterialDeliveryCommand(
        contextOf(request),
        request.params.setId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return materialDeliveryResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/material-recipients',
    {
      preValidation: guarded(MATERIAL_DELIVERY_ROLES),
      schema: {
        operationId: 'listMaterialRecipients',
        tags,
        summary: 'Teslim alabilecek kayıtlı veliler',
        description: `Öğrencinin etkin veli bağları, ad ve yakınlıkla; iletişim kısıtlı veli listelenmez (K-206). Olmayan, arşivli ya da başka kurumun öğrencisi 404. ${READERS}`,
        querystring: materialRecipientQuery,
        response: { 200: materialRecipientResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listMaterialRecipientsFor(contextOf(request), request.query.studentId),
    }),
  )

  typed.get(
    `${DELIVERIES}/:deliveryId`,
    {
      preValidation: guarded(MATERIAL_SET_READ_ROLES),
      schema: {
        operationId: 'getMaterialDelivery',
        tags,
        summary: 'Teslim ayrıntısı (teslim tutanağı)',
        description: `İptal edilmiş teslim dahil: set, eğitim yılı, öğrenci adı, numarası, sınıfı ya da kur grubu, kalemler, teslim alan, teslim eden (kaydeden), teslim günü, iptal bilgisi ve setin yılında kitap ve kırtasiye ücret kalemi olup olmadığı (\`hasMaterialFee\`; tutar ve ödeme durumu yok, K-207). Teslim tutanağı PDF'i web'de bu yanıttan üretilir (ON-338). Olmayan ya da başka kurumun teslimi 404. ${READERS}`,
        params: materialDeliveryParams,
        response: { 200: materialDeliveryResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getMaterialDeliveryFor(contextOf(request), request.params.deliveryId),
    }),
  )

  typed.post(
    `${DELIVERIES}/:deliveryId/cancel`,
    {
      preValidation: [...guarded(MATERIAL_DELIVERY_CANCEL_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelMaterialDelivery',
        tags,
        summary: 'Teslimi iptal et',
        description: `Gerekçeyle (5–500 karakter) iptal; teslim silinmez, stok çıkışları aynı gerekçeyle iptal edilir ve öğrenciye set yeniden teslim edilebilir (K-209). Zaten iptal edilmiş 422 \`material_delivery_already_cancelled\`. \`If-Match\` teslimin sürümüdür. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: materialDeliveryParams,
        body: cancelMaterialDeliverySchema,
        response: { 200: materialDeliveryResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelMaterialDeliveryCommand(
        contextOf(request),
        request.params.deliveryId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return materialDeliveryResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${DELIVERIES}/:deliveryId/signature`,
    {
      preValidation: [...guarded(MATERIAL_DELIVERY_ROLES), requireIfMatch()],
      schema: {
        operationId: 'signMaterialDelivery',
        tags,
        summary: 'Teslim imzasının alındığını işle',
        description: `Kâğıt imza sonradan getirildiğinde işaretlenir; geri alınmaz (K-206). İmzası alınmış teslim 422 \`material_delivery_signature_exists\`, iptal edilmiş teslim 422 \`material_delivery_cancelled\`. \`If-Match\` teslimin sürümüdür. ${READERS}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: materialDeliveryParams,
        response: { 200: materialDeliveryResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await signMaterialDeliveryCommand(
        contextOf(request),
        request.params.deliveryId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return materialDeliveryResponse.parse(sendBody(reply, result))
    },
  )
}
