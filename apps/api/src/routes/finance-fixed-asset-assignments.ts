import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  fixedAssetAssignmentSchema,
  fixedAssetReturnSchema,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { FIXED_ASSET_ROLES } from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  assignFixedAssetCommand,
  getFixedAssetAssignmentFor,
  listFixedAssetAssigneesFor,
  listFixedAssetAssignmentsFor,
  returnFixedAssetAssignmentCommand,
} from '../services/finance-fixed-asset-assignments.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  assetAssignmentParams,
  assigneeListQuery,
  assigneeListResponse,
  assignmentListQuery,
  assignmentListResponse,
  assignmentParams,
  assignmentResponse,
} from './finance-fixed-asset-assignments.schemas.ts'

/**
 * Demirbaş zimmeti uçları (docs/domain/finans.md DOM-FIN-086; ON-236). Modül `finance`; okuma ve
 * yazma yalnız yönetici, muhasebe rolü açılınca o da (K-189; personel adı kişisel veridir, K-214).
 * Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Zimmet silinmez ve düzeltilmez:
 * `POST /fixed-assets/:assetId/assignments` verir, `POST …/:assignmentId/return` iade alır.
 */

const MANAGER = 'Rol: `yonetici` (muhasebe rolü açılınca o da; K-189). Modül `finance`.'
const URL = '/api/v1/finance/fixed-asset-assignments'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceFixedAssetAssignmentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FIXED_ASSET_ROLES),
  ]
  const tags = ['finance-fixed-assets']

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listFixedAssetAssignments',
        tags,
        summary: 'Demirbaş zimmetlerini listele',
        description: `Açık zimmetler önce, yeni zimmet önce. \`assetId\` demirbaşın zimmet geçmişini, \`membershipId\` personelin zimmetlerini (ilişik kesmede açık zimmetler, K-214), \`state\` açık ya da iade edilmişleri süzer; \`q\` etiket, demirbaş adı, personel adı ve konumda arar (DOM-FIN-086). ${MANAGER}`,
        querystring: assignmentListQuery,
        response: { 200: assignmentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listFixedAssetAssignmentsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${URL}/:assignmentId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getFixedAssetAssignment',
        tags,
        summary: 'Zimmet ayrıntısı',
        description: `Zimmet tutanağının verisi: demirbaş, teslim alan (personel ya da konum), zimmet ve iade bilgisi. Olmayan ya da başka kurumun zimmeti 404. ${MANAGER}`,
        params: assignmentParams,
        response: { 200: assignmentResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getFixedAssetAssignmentFor(contextOf(request), request.params.assignmentId),
    }),
  )

  typed.post(
    '/api/v1/finance/fixed-assets/:assetId/assignments',
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'assignFixedAsset',
        tags,
        summary: 'Demirbaşı zimmetle',
        description: `Personele (\`assigneeType: staff\`, kurumun etkin yönetici, öğretmen ya da ön büro üyeliği) ya da konuma (\`assigneeType: location\`, isteğe bağlı kampüs ve oda) zimmet, zimmet günü ve not (K-210). Açık zimmet varken 409 \`fixed_asset_already_assigned\` (devir önce iadedir, K-211); hurdaya ayrılmış demirbaş 422 \`fixed_asset_scrapped\`; gelecek gün 422 \`fixed_asset_date_in_future\`; alım gününden önce 422 \`fixed_asset_assignment_before_acquisition\`; son iade gününden önce 422 \`fixed_asset_assignment_before_return\`; olmayan üyelik 422 \`fixed_asset_assignee_not_found\`, öğrenci ya da veli 422 \`fixed_asset_assignee_not_staff\`, pasif personel 422 \`fixed_asset_assignee_inactive\`; olmayan kampüs 422 \`fixed_asset_campus_not_found\`. Başka kurumun demirbaşı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: assetAssignmentParams,
        body: fixedAssetAssignmentSchema,
        response: { 201: assignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await assignFixedAssetCommand(
        contextOf(request),
        request.params.assetId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = assignmentResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${URL}/:assignmentId/return`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'returnFixedAssetAssignment',
        tags,
        summary: 'Zimmeti iade al',
        description: `İade günü, durum (\`intact\` sağlam, \`damaged\` hasarlı) ve not; hasarlı iadede not en az 5 karakter (K-212). Zimmet kaydı silinmez; demirbaşın durumu kendiliğinden değişmez. Zaten iade edilmiş 422 \`fixed_asset_assignment_returned\`, gelecek gün 422 \`fixed_asset_date_in_future\`, zimmet gününden önce 422 \`fixed_asset_return_before_assignment\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: assignmentParams,
        body: fixedAssetReturnSchema,
        response: { 200: assignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await returnFixedAssetAssignmentCommand(
        contextOf(request),
        request.params.assignmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return assignmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/fixed-asset-assignees',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listFixedAssetAssignees',
        tags,
        summary: 'Zimmet alabilecek personel ve açık zimmet sayısı',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri, ada göre; her satırda açık zimmet sayısı. Pasifleştirilmiş (ayrılan) personel de listelenir; \`status=passive&holding=true\` ilişik kesmede iade bekleyen zimmetleri olan personeli verir (K-214). ${MANAGER}`,
        querystring: assigneeListQuery,
        response: { 200: assigneeListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, holding } = request.query
      const { items, total } = await listFixedAssetAssigneesFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        holding: holding === undefined ? undefined : holding === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
