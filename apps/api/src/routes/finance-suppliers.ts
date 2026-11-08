import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  SUPPLIER_READ_ROLES,
  SUPPLIER_WRITE_ROLES,
  supplierSchema,
  updateSupplierSchema,
} from '@kampus/school-core/lib/finance-suppliers.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createSupplierCommand,
  getSupplierFor,
  listSuppliersFor,
  updateSupplierCommand,
} from '../services/finance-suppliers.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  supplierListQuery,
  supplierListResponse,
  supplierParams,
  supplierResponse,
} from './finance-suppliers.schemas.ts'

/**
 * Tedarikçi uçları (docs/domain/finans.md DOM-FIN-070; ON-221). Modül `finance` (K-126). Liste
 * yönetici ve ön büro (şahıs TCKN'si ve IBAN maskeli); ayrıntı ve yazma yalnız yönetici, muhasebe
 * rolü açılınca o da. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Tedarikçi
 * silinmez: `PATCH` ile `isActive: false` pasifleştirir.
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-126). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (muhasebe rolü açılınca o da; K-126). Modül `finance`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceSupplierRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-procurement']

  typed.get(
    '/api/v1/finance/suppliers',
    {
      preValidation: guarded(SUPPLIER_READ_ROLES),
      schema: {
        operationId: 'listSuppliers',
        tags,
        summary: 'Tedarikçileri listele',
        description: `Etkinler önce, unvana göre; pasifler dahil, \`status\`, \`type\` ve \`category\` ile süzülür (DOM-FIN-070). Şahıs tedarikçinin TCKN'si ve IBAN son dört hane dışında maskelidir; belge uyarısı sayıları bugüne göredir. ${READERS}`,
        querystring: supplierListQuery,
        response: { 200: supplierListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listSuppliersFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/suppliers',
    {
      preValidation: [...guarded(SUPPLIER_WRITE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSupplier',
        tags,
        summary: 'Tedarikçi ekle',
        description: `Unvan, tür (\`company\` VKN 10 hane, \`individual\` TCKN 11 hane; kontrol haneleri denetlenir), vergi dairesi, en az bir kategori, isteğe bağlı iletişim, adres, TR IBAN (mod-97) ve belge listesi (ad, son geçerlilik günü, not; dosya yok, K-127). Vergi numarası kurumda tekil: 409 \`supplier_tax_number_exists\` (DOM-FIN-070). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: supplierSchema,
        response: { 201: supplierResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSupplierCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = supplierResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/suppliers/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/suppliers/:supplierId',
    {
      preValidation: guarded(SUPPLIER_WRITE_ROLES),
      schema: {
        operationId: 'getSupplier',
        tags,
        summary: 'Tedarikçi ayrıntısı',
        description: `Tam vergi numarası, IBAN, adres ve belge durumları. Olmayan ya da başka kurumun tedarikçisi 404. ${MANAGER}`,
        params: supplierParams,
        response: { 200: supplierResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSupplierFor(contextOf(request), request.params.supplierId),
    }),
  )

  typed.patch(
    '/api/v1/finance/suppliers/:supplierId',
    {
      preValidation: [...guarded(SUPPLIER_WRITE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateSupplier',
        tags,
        summary: 'Tedarikçiyi düzelt ya da pasifleştir',
        description: `Kısmi düzeltme; tür ve vergi numarası birlikte gönderilir, belge listesi bütün olarak yazılır. \`isActive: false\` pasifleştirir (pasif tedarikçi talepte önerilemez), \`true\` yeniden etkinleştirir. Başka tedarikçinin vergi numarası 409 \`supplier_tax_number_exists\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: supplierParams,
        body: updateSupplierSchema,
        response: { 200: supplierResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateSupplierCommand(
        contextOf(request),
        request.params.supplierId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return supplierResponse.parse(sendBody(reply, result))
    },
  )
}
