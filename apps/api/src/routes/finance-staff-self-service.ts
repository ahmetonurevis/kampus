import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  myLeaveRequestInputSchema,
  STAFF_CHANGE_APPROVER_ROLES,
  STAFF_SELF_SERVICE_ROLES,
  staffChangeRejectSchema,
  staffChangeRequestInputSchema,
} from '@kampus/school-core/lib/finance-staff-self-service.ts'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { ownPayslipMonthsFor, payrollPayslipsFor } from '../services/finance-payroll-payslips.ts'
import { ownStaffDocumentsFor } from '../services/finance-staff-documents.ts'
import {
  approveStaffChangeRequestCommand,
  cancelOwnChangeRequestCommand,
  createOwnChangeRequestCommand,
  createOwnLeaveRequestCommand,
  listOwnChangeRequestsFor,
  listStaffChangeRequestsFor,
  ownLeaveFor,
  ownStaffProfileFor,
  rejectStaffChangeRequestCommand,
  staffChangeRequestFileUrl,
  type StaffSelfServiceDeps,
} from '../services/finance-staff-self-service.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { payrollPayslipsResponse } from './finance-payroll-payslips.schemas.ts'
import { payrollMonthParams } from './finance-payroll-runs.schemas.ts'
import {
  ownChangeRequestListQuery,
  ownLeaveQuery,
  ownLeaveRequestResponse,
  ownLeaveResponse,
  ownPayslipMonthsResponse,
  ownStaffDocumentsResponse,
  ownStaffProfileResponse,
  staffChangeRequestListQuery,
  staffChangeRequestListResponse,
  staffChangeRequestParams,
  staffChangeRequestResponse,
} from './finance-staff-self-service.schemas.ts'
import { staffDocumentFileUrlResponse } from './finance-staff-documents.schemas.ts'

/**
 * Personel self-servisi uçları (docs/domain/finans.md DOM-FIN-166; ON-189; K-553…K-555). Modül
 * `finance`. `my-*` uçları oturumdaki personelindir (yönetici, öğretmen, ön büro); istekte
 * personel kimliği yoktur, başka personelin talebi 404, öğrenci ve veli 403. Onay kuyruğu
 * (`staff-change-requests`) yalnız yöneticide. Sıra: 401 → 403 modül → 403 rol → `If-Match` →
 * 400 → işlem.
 */

const SELF =
  'Rol: personel (`yonetici`, `ogretmen`, `onburo`), yalnız kendi kaydı; öğrenci ve veli 403. Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (K-553). Modül `finance`.'
const OWN = '/api/v1/finance/my-change-requests'
const QUEUE = '/api/v1/finance/staff-change-requests'
const PAYSLIPS = '/api/v1/finance/my-payslips'
const EXPORTS_PER_MINUTE = 10

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

const isBankChange = (body: unknown) =>
  typeof body === 'object' && body !== null && (body as { kind?: unknown }).kind === 'bank'

export function registerFinanceStaffSelfServiceRoutes(
  app: FastifyInstance,
  storage: StorageDriver,
) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const deps: StaffSelfServiceDeps = { cipher: fieldCipherFromConfig(app.config) }
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const self = guarded(STAFF_SELF_SERVICE_ROLES)
  const manager = guarded(STAFF_CHANGE_APPROVER_ROLES)
  const tags = ['finance-staff-self-service']

  typed.get(
    '/api/v1/finance/my-staff-profile',
    {
      preValidation: self,
      schema: {
        operationId: 'getOwnStaffProfile',
        tags,
        summary: 'Bilgilerim: özlük özetim',
        description: `Oturumdaki personelin özlük kartı (DOM-FIN-140), salt okunur: kimlik (maskeli T.C. kimlik no), iletişim, eğitim, banka (maskeli IBAN), acil durum kişileri. Kart yoksa \`file: null\`. \`pendingKinds\` onay bekleyen talebin türleridir. Değişiklik \`POST /finance/my-change-requests\` ile talep edilir (K-553). ${SELF}`,
        response: { 200: ownStaffProfileResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await ownStaffProfileFor(contextOf(request), deps) }),
  )

  typed.get(
    OWN,
    {
      preValidation: self,
      schema: {
        operationId: 'listOwnChangeRequests',
        tags,
        summary: 'Değişiklik taleplerim',
        description: `Oturumdaki personelin değişiklik talepleri, bekleyenler önce; IBAN maskeli, ret gerekçesi görünür. ${SELF}`,
        querystring: ownChangeRequestListQuery,
        response: { 200: staffChangeRequestListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status } = request.query
      const { items, total } = await listOwnChangeRequestsFor(contextOf(request), deps, {
        page,
        pageSize,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    OWN,
    {
      preValidation: [...self, rejectIfMatch(), captureInput()],
      preHandler: async (request, reply) => {
        // IBAN değişikliğinde ek doğrulama (K-554): taze oturum.
        if (isBankChange(request.body)) await app.requireFreshSession.call(app, request, reply)
      },
      schema: {
        operationId: 'createOwnChangeRequest',
        tags,
        summary: 'Değişiklik talep et',
        description: `Tür (\`kind\`) ve önerilen değerler (K-553): \`contact\` adres (10–500) ve/veya telefon (0XXXXXXXXXX; \`null\` temizler), \`emergency_contacts\` acil durum kişilerinin yeni listesi (1–5), \`bank\` TR IBAN (mod-97) ve hesap sahibi, \`document\` özlük belgesi (tür, sağlık raporunda işe giriş/periyodik, belge günü, isteğe bağlı \`document\` amaçlı dosya ve not). **Banka talebi taze oturum ister** (eskiyse 403 \`reauthentication_required\`) ve hesap sahibi personelin kendi adı olmalı (422 \`staff_change_bank_holder_mismatch\`; K-554). Aynı türde bekleyen talep varsa 409 \`staff_change_request_pending_exists\` (belge talebinde en çok 10 bekleyen, sonra 422 \`staff_change_document_pending_limit\`); kartta zaten kayıtlı değer 422 \`staff_change_request_unchanged\`; ayrılmış personel 422 \`staff_self_service_inactive\`. Belge tarihi bugünden sonra 422 \`staff_document_date_in_future\`; özel nitelikli belgeye not 422 \`staff_document_sensitive_note\`. Dosya yükleyenin, hazır ve bağsız olmalı (422 \`file_unavailable\`); öğretmen \`document\` amaçlı dosya yükleyemez, belgeyi dosyasız bildirir. Talep "onay bekliyor" olarak girer. Denetim kaydına tür ve alan adları yazılır, değer yazılmaz. \`Idempotency-Key\` isteğe bağlı. ${SELF}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: staffChangeRequestInputSchema,
        response: { 201: staffChangeRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createOwnChangeRequestCommand(
        contextOf(request),
        deps,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = staffChangeRequestResponse.parse(sendBody(reply, result))
      reply.header('location', `${OWN}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${OWN}/:requestId/cancel`,
    {
      preValidation: [...self, requireIfMatch()],
      schema: {
        operationId: 'cancelOwnChangeRequest',
        tags,
        summary: 'Değişiklik talebimi geri çek',
        description: `Bekleyen kendi talebini geri çeker; belge dosyasının talep bağı kalkar. Bekleyen olmayan talep 422 \`staff_change_request_not_pending\`. Başka personelin ya da başka kurumun talebi 404. \`If-Match\` zorunlu; sürüm tutmazsa 409. ${SELF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: staffChangeRequestParams,
        response: { 200: staffChangeRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelOwnChangeRequestCommand(
        contextOf(request),
        deps,
        request.params.requestId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffChangeRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/my-staff-documents',
    {
      preValidation: self,
      schema: {
        operationId: 'listOwnStaffDocuments',
        tags,
        summary: 'Özlük belgelerim',
        description: `Oturumdaki personelin kayıtlı özlük belgeleri (DOM-FIN-113; yerine geçilenler dahil) ve eksik zorunlu türler. Kendi verisi olduğundan özel nitelikli belgede de tür, tarihler ve dosya adı döner; dosya self-servisten açılmaz (K-555). Onay bekleyen belge talepleri \`GET /finance/my-change-requests\` içindedir. ${SELF}`,
        response: { 200: ownStaffDocumentsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await ownStaffDocumentsFor(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/finance/my-leave',
    {
      preValidation: self,
      schema: {
        operationId: 'getOwnLeave',
        tags,
        summary: 'İzin bakiyem',
        description: `Oturumdaki personelin \`date\` (varsayılan bugün) gününe göre yıllık izin hak edişi ve bakiyesi (DOM-FIN-109: kalan, kullanılan, planlanan), kullanılmış izin kayıtları, son 50 izin talebi (DOM-FIN-116; bekleyenler önce) ve talep açılabilecek türler (K-555). İzin profili yoksa \`entitlement: null\`. ${SELF}`,
        querystring: ownLeaveQuery,
        response: { 200: ownLeaveResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await ownLeaveFor(contextOf(request), request.query.date) }),
  )

  typed.post(
    '/api/v1/finance/my-leave-requests',
    {
      preValidation: [...self, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createOwnLeaveRequest',
        tags,
        summary: 'İzin talep et',
        description: `Oturumdaki personel adına izin talebi (DOM-FIN-116, K-555): tür, ilk ve son gün, iş günü, isteğe bağlı açıklama. Yönetici talebinin aynı kuralları uygulanır (çakışan talep 422, onaylı bordro ayı 409); öğretmende etkilenen dersler talebe kopyalanır, yedeği onayda yönetici seçer. Talep "onay bekliyor" olarak girer. Yanıtta yedek adayı ve ders ayrıntısı yoktur. \`Idempotency-Key\` zorunlu. ${SELF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: myLeaveRequestInputSchema,
        response: { 201: ownLeaveRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createOwnLeaveRequestCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return ownLeaveRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    PAYSLIPS,
    {
      preValidation: self,
      schema: {
        operationId: 'listOwnPayslipMonths',
        tags,
        summary: 'Bordro pusulalarım',
        description: `Onaylı (kilitli) bordro dönemlerinde oturumdaki personelin kayıtlı hesapta satırı olan ayları, yeniden eskiye (DOM-FIN-119, K-555). Tutar dönmez; pusula \`GET /finance/my-payslips/{month}\` ile üretilir. ${SELF}`,
        response: { 200: ownPayslipMonthsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await ownPayslipMonthsFor(contextOf(request)) }),
  )

  typed.get(
    `${PAYSLIPS}/:month`,
    {
      config: {
        rateLimit: {
          max: EXPORTS_PER_MINUTE,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            `payroll-payslip-export:${request.auth?.userId ?? request.ip}`,
        },
      },
      preValidation: [
        ...self,
        async function (request, reply) {
          await app.requireFreshSession.call(app, request, reply)
        },
      ],
      schema: {
        operationId: 'getOwnPayslip',
        tags,
        summary: 'Bordro pusulam (PDF verisi)',
        description: `Oturumdaki personelin ayın etkin kayıtlı hesabından ücret hesap pusulası verisi (DOM-FIN-119 içeriği, K-407); PDF web'de üretilir. Yalnız onaylı (kilitli) dönem: onaysız ay, kayıtlı hesabı olmayan ay ve hesapta satırı olmayan personel 404. Yönetici pusulasıyla aynı kurallar (K-555): taze oturum (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk (yönetici pusulasıyla ortak sayaç), \`finance.payroll_payslip.export\` denetim kaydı (satır kimliği, yalnız alan adları). ${SELF}`,
        params: payrollMonthParams,
        response: { 200: payrollPayslipsResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      return {
        data: await payrollPayslipsFor(ctx, request.params.month, ctx.actor.membershipId, {
          lockedOnly: true,
        }),
      }
    },
  )

  typed.get(
    QUEUE,
    {
      preValidation: manager,
      schema: {
        operationId: 'listStaffChangeRequests',
        tags,
        summary: 'Değişiklik talepleri (onay kuyruğu)',
        description: `Personelin değişiklik talepleri, bekleyenler önce; durum, tür ve personel adıyla süzülür. Öneri IBAN'ı maskelidir; belge dosyası \`GET …/{requestId}/file-url\` ile açılır. ${MANAGER}`,
        querystring: staffChangeRequestListQuery,
        response: { 200: staffChangeRequestListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, kind, q } = request.query
      const { items, total } = await listStaffChangeRequestsFor(contextOf(request), deps, {
        page,
        pageSize,
        status,
        kind,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${QUEUE}/:requestId/approve`,
    {
      preValidation: [...manager, requireIfMatch()],
      schema: {
        operationId: 'approveStaffChangeRequest',
        tags,
        summary: 'Değişiklik talebini onayla',
        description: `Onay aynı transaction'da kaydı yazar (K-553): kart talebinde özlük kartı (yoksa açılır; DOM-FIN-140 kuralları, ayrılmış personele yeni kart 422 \`personnel_file_staff_inactive\`), belge talebinde özlük belgesi (DOM-FIN-113 kuralları; dosya talepten belgeye taşınır, tekil türde eski belgenin yerine geçer). Bekleyen olmayan talep 422 \`staff_change_request_not_pending\`. Denetim kaydına talep ve kartın değişen alan adları yazılır. \`If-Match\` zorunlu; sürüm tutmazsa 409. Başka kurumun talebi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: staffChangeRequestParams,
        response: { 200: staffChangeRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await approveStaffChangeRequestCommand(
        contextOf(request),
        deps,
        request.params.requestId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffChangeRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${QUEUE}/:requestId/reject`,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'rejectStaffChangeRequest',
        tags,
        summary: 'Değişiklik talebini reddet',
        description: `Gerekçeyle ret (5–500; personele gösterilir, denetim kaydına yazılmaz). Belge dosyasının talep bağı kalkar. Bekleyen olmayan talep 422 \`staff_change_request_not_pending\`. \`If-Match\` zorunlu; sürüm tutmazsa 409. Başka kurumun talebi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: staffChangeRequestParams,
        body: staffChangeRejectSchema,
        response: { 200: staffChangeRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await rejectStaffChangeRequestCommand(
        contextOf(request),
        deps,
        request.params.requestId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffChangeRequestResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${QUEUE}/:requestId/file-url`,
    {
      preValidation: manager,
      schema: {
        operationId: 'getStaffChangeRequestFileUrl',
        tags,
        summary: 'Belge talebinin dosyasını aç',
        description: `Bekleyen belge talebinin dosyası için kısa ömürlü imzalı bağlantı (5 dk). Her üretim \`finance.staff_change_request.file_open\` denetimine yazılır; denetim yazılamazsa bağlantı dönmez. Dosyasız talep 422 \`staff_change_request_no_file\`; onaylanmış talepte dosya özlük belgesinin ucundan, reddedilen ya da geri çekilen talepte hiç açılmaz (404). Dosya \`GET /files/{fileId}/url\` yolundan açılmaz. Başka kurumun talebi 404. ${MANAGER}`,
        params: staffChangeRequestParams,
        response: { 200: staffDocumentFileUrlResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await staffChangeRequestFileUrl(contextOf(request), storage, request.params.requestId),
    }),
  )
}
