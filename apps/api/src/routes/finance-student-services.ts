import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { FEE_UNITS } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  endStudentServiceSchema,
  STUDENT_SERVICE_END_REASONS,
  STUDENT_SERVICE_KINDS,
  STUDENT_SERVICE_STATUSES,
  subscribeStudentServiceSchema,
} from '@kampus/school-core/lib/finance-student-services.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  endStudentServiceCommand,
  getStudentServiceFor,
  listStudentServicesFor,
  quoteStudentServiceFor,
  subscribeStudentServiceCommand,
} from '../services/finance-student-services.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Ek hizmet aboneliği uçları (docs/domain/finans.md DOM-FIN-002, -003, -040; ON-087). Modül `finance`.
 * Yazma yönetici ve ön büro; okuma ayrıca veli ve öğrenci, kendi kapsamında (DOM-FIN-052).
 */

const invoiceSchema = z.object({
  id: z.string(),
  installment: z.number().int().describe('Aboneliğin içindeki taksit numarası'),
  amountCents: z.number().int().describe('Taksit tutarı, kuruş'),
  dueDate: z.string().describe('Vade günü (YYYY-MM-DD)'),
  paidCents: z.number().int().describe('Taksite dağıtılan tahsilat, kuruş; iptalde 0'),
  cancelled: z.boolean().describe('Çıkışta iptal edildi'),
})
const serviceSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  kind: z.enum(STUDENT_SERVICE_KINDS),
  academicYear: z.number().int().describe('Eğitim yılının başlangıç yılı'),
  tariffId: z.string(),
  tariffVersion: z.number().int().describe('Ücretin alındığı tarife sürümü'),
  feeLevel: z.string().nullable().describe('Tarifedeki kalemin düzeyi'),
  unit: z.enum(FEE_UNITS).describe('Ücret birimi; `month` her ay taksit açar'),
  amountCents: z
    .number()
    .int()
    .describe('Uygulanan birim ücret, kuruş; aylık kalemde bir ayın tutarı. Tarifeyi aşamaz.'),
  tariffAmountCents: z.number().int().describe('Yazılma anında tarifedeki birim ücret, kuruş'),
  contractId: z
    .string()
    .nullable()
    .describe('Yürürlükteki sözleşme sürümü; taksit sözleşmenin planına girmez (DOM-FIN-010)'),
  startDate: z.string().describe('Başlangıç günü (YYYY-MM-DD)'),
  endDate: z.string().nullable().describe('Planlanan bitiş günü (YYYY-MM-DD)'),
  status: z.enum(STUDENT_SERVICE_STATUSES),
  endedDate: z.string().nullable().describe('Gerçek çıkış günü (YYYY-MM-DD)'),
  endReason: z.enum(STUDENT_SERVICE_END_REASONS).nullable(),
  billedCents: z.number().int().describe('İptal edilmemiş taksitlerin toplamı, kuruş'),
  paidCents: z.number().int().describe('Tahsil edilen, kuruş'),
  openCents: z.number().int().describe('Kalan, kuruş'),
  refundDecisionRequired: z
    .boolean()
    .describe(
      'Erken bitti ve kalan taksit kullanılmamış dönemi de kapsıyor. İade otomatik yazılmaz; karar yöneticinindir (DOM-FIN-040, H-15).',
    ),
  invoices: z.array(invoiceSchema),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
const commandSchema = serviceSchema.extend({
  tariffCarriedOverFromYear: z
    .number()
    .int()
    .nullable()
    .describe('Tarife önceki yıldan geçerli kaldıysa o yıl (DOM-FIN-002, K-11)'),
})
const serviceResponse = dataResponse(serviceSchema)
const commandResponse = dataResponse(commandSchema)
const params = z.object({ serviceId: z.uuid('Abonelik kimliği geçersiz.') })
const listQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().min(1).max(200).optional().describe('Öğrenci kimliği'),
  kind: z.enum(STUDENT_SERVICE_KINDS).optional(),
  academicYear: z.coerce.number().int().min(2000).max(2100).optional().describe('Eğitim yılı'),
  status: z.enum(STUDENT_SERVICE_STATUSES).optional(),
})

const quoteQuery = z.strictObject({
  studentId: z.string().min(1).max(200).describe('Öğrenci kimliği'),
  kind: z.enum(STUDENT_SERVICE_KINDS),
  academicYear: z.coerce.number().int().min(2000).max(2100).describe('Eğitim yılı'),
  startDate: daySchema.describe('Başlangıç günü (YYYY-MM-DD)'),
  endDate: daySchema.optional().describe('Bitiş günü (YYYY-MM-DD); aylık kalemde ay sayısı için'),
})
const quoteSchema = z.object({
  tariffAmountCents: z.number().int().describe('Önerilen birim tutar: tarifedeki kalem, kuruş'),
  unit: z.enum(FEE_UNITS),
  dueDates: z
    .array(z.string())
    .describe('Açılacak taksitlerin vadeleri (ISO 8601); aylık kalemde bitiş yoksa boş'),
  tariffCarriedOverFromYear: z
    .number()
    .int()
    .nullable()
    .describe('Tarife önceki yıldan geçerli kaldıysa o yıl (DOM-FIN-002, K-11)'),
})

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceStudentServiceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const read = [
    app.authenticate,
    finance,
    app.requireRole(['yonetici', 'onburo', 'veli', 'ogrenci']),
  ]
  const write = (ifMatch: 'reject' | 'required'): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(WRITE_ACTION_ROLES['studentService.manage']),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    captureInput(),
  ]

  typed.get(
    '/api/v1/finance/student-services',
    {
      preValidation: read,
      schema: {
        operationId: 'listStudentServices',
        tags: ['finance-student-services'],
        summary: 'Ek hizmet aboneliklerini listele',
        description:
          'Abonelikleri yeni yıl önce, taksit ve tutar özetiyle listeler (DOM-FIN-003). `studentId`, `kind`, `academicYear` ve `status` süzer; sayfalıdır, bilinmeyen parametre 400. Veli yalnız velayetli ve kısıtsız bağlı çocuğunu ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini görür; kapsam dışı öğrenci boş liste döner. Roller: `yonetici`, `onburo`, `veli`, `ogrenci`.',
        querystring: listQuery,
        response: {
          200: z.object({ data: z.array(serviceSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listStudentServicesFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/student-services/quote',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(WRITE_ACTION_ROLES['studentService.manage']),
      ],
      schema: {
        operationId: 'quoteStudentService',
        tags: ['finance-student-services'],
        summary: 'Ek hizmet tutarını ve taksitlerini önizle',
        description:
          'Hiçbir kayıt yazmaz. Önerilen birim tutarı (öğrencinin düzeyine göre tarife kalemi) ve açılacak taksitlerin vadelerini döner; aylık (`month`) kalemde bitiş verilmezse vadeler boştur. Yazılmayla aynı denetimler: tarife yok 422 `tariff_not_published`, kalem yok 422 `extra_not_in_tariff`, öğrenci aktif değil 409 `student_service_student_inactive`, açık abonelik 409 `student_service_open`, sözleşmede aynı kalem 409 `student_service_on_contract`. Olmayan ya da başka kurumun öğrencisi 404. Roller: `yonetici`, `onburo`.',
        querystring: quoteQuery,
        response: { 200: dataResponse(quoteSchema), ...commandErrors },
      },
    },
    async (request) => ({
      data: await quoteStudentServiceFor(contextOf(request), request.query),
    }),
  )

  typed.get(
    '/api/v1/finance/student-services/:serviceId',
    {
      preValidation: read,
      schema: {
        operationId: 'getStudentService',
        tags: ['finance-student-services'],
        summary: 'Ek hizmet aboneliği ayrıntısı',
        description:
          'Kapsam dışı, olmayan ya da başka kurumun aboneliği aynı 404. Roller: `yonetici`, `onburo`, `veli`, `ogrenci`.',
        params,
        response: { 200: serviceResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStudentServiceFor(contextOf(request), request.params.serviceId),
    }),
  )

  typed.post(
    '/api/v1/finance/student-services',
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'subscribeStudentService',
        tags: ['finance-student-services'],
        summary: 'Öğrenciyi ek hizmete yaz',
        description:
          'Ücret eğitim yılının yayımlı tarifesinden hesaplanır, öğrenimden ayrı taksit aynı işlemde yazılır (DOM-FIN-002, -003). `amountCents` birim tutarı elle düzeltir: tarifenin üstüne çıkamaz (422 `student_service_amount_exceeds_tariff`), sıfırdan büyük olmalıdır (400); boşsa tarife uygulanır, düzeltme denetime `studentService.amountAdjust` ile yazılır (K-17). Aylık (`month`) kalem bitiş gününe kadar her ay bu tutarda, öteki birimler başlangıçta tek taksit açar; kısmi dönem oranı yoktur. Taksit sözleşmeye eklenmez, `contractId` yürürlükteki sözleşmeyi gösterir (DOM-FIN-010). Tarife yok 422 `tariff_not_published`, kalem yok 422 `extra_not_in_tariff`, aylık kalemde bitiş yok 422 `student_service_end_required`, öğrenci aktif değil 409 `student_service_student_inactive`, aynı türde açık abonelik 409 `student_service_open`, aynı yılın sözleşmesinde aynı kalem 409 `student_service_on_contract`. `Idempotency-Key` zorunlu; başarı 201 ve `Location`. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: subscribeStudentServiceSchema,
        response: { 201: commandResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await subscribeStudentServiceCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = commandResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/student-services/${body.data.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/finance/student-services/:serviceId/end',
    {
      preValidation: write('required'),
      schema: {
        operationId: 'endStudentService',
        tags: ['finance-student-services'],
        summary: 'Ek hizmetten çıkar',
        description:
          'Aboneliği kapatır; çıkış gününden sonra vadeli, tahsilat görmemiş taksitler iptal edilir (DOM-FIN-003). Ödenmiş tutar için iade yazılmaz: kullanılmamış dönem kaldıysa yanıt `refundDecisionRequired: true` döner, karar yöneticinindir (DOM-FIN-040, H-15). Kapalı abonelik 409 `student_service_ended`, ileri tarih 422 `student_service_end_in_future`, başlangıçtan önce 422 `student_service_end_before_start`. `Idempotency-Key` ve `If-Match` zorunlu. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params,
        body: endStudentServiceSchema,
        response: { 200: commandResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'required')
      if (expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await endStudentServiceCommand(
        contextOf(request),
        request.params.serviceId,
        request.commandInput,
        { idempotency, expectedVersion },
      )
      return commandResponse.parse(sendBody(reply, result))
    },
  )
}
