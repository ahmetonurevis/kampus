import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_SEPARATION_ROLES,
  staffSeparationCancelSchema,
  staffSeparationInputSchema,
  staffSeparationStepSchema,
  staffSeparationUpdateSchema,
} from '@kampus/school-core/lib/finance-staff-separations.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelStaffSeparationCommand,
  completeStaffSeparationCommand,
  createStaffSeparationCommand,
  getStaffSeparationFor,
  listStaffSeparationsFor,
  markStaffSeparationStepCommand,
  staffSeparationDocumentFor,
  updateStaffSeparationCommand,
} from '../services/finance-staff-separations.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  separationCompleteBody,
  separationDocumentResponse,
  separationListQuery,
  separationListResponse,
  separationParams,
  separationResponse,
} from './finance-staff-separations.schemas.ts'

/**
 * İşten ayrılış uçları (docs/domain/finans.md DOM-FIN-118; ON-180). Modül `finance`; okuma ve
 * yazma yalnız yönetici (K-403). Dosya açılışı ve tamamlama `Idempotency-Key` ister; düzeltme,
 * adım işareti, tamamlama ve iptal `If-Match` ister. Zimmet iadesi demirbaş zimmeti ucundan, hesap
 * kapatma personel hesabı ucundan (`/institution-members/:id/deactivate`), hizmet belgesi personel
 * belgesi ucundan yapılır; bu uçlar adımları yalnız okur (K-404, K-405).
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-403; dosya avans, icra ve izin bilgisi taşır). Modül `finance`.'
const URL = '/api/v1/finance/staff-separations'
const ITEM = `${URL}/:separationId`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceStaffSeparationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFF_SEPARATION_ROLES),
  ]
  const tags = ['finance-staff-separations']

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffSeparations',
        tags,
        summary: 'İşten ayrılış dosyalarını listele',
        description: `Ayrılış dosyaları: açıklar önce, sonra ayrılış günü yeni önce (DOM-FIN-118). Personel adında aranır; durum ve personelle süzülür. Adımlar listede hesaplanmaz, ayrıntıdadır. ${MANAGER}`,
        querystring: separationListQuery,
        response: { 200: separationListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, membershipId } = request.query
      const { items, total } = await listStaffSeparationsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        membershipId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffSeparation',
        tags,
        summary: 'İşten ayrılış dosyası aç',
        description: `Ayrılan personel için dosya açar (K-403): ayrılış günü (bugünden en çok 365 gün sonra), neden (\`resignation\`, \`termination\`, \`retirement\`, \`contract_end\`, \`other\`), SGK çıkış kodu (boşsa nedenden önerilir; H-85), isteğe bağlı işe giriş ve bildirim günü (bildirim süresi bilgisi; K-405) ve not. Pasifleştirilmiş personele de açılır. Olmayan üyelik 422 \`staff_separation_staff_not_found\`, öğrenci ya da veli 422 \`staff_separation_not_staff\`, açık dosyası olan personel 409 \`staff_separation_open_exists\`; ileri tarihli işe giriş ya da bildirim 422. Yanıt kontrol listesini taşır. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: staffSeparationInputSchema,
        response: { 201: separationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffSeparationCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = separationResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    ITEM,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffSeparation',
        tags,
        summary: 'İşten ayrılış dosyası',
        description: `Dosya, bildirim süresi bilgisi ve kontrol listesi (K-404): zimmet iadesi (personelin zimmetleri; açık zimmet kalmayınca biter), avans ve icra kontrolü (ayrılış ayından kesilecek avans ve süren icra; yoksa kendiliğinden, varsa işaretle biter), kullanılmayan yıllık izin günü (ayrılış günündeki bakiye; işaretle biter), kıdem ve ihbar hesabı (isteğe bağlı işaret), hesap kapatma (üyelik pasifleştirilince biter) ve hizmet belgesi (iptal edilmemiş belge düzenlenince biter). Ayrılış ayının bordro kilidi de döner. İcra sayısı dönen okuma denetime yazılır (\`finance.staff_separation.garnishment_read\`). Başka kurumun dosyası 404. ${MANAGER}`,
        params: separationParams,
        response: { 200: separationResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffSeparationFor(contextOf(request), request.params.separationId),
    }),
  )

  typed.patch(
    ITEM,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStaffSeparation',
        tags,
        summary: 'İşten ayrılış dosyasını düzelt',
        description: `Açık dosyanın ayrılış günü, nedeni, SGK kodu, işe giriş ve bildirim günü ya da notu (kısmi; \`null\` temizler). Neden değişip kod verilmezse kod yeni nedenin önerisine döner. Tamamlanmış ya da iptal edilmiş dosya 409 \`staff_separation_closed\`; değişiklik yoksa 422 \`staff_separation_unchanged\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: separationParams,
        body: staffSeparationUpdateSchema,
        response: { 200: separationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateStaffSeparationCommand(
        contextOf(request),
        request.params.separationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return separationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/mark-step`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'markStaffSeparationStep',
        tags,
        summary: 'Ayrılış adımını işaretle',
        description: `Elle adımı "kontrol edildi" işaretler ya da işareti kaldırır (K-404): \`deductions\` avans ve icra, \`leave\` kullanılmayan izin, \`severance\` kıdem ve ihbar. Zimmet, hesap kapatma ve hizmet belgesi adımları kayıtlardan okunur, işaretlenmez (400). Durum aynıysa yazılmaz (200, denetim yok). Kapanmış dosya 409 \`staff_separation_closed\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: separationParams,
        body: staffSeparationStepSchema,
        response: { 200: separationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await markStaffSeparationStepCommand(
        contextOf(request),
        request.params.separationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return separationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/complete`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'completeStaffSeparation',
        tags,
        summary: 'İlişiği kes (dosyayı tamamla)',
        description: `Zorunlu adımların tamamı bitince dosyayı tamamlar; adımlar kurum kilidi altında kayıtlardan yeniden hesaplanır, kullanılmayan izin günü dondurulur (K-403). Ayrılış günü gelmemişse 422 \`staff_separation_not_due\`, eksik adım varsa 422 \`staff_separation_steps_incomplete\` (ileti eksikleri sayar), kapanmış dosya 409 \`staff_separation_closed\`. Tamamlanan dosya değişmez. \`Idempotency-Key\` ve \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: separationParams,
        body: separationCompleteBody,
        response: { 200: separationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await completeStaffSeparationCommand(
        contextOf(request),
        request.params.separationId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return separationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelStaffSeparation',
        tags,
        summary: 'İşten ayrılış dosyasını iptal et',
        description: `Açık dosyayı gerekçeyle (5–500 karakter) iptal eder (K-403); dosya silinmez. Tamamlanmış dosya iptal edilmez, kapanmış dosya 409 \`staff_separation_closed\`. Gerekçe denetim kaydına yazılmaz. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: separationParams,
        body: staffSeparationCancelSchema,
        response: { 200: separationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelStaffSeparationCommand(
        contextOf(request),
        request.params.separationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return separationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${ITEM}/document`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffSeparationDocument',
        tags,
        summary: 'İlişik kesme belgesinin verisi',
        description: `PDF'in verisi (K-403): kurum adı, personel, günler, neden, SGK kodu, adımların durumu, zimmet dökümü, kullanılmayan izin günü ve hizmet belgesi numarası. Avans ve icra tutarı belgeye girmez. Tamamlanmamış dosyada PDF "Taslak" basar. Başka kurumun dosyası 404. ${MANAGER}`,
        params: separationParams,
        response: { 200: separationDocumentResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await staffSeparationDocumentFor(contextOf(request), request.params.separationId),
    }),
  )
}
