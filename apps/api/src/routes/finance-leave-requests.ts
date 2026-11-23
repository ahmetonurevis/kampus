import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_LEAVE_REQUEST_ROLES,
  leaveRequestApproveSchema,
  leaveRequestCancelSchema,
  leaveRequestCreateSchema,
  leaveRequestRejectSchema,
  leaveRequestSubstitutesSchema,
} from '@kampus/school-core/lib/finance-leave-requests.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  approveLeaveRequestCommand,
  cancelLeaveRequestCommand,
  createLeaveRequestCommand,
  getLeaveRequestFor,
  listLeaveRequestsFor,
  previewLeaveRequestFor,
  rejectLeaveRequestCommand,
  updateLeaveRequestSubstitutesCommand,
} from '../services/finance-leave-requests.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  leaveRequestListQuery,
  leaveRequestListResponse,
  leaveRequestParams,
  leaveRequestPreviewQuery,
  leaveRequestPreviewResponse,
  leaveRequestResponse,
} from './finance-leave-requests.schemas.ts'

/**
 * İzin talebi ve onayı uçları (docs/domain/finans.md DOM-FIN-116; ON-182; K-397…K-399). Modül
 * `finance`; okuma ve yazma yalnız yönetici (talebi personel adına açar; self-servis ON-189).
 * Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const MANAGER = 'Rol: yalnız `yonetici` (personel kişisel verisi). Modül `finance`.'
const REQUESTS = '/api/v1/finance/leave-requests'
const STATE = 'Bekleyen olmayan talep 422 `staff_leave_request_not_pending`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceLeaveRequestRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_LEAVE_REQUEST_ROLES),
  ]
  const tags = ['finance-leave-requests']

  typed.get(
    REQUESTS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listLeaveRequests',
        tags,
        summary: 'İzin talepleri',
        description: `Kurumun izin talepleri: onay bekleyenler önce, sonra başlangıç günü yeniden eskiye. Durum, personel, ad araması ve gün aralığı (\`from\` bu güne uzanan, \`to\` bu güne kadar başlayan) süzgeci. Satırda tür, aralık, gün, durum, karar ve iptal bilgisi, bağlı ve yedeği seçilmiş ders sayısı (DOM-FIN-116). ${MANAGER}`,
        querystring: leaveRequestListQuery,
        response: { 200: leaveRequestListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, membershipId, q, from, to } = request.query
      const { items, total } = await listLeaveRequestsFor(contextOf(request), {
        page,
        pageSize,
        status,
        membershipId,
        q,
        from,
        to,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${REQUESTS}/preview`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'previewLeaveRequest',
        tags,
        summary: 'İzin talebi önizlemesi',
        description: `Talep formu için: personel bir öğretmen kaydına bağlıysa aralıktaki (Europe/Istanbul günü) iptal edilmemiş dersleri (asıl ya da yedek olduğu; en çok \`lessonLimit\`), yedek adayları (etkin öğretmenler) ve her derste uyarısı olan adaylar (\`busy\`, \`on_leave\`, \`other_subject\`; engel değildir, K-399). \`typeCode\` ve \`days\` verilirse talep onaylanırsa kalacak yıllık izin. Yalnız okur. Olmayan, başka kurumun ya da personel olmayan üyelik 404. ${MANAGER}`,
        querystring: leaveRequestPreviewQuery,
        response: { 200: leaveRequestPreviewResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await previewLeaveRequestFor(contextOf(request), request.query),
    }),
  )

  typed.get(
    `${REQUESTS}/:requestId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getLeaveRequest',
        tags,
        summary: 'İzin talebi',
        description: `Talep, bağlı dersler (seçilen yedek, uyarıları ve uyarısı olan adaylar), yedek adayları ve bekleyen talepte onaylanırsa kalacak yıllık izin. Başka kurumun talebi 404. ${MANAGER}`,
        params: leaveRequestParams,
        response: { 200: leaveRequestResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getLeaveRequestFor(contextOf(request), request.params.requestId),
    }),
  )

  typed.post(
    REQUESTS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLeaveRequest',
        tags,
        summary: 'İzin talebi aç',
        description: `Yönetici personel adına talep açar (K-397): tür, ilk ve son gün, iş günü (tam gün; yarım gün yok), açıklama ve derslere yedek öğretmen. Kullanılmış izin kaydının kuralları geçerlidir (DOM-FIN-109: \`staff_leave_staff_not_found\`, \`staff_leave_not_staff\`, \`staff_leave_staff_inactive\`, \`staff_leave_type_not_found\`, \`staff_leave_type_inactive\`, rapor talep edilmez \`staff_leave_sick_not_manual\`, \`staff_leave_days_exceed_range\`, \`staff_leave_profile_required\`, \`staff_leave_before_seniority\`, etkin kayıtla çakışma \`staff_leave_overlap\`); bekleyen ya da onaylı taleple çakışma 422 \`staff_leave_request_overlap\`. Personel öğretmen kaydına bağlıysa aralıktaki dersler ders programından kopyalanır (en çok 200; fazlası 422 \`staff_leave_request_too_many_lessons\`); yedek seçimi yalnız bu derslerde (422 \`staff_leave_lesson_not_affected\`), etkin öğretmen (422 \`staff_leave_substitute_not_found\`) ve izne çıkan değil (422 \`staff_leave_substitute_self\`). Yetersiz bakiye talepte uyarıdır. Açıklama denetim kaydına yazılmaz. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: leaveRequestCreateSchema,
        response: { 201: leaveRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLeaveRequestCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = leaveRequestResponse.parse(sendBody(reply, result))
      reply.header('location', `${REQUESTS}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${REQUESTS}/:requestId/approve`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'approveLeaveRequest',
        tags,
        summary: 'İzin talebini onayla',
        description: `Talebi onaylar ve kullanılmış izin kaydını türün güncel ayarıyla üretir (kayıt \`requestId\` taşır; K-398). Kayıt kuralları yeniden denetlenir; onaylı bordro ayına değen aralık 409 \`payroll_period_locked\` (DOM-FIN-108). Yıllıktan düşen türde kalan izin (başlangıç gününde, planlananlar düşülmüş) talebi karşılamıyorsa 422 \`staff_leave_balance_insufficient\`; \`allowAdvance: true\` avans izin olarak onaylar. ${STATE} \`If-Match\` ve \`Idempotency-Key\` zorunlu. Başka kurumun talebi 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: leaveRequestParams,
        body: leaveRequestApproveSchema,
        response: { 200: leaveRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await approveLeaveRequestCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return leaveRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${REQUESTS}/:requestId/reject`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'rejectLeaveRequest',
        tags,
        summary: 'İzin talebini reddet',
        description: `Bekleyen talebi gerekçeyle (5–500 karakter) reddeder; kayıt üretilmez. Gerekçe denetim kaydına yazılmaz. ${STATE} \`If-Match\` zorunlu. Başka kurumun talebi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: leaveRequestParams,
        body: leaveRequestRejectSchema,
        response: { 200: leaveRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await rejectLeaveRequestCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return leaveRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${REQUESTS}/:requestId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelLeaveRequest',
        tags,
        summary: 'İzin talebini iptal et',
        description: `Bekleyen talep gerekçeyle geri çekilir; onaylı talep iptal edilir ve ürettiği kullanılmış izin kaydı da aynı gerekçeyle iptal edilir (bakiyeye geri döner; K-397). Onaylı talebin aralığı onaylı bordro ayına değiyorsa 409 \`payroll_period_locked\`. Reddedilmiş ya da iptal edilmiş talep 422 \`staff_leave_request_closed\`. Gerekçe denetim kaydına yazılmaz. \`If-Match\` zorunlu. Başka kurumun talebi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: leaveRequestParams,
        body: leaveRequestCancelSchema,
        response: { 200: leaveRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelLeaveRequestCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return leaveRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${REQUESTS}/:requestId/assign-substitutes`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateLeaveRequestSubstitutes',
        tags,
        summary: 'Derslere yedek öğretmen seç',
        description: `Bekleyen ya da onaylı talebin derslerinde yedek öğretmeni seçer, değiştirir ya da kaldırır (\`null\`; K-399). Ders talebin derslerinden olmalı (422 \`staff_leave_lesson_not_affected\`), yedek etkin öğretmen (422 \`staff_leave_substitute_not_found\`) ve izne çıkan değil (422 \`staff_leave_substitute_self\`); değişiklik yoksa 422 \`staff_leave_substitutes_unchanged\`; kapalı talep 422 \`staff_leave_request_closed\`. Seçim ders programına yazılmaz. \`If-Match\` zorunlu (talep sürümü). Başka kurumun talebi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: leaveRequestParams,
        body: leaveRequestSubstitutesSchema,
        response: { 200: leaveRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateLeaveRequestSubstitutesCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return leaveRequestResponse.parse(sendBody(reply, result))
    },
  )
}
