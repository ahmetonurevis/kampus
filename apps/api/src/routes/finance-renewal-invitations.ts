import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  openRenewalInvitationsSchema,
  RENEWAL_INVITATION_RESPONSES,
  RENEWAL_INVITATION_STATUSES,
  respondRenewalInvitationSchema,
} from '@kampus/school-core/lib/renewal-invitations.ts'
import { mayRun } from '@kampus/school-core/lib/school-workflows.ts'

import { ROLES } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  listRenewalInvitationsFor,
  openRenewalInvitationsCommand,
  respondRenewalInvitationCommand,
} from '../services/finance-renewal-invitations.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Yenileme daveti uçları (K-10; docs/domain/kayit-ve-crm.md DOM-KAY-027; IST-100). Rol core
 * `mayRun`'dan; yanıt ödeyici velinindir, kapsamı core `renewalInvitationAccess`. Uçlar yenileme
 * uçlarıyla aynı iki modüle bağlıdır: `renewal` kurum türünde yoksa 404, biri kapalıysa 403
 * `module_disabled` (DOM-YTK-012, DOM-YTK-040).
 */

const OPEN_ROLES = ROLES.filter((role) => mayRun({ role }, 'renewal'))
const READ_ROLES = ['yonetici', 'onburo', 'veli'] as const
const RESPOND_ROLES = ['veli'] as const

const invitationSchema = z.object({
  id: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
  createdAt: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  className: z.string().nullable().describe('Öğrencinin güncel sınıfı'),
  academicYear: z.number().int().describe('Davetin hedef eğitim yılı'),
  status: z
    .enum(RENEWAL_INVITATION_STATUSES)
    .describe('Yenileme kaydı ve velinin yanıtından türer; `planned` plan yapılmıştır'),
  response: z.enum(RENEWAL_INVITATION_RESPONSES).nullable().describe('Velinin son yanıtı'),
  // kvkk: K
  note: z.string().nullable().describe('Velinin notu; personel ve ödeyici veli görür'),
  respondedAt: z.string().nullable(),
  canRespond: z.boolean().describe('Oturumdaki hesap bu daveti şimdi yanıtlayabilir mi'),
})
const openedResponse = dataResponse(
  z.object({
    invitations: z.array(z.object({ id: z.string(), studentId: z.string() })),
    withoutPayerCount: z
      .number()
      .int()
      .describe('Ödeyicisi kayıtlı olmadığı için bildirim gitmeyen öğrenci sayısı'),
  }),
)
const respondedResponse = dataResponse(
  z.object({
    id: z.string(),
    version: z.number().int(),
    status: z.enum(RENEWAL_INVITATION_STATUSES),
    respondedAt: z.string().nullable(),
  }),
)
const invitationParams = z.object({ invitationId: z.uuid('Davet geçersiz.').describe('Davet') })
const listQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Öğrenci adında arama'),
  academicYear: z.coerce
    .number('Eğitim yılı geçersiz.')
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe('Hedef eğitim yılı'),
  status: z.enum(RENEWAL_INVITATION_STATUSES).optional().describe('Davet durumu'),
  studentId: z.string().min(1).max(200).optional().describe('Öğrenci; veli için seçili çocuk'),
})

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceRenewalInvitationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const renewal = app.requireModule('renewal')
  /** `routes/finance-renewals.ts` ile aynı sarmalama: `renewal` ikinci modül denetimidir. */
  const renewalModule: preValidationAsyncHookHandler = async function (
    this: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    await renewal.call(this, request, reply)
  }
  const guarded = (roles: readonly (typeof ROLES)[number][]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    renewalModule,
    app.requireRole(roles),
  ]

  typed.get(
    '/api/v1/finance/renewal-invitations',
    {
      preValidation: guarded(READ_ROLES),
      schema: {
        operationId: 'listRenewalInvitations',
        tags: ['finance-renewals'],
        summary: 'Yenileme davetlerini listele',
        description:
          'Yönetici ve ön büro kurum geneli; veli velayetli ya da ödeyicisi olduğu çocuklarını görür (DOM-KAY-027). Durum `pending`, `will_renew`, `will_not_renew` ya da `planned`; `q` öğrenci adında arar. Velinin notunu personel ve ödeyici veli görür. Roller: `yonetici`, `onburo`, `veli`. Modül `renewal`: dil okulu ve kursta 404.',
        querystring: listQuerySchema,
        response: {
          200: z.object({ data: z.array(invitationSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize, q, academicYear, status, studentId } = request.query
      const { items, total } = await listRenewalInvitationsFor(contextOf(request), {
        page,
        pageSize,
        q,
        academicYear,
        status,
        studentId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/renewal-invitations',
    {
      preValidation: [...guarded(OPEN_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'openRenewalInvitations',
        tags: ['finance-renewals'],
        summary: 'Yenileme daveti aç',
        description:
          'Hedef eğitim yılı için seçili öğrencilere (en çok 200) tek işlemde davet açar; biri reddedilirse hiçbiri açılmaz (DOM-KAY-027). Aynı öğrenci ve yıla ikinci davet 409 `renewal_invitation_exists`, planı yapılmış öğrenci 409 `renewal_invitation_already_planned`, geçmiş yıl 422 `renewal_year_invalid`, son sınıf 422 `renewal_invitation_final_grade`. Ödeyicisi kayıtlı öğrencinin velisine bildirim gider. `Idempotency-Key` zorunlu. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: openRenewalInvitationsSchema,
        response: { 201: openedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await openRenewalInvitationsCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return openedResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/renewal-invitations/:invitationId/respond',
    {
      preValidation: [...guarded(RESPOND_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'respondRenewalInvitation',
        tags: ['finance-renewals'],
        summary: 'Yenileme davetini yanıtla',
        description:
          'Ödeyici velinin niyet beyanı: sözleşme, taksit ve sınıf yazmaz, sözleşme onayı ayrı kalır (K-10, DOM-KAY-027). Plan yapılana kadar değiştirilebilir, sonra 409 `renewal_invitation_planned`. Velayetli olup ödeyici olmayan veli 403 `renewal_invitation_payer_only`; kapsam dışı, yok ya da başka kurum 404. `If-Match` zorunlu. Rol: `veli`.',
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: invitationParams,
        body: respondRenewalInvitationSchema,
        response: { 200: respondedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await respondRenewalInvitationCommand(
        contextOf(request),
        request.params.invitationId,
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return respondedResponse.parse(sendBody(reply, result))
    },
  )
}
