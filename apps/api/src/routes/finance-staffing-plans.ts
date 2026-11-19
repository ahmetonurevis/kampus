import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFFING_ROLES,
  staffingPlanInputSchema,
  staffingPositionInputSchema,
  staffingPositionUpdateSchema,
} from '@kampus/school-core/lib/finance-staffing-plans.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  createStaffingPositionCommand,
  saveStaffingPlanCommand,
  staffingPlanFor,
  updateStaffingPositionCommand,
} from '../services/finance-staffing-plans.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  staffingPlanParams,
  staffingPlanQuery,
  staffingPlanResponse,
  staffingPlanSavedResponse,
  staffingPositionParams,
  staffingPositionResponse,
} from './finance-staffing-plans.schemas.ts'

/**
 * Kadro planı ve açık pozisyon (docs/domain/finans.md DOM-FIN-126; ON-188; K-433…K-435). Modül
 * `finance`; okuma ve yazma yalnız yönetici. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 →
 * işlem.
 */

const PLAN = '/api/v1/finance/staffing-plans/:academicYear'
const POSITIONS = '/api/v1/finance/staffing-positions'
const POSITION = `${POSITIONS}/:positionId`
const MANAGER = 'Rol: yalnız `yonetici`. Modül `finance`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceStaffingPlanRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFFING_ROLES),
  ]
  const tags = ['finance-staffing-plans']

  typed.get(
    PLAN,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffingPlan',
        tags,
        summary: 'Kadro planı',
        description: `Eğitim yılının planı (norm, elle girilen branş ihtiyaçları; hiç kaydedilmediyse norm 20, sürüm 1) ve branş başına hesap: ders programı önerisi (seçilen haftanın iptal edilmemiş her dersi bir saat; plan satırı yoksa ihtiyaç budur, K-433), tam zamanlı ve saatlik öğretmen sayısı, kapasite (tam zamanlı × norm; birden çok branşlı öğretmenin normu bölünür, saatlik/ders saati ücretli kapasiteye girmez, K-434), açık, açık/ilandaki pozisyon saati, önerilen yeni pozisyon saati ve tam zamanlı eşdeğeri (K-435). Branş öğretmen kaydının dersidir (K-421). Ücret tutarı yanıta girmez. ${MANAGER}`,
        params: staffingPlanParams,
        querystring: staffingPlanQuery,
        response: { 200: staffingPlanResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await staffingPlanFor(
        contextOf(request),
        request.params.academicYear,
        request.query.weekOf,
      ),
    }),
  )

  typed.patch(
    PLAN,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'saveStaffingPlan',
        tags,
        summary: 'Kadro planını kaydet',
        description: `Norm (1–40) ve branş ihtiyaç satırları (en çok 80, saat 0–2000, aynı branş bir kez; 400) bütün olarak yazılır; satırı olmayan branşta ihtiyaç program önerisidir. Değişiklik yoksa 422 \`staffing_plan_unchanged\`. \`If-Match\` zorunlu (\`GET\` yanıtındaki sürüm; hiç kaydedilmediyse 1); tutmazsa 409 \`version_conflict\`. Denetim kaydına alan adları yazılır. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: staffingPlanParams,
        body: staffingPlanInputSchema,
        response: { 200: staffingPlanSavedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await saveStaffingPlanCommand(
        contextOf(request),
        request.params.academicYear,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffingPlanSavedResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    POSITIONS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffingPosition',
        tags,
        summary: 'Açık pozisyon aç',
        description: `Eğitim yılı, branş, haftalık saat (1–60), isteğe bağlı not ve iş teklifi bağı; durum \`open\`. Teklif kurumda yoksa 422 \`staffing_position_offer_not_found\`. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: staffingPositionInputSchema,
        response: { 201: staffingPositionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffingPositionCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = staffingPositionResponse.parse(sendBody(reply, result))
      reply.header('location', `${POSITIONS}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    POSITION,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStaffingPosition',
        tags,
        summary: 'Açık pozisyonu güncelle',
        description: `Durum (açık ↔ ilanda, açık/ilanda → dolduruldu ya da iptal), saat, not ve teklif bağı değişir. Dolduruldu ya da iptal pozisyon değişmez (422 \`staffing_position_closed\`); izinsiz geçiş 422 \`staffing_position_transition\`; değişiklik yoksa 422 \`staffing_position_unchanged\`; teklif kurumda yoksa 422 \`staffing_position_offer_not_found\`. \`If-Match\` zorunlu; tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: staffingPositionParams,
        body: staffingPositionUpdateSchema,
        response: { 200: staffingPositionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateStaffingPositionCommand(
        contextOf(request),
        request.params.positionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffingPositionResponse.parse(sendBody(reply, result))
    },
  )
}
