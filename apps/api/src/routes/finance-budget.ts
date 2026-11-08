import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  BUDGET_ROLES,
  BUDGET_STATUS_ROLES,
  budgetItemSchema,
  budgetLineSchema,
  budgetPeriodSchema,
  updateBudgetItemSchema,
  updateBudgetLineSchema,
  updateBudgetPeriodSchema,
} from '@kampus/school-core/lib/finance-budget.ts'
import {
  costCenterSchema,
  updateCostCenterSchema,
} from '@kampus/school-core/lib/finance-cost-centers.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  changeBudgetPeriodStatusCommand,
  createBudgetItemCommand,
  createBudgetLineCommand,
  createBudgetPeriodCommand,
  createCostCenterCommand,
  getBudgetPeriodFor,
  listBudgetItemsFor,
  listBudgetLinesFor,
  listBudgetPeriodsFor,
  listCostCentersFor,
  removeBudgetLineCommand,
  updateBudgetItemCommand,
  updateBudgetLineCommand,
  updateBudgetPeriodCommand,
  updateCostCenterCommand,
} from '../services/finance-budget.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  budgetItemListQuery,
  budgetItemListResponse,
  budgetItemParams,
  budgetItemResponse,
  budgetLineListQuery,
  budgetLineListResponse,
  budgetLineParams,
  budgetLineRemoveResponse,
  budgetLineResponse,
  budgetPeriodListQuery,
  budgetPeriodListResponse,
  budgetPeriodParams,
  budgetPeriodResponse,
  costCenterListQuery,
  costCenterListResponse,
  costCenterParams,
  costCenterResponse,
} from './finance-budget.schemas.ts'

/**
 * Maliyet merkezi, bütçe kalemi, bütçe dönemi ve bütçe satırı uçları (docs/domain/finans.md
 * DOM-FIN-062; ON-241, ON-242). Modül `finance` (K-59); bugün yalnız yönetici (K-60, muhasebe rolü
 * açılınca listeye girer). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Kapalı
 * dönemde yazma 422 `budget_period_closed`.
 */

const MANAGER = 'Rol: `yonetici` (muhasebe rolü açılınca o da; K-60). Modül `finance`.'
const IF_MATCH = '`If-Match` zorunlu; sürüm tutmazsa 409 `version_conflict`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceBudgetRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (
    roles: readonly 'yonetici'[] = BUDGET_ROLES,
  ): preValidationAsyncHookHandler[] => [app.authenticate, finance, app.requireRole(roles)]
  const create = [...guarded(), rejectIfMatch(), captureInput()]
  const versioned = (roles?: readonly 'yonetici'[]) => [...guarded(roles), requireIfMatch()]
  const createHeaders = commandHeadersSchema('optional', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-budget']

  // --- Maliyet merkezi ---------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/cost-centers',
    {
      preValidation: guarded(),
      schema: {
        operationId: 'listCostCenters',
        tags,
        summary: 'Maliyet merkezlerini listele',
        description: `Hiyerarşi yoluna göre (üst merkez altındakilerden önce); pasifler dahil, \`status\` ile süzülür (DOM-FIN-062). ${MANAGER}`,
        querystring: costCenterListQuery,
        response: { 200: costCenterListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listCostCentersFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/cost-centers',
    {
      preValidation: create,
      schema: {
        operationId: 'createCostCenter',
        tags,
        summary: 'Maliyet merkezi ekle',
        description: `Kampüs merkezi bir kampüse bağlanır (zorunlu), program okulda sınıf düzeyine, dil okulunda kura bağlanabilir, birim bağsızdır. Kod kurumda tekil: 409 \`cost_center_code_taken\`; kampüse tek etkin merkez: 409 \`cost_center_campus_taken\`; aynı üst merkezde aynı programa tek etkin merkez: 409 \`cost_center_program_taken\`. Üst merkez yok, pasif, döngü ya da 4 düzeyi aşma 422 (\`cost_center_parent_not_found\`, \`cost_center_parent_inactive\`, \`cost_center_too_deep\`); kampüs ya da kur yok 422, kurum türüne uymayan bağ 422 \`cost_center_link_unavailable\` (DOM-FIN-062, K-66). ${MANAGER}`,
        headers: createHeaders,
        body: costCenterSchema,
        response: { 201: costCenterResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createCostCenterCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return costCenterResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    '/api/v1/finance/cost-centers/:costCenterId',
    {
      preValidation: [...versioned(), captureInput()],
      schema: {
        operationId: 'updateCostCenter',
        tags,
        summary: 'Maliyet merkezini düzelt ya da pasifleştir',
        description: `Kısmi düzeltme; tür değişmez. \`isActive: false\` pasifleştirir (altında etkin merkez varsa 422 \`cost_center_has_active_children\`), \`true\` yeniden etkinleştirir. Üst merkezi kendisinin altına taşımak 422 \`cost_center_cycle\`. Merkez silinmez. ${IF_MATCH} ${MANAGER}`,
        headers: versionHeaders,
        params: costCenterParams,
        body: updateCostCenterSchema,
        response: { 200: costCenterResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateCostCenterCommand(
        contextOf(request),
        request.params.costCenterId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return costCenterResponse.parse(sendBody(reply, result))
    },
  )

  // --- Kalem -------------------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/budget-items',
    {
      preValidation: guarded(),
      schema: {
        operationId: 'listBudgetItems',
        tags,
        summary: 'Bütçe kalemlerini listele',
        description: `Koda göre; pasifler dahil, \`kind\` ve \`status\` ile süzülür (DOM-FIN-062). ${MANAGER}`,
        querystring: budgetItemListQuery,
        response: { 200: budgetItemListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listBudgetItemsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/budget-items',
    {
      preValidation: create,
      schema: {
        operationId: 'createBudgetItem',
        tags,
        summary: 'Bütçe kalemi ekle',
        description: `Gelir ya da gider kalemi; gelir kalemi isteğe bağlı bir ücret türüne eşlenir, giderde ücret türü 400. Kod kurumda tekil: 409 \`budget_item_code_taken\`; bir ücret türüne tek etkin gelir kalemi: 409 \`budget_item_fee_kind_taken\` (K-65). ${MANAGER}`,
        headers: createHeaders,
        body: budgetItemSchema,
        response: { 201: budgetItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createBudgetItemCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return budgetItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    '/api/v1/finance/budget-items/:itemId',
    {
      preValidation: [...versioned(), captureInput()],
      schema: {
        operationId: 'updateBudgetItem',
        tags,
        summary: 'Bütçe kalemini düzelt ya da pasifleştir',
        description: `Kısmi düzeltme; bütçe satırında kullanılan kalemin türü değişmez: 422 \`budget_item_in_use\`. Gider kalemine ücret türü 422 \`budget_item_fee_kind_expense\`. \`isActive: false\` pasifleştirir; kalem silinmez. ${IF_MATCH} ${MANAGER}`,
        headers: versionHeaders,
        params: budgetItemParams,
        body: updateBudgetItemSchema,
        response: { 200: budgetItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateBudgetItemCommand(
        contextOf(request),
        request.params.itemId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return budgetItemResponse.parse(sendBody(reply, result))
    },
  )

  // --- Dönem -------------------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/budget-periods',
    {
      preValidation: guarded(),
      schema: {
        operationId: 'listBudgetPeriods',
        tags,
        summary: 'Bütçe dönemlerini listele',
        description: `Yeni başlayan önce; gelir, gider, fark ve satır sayısı satırlardan hesaplanır (DOM-FIN-062). ${MANAGER}`,
        querystring: budgetPeriodListQuery,
        response: { 200: budgetPeriodListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status } = request.query
      const { items, total } = await listBudgetPeriodsFor(contextOf(request), {
        page,
        pageSize,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/budget-periods',
    {
      preValidation: create,
      schema: {
        operationId: 'createBudgetPeriod',
        tags,
        summary: 'Bütçe dönemi ekle',
        description: `Taslak açılır. \`academicYear\` verilirse günler kurumun o eğitim yılı kaydından (yoksa 1 Eylül – 31 Ağustos) kopyalanır (K-63); ya da \`startDate\` ve \`endDate\` verilir. Bitiş başlangıçtan önce 422 \`budget_period_dates_invalid\`, 366 günü aşan dönem 422 \`budget_period_too_long\`, aynı ad 409 \`budget_period_name_taken\`. ${MANAGER}`,
        headers: createHeaders,
        body: budgetPeriodSchema,
        response: { 201: budgetPeriodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createBudgetPeriodCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return budgetPeriodResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/budget-periods/:periodId',
    {
      preValidation: guarded(),
      schema: {
        operationId: 'getBudgetPeriod',
        tags,
        summary: 'Bütçe dönemi ayrıntısı',
        description: `Toplamlar ve ay listesiyle. Olmayan ya da başka kurumun dönemi 404. ${MANAGER}`,
        params: budgetPeriodParams,
        response: { 200: budgetPeriodResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getBudgetPeriodFor(contextOf(request), request.params.periodId),
    }),
  )

  typed.patch(
    '/api/v1/finance/budget-periods/:periodId',
    {
      preValidation: [...versioned(), captureInput()],
      schema: {
        operationId: 'updateBudgetPeriod',
        tags,
        summary: 'Bütçe dönemini düzelt',
        description: `Ad taslakta ve açıkken değişir; günler (\`academicYear\` ya da \`startDate\`/\`endDate\`) yalnız taslakta: 422 \`budget_period_not_draft\`, aylık dağılımlı satır varken 422 \`budget_period_has_distribution\`. Kapalı dönem 422 \`budget_period_closed\`. ${IF_MATCH} ${MANAGER}`,
        headers: versionHeaders,
        params: budgetPeriodParams,
        body: updateBudgetPeriodSchema,
        response: { 200: budgetPeriodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateBudgetPeriodCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return budgetPeriodResponse.parse(sendBody(reply, result))
    },
  )

  for (const [verb, target, summary, rule] of [
    [
      'open',
      'open',
      'Bütçe dönemini aç',
      'Yalnız taslak açılır (422 `budget_period_not_draft`); açık dönemler örtüşmez: 422 `budget_period_overlap` (K-62).',
    ],
    [
      'close',
      'closed',
      'Bütçe dönemini kapat',
      'Yalnız açık dönem kapanır (422 `budget_period_not_open`); kapanış geri alınmaz, kapalı dönemde hiçbir şey değişmez (K-61).',
    ],
  ] as const)
    typed.post(
      `/api/v1/finance/budget-periods/:periodId/${verb}`,
      {
        preValidation: versioned(BUDGET_STATUS_ROLES),
        schema: {
          operationId: verb === 'open' ? 'openBudgetPeriod' : 'closeBudgetPeriod',
          tags,
          summary,
          description: `${rule} ${IF_MATCH} Rol: yalnız \`yonetici\` (K-61). Modül \`finance\`.`,
          headers: versionHeaders,
          params: budgetPeriodParams,
          response: { 200: budgetPeriodResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await changeBudgetPeriodStatusCommand(
          contextOf(request),
          request.params.periodId,
          target,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return budgetPeriodResponse.parse(sendBody(reply, result))
      },
    )

  // --- Satır -------------------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/budget-periods/:periodId/lines',
    {
      preValidation: guarded(),
      schema: {
        operationId: 'listBudgetLines',
        tags,
        summary: 'Bütçe satırlarını listele',
        description: `Merkez ve kalem koduna göre; \`costCenterId\`, \`kind\` ve \`q\` ile süzülür. Olmayan ya da başka kurumun dönemi 404. ${MANAGER}`,
        params: budgetPeriodParams,
        querystring: budgetLineListQuery,
        response: { 200: budgetLineListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listBudgetLinesFor(
        contextOf(request),
        request.params.periodId,
        { page, pageSize, ...filters },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/budget-periods/:periodId/lines',
    {
      preValidation: create,
      schema: {
        operationId: 'createBudgetLine',
        tags,
        summary: 'Bütçe satırı ekle',
        description: `Dönem × maliyet merkezi × kalem için planlanan tutar (kuruş). Kapalı dönem 422 \`budget_period_closed\`; merkez ya da kalem yok ya da pasif 422 (\`cost_center_not_found\`, \`cost_center_inactive\`, \`budget_item_not_found\`, \`budget_item_inactive\`); aynı üçlü 409 \`budget_line_exists\`. \`monthlyCents\` verilirse dönemin \`months\` sırasıyla her ay için tutar, toplamı \`amountCents\` (422 \`budget_line_months_mismatch\`, \`budget_line_monthly_sum\`; K-64). ${MANAGER}`,
        headers: createHeaders,
        params: budgetPeriodParams,
        body: budgetLineSchema,
        response: { 201: budgetLineResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createBudgetLineCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return budgetLineResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    '/api/v1/finance/budget-periods/:periodId/lines/:lineId',
    {
      preValidation: [...versioned(), captureInput()],
      schema: {
        operationId: 'updateBudgetLine',
        tags,
        summary: 'Bütçe satırını düzelt',
        description: `Tutar ve aylık dağılım değişir; merkez ve kalem değişmez. Tutar değişip dağılım gönderilmezse eski dağılım yeni tutarla tutmalı (422 \`budget_line_monthly_sum\`); \`monthlyCents: null\` dağılımı kaldırır. Kapalı dönem 422 \`budget_period_closed\`. ${IF_MATCH} ${MANAGER}`,
        headers: versionHeaders,
        params: budgetLineParams,
        body: updateBudgetLineSchema,
        response: { 200: budgetLineResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateBudgetLineCommand(
        contextOf(request),
        request.params.periodId,
        request.params.lineId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return budgetLineResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    '/api/v1/finance/budget-periods/:periodId/lines/:lineId',
    {
      preValidation: versioned(),
      schema: {
        operationId: 'removeBudgetLine',
        tags,
        summary: 'Bütçe satırını kaldır',
        description: `Satır arşivlenir; aynı merkez ve kalem için yeni satır eklenebilir. Kapalı dönem 422 \`budget_period_closed\`. ${IF_MATCH} ${MANAGER}`,
        headers: versionHeaders,
        params: budgetLineParams,
        response: { 200: budgetLineRemoveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await removeBudgetLineCommand(
        contextOf(request),
        request.params.periodId,
        request.params.lineId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return budgetLineRemoveResponse.parse(sendBody(reply, result))
    },
  )
}
