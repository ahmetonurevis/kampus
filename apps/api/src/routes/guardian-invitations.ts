import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { guardianInvitationInputSchema } from '@kampus/school-core/lib/guardian-invitations.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelGuardianInvitation,
  inviteGuardianAccount,
  listGuardianInvitations,
} from '../services/guardian-invitations.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  guardianInvitationListResponseSchema,
  guardianInvitationResponseSchema,
  staffInvitationListQuerySchema,
  staffInvitationParamsSchema,
} from './institution-members.schemas.ts'

/**
 * Veli hesabı daveti, bekleyen davet listesi ve iptali (DOM-YTK-071). Platform yeteneğidir, modüle
 * bağlı değildir. Rol listeleri core yetki tablosundan gelir (`guardian.invite`,
 * `guardian.invite_list`, `guardian.invite_cancel`; yönetici ve ön büro) ve `preValidation`'da
 * denetlenir; kurum oturumdan gelir. Personel davetleri `routes/institution-members.ts`'tedir.
 */

const rolesOf = (action: 'guardian.invite' | 'guardian.invite_list' | 'guardian.invite_cancel') =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const access = (action: Parameters<typeof rolesOf>[0]) =>
  `Yalnız ${rolesOf(action)} (diğer roller 403; rol ve pasiflik kurum kilidi altında yeniden doğrulanır); taze oturum ister (15 dakikadan eski oturum 403 \`reauthentication_required\`). Kurum oturumdan gelir. Yazma ve denetim kaydı (\`audit_log\`, yalnız alan adları) tek transaction’dadır.`

/** Komut yanıtı; tekrarlanan yanıt veritabanından geldiği için şemayla yeniden okunur. */
function send<T>(reply: FastifyReply, response: CommandResponse, schema: z.ZodType<T>): T {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body)
}

export function registerGuardianInvitationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const fresh = app.requireFreshSession
  const invite = [app.requireRole(WRITE_ACTION_ROLES['guardian.invite']), fresh]
  const cancel = [app.requireRole(WRITE_ACTION_ROLES['guardian.invite_cancel']), fresh]

  typed.get(
    '/api/v1/institution-members/guardian-invitations',
    {
      preValidation: app.requireRole(WRITE_ACTION_ROLES['guardian.invite_list']),
      schema: {
        operationId: 'listGuardianInvitations',
        tags: ['institution'],
        summary: 'Bekleyen veli davetleri',
        description: `Etkin kurumun bekleyen (kişinin henüz giriş yapmadığı) veli davetleri, yeni önce (DOM-YTK-071); personel davetleri bu listede değildir. Süresi dolmuş ama hâlâ bekleyen davet de listelenir (\`expiresAt\` görünür): yeni davetleri engellemez, iptalle temizlenir. Yalnız ${rolesOf('guardian.invite_list')} (diğer roller 403). Okuma denetim kaydı üretmez.`,
        querystring: staffInvitationListQuerySchema,
        response: { 200: guardianInvitationListResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize } = request.query
      const result = await listGuardianInvitations(ctx.db, ctx.institutionId, { page, pageSize })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.post(
    '/api/v1/institution-members/guardian-invitations',
    {
      preValidation: invite,
      schema: {
        operationId: 'inviteGuardianAccount',
        tags: ['institution'],
        summary: 'Veli hesabı davet et',
        description: `Kesin kayıttan sonra velinin hesabını açar (DOM-YTK-071): kullanıcı (parolasız), \`veli\` üyeliği ve seçilen her öğrenci (\`studentIds\`, 1–10, benzersiz) için çocuk bağlantısı aynı işlemde yazılır. \`parentId\` verilirse o veli kaydının seçilen öğrencilerdeki velayet bağları hesaba bağlanır; kayıt seçilen bir öğrencinin velisi değilse 422 \`guardian_record_not_linked\`, bağı başka hesaba bağlıysa ya da kayıt bekleyen bir veli davetinde tutuluyorsa 409 \`guardian_link_exists\`, kayıt başka öğrencide başka hesapla eşlenmişse 422 \`guardian_identity_mismatch\`. \`parentId\` verilmezse velayet bağı kurulmaz ve hesap öğrencinin verisini görmez: velayet ve yakınlık \`POST /api/v1/students/{studentId}/guardians\` (\`membershipId\` ile) girilir. Better Auth daveti kişi ilk girişini yapana kadar \`pending\` kalır; parola belirleme bağlantısı personel davetindeki gibi yanıtı beklemeden gider (kuyruk açıkken \`staff.password-link\` işi). E-posta başka kurumda hesaplıysa üyelik, bağlantı ve bağ yazılmaz, ileti gitmez; öğrenciler ve veli kaydı davette saklanır ve kabulde bağlanır. Yanıtın durum kodu ve alanları iki durumda aynıdır (karar 73); bekleyen davet \`GET\` ile listelenir, \`POST .../{invitationId}/cancel\` ile iptal edilir. Kurumda kayıtlı e-posta 409 \`member_exists\` (kardeş kaydındaki mevcut veli hesabı bağ ucuyla bağlanır), süresi dolmamış bekleyen davet 409 \`invitation_exists\` (süresi dolmuş bekleyen davet saymaz); olmayan, arşivli ya da başka kurumun öğrencisi veya veli kaydı 404. \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. ${access('guardian.invite')}`,
        body: guardianInvitationInputSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: guardianInvitationResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const response = await inviteGuardianAccount(
        contextOf(request),
        app.auth,
        app.staffLinks.scheduler,
        request.body,
        idempotencyOf(request, true),
      )
      reply.header('location', '/api/v1/institution-members/guardian-invitations')
      return send(reply, response, guardianInvitationResponseSchema)
    },
  )

  typed.post(
    '/api/v1/institution-members/guardian-invitations/:invitationId/cancel',
    {
      preValidation: cancel,
      schema: {
        operationId: 'cancelGuardianInvitation',
        tags: ['institution'],
        summary: 'Veli davetini iptal et',
        description: `Bekleyen veli davetini iptal eder (DOM-YTK-071): davet \`canceled\` olur, e-posta ve veli kaydı yeni davetlere açılır. Davetle açılmış hesap, \`veli\` üyeliği, çocuk bağlantıları ve velayet bağının hesabı korunur (üyelik silinseydi velayet bağı da silinirdi): bu hesap parolasını belirleyip girebilir ve bağlı çocuklarını okur. Başka kurumda hesabı olan e-postaya yazılmış davette (karar 73) hiç hesap yazılmadığından yalnız davet kapanır. Olmayan, başka kurumun ya da personel daveti 404; bekleyen olmayan davet 409 \`invitation_not_pending\`. \`Idempotency-Key\` isteğe bağlı. ${access('guardian.invite_cancel')}`,
        params: staffInvitationParamsSchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 200: guardianInvitationResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      return send(
        reply,
        await cancelGuardianInvitation(
          contextOf(request),
          app.auth,
          request.params.invitationId,
          idempotencyOf(request, false),
        ),
        guardianInvitationResponseSchema,
      )
    },
  )
}
