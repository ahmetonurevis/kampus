import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import {
  BUDGET_DRAFT_APPROVER_ROLES,
  BUDGET_DRAFT_ROLES,
  budgetDraftLinesSchema,
  budgetDraftNoteSchema,
  budgetDraftReasonSchema,
  budgetDraftSchema,
  budgetOwnerSchema,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'

import { contextOf, type ServiceContext } from '../plugins/authenticate.ts'
import {
  approveBudgetDraftCommand,
  budgetDraftComparisonFor,
  budgetDraftOptionsFor,
  createBudgetDraftCommand,
  getBudgetDraftFor,
  listBudgetDraftsFor,
  rejectBudgetDraftCommand,
  reopenBudgetDraftCommand,
  requestBudgetDraftRevisionCommand,
  setBudgetOwnerCommand,
  submitBudgetDraftCommand,
  updateBudgetDraftLinesCommand,
} from '../services/finance-budget-drafts.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  budgetDraftComparisonResponse,
  budgetDraftListQuery,
  budgetDraftListResponse,
  budgetDraftOptionsResponse,
  budgetDraftParams,
  budgetDraftResponse,
  budgetOwnerParams,
  budgetOwnerResponse,
} from './finance-budget-drafts.schemas.ts'

/**
 * Bütçe hazırlama ve onay uçları (docs/domain/finans.md DOM-FIN-093; ON-243). Modül `finance`.
 * Okuma, açma, düzenleme, gönderim ve yeni revizyon: yönetici ve bütçe sorumlusu personel (ön büro,
 * öğretmen yalnız sorumlusu olduğu merkezler; başkasınınki 404, K-257). Onay, revizyon isteği, ret
 * ve sorumlu ataması yalnız yönetici (K-256). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 →
 * işlem.
 */

const PREPARERS =
  'Rol: `yonetici`; `onburo` ve `ogretmen` yalnız bütçe sorumlusu oldukları merkezlerde (K-257). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-256). Modül `finance`.'
const URL = '/api/v1/finance/budget-drafts'

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

export function registerFinanceBudgetDraftRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const preparers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(BUDGET_DRAFT_ROLES),
  ]
  const managers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(BUDGET_DRAFT_APPROVER_ROLES),
  ]
  const tags = ['finance-budget']

  typed.get(
    '/api/v1/finance/budget-draft-options',
    {
      preValidation: preparers,
      schema: {
        operationId: 'getBudgetDraftOptions',
        tags,
        summary: 'Bütçe taslağı formunun seçenekleri',
        description: `Kapalı olmayan bütçe dönemleri, görülen etkin maliyet merkezleri (sorumlusu ve hazırlama hakkıyla) ve etkin bütçe kalemleri. Ön büro ve öğretmen yalnız sorumlusu olduğu merkezleri görür. ${PREPARERS}`,
        response: { 200: budgetDraftOptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await budgetDraftOptionsFor(contextOf(request)) }),
  )

  typed.post(
    '/api/v1/finance/cost-centers/:costCenterId/budget-owner',
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'setBudgetOwner',
        tags,
        summary: 'Maliyet merkezinin bütçe sorumlusunu ata',
        description: `Merkezin bütçe sorumlusu kurumun etkin yönetici, öğretmen ya da ön büro üyeliğidir; \`membershipId: null\` sorumluyu kaldırır (K-257). Olmayan üyelik (başka kurumunki dahil) 422 \`budget_owner_not_found\`, öğrenci ya da veli 422 \`budget_owner_not_staff\`, pasif üyelik 422 \`budget_owner_inactive\`; başka kurumun merkezi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: budgetOwnerParams,
        body: budgetOwnerSchema,
        response: { 200: budgetOwnerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await setBudgetOwnerCommand(
        contextOf(request),
        request.params.costCenterId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return budgetOwnerResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    URL,
    {
      preValidation: preparers,
      schema: {
        operationId: 'listBudgetDrafts',
        tags,
        summary: 'Bütçe taslaklarını listele',
        description: `Yeni başlayan dönem önce, dönem içinde merkez koduna göre; \`periodId\`, \`costCenterId\` ve \`status\` süzer. Toplamlar satırlardan hesaplanır. ${PREPARERS}`,
        querystring: budgetDraftListQuery,
        response: { 200: budgetDraftListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listBudgetDraftsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${URL}/:draftId`,
    {
      preValidation: preparers,
      schema: {
        operationId: 'getBudgetDraft',
        tags,
        summary: 'Bütçe taslağı ayrıntısı ve revizyon geçmişi',
        description: `Taslak, satırlar ve revizyon geçmişi (sürüm, kim, ne zaman, değişen kalemler). Olmayan, başka kurumun ya da sorumlu için başka merkezin taslağı 404. ${PREPARERS}`,
        params: budgetDraftParams,
        response: { 200: budgetDraftResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getBudgetDraftFor(contextOf(request), request.params.draftId),
    }),
  )

  typed.get(
    `${URL}/:draftId/comparison`,
    {
      preValidation: preparers,
      schema: {
        operationId: 'getBudgetDraftComparison',
        tags,
        summary: 'Taslağı onaylı bütçe ve önceki dönemle karşılaştır',
        description: `Kalem bazında taslak, bu dönemin onaylı bütçesi, önceki dönemin planı ve tahakkuk esaslı gerçekleşeni (DOM-FIN-066; önceki dönem K-259). Salt okur; CSV tarayıcıda bu yanıttan üretilir. ${PREPARERS}`,
        params: budgetDraftParams,
        response: { 200: budgetDraftComparisonResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await budgetDraftComparisonFor(contextOf(request), request.params.draftId),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...preparers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createBudgetDraft',
        tags,
        summary: 'Bütçe taslağı aç',
        description: `Dönem ve maliyet merkezi için taslak açar; satırlar merkezin dönemdeki onaylı bütçesinden doldurulur. Sorumlusu olmadığı merkez 403 \`budget_draft_not_owner\`, olmayan merkez 422 \`cost_center_not_found\`, pasif merkez 422 \`cost_center_inactive\`, olmayan dönem 422 \`budget_period_not_found\`, kapalı dönem 422 \`budget_period_closed\`, reddedilmemiş taslak varsa 409 \`budget_draft_exists\`. ${PREPARERS}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: budgetDraftSchema,
        response: { 201: budgetDraftResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createBudgetDraftCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = budgetDraftResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    `${URL}/:draftId`,
    {
      preValidation: [...preparers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateBudgetDraftLines',
        tags,
        summary: 'Taslağın satırlarını yaz',
        description: `Satırların tamamı (kalem, tutar kuruş, gerekçe) yerine yazılır; bir kalem bir kez. Yalnız taslak ya da revizyonu istenen taslakta (422 \`budget_draft_status_invalid\`); olmayan kalem 422 \`budget_item_not_found\`, yeni eklenen pasif kalem 422 \`budget_item_inactive\`. \`If-Match\` zorunlu, sürüm tutmazsa 409. ${PREPARERS}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: budgetDraftParams,
        body: budgetDraftLinesSchema,
        response: { 200: budgetDraftResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateBudgetDraftLinesCommand(
        contextOf(request),
        request.params.draftId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return budgetDraftResponse.parse(sendBody(reply, result))
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
      `${URL}/:draftId/${verb}`,
      {
        preValidation: [...guards, requireIfMatch(), captureInput()],
        schema: {
          operationId,
          tags,
          summary,
          description: `${description} Geçersiz geçiş 422 \`budget_draft_status_invalid\`, kapalı dönem 422 \`budget_period_closed\`; başka kurumun taslağı 404; \`If-Match\` zorunlu, sürüm tutmazsa 409.`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: budgetDraftParams,
          body,
          response: { 200: budgetDraftResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await run(
          contextOf(request),
          request.params.draftId,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return budgetDraftResponse.parse(sendBody(reply, result))
      },
    )
  }

  transition(
    'submit',
    'submitBudgetDraft',
    'Taslağı onaya gönder',
    `Taslak ya da revizyonu istenen taslak \`submitted\` olur, sürüm bir artar; geçmişe sürümün satırları ve değişen kalemler yazılır. Satırsız taslak 422 \`budget_draft_empty\`; yeni ya da onaylı tutarı değişen kalemde gerekçe yoksa 422 \`budget_draft_justification_required\` (K-257). ${PREPARERS}`,
    budgetDraftNoteSchema,
    preparers,
    submitBudgetDraftCommand,
  )
  transition(
    'approve',
    'approveBudgetDraft',
    'Taslağı onayla',
    `Onay bekleyen taslak \`approved\` olur; merkezin dönemdeki bütçe satırları aynı işlemde taslağa eşitlenir (yeni satır, tutar düzeltmesi, taslakta olmayan satırın kaldırılması; tutarı değişen satırın aylık dağılımı kalkar, K-258). Yeni satırda pasif merkez 422 \`cost_center_inactive\`, pasif kalem 422 \`budget_item_inactive\`. ${MANAGER}`,
    budgetDraftNoteSchema,
    managers,
    approveBudgetDraftCommand,
  )
  transition(
    'request-revision',
    'requestBudgetDraftRevision',
    'Taslak için revizyon iste',
    `Onay bekleyen taslak gerekçeyle \`revision_requested\` olur; sorumlu düzeltip yeniden gönderir (K-256). ${MANAGER}`,
    budgetDraftReasonSchema,
    managers,
    requestBudgetDraftRevisionCommand,
  )
  transition(
    'reject',
    'rejectBudgetDraft',
    'Taslağı reddet',
    `Onay bekleyen taslak gerekçeyle \`rejected\` olur ve kapanır; birim aynı dönem için yeni taslak açabilir (K-256). ${MANAGER}`,
    budgetDraftReasonSchema,
    managers,
    rejectBudgetDraftCommand,
  )
  transition(
    'reopen',
    'reopenBudgetDraft',
    'Onaylı bütçe için yeni revizyon aç',
    `Onaylı taslak yeniden \`draft\` olur; onaylı bütçe satırları yeni sürüm onaylanana kadar değişmez (K-258). ${PREPARERS}`,
    budgetDraftNoteSchema,
    preparers,
    reopenBudgetDraftCommand,
  )
}
