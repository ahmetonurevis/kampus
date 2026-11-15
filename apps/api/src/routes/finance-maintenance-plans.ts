import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  MAINTENANCE_PLAN_MANAGE_ROLES,
  MAINTENANCE_PLAN_READ_ROLES,
  maintenanceInspectionCancelSchema,
  maintenanceInspectionSchema,
  maintenancePlanSchema,
  updateMaintenancePlanSchema,
} from '@kampus/school-core/lib/finance-maintenance-plans.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveMaintenancePlanCommand,
  cancelMaintenanceInspectionCommand,
  createMaintenancePlanCommand,
  getMaintenancePlanFor,
  listMaintenancePlansFor,
  maintenancePlansCsvFor,
  openRequestFromInspectionCommand,
  recordMaintenanceInspectionCommand,
  updateMaintenancePlanCommand,
} from '../services/finance-maintenance-plans.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  maintenanceInspectionParams,
  maintenancePlanArchiveResponse,
  maintenancePlanListQuery,
  maintenancePlanListResponse,
  maintenancePlanParams,
  maintenancePlanResponse,
} from './finance-maintenance-plans.schemas.ts'

/**
 * Periyodik bakım planı uçları (docs/domain/finans.md DOM-FIN-092; ON-240). Modül `finance`.
 * Okuma yönetici ve ön büro; plan, denetim kaydı, iptal ve denetimden arıza talebi yalnız yönetici
 * (K-255). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Liste CSV'si sorumlu
 * personel adı taşır: taze oturum, kullanıcı başına 10/dk ve denetim kaydı.
 */

const READERS = 'Rol: `yonetici`, `onburo` (K-255). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-255). Modül `finance`.'
const URL = '/api/v1/finance/maintenance-plans'
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceMaintenancePlanRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const readers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(MAINTENANCE_PLAN_READ_ROLES),
  ]
  const managers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(MAINTENANCE_PLAN_MANAGE_ROLES),
  ]
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-maintenance']

  typed.get(
    URL,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `maintenance-plan-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...readers, freshForCsv],
      schema: {
        operationId: 'listMaintenancePlans',
        tags,
        summary: 'Periyodik bakım planlarını listele',
        description: `Hiç denetlenmemiş planlar önce, sonra sonraki denetim günü en yakın (geciken önce); eşitlikte ad. Son ve sonraki denetim günü ile durum her okumada hesaplanır: sonraki gün bugünden önceyse \`overdue\`, bugün dahil 30 gün içindeyse \`due_soon\`, hiç denetim yoksa \`never\` (K-253). \`due=attention\` geciken, yaklaşan ve hiç denetlenmemiş planları verir (rozet sayısı \`meta.total\`). \`type\`, \`assetId\` süzer; \`q\` ad, yer, demirbaş etiketi ve adında arar (DOM-FIN-092). \`Accept: text/csv\` süzgeçle eşleşen bütün planları CSV verir (\`;\` ayırıcı, UTF-8 BOM, formül kaçışı); sorumlu personel adı taşıdığı için taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.maintenance_plan_export\` (K-255). ${READERS}`,
        querystring: maintenancePlanListQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: maintenancePlanListResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { page, pageSize, ...filters } = request.query
      if (wantsCsv(request)) {
        const { csv, filename } = await maintenancePlansCsvFor(ctx, filters)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      const { items, total } = await listMaintenancePlansFor(ctx, { page, pageSize, ...filters })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${URL}/:planId`,
    {
      preValidation: readers,
      schema: {
        operationId: 'getMaintenancePlan',
        tags,
        summary: 'Bakım planı ayrıntısı ve denetim kayıtları',
        description: `Plan, takvimi ve denetim kayıtları (yeniden eskiye, iptal edilenler dahil; açılan arıza talebinin numarası ve durumu). Olmayan, arşivlenmiş ya da başka kurumun planı 404. ${READERS}`,
        params: maintenancePlanParams,
        response: { 200: maintenancePlanResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getMaintenancePlanFor(contextOf(request), request.params.planId),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createMaintenancePlan',
        tags,
        summary: 'Bakım planı aç',
        description: `Ad, tür, yer, isteğe bağlı kampüs, demirbaş etiketi, periyot (ay), sistemden önceki son denetim günü, sorumlu (personel ya da tedarikçi) ve yasal işaret (K-252). Periyot ve yasal işaret boşsa türün önerisi yazılır (asansör 12, yangın söndürücü 6, jeneratör 12, oyun alanı 12, kazan 12, elektrik 12 ay; mevzuat varsayımı doğrulanmalı, H-31). Olmayan etiket (başka kurumun etiketi dahil) 422 \`maintenance_plan_asset_not_found\`, hurdaya ayrılmış demirbaş 422 \`maintenance_plan_asset_scrapped\`, olmayan kampüs 422 \`maintenance_plan_campus_not_found\`, gelecek gün 422 \`maintenance_plan_date_in_future\`; olmayan, personel olmayan ya da pasif personel 422 \`maintenance_plan_responsible_not_found\` / \`_not_staff\` / \`_inactive\`, olmayan ya da pasif tedarikçi 422 \`maintenance_plan_supplier_not_found\` / \`_inactive\`. Gövdedeki \`institutionId\` 400. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: maintenancePlanSchema,
        response: { 201: maintenancePlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMaintenancePlanCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = maintenancePlanResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    `${URL}/:planId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateMaintenancePlan',
        tags,
        summary: 'Bakım planını düzelt',
        description: `Verilen alanlar değişir (K-252); yalnız değişen bağlantılar yeniden denetlenir, tür değişikliği periyodu değiştirmez. Değişiklik yoksa 422 \`maintenance_plan_unchanged\`; diğer hatalar plan açılışındaki gibidir. \`If-Match\` zorunlu, sürüm tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: maintenancePlanParams,
        body: updateMaintenancePlanSchema,
        response: { 200: maintenancePlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateMaintenancePlanCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return maintenancePlanResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${URL}/:planId`,
    {
      preValidation: [...managers, requireIfMatch()],
      schema: {
        operationId: 'archiveMaintenancePlan',
        tags,
        summary: 'Bakım planını arşivle',
        description: `Arşivli plan listede ve uyarıda görünmez; denetim kayıtları ve açılan arıza talepleri kalır. Olmayan ya da başka kurumun planı 404; \`If-Match\` zorunlu, sürüm tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: maintenancePlanParams,
        response: { 200: maintenancePlanArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveMaintenancePlanCommand(
        contextOf(request),
        request.params.planId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return maintenancePlanArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:planId/inspections`,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordMaintenanceInspection',
        tags,
        summary: 'Denetim kaydet',
        description: `Gün, yapan, sonuç (\`pass\` uygun, \`fail\` uygunsuz, \`partial\` kısmen uygun), isteğe bağlı belge no ve not; uygunsuz ve kısmen uygun sonuçta not zorunlu (400). Son ve sonraki denetim günü bu kayıttan yeniden hesaplanır (K-253, K-254). Gelecek gün 422 \`maintenance_inspection_date_in_future\`; aynı plana aynı güne iptal edilmemiş ikinci kayıt 409 \`maintenance_inspection_exists\`. Olmayan ya da başka kurumun planı 404. \`Idempotency-Key\` alabilir. Yanıt planın ayrıntısıdır. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: maintenancePlanParams,
        body: maintenanceInspectionSchema,
        response: { 201: maintenancePlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordMaintenanceInspectionCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return maintenancePlanResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:planId/inspections/:inspectionId/cancel`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelMaintenanceInspection',
        tags,
        summary: 'Denetim kaydını iptal et',
        description: `Yanlış girilen denetim gerekçeyle (5–500) iptal edilir; takvime sayılmaz, aynı güne yeniden kayıt yazılabilir. Açılmış arıza talebi değişmez. İptal edilmiş kayıt 422 \`maintenance_inspection_cancelled\`. Olmayan ya da başka kurumun planı veya denetimi 404; \`If-Match\` denetimin sürümüdür, tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: maintenanceInspectionParams,
        body: maintenanceInspectionCancelSchema,
        response: { 200: maintenancePlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelMaintenanceInspectionCommand(
        contextOf(request),
        request.params.planId,
        request.params.inspectionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return maintenancePlanResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:planId/inspections/:inspectionId/maintenance-request`,
    {
      preValidation: [...managers, requireIfMatch()],
      schema: {
        operationId: 'openMaintenanceRequestFromInspection',
        tags,
        summary: 'Uygunsuz denetimden arıza talebi aç',
        description: `Uygunsuz ya da kısmen uygun denetimden tek adımda arıza talebi (DOM-FIN-089) açar (K-254): başlık plan adından, açıklama denetimin gününden, yapanından, belge numarasından ve notundan üretilir; uygunsuz sonuç acil, kısmen uygun normal öncelikli; yer, etkin kampüs ve hurdaya ayrılmamış demirbaş plandan gelir. Talep \`open\` ve \`AT-<sıra>\` numarasıyla açılır, denetime bağlanır. Uygun sonuç 422 \`maintenance_inspection_passed\`, iptal edilmiş denetim 422 \`maintenance_inspection_cancelled\`, talep açılmışsa 409 \`maintenance_inspection_request_exists\`. Olmayan ya da başka kurumun planı veya denetimi 404; \`If-Match\` denetimin sürümüdür. Yanıt planın ayrıntısıdır; \`location\` açılan talebi gösterir. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: maintenanceInspectionParams,
        response: { 201: maintenancePlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await openRequestFromInspectionCommand(
        contextOf(request),
        request.params.planId,
        request.params.inspectionId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      const body = maintenancePlanResponse.parse(sendBody(reply, result))
      const opened = body.data.inspections.find(
        (item) => item.id === request.params.inspectionId,
      )?.maintenanceRequest
      if (opened) reply.header('location', `/api/v1/finance/maintenance-requests/${opened.id}`)
      return body
    },
  )
}
