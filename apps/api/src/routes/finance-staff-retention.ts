import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_RETENTION_ROLES,
  staffDataDestructionInputSchema,
  staffRetentionPolicyUpdateSchema,
} from '@kampus/school-core/lib/finance-staff-retention.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  destroyStaffDataCommand,
  getStaffRetentionPolicyFor,
  listStaffDataDestructionsFor,
  listStaffRetentionCandidatesFor,
  updateStaffRetentionPolicyCommand,
} from '../services/finance-staff-retention.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  staffDataDestructionListResponse,
  staffDataDestructionQuery,
  staffDataDestructionResponse,
  staffRetentionCandidateListResponse,
  staffRetentionCandidateQuery,
  staffRetentionPolicyResponse,
} from './finance-staff-retention.schemas.ts'

/**
 * Özlük verisi saklama ve imha uçları (docs/domain/finans.md DOM-FIN-122; ON-176; KVKK IST-021).
 * Modül `finance`; bütün uçlar yalnız yönetici (K-417). İmha taze oturum ve `Idempotency-Key`
 * ister; arka plan otomatik imhası yoktur. Sıra: 401 → 403 modül → 403 rol → (403 taze oturum) →
 * 400 → işlem.
 */

const MANAGER = 'Rol: yalnız `yonetici` (ön büro, öğretmen, veli, öğrenci 403). Modül `finance`.'
const DESTRUCTIONS = '/api/v1/finance/staff-data-destructions'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceStaffRetentionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFF_RETENTION_ROLES),
  ]
  const tags = ['finance-staff-retention']

  typed.get(
    '/api/v1/finance/staff-retention-policies',
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffRetentionPolicies',
        tags,
        summary: 'Özlük verisi saklama politikası',
        description: `Altı veri kategorisinin (istirahat raporları, sağlık raporu belgeleri, adli sicil kayıtları, özlük dosyası, izin kayıtları, mali kayıtlar) ayrılış sonrası saklama süresi, yasal en az süresi, başlangıç olayı ve imha yöntemi. Ayarlanmamış kategori yasal en az süreyi kullanır (\`customized: false\`; K-415). Süreler **doğrulanmalı** (H-89, M-85). ${MANAGER}`,
        response: { 200: staffRetentionPolicyResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getStaffRetentionPolicyFor(contextOf(request)) }),
  )

  typed.patch(
    '/api/v1/finance/staff-retention-policies',
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStaffRetentionPolicies',
        tags,
        summary: 'Özlük verisi saklama sürelerini değiştir',
        description: `Gönderilen kategorilerin süresi (ay, en çok 360) yazılır; \`null\` yasal en az süreye döner. Yasal en az sürenin altı 400 (K-415). Süre değişikliği yalnız henüz imha edilmemiş kayıtların imha gününü değiştirir. Denetim \`finance.staff_retention.update\` (kategori adları). \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: staffRetentionPolicyUpdateSchema,
        response: { 200: staffRetentionPolicyResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await updateStaffRetentionPolicyCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return staffRetentionPolicyResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/staff-retention-candidates',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffRetentionCandidates',
        tags,
        summary: 'İmha adayları',
        description: `Pasifleştirilmiş (ayrılmış) personel × kaydı bulunan veri kategorisi: ayrılış günü, kayıt sayısı, imha edilebileceği ilk gün ve kalan gün. Süresi dolanlar (\`status: due\`) önce, sonra imha günü. Ayrılış günü üyeliğin pasifleştirildiği Europe/Istanbul günüdür; yeniden etkinleştirilen personel aday olmaz (K-415). Ad, kategori ve durumla süzülür, sayfalıdır. ${MANAGER}`,
        querystring: staffRetentionCandidateQuery,
        response: { 200: staffRetentionCandidateListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, category, status } = request.query
      const { items, total } = await listStaffRetentionCandidatesFor(contextOf(request), {
        page,
        pageSize,
        q,
        category,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    DESTRUCTIONS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffDataDestructions',
        tags,
        summary: 'İmha kayıtları',
        description: `Onaylı imhaların kaydı, en yeni önce: kategori, yöntem, kayıt ve dosya sayısı, uygulanan süre, imha eden ve an. İmha edilen personelin kimliği ve adı tutulmaz; kayıt değişmez ve silinmez (K-417). ${MANAGER}`,
        querystring: staffDataDestructionQuery,
        response: { 200: staffDataDestructionListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, category } = request.query
      const { items, total } = await listStaffDataDestructionsFor(contextOf(request), {
        page,
        pageSize,
        category,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    DESTRUCTIONS,
    {
      preValidation: [...guarded, app.requireFreshSession, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'destroyStaffData',
        tags,
        summary: 'Özlük verisini imha et',
        description: `Ayrılmış personelin bir kategorideki bütün kayıtlarını (iptal edilmişler dahil) imha eder (K-416): istirahat raporu, sağlık raporu, adli sicil, özlük dosyası ve izin kayıtları fiziksel silinir; mali kayıtlar kişi düzeyinde silinerek anonimleşir (onaylı bordro dönemi ve aktarım özetleri kişisiz kalır). Bağlı dosyaların saklama sonu şimdiye çekilir, nesneyi platformun saklama sonu imhası siler. Aynı işlemde kişisel veri içermeyen imha kaydı ve \`finance.staff_data.destroy\` denetimi yazılır. Olmayan, başka kurumun ya da personel olmayan üyelik 404; etkin personel 422 \`staff_retention_member_active\`; süresi dolmamış kategori 422 \`staff_retention_not_due\`; kaydı olmayan kategori 422 \`staff_retention_nothing_to_destroy\`. Taze oturum ister (eskiyse 403 \`reauthentication_required\`); \`Idempotency-Key\` zorunlu. Geri alınamaz. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: staffDataDestructionInputSchema,
        response: { 201: staffDataDestructionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await destroyStaffDataCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return staffDataDestructionResponse.parse(sendBody(reply, result))
    },
  )
}
