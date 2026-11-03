import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { guardianInvitationInputSchema } from '@kampus/school-core/lib/guardian-invitations.ts'
import {
  staffInvitationInputSchema,
  staffRoleChangeInputSchema,
} from '@kampus/school-core/lib/staff-accounts.ts'
import { staffImportInputSchema } from '@kampus/school-core/lib/staff-import.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { inviteGuardianAccount } from '../services/guardian-invitations.ts'
import { listInstitutionMembers } from '../services/institution-members.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  cancelStaffInvitation,
  changeStaffRole,
  inviteStaffMember,
  listStaffInvitations,
  setStaffActive,
} from '../services/staff-accounts.ts'
import { importStaffMembers } from '../services/staff-import.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  guardianInvitationResponseSchema,
  institutionMemberListQuerySchema,
  institutionMemberListResponseSchema,
  institutionMemberParamsSchema,
  institutionMemberResponseSchema,
  staffInvitationListQuerySchema,
  staffInvitationListResponseSchema,
  staffInvitationParamsSchema,
  staffImportResponseSchema,
  staffInvitationResponseSchema,
} from './institution-members.schemas.ts'

/** CSV gövdesi (en çok 600.000 karakter, çok baytlı Türkçe harflerle) için gövde sınırı. */
const IMPORT_BODY_LIMIT = 2 * 1024 * 1024

const WRITE_ACCESS =
  'Yalnız yönetici (diğer roller 403; rol ve pasiflik kurum kilidi altında yeniden doğrulanır); taze oturum ister (15 dakikadan eski oturum 403 `reauthentication_required`). Kurum oturumdan gelir; başka kurumun kaydı 404. Yazma ve denetim kaydı (`audit_log`, yalnız alan adları) tek transaction’dadır.'

/** Komut yanıtı; tekrarlanan yanıt veritabanından geldiği için şemayla yeniden okunur. */
function send<T>(reply: FastifyReply, response: CommandResponse, schema: z.ZodType<T>): T {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body)
}

/**
 * Ayarlar → Kullanıcı & Yetkiler (DOM-YTK-020, DOM-YTK-070). Yalnız yönetici; kurum oturumdan
 * gelir, sorguda kurum kimliği kabul edilmez. Okuma: üyeler ve bekleyen davetler. Yazma: personel
 * daveti ve iptali, rol değiştirme, pasifleştirme ve geri alma (`services/staff-accounts.ts`),
 * toplu personel aktarımı (`services/staff-import.ts`, IST-007). Veli hesabı daveti
 * (`services/guardian-invitations.ts`, DOM-YTK-071) yönetici ve ön büroya açıktır.
 */
export function registerInstitutionMemberRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const admin = app.requireRole(['yonetici'])
  const write = [admin, app.requireFreshSession]
  const guardianRoles = WRITE_ACTION_ROLES['guardian.invite']
  const guardianWrite = [app.requireRole(guardianRoles), app.requireFreshSession]

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
        description: `Yönetici, öğretmen ya da ön büro hesabı açar (DOM-YTK-070, IST-007): kullanıcı (parolasız), üyelik ve isteğe bağlı öğretmen kaydı bağlantısı (\`teacherId\`, yalnız öğretmen rolünde) aynı işlemde yazılır; Better Auth daveti kişi ilk girişini yapana kadar \`pending\` kalır. Kişiye parola belirleme bağlantısı (parola sıfırlama akışı) yanıtı beklemeden gönderilir (kuyruk açıkken \`staff.password-link\` işi). E-posta başka kurumda hesaplıysa üyelik açılmaz ve ileti gitmez; yalnız bekleyen davet yazılır, öğretmen kaydı davette saklanır ve kabulde bağlanır. Yanıtın durum kodu ve alanları iki durumda aynıdır, ad yöneticinin girdiğidir: e-postanın başka kurumda hesabı olup olmadığı yanıttan anlaşılmaz. Kurumda kayıtlı e-posta 409 \`member_exists\`, bekleyen davet 409 \`invitation_exists\`, kurumda olmayan öğretmen kaydı 404, başka hesaba bağlı öğretmen kaydı 409 \`teacher_already_linked\`, kurumun bekleyen başka bir davetinin tuttuğu öğretmen kaydı 409 \`teacher_invitation_pending\`. Öğrenci hesapları kayıt aktarımıyla açılır; \`veli\` rolü 400, veli hesabı \`POST /api/v1/institution-members/guardian-invitations\` (\`inviteGuardianAccount\`) ile açılır. \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. ${WRITE_ACCESS}`,
        body: staffInvitationInputSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: staffInvitationResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const response = await inviteStaffMember(
        contextOf(request),
        app.auth,
        app.staffLinks.scheduler,
        request.body,
        idempotencyOf(request, true),
      )
      reply.header('location', '/api/v1/institution-members/invitations')
      return send(reply, response, staffInvitationResponseSchema)
    },
  )

  typed.post(
    '/api/v1/institution-members/guardian-invitations',
    {
      preValidation: guardianWrite,
      schema: {
        operationId: 'inviteGuardianAccount',
        tags: ['institution'],
        summary: 'Veli hesabı davet et',
        description: `Kesin kayıttan sonra velinin hesabını açar (DOM-YTK-071): kullanıcı (parolasız), \`veli\` üyeliği ve seçilen her öğrenci (\`studentIds\`, 1–10, benzersiz) için çocuk bağlantısı aynı işlemde yazılır. \`parentId\` verilirse o veli kaydının seçilen öğrencilerdeki velayet bağları hesaba bağlanır; kayıt seçilen bir öğrencinin velisi değilse 422 \`guardian_record_not_linked\`, bağı başka hesaba bağlıysa ya da kayıt bekleyen bir veli davetinde tutuluyorsa 409 \`guardian_link_exists\`, kayıt başka öğrencide başka hesapla eşlenmişse 422 \`guardian_identity_mismatch\`. \`parentId\` verilmezse velayet bağı kurulmaz ve hesap öğrencinin verisini görmez: velayet ve yakınlık \`POST /api/v1/students/{studentId}/guardians\` (\`membershipId\` ile) girilir. Better Auth daveti kişi ilk girişini yapana kadar \`pending\` kalır; parola belirleme bağlantısı personel davetindeki gibi yanıtı beklemeden gider (kuyruk açıkken \`staff.password-link\` işi). E-posta başka kurumda hesaplıysa üyelik, bağlantı ve bağ yazılmaz, ileti gitmez; öğrenciler ve veli kaydı davette saklanır ve kabulde bağlanır. Yanıtın durum kodu ve alanları iki durumda aynıdır (karar 73). Kurumda kayıtlı e-posta 409 \`member_exists\` (kardeş kaydındaki mevcut veli hesabı bağ ucuyla bağlanır), bekleyen davet 409 \`invitation_exists\`; olmayan, arşivli ya da başka kurumun öğrencisi veya veli kaydı 404. \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. Yalnız ${guardianRoles.map((role) => `\`${role}\``).join(', ')} (diğer roller 403; rol ve pasiflik kurum kilidi altında yeniden doğrulanır); taze oturum ister (15 dakikadan eski oturum 403 \`reauthentication_required\`). Kurum oturumdan gelir. Yazma ve denetim kaydı (\`audit_log\`, yalnız alan adları) tek transaction’dadır.`,
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
    '/api/v1/institution-members/imports',
    {
      preValidation: write,
      bodyLimit: IMPORT_BODY_LIMIT,
      schema: {
        operationId: 'importStaffMembers',
        tags: ['institution'],
        summary: 'Personeli toplu aktar (CSV)',
        description: `Yönetici, öğretmen ve ön büro hesaplarını CSV dosyasıyla toplu davet eder (IST-007, DOM-YTK-070). Başlık satırı zorunludur; sütunlar \`ad\`, \`e-posta\`, \`rol\` ve öğretmen için isteğe bağlı \`branş\`, \`kampüs\` (ayraç \`;\`, sekme ya da \`,\`; sıra serbest). En çok 1.000 veri satırı. Bütün satırlar kurum kilidi altında doğrulanmadan hiçbir kayıt yazılmaz: geçersiz ad/e-posta/rol, dosyada yinelenen e-posta, kurumda kayıtlı e-posta (\`member_exists\`), bekleyen davet (\`invitation_exists\`), bulunamayan ya da uyuşmayan branş/kampüs başka hesaba bağlı (\`teacher_already_linked\`) ya da bekleyen bir davetin tuttuğu (\`teacher_invitation_pending\`) öğretmen kaydı satır numarasıyla raporlanır. Öğretmen satırı aynı e-postalı (yoksa aynı ad, branş ve kampüslü e-postasız) öğretmen kaydına bağlanır; kayıtta başka bir e-posta varsa satır \`teacher_email_mismatch\`; aktarım öğretmen kaydı açmaz. \`dryRun: true\` önizlemedir: 200 ve \`issues\` döner, hiçbir şey yazmaz. Aktarımda hata varsa 422 \`staff_import_invalid\` (\`issues\` yolu \`['rows', satır, alan]\`); başarı 201. Dosya düzeyindeki sorun (başlık, satır sınırı, tırnak) 422 ve sorunun kodu (ör. \`csv_too_many_rows\`). Her satır tek davetle aynı biçimde yazılır (başka kurumda hesabı olan e-postada yalnız bekleyen davet; yanıt ayırt etmez); parola belirleme bağlantıları yanıtı beklemeden yeni hesaplara gider; yanıt süresi de hesabın varlığını belli etmez. \`Idempotency-Key\` zorunlu (önizlemede saklanmaz). ${WRITE_ACCESS}`,
        body: staffImportInputSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: staffImportResponseSchema,
          201: staffImportResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const response = await importStaffMembers(
        contextOf(request),
        app.auth,
        app.staffLinks.scheduler,
        request.body,
        idempotencyOf(request, true),
      )
      return send(reply, response, staffImportResponseSchema)
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
        description: `Bekleyen daveti iptal eder (DOM-YTK-070): davet \`canceled\` olur, davetle açılan üyelik ve öğretmen bağlantısı silinir (mevcut hesaba yazılmış davette yalnız davet iptal edilir); kişinin başka kurumda üyeliği yoksa açık parola bağlantısı geçersizleşir, hiç parola koymadıysa hesabı da silinir. Bekleyen olmayan davet 409 \`invitation_not_pending\`. \`Idempotency-Key\` isteğe bağlı. ${WRITE_ACCESS}`,
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
            ? `Pasifleştirilen personel hesabını geri alır (DOM-YTK-070); kişi yeniden giriş yapabilir. Etkin hesap yazılmaz (200, denetim yok). Kendi hesabı 422 \`self_reactivate\`. Öğrenci ve veli hesabı 422 \`member_not_staff\`. \`Idempotency-Key\` isteğe bağlı. ${WRITE_ACCESS}`
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
