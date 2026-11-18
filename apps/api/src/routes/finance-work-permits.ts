import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_WORK_PERMIT_ROLES,
  workPermitApplySchema,
  workPermitApproveSchema,
  workPermitCancelSchema,
  workPermitInputSchema,
  workPermitRejectSchema,
  workPermitUpdateSchema,
} from '@kampus/school-core/lib/finance-work-permits.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  applyWorkPermitCommand,
  approveWorkPermitCommand,
  cancelWorkPermitCommand,
  createWorkPermitCommand,
  getWorkPermitFor,
  listWorkPermitsFor,
  listWorkPermitTeachersFor,
  rejectWorkPermitCommand,
  updateWorkPermitCommand,
} from '../services/finance-work-permits.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  permitCancelResponse,
  permitListQuery,
  permitListResponse,
  permitParams,
  permitResponse,
  teacherListQuery,
  teacherListResponse,
} from './finance-work-permits.schemas.ts'

/**
 * Öğretmen çalışma onayı uçları (docs/domain/finans.md DOM-FIN-114; ON-174). Modül `finance`; okuma
 * ve yazma yalnız yönetici (K-377). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 * Kampüs MEBBİS'e başvuru göndermez (IST-143); kayıt kurum içi takiptir. Açılış `Idempotency-Key`
 * ister (çift tıklama ikinci başvuru açmaz); durum geçişleri `If-Match` sürümüyle yapılır.
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-377). Modül `finance`. MEBBİS’e gönderim yoktur (IST-143).'
const URL = '/api/v1/finance/work-permits'
const TEACHERS_URL = '/api/v1/finance/work-permit-teachers'

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

export function registerFinanceWorkPermitRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_WORK_PERMIT_ROLES),
  ]
  const tags = ['finance-work-permits']

  typed.get(
    TEACHERS_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listWorkPermitTeachers',
        tags,
        summary: 'Öğretmenlerin çalışma onayı takibi',
        description: `Kurumun etkin öğretmenleri ada göre; her satırda geçerli (bitişi en geç) onay, durum (\`valid\`, \`expiring\` 30 gün içinde dolacak, \`expired\`, \`missing\`), kalan gün, açık başvuru ve \`teaching\` (önümüzdeki 30 günde ders programında iptal edilmemiş dersi ya da bitmemiş dil grubu) ile \`warning\` (programda görevli ve onay yok ya da süresi doldu) işaretleri (K-376). Durum her okumada bugüne (Europe/Istanbul) göre hesaplanır. \`status\` (\`attention\` geçerli olmayan her durum) ve \`warning=true\` süzer; \`counts\` süzgeçten bağımsız rozet sayılarıdır. ${MANAGER}`,
        querystring: teacherListQuery,
        response: { 200: teacherListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, warning } = request.query
      const { items, total, counts } = await listWorkPermitTeachersFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        warning: warning === 'true',
      })
      return { data: items, meta: { page, pageSize, total }, counts }
    },
  )

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listWorkPermits',
        tags,
        summary: 'Çalışma onayı kayıtlarını listele',
        description: `İptal edilmemiş kayıtlar, yeni açılan önce. \`membershipId\` öğretmene, \`state\` gösterilen duruma (\`expired\` onaylı ve bitişi bugünden önce; \`approved\` yalnız süresi geçmemiş onaylar), \`q\` öğretmen adı ve branşa göre süzer. ${MANAGER}`,
        querystring: permitListQuery,
        response: { 200: permitListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listWorkPermitsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${URL}/:permitId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getWorkPermit',
        tags,
        summary: 'Çalışma onayı ayrıntısı',
        description: `Kayıt, hesaplanan durum, ret gerekçesi ve onay belgesinin adı. Olmayan, iptal edilmiş ya da başka kurumun kaydı 404. ${MANAGER}`,
        params: permitParams,
        response: { 200: permitResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getWorkPermitFor(contextOf(request), request.params.permitId),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createWorkPermit',
        tags,
        summary: 'Çalışma onayı kaydı aç',
        description: `Öğretmen üyeliği, onay türü (\`initial\`, \`renewal\`, \`branch_change\`), branş ve isteğe bağlı başvuru günü ile not. Başvuru günü varsa kayıt \`applied\`, yoksa \`preparing\` açılır (K-375). Olmayan üyelik 422 \`work_permit_teacher_not_found\`, öğretmen olmayan üyelik 422 \`work_permit_not_teacher\`, pasif öğretmen 422 \`work_permit_teacher_inactive\`, sürmekte olan başvuru varken 422 \`work_permit_open_exists\`, onaysız öğretmende yenileme ya da branş değişikliği 422 \`work_permit_no_prior_approval\`, gelecek gün 422 \`work_permit_date_in_future\`. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: workPermitInputSchema,
        response: { 201: permitResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createWorkPermitCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = permitResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    `${URL}/:permitId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateWorkPermit',
        tags,
        summary: 'Çalışma onayı kaydını düzelt',
        description: `Verilen alanlar değişir. Sonuçlanmış (onaylanmış ya da reddedilmiş) kayıtta yalnız not ve onay belgesi değişir (422 \`work_permit_decided\`; yanlış kayıt iptal edilip yeniden açılır). Başvuru günü yalnız başvurulmuş kayıtta (422 \`work_permit_not_applied\`). Değişiklik yoksa 422 \`work_permit_unchanged\`. \`documentFileId\` (\`POST /files\`, \`purpose: document\`, PDF; yükleyen yönetici bağlar: başkasının ya da başka kurumun dosyası 422 \`file_unavailable\`, başka kayda bağlı 409 \`file_already_attached\`) değişince eski dosyanın bağı kalkar; \`null\` eki kaldırır. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: permitParams,
        body: workPermitUpdateSchema,
        response: { 200: permitResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateWorkPermitCommand(
        contextOf(request),
        request.params.permitId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return permitResponse.parse(sendBody(reply, result))
    },
  )

  const transition = (spec: {
    verb: 'apply' | 'approve' | 'reject'
    operationId: string
    summary: string
    description: string
    body:
      typeof workPermitApplySchema | typeof workPermitApproveSchema | typeof workPermitRejectSchema
    run: Transition
  }) =>
    typed.post(
      `${URL}/:permitId/${spec.verb}`,
      {
        preValidation: [...guarded, requireIfMatch(), captureInput()],
        schema: {
          operationId: spec.operationId,
          tags,
          summary: spec.summary,
          description: `${spec.description} \`If-Match\` zorunlu. Başka kurumun ya da iptal edilmiş kaydı 404. ${MANAGER}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: permitParams,
          body: spec.body,
          response: { 200: permitResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await spec.run(
          contextOf(request),
          request.params.permitId,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return permitResponse.parse(sendBody(reply, result))
      },
    )

  transition({
    verb: 'apply',
    operationId: 'applyWorkPermit',
    summary: 'Başvuruldu olarak işaretle',
    description:
      'Hazırlanan kayıt MEBBİS başvuru günüyle `applied` olur (K-375). Hazırlanmayan kayıt 422 `work_permit_not_preparing`, gelecek gün 422 `work_permit_date_in_future`.',
    body: workPermitApplySchema,
    run: applyWorkPermitCommand,
  })
  transition({
    verb: 'approve',
    operationId: 'approveWorkPermit',
    summary: 'Onayı kaydet',
    description:
      'Başvurulmuş kayıt onay günü, onay sayısı ve geçerlilik bitişiyle `approved` olur. `validUntil` verilmezse onay gününün eğitim yılı sonu (kurumun yıl kaydı, yoksa 31 Ağustos; yıl sonuna 60 günden az kala verilen onayda sonraki yılın sonu), `null` süresizdir (K-376). Onay belgesi (`documentFileId`) isteğe bağlıdır. Başvurulmamış kayıt 422 `work_permit_not_applied`, başvurudan önceki gün 422 `work_permit_decision_before_application`, gelecek gün 422 `work_permit_date_in_future`, onaydan önceki bitiş 422 `work_permit_valid_until_before_approval`.',
    body: workPermitApproveSchema,
    run: approveWorkPermitCommand,
  })
  transition({
    verb: 'reject',
    operationId: 'rejectWorkPermit',
    summary: 'Reddi kaydet',
    description:
      'Başvurulmuş kayıt ret günü ve gerekçesiyle (5–500 karakter; denetim kaydına yalnız alan adı) `rejected` olur. Başvurulmamış kayıt 422 `work_permit_not_applied`, başvurudan önceki gün 422 `work_permit_decision_before_application`.',
    body: workPermitRejectSchema,
    run: rejectWorkPermitCommand,
  })

  typed.post(
    `${URL}/:permitId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelWorkPermit',
        tags,
        summary: 'Yanlış kaydı iptal et',
        description: `Her durumdaki kayıt gerekçeyle (5–500 karakter; denetim kaydına yazılmaz) iptal (arşiv) edilir; listeden ve takipten düşer, bağlı onay belgesinin bağı kalkar. \`If-Match\` zorunlu. Başka kurumun ya da iptal edilmiş kaydı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: permitParams,
        body: workPermitCancelSchema,
        response: { 200: permitCancelResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelWorkPermitCommand(
        contextOf(request),
        request.params.permitId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return permitCancelResponse.parse(sendBody(reply, result))
    },
  )
}
