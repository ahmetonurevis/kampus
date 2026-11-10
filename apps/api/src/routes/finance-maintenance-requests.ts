import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import {
  MAINTENANCE_MANAGE_ROLES,
  MAINTENANCE_REPORT_ROLES,
  maintenanceAssignSchema,
  maintenanceCancelSchema,
  maintenanceNoteSchema,
  maintenanceRequestSchema,
  maintenanceResolveSchema,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  assignMaintenanceCommand,
  cancelMaintenanceCommand,
  closeMaintenanceCommand,
  getMaintenanceRequestFor,
  listMaintenanceRequestsFor,
  reportMaintenanceCommand,
  resolveMaintenanceCommand,
  startMaintenanceCommand,
} from '../services/finance-maintenance-requests.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  maintenanceListQuery,
  maintenanceListResponse,
  maintenanceParams,
  maintenanceResponse,
} from './finance-maintenance-requests.schemas.ts'

/**
 * Arıza ve bakım talebi uçları (docs/domain/finans.md DOM-FIN-089; ON-239). Modül `finance`.
 * Bildirim, okuma ve kendi açık bildirimini iptal: yönetici, ön büro ve öğretmen (öğretmen yalnız
 * kendi bildirimlerini görür, K-238). Atama, başlatma, çözüm ve kapatma yalnız yönetici (K-237).
 * Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Maliyet yalnız yöneticiye döner.
 */

const REPORTERS =
  'Rol: `yonetici`, `onburo`, `ogretmen` (öğretmen yalnız kendi bildirimlerini görür; K-238). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-237). Modül `finance`.'
const URL = '/api/v1/finance/maintenance-requests'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

type Transition = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => Promise<CommandResponse>

export function registerFinanceMaintenanceRequestRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const reporters: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(MAINTENANCE_REPORT_ROLES),
  ]
  const managers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(MAINTENANCE_MANAGE_ROLES),
  ]
  const tags = ['finance-maintenance']

  typed.get(
    URL,
    {
      preValidation: reporters,
      schema: {
        operationId: 'listMaintenanceRequests',
        tags,
        summary: 'Arıza ve bakım taleplerini listele',
        description: `Kapatılmamış ve iptal edilmemiş talepler önce; içlerinde acil önce, yeni bildirim önce. \`status\`, \`state\` (\`active\`/\`done\`), \`priority\` ve \`assetId\` (demirbaşın arıza geçmişi) süzer; \`q\` başlık, yer, demirbaş etiketi ve adında ya da talep numarasında arar (DOM-FIN-089). Öğretmen yalnız kendi bildirimlerini görür; maliyet yalnız yönetici yanıtındadır. ${REPORTERS}`,
        querystring: maintenanceListQuery,
        response: { 200: maintenanceListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listMaintenanceRequestsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${URL}/:requestId`,
    {
      preValidation: reporters,
      schema: {
        operationId: 'getMaintenanceRequest',
        tags,
        summary: 'Arıza talebi ayrıntısı ve iş emri geçmişi',
        description: `Talep, sorumlu, çözüm ve iş emri geçmişi (kim, ne zaman, not; K-237); iş emri PDF'inin verisi. Olmayan, başka kurumun ya da öğretmen için başkasının talebi 404. ${REPORTERS}`,
        params: maintenanceParams,
        response: { 200: maintenanceResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getMaintenanceRequestFor(contextOf(request), request.params.requestId),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...reporters, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'reportMaintenanceRequest',
        tags,
        summary: 'Arıza bildir',
        description: `Başlık, açıklama, isteğe bağlı kampüs, yer, isteğe bağlı demirbaş etiketi ve öncelik (K-236); talep \`open\` durumunda ve \`AT-<sıra>\` numarasıyla açılır. Kurumda olmayan etiket (başka kurumun etiketi dahil) 422 \`maintenance_asset_not_found\`, hurdaya ayrılmış demirbaş 422 \`maintenance_asset_scrapped\`, olmayan kampüs 422 \`maintenance_campus_not_found\`. Gövdedeki \`institutionId\` 400. ${REPORTERS}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: maintenanceRequestSchema,
        response: { 201: maintenanceResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await reportMaintenanceCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = maintenanceResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  function transition(
    verb: string,
    operationId: string,
    summary: string,
    description: string,
    body: z.ZodType,
    guards: preValidationAsyncHookHandler[],
    run: Transition,
  ) {
    typed.post(
      `${URL}/:requestId/${verb}`,
      {
        preValidation: [...guards, requireIfMatch(), captureInput()],
        schema: {
          operationId,
          tags,
          summary,
          description: `${description} Geçersiz geçiş 422 \`maintenance_status_invalid\`; başka kurumun talebi 404; \`If-Match\` zorunlu, sürüm tutmazsa 409.`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: maintenanceParams,
          body,
          response: { 200: maintenanceResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await run(
          contextOf(request),
          request.params.requestId,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return maintenanceResponse.parse(sendBody(reply, result))
      },
    )
  }

  transition(
    'assign',
    'assignMaintenanceRequest',
    'İş emrini ata',
    `Personele (\`assigneeType: staff\`, kurumun etkin yönetici, öğretmen ya da ön büro üyeliği) ya da tedarikçiye (\`assigneeType: supplier\`, etkin tedarikçi) atar; açık talep \`assigned\` olur, atanmış ya da üzerinde çalışılan talepte yalnız sorumlu değişir (K-237). Olmayan üyelik 422 \`maintenance_assignee_not_found\`, öğrenci ya da veli 422 \`maintenance_assignee_not_staff\`, pasif personel 422 \`maintenance_assignee_inactive\`, olmayan tedarikçi 422 \`maintenance_supplier_not_found\`, pasif tedarikçi 422 \`maintenance_supplier_inactive\`, aynı sorumlu 422 \`maintenance_same_assignee\`. ${MANAGER}`,
    maintenanceAssignSchema,
    managers,
    assignMaintenanceCommand,
  )
  transition(
    'start',
    'startMaintenanceRequest',
    'İşe başla',
    `Atanmış talep \`in_progress\` olur; isteğe bağlı not. ${MANAGER}`,
    maintenanceNoteSchema,
    managers,
    startMaintenanceCommand,
  )
  transition(
    'resolve',
    'resolveMaintenanceRequest',
    'İş emrini çöz',
    `Atanmış ya da üzerinde çalışılan talep \`resolved\` olur: çözüm günü, yapılan iş, isteğe bağlı maliyet (kuruş) ve tedarikçi (K-237). Gelecek gün 422 \`maintenance_date_in_future\`, bildirim gününden önce 422 \`maintenance_resolved_before_report\`, olmayan tedarikçi 422 \`maintenance_supplier_not_found\`. ${MANAGER}`,
    maintenanceResolveSchema,
    managers,
    resolveMaintenanceCommand,
  )
  transition(
    'close',
    'closeMaintenanceRequest',
    'İş emrini kapat',
    `Çözülmüş talep \`closed\` olur; kapatılan talep yeniden açılmaz. ${MANAGER}`,
    maintenanceNoteSchema,
    managers,
    closeMaintenanceCommand,
  )
  transition(
    'cancel',
    'cancelMaintenanceRequest',
    'Arıza talebini iptal et',
    `Gerekçeyle iptal (K-237). Yönetici açık, atanmış ya da üzerinde çalışılan talebi iptal eder; ön büro ve öğretmen yalnız kendi bildirimini ve atanmamışken (başkasının bildirimi 403 \`maintenance_not_owner\`, atanmış talep 422 \`maintenance_not_cancellable\`). ${REPORTERS}`,
    maintenanceCancelSchema,
    reporters,
    cancelMaintenanceCommand,
  )
}
