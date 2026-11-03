import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import {
  staffInvitationInputSchema,
  staffRoleChangeInputSchema,
} from '@kampus/school-core/lib/staff-accounts.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { listInstitutionMembers } from '../services/institution-members.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  cancelStaffInvitation,
  changeStaffRole,
  inviteStaffMember,
  listStaffInvitations,
  sendStaffPasswordLink,
  setStaffActive,
} from '../services/staff-accounts.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  institutionMemberListQuerySchema,
  institutionMemberListResponseSchema,
  institutionMemberParamsSchema,
  institutionMemberResponseSchema,
  staffInvitationListQuerySchema,
  staffInvitationListResponseSchema,
  staffInvitationParamsSchema,
  staffInvitationResponseSchema,
} from './institution-members.schemas.ts'

const WRITE_ACCESS =
  'Yalnız yönetici (diğer roller 403); taze oturum ister (15 dakikadan eski oturum 403 `reauthentication_required`). Kurum oturumdan gelir; başka kurumun kaydı 404. Yazma ve denetim kaydı (`audit_log`, yalnız alan adları) tek transaction’dadır.'

/** Komut yanıtı; tekrarlanan yanıt veritabanından geldiği için şemayla yeniden okunur. */
function send<T>(reply: FastifyReply, response: CommandResponse, schema: z.ZodType<T>): T {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body)
}

/**
 * Ayarlar → Kullanıcı & Yetkiler (DOM-YTK-020, DOM-YTK-070). Yalnız yönetici; kurum oturumdan
 * gelir, sorguda kurum kimliği kabul edilmez. Okuma: üyeler ve bekleyen davetler. Yazma: personel
 * daveti ve iptali, rol değiştirme, pasifleştirme ve geri alma (`services/staff-accounts.ts`).
 */
export function registerInstitutionMemberRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const admin = app.requireRole(['yonetici'])
  const write = [admin, app.requireFreshSession]

  typed.get(
    '/api/v1/institution-members',
    {
      preValidation: admin,
      schema: {
        operationId: 'listInstitutionMembers',
        tags: ['institution'],
        summary: 'Kurum kullanıcıları',
        description:
          'Etkin kurumun üyelerini görünen ad, rol, durum, bağlı kişi, pasifleştirme anı ve oluşturulma tarihiyle sayfalı döndürür. E-posta yalnız yöneticiye döner; telefon, parola, oturum ve IP dönmez. Yalnız yönetici (diğer roller 403). Okuma denetim kaydı üretmez.',
        querystring: institutionMemberListQuerySchema,
        response: { 200: institutionMemberListResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize, q, role, status, sort } = request.query
      const result = await listInstitutionMembers(
        ctx.db,
        ctx.institutionId,
        { page, pageSize, q, role, status, sort },
        ctx.log,
      )
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/institution-members/invitations',
    {
      preValidation: admin,
      schema: {
        operationId: 'listStaffInvitations',
        tags: ['institution'],
        summary: 'Bekleyen personel davetleri',
        description:
          'Etkin kurumun bekleyen (kişinin henüz giriş yapmadığı) personel davetleri, yeni önce (DOM-YTK-070). Yalnız yönetici (diğer roller 403). Okuma denetim kaydı üretmez.',
        querystring: staffInvitationListQuerySchema,
        response: { 200: staffInvitationListResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize } = request.query
      const result = await listStaffInvitations(ctx.db, ctx.institutionId, { page, pageSize })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.post(
    '/api/v1/institution-members/invitations',
    {
      preValidation: write,
      schema: {
        operationId: 'inviteStaffMember',
        tags: ['institution'],
        summary: 'Personel davet et',
        description: `Yönetici, öğretmen ya da ön büro hesabı açar (DOM-YTK-070, IST-007): kullanıcı (parolasız), üyelik ve isteğe bağlı öğretmen kaydı bağlantısı (\`teacherId\`, yalnız öğretmen rolünde) aynı işlemde yazılır; Better Auth daveti kişi ilk girişini yapana kadar \`pending\` kalır. İşlemden sonra kişiye parola belirleme bağlantısı (parola sıfırlama akışı) gönderilir. E-posta başka kurumda hesaplıysa yeni hesap açılmaz, hesap bu kuruma da üye olur. Kurumda kayıtlı e-posta 409 \`member_exists\`, bekleyen davet 409 \`invitation_exists\`, kurumda olmayan öğretmen kaydı 404, başka hesaba bağlı öğretmen kaydı 409 \`teacher_already_linked\`. Öğrenci ve veli hesapları kayıt aktarımıyla açılır (400). \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. ${WRITE_ACCESS}`,
        body: staffInvitationInputSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: staffInvitationResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const ctx = contextOf(request)
      const response = await inviteStaffMember(
        ctx,
        app.auth,
        request.body,
        idempotencyOf(request, true),
      )
      if (!response.replayed) await sendStaffPasswordLink(ctx, app.auth, request.body.email)
      reply.header('location', '/api/v1/institution-members/invitations')
      return send(reply, response, staffInvitationResponseSchema)
    },
  )

  typed.post(
    '/api/v1/institution-members/invitations/:invitationId/cancel',
    {
      preValidation: write,
      schema: {
        operationId: 'cancelStaffInvitation',
        tags: ['institution'],
        summary: 'Personel davetini iptal et',
        description: `Bekleyen daveti iptal eder (DOM-YTK-070): davet \`canceled\` olur, davetle açılan üyelik ve öğretmen bağlantısı silinir; kişinin başka kurumda üyeliği yoksa açık parola bağlantısı geçersizleşir, hiç parola koymadıysa hesabı da silinir. Bekleyen olmayan davet 409 \`invitation_not_pending\`. \`Idempotency-Key\` isteğe bağlı. ${WRITE_ACCESS}`,
        params: staffInvitationParamsSchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 200: staffInvitationResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      return send(
        reply,
        await cancelStaffInvitation(
          contextOf(request),
          app.auth,
          request.params.invitationId,
          idempotencyOf(request, false),
        ),
        staffInvitationResponseSchema,
      )
    },
  )

  typed.post(
    '/api/v1/institution-members/:membershipId/role',
    {
      preValidation: write,
      schema: {
        operationId: 'changeStaffRole',
        tags: ['institution'],
        summary: 'Personel rolünü değiştir',
        description: `Yönetici, öğretmen ve ön büro arasında rol değiştirir (DOM-YTK-070). Aynı rol yazmaz (200, denetim yok). Kendi rolü 422 \`self_role_change\`; kurumdaki son etkin yönetici 422 \`last_admin\`; pasif hesap 422 \`member_deactivated\`; öğrenci ve veli hesabı 422 \`member_not_staff\`. Rol her istekte okunur; değişiklik kişinin bir sonraki isteğinde geçerlidir. \`Idempotency-Key\` isteğe bağlı. ${WRITE_ACCESS}`,
        params: institutionMemberParamsSchema,
        body: staffRoleChangeInputSchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 200: institutionMemberResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      return send(
        reply,
        await changeStaffRole(
          contextOf(request),
          app.auth,
          request.params.membershipId,
          request.body,
          idempotencyOf(request, false),
        ),
        institutionMemberResponseSchema,
      )
    },
  )

  for (const active of [false, true]) {
    typed.post(
      `/api/v1/institution-members/:membershipId/${active ? 'reactivate' : 'deactivate'}`,
      {
        preValidation: write,
        schema: {
          operationId: active ? 'reactivateStaffMember' : 'deactivateStaffMember',
          tags: ['institution'],
          summary: active ? 'Personel hesabını etkinleştir' : 'Personel hesabını pasifleştir',
          description: active
            ? `Pasifleştirilen personel hesabını geri alır (DOM-YTK-070); kişi yeniden giriş yapabilir. Etkin hesap yazılmaz (200, denetim yok). Öğrenci ve veli hesabı 422 \`member_not_staff\`. \`Idempotency-Key\` isteğe bağlı. ${WRITE_ACCESS}`
            : `Personel hesabını pasifleştirir (DOM-YTK-070): üyelik kimlik doğrulamada yok sayılır, kişinin bu kurumdaki oturumları kapatılır; kayıtları ve geçmişi korunur. Pasif hesap yazılmaz (200, denetim yok). Kendi hesabı 422 \`self_deactivate\`; kurumdaki son etkin yönetici 422 \`last_admin\`; öğrenci ve veli hesabı 422 \`member_not_staff\`. \`Idempotency-Key\` isteğe bağlı. ${WRITE_ACCESS}`,
          params: institutionMemberParamsSchema,
          headers: commandHeadersSchema('optional', { ifMatch: false }),
          response: { 200: institutionMemberResponseSchema, ...commandErrors },
        },
      },
      async (request, reply) => {
        ifMatchVersion(request, false)
        return send(
          reply,
          await setStaffActive(
            contextOf(request),
            app.auth,
            request.params.membershipId,
            active,
            idempotencyOf(request, false),
          ),
          institutionMemberResponseSchema,
        )
      },
    )
  }
}
