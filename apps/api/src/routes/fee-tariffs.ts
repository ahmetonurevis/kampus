import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  createFeeTariffSchema,
  feeItemSchema,
  publishFeeTariffSchema,
  updateFeeTariffSchema,
} from '@kampus/school-core/lib/fee-tariffs.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  createFeeTariffCommand,
  getFeeTariffFor,
  listFeeTariffsFor,
  publishFeeTariffCommand,
  updateFeeTariffCommand,
} from '../services/fee-tariffs.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Ücret tarifesi uçları (ADR 0006 karar 8; docs/domain/finans.md DOM-FIN-002, -004, -006; IST-104).
 * Modül `finance`. Okuma yönetici ve ön büro, yazma yalnız yönetici (DOM-FIN-052).
 */

const tariffSchema = z.object({
  id: z.string(),
  academicYear: z.number().int().describe('Eğitim yılının başlangıç yılı'),
  versionNumber: z.number().int().describe('Yıl içinde tarife sürümü'),
  status: z.enum(['draft', 'published', 'superseded']),
  items: z.array(feeItemSchema),
  announcedDate: z.string().nullable().describe('İlan günü (YYYY-MM-DD)'),
  mebbisRecordedDate: z.string().nullable().describe("MEBBİS'e işlendiği gün (YYYY-MM-DD)"),
  publishedAt: z.string().nullable().describe('Yayım anı (ISO 8601 UTC)'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
const tariffResponseSchema = dataResponse(tariffSchema)
const paramsSchema = z.object({ tariffId: z.uuid('Tarife kimliği geçersiz.') })
const listQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  academicYear: z.coerce.number().int().min(2000).max(2100).optional().describe('Eğitim yılı'),
})

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFeeTariffRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const managers = WRITE_ACTION_ROLES['tariff.manage']
  const read = [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])]
  const write = (ifMatch: 'reject' | 'required'): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(managers),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    captureInput(),
  ]

  typed.get(
    '/api/v1/fee-tariffs',
    {
      preValidation: read,
      schema: {
        operationId: 'listFeeTariffs',
        tags: ['fee-tariffs'],
        summary: 'Ücret tarifelerini listele',
        description:
          'Kurumun tarifelerini yeni yıl ve sürüm önce listeler. `academicYear` süzer; sayfalıdır, bilinmeyen parametre 400. Roller: `yonetici`, `onburo`.',
        querystring: listQuerySchema,
        response: {
          200: z.object({ data: z.array(tariffSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listFeeTariffsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/fee-tariffs/:tariffId',
    {
      preValidation: read,
      schema: {
        operationId: 'getFeeTariff',
        tags: ['fee-tariffs'],
        summary: 'Ücret tarifesi ayrıntısı',
        description: 'Başka kurumun tarifesi 404. Roller: `yonetici`, `onburo`.',
        params: paramsSchema,
        response: { 200: tariffResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getFeeTariffFor(contextOf(request), request.params.tariffId),
    }),
  )

  typed.post(
    '/api/v1/fee-tariffs',
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'createFeeTariff',
        tags: ['fee-tariffs'],
        summary: 'Tarife taslağı aç',
        description:
          'Eğitim yılı için yeni taslak sürüm açar. Kalem türü sabit listedendir; serbest adlı borç yoktur (DOM-FIN-004). Aynı tür ve düzey 422 `tariff_item_duplicate`; açık taslak varken 409 `open_tariff_draft`. KDV oranı kalem başına ve tarihlidir, yayımlanan sürüm değişmediği için geçmiş kayıtlar eski oranla kalır (IST-104). Başarı 201 ve `Location`. Rol: `yonetici`.',
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createFeeTariffSchema,
        response: { 201: tariffResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createFeeTariffCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = tariffResponseSchema.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/fee-tariffs/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/fee-tariffs/:tariffId',
    {
      preValidation: write('required'),
      schema: {
        operationId: 'updateFeeTariff',
        tags: ['fee-tariffs'],
        summary: 'Tarife taslağını düzenle',
        description:
          'Taslağın kalemlerini bütün olarak değiştirir. Yayımlanmış sürüm 409 `tariff_not_draft`. `If-Match` zorunludur: eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Rol: `yonetici`.',
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: paramsSchema,
        body: updateFeeTariffSchema,
        response: { 200: tariffResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'optional')
      const result = await updateFeeTariffCommand(
        contextOf(request),
        request.params.tariffId,
        request.commandInput,
        expected(expectedVersion),
        idempotency,
      )
      return tariffResponseSchema.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/fee-tariffs/:tariffId/publish',
    {
      preValidation: write('required'),
      schema: {
        operationId: 'publishFeeTariff',
        tags: ['fee-tariffs'],
        summary: 'Tarifeyi yayımla',
        description:
          'Taslağı yayımlar; aynı yılın önceki yayındaki sürümü aynı işlemde kalkar (DOM-FIN-002). Öğrenim ücreti yoksa 422 `tariff_tuition_required`; birim kurum türüne uymuyorsa 422 `tariff_unit_mismatch` (okulda `year`, dil okulunda `lesson_hour`, DOM-FIN-006); okulda onaylı tutar yoksa 422 `tariff_announced_required`; ücret onaylı tutarı aşarsa 422 `tariff_amount_exceeds_announced`. İleri tarih 422. İlan tarihi, MEBBİS tarihi ve yayımlayan kişi saklanır. `If-Match` zorunludur. Rol: `yonetici`.',
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: paramsSchema,
        body: publishFeeTariffSchema,
        response: { 200: tariffResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'optional')
      const result = await publishFeeTariffCommand(
        contextOf(request),
        request.params.tariffId,
        request.commandInput,
        expected(expectedVersion),
        idempotency,
      )
      return tariffResponseSchema.parse(sendBody(reply, result))
    },
  )
}
