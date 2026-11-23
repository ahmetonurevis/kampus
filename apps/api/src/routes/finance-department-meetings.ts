import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  departmentDecisionFollowUpSchema,
  departmentDecisionInputSchema,
  departmentMeetingFinalizeSchema,
  departmentMeetingInputSchema,
  FINANCE_DEPARTMENT_MEETING_ROLES,
  meetingAgendaTemplateInputSchema,
  meetingAgendaTemplateUpdateSchema,
} from '@kampus/school-core/lib/finance-department-meetings.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveTemplateCommand,
  createDecisionCommand,
  createMeetingCommand,
  createTemplateCommand,
  finalizeMeetingCommand,
  followUpDecisionCommand,
  listDecisionsFor,
  listMeetingsFor,
  listTemplatesFor,
  meetingFor,
  removeDecisionCommand,
  subjectsFor,
  updateDecisionCommand,
  updateMeetingCommand,
  updateTemplateCommand,
} from '../services/finance-department-meetings.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  decisionListQuery,
  decisionListResponse,
  decisionParams,
  decisionRemoveResponse,
  decisionResponse,
  meetingListQuery,
  meetingListResponse,
  meetingParams,
  meetingResponse,
  subjectListResponse,
  templateListQuery,
  templateListResponse,
  templateParams,
  templateResponse,
} from './finance-department-meetings.schemas.ts'

/**
 * Kurul ve zümre toplantısı tutanağı uçları (docs/domain/finans.md DOM-FIN-132, DOM-FIN-135;
 * ON-217, ON-218). Modül `finance`, yalnız yönetici (K-451). Uç adları zümre modülünden kalır,
 * öğretmenler kurulu ve şube öğretmenler kurulunu da taşır (K-460; geriye uyum). Yeni tutanak,
 * yeni karar ve yeni gündem şablonu `Idempotency-Key` ister; düzeltme, kesinleştirme, kaldırma,
 * arşiv ve takip `If-Match`. Kesinleşen tutanakta yalnız karar takibi yazılır (K-453).
 */

const ROLE = 'Rol: yalnız `yonetici` (K-451). Modül `finance`.'
const URL = '/api/v1/finance/department-meetings'
const ITEM = `${URL}/:meetingId`
const DECISIONS = `${ITEM}/decisions`
const DECISION = `${DECISIONS}/:decisionId`
const TEMPLATES = '/api/v1/finance/department-meeting-templates'
const TEMPLATE = `${TEMPLATES}/:templateId`
const BOARD =
  'Kurul türü (`board`, K-460): `department` zümre toplantısı (varsayılan; `subjectId` zorunlu), `teachers` öğretmenler kurulu (ders ve sınıf yok), `class` şube öğretmenler kurulu (`classId` zorunlu; kurumun etkin sınıf kaydı, yoksa 422 `department_meeting_class_not_found`). Türe uymayan hedef 400. İsteğe bağlı `agendaTemplateId` gündemin kopyalandığı şablondur (iz): olmayan 422 `department_meeting_template_not_found`, başka kurul türünün 422 `department_meeting_template_board_mismatch`, arşivli 422 `department_meeting_template_archived` (K-461).'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceDepartmentMeetingRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guard: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_DEPARTMENT_MEETING_ROLES),
  ]
  const tags = ['finance-department-meetings']
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })

  typed.get(
    URL,
    {
      preValidation: guard,
      schema: {
        operationId: 'listDepartmentMeetings',
        tags,
        summary: 'Kurul ve zümre toplantılarını listele',
        description: `Kurul ve zümre toplantısı tutanakları, yeniden eskiye (DOM-FIN-132, DOM-FIN-135). Ders ya da sınıf adında ya da yerde aranır; kurul türü, zümre, sınıf, zaman, durum ve gün aralığıyla süzülür. Satır katılım ve açık karar sayılarını taşır. ${ROLE}`,
        querystring: meetingListQuery,
        response: { 200: meetingListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listMeetingsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    URL,
    {
      preValidation: [...guard, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createDepartmentMeeting',
        tags,
        summary: 'Kurul ya da zümre toplantısı tutanağı aç',
        description: `Tutanak taslak açılır (K-452). ${BOARD} Zümre kurumun dersi (yoksa 422 \`department_meeting_subject_not_found\`); başkan ve katılımcılar kurumun etkin öğretmen ya da yönetici üyeliği (olmayan ya da başka kurumun üyeliği 422 \`department_meeting_staff_not_found\`, diğer roller 422 \`department_meeting_not_staff\`, ayrılmış 422 \`department_meeting_staff_inactive\`); başkan katılımcılar arasında "katıldı" olmalı. Gündem 1–30 madde, sıra gövdedeki sıradır. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${ROLE}`,
        headers: createHeaders,
        body: departmentMeetingInputSchema,
        response: { 201: meetingResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMeetingCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = meetingResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/department-meeting-subjects',
    {
      preValidation: guard,
      schema: {
        operationId: 'listDepartmentMeetingSubjects',
        tags,
        summary: 'Zümre (ders) seçenekleri',
        // Uç adı zümreye özgüdür: ders yalnız zümre toplantısında seçilir.
        description: `Kurumun ders kayıtları ve öğretmen kayıtlarının dersleri (izin takvimiyle aynı kaynak, K-421); kurumda ders yoksa müfredat dersleri. ${ROLE}`,
        response: { 200: subjectListResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await subjectsFor(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/finance/department-meeting-decisions',
    {
      preValidation: guard,
      schema: {
        operationId: 'listDepartmentMeetingDecisions',
        tags,
        summary: 'Kurul ve zümre kararlarının takip listesi',
        description: `Kesinleşmiş tutanakların kararları; termine göre (terminsiz sonda). \`overdue=true\` termini İstanbul gününe göre geçmiş açık kararları verir (K-453). Durum, sorumlu, zümre ve kurul türüyle süzülür (K-462). ${ROLE}`,
        querystring: decisionListQuery,
        response: { 200: decisionListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, overdue, ...filters } = request.query
      const { items, total } = await listDecisionsFor(contextOf(request), {
        page,
        pageSize,
        overdue: overdue === 'true',
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    ITEM,
    {
      preValidation: guard,
      schema: {
        operationId: 'getDepartmentMeeting',
        tags,
        summary: 'Kurul ya da zümre toplantısı tutanağı',
        description: `Gündem, katılım ve numaralı kararlar; tutanak PDF'i bu yanıttan üretilir. Olmayan ya da başka kurumun tutanağı 404. ${ROLE}`,
        params: meetingParams,
        response: { 200: meetingResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await meetingFor(contextOf(request), request.params.meetingId) }),
  )

  typed.patch(
    ITEM,
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateDepartmentMeeting',
        tags,
        summary: 'Tutanak taslağını düzelt',
        description: `Tam gövde (oluşturma kurallarıyla; kurul türü taslakta değişebilir). Tutanakta zaten olan ders, sınıf ya da arşivlenmiş şablon kalabilir. Var olan gündem maddesi kimliğiyle gönderilir; bilinmeyen kimlik 422 \`department_meeting_agenda_unknown\`, kararı olan maddeyi silmek 422 \`department_meeting_agenda_in_use\`. Toplantı günü açık kararların termininden sonraya alınamaz (422 \`department_meeting_due_before_meeting\`). Tutanakta zaten olan ayrılmış personel kalabilir. Kesinleşmiş tutanak 409 \`department_meeting_finalized\`. \`If-Match\` zorunlu. Başka kurumun tutanağı 404. ${ROLE}`,
        headers: versionHeaders,
        params: meetingParams,
        body: departmentMeetingInputSchema,
        response: { 200: meetingResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateMeetingCommand(
        contextOf(request),
        request.params.meetingId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return meetingResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/finalize`,
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'finalizeDepartmentMeeting',
        tags,
        summary: 'Tutanağı kesinleştir',
        description: `İmza günüyle kesinleşir (K-453); sonra toplantı, katılım ve karar metni değişmez, yalnız karar takibi yazılır. İmza günü toplantıdan önce (422 \`department_meeting_signed_before_meeting\`) ve bugünden sonra (422 \`department_meeting_signed_in_future\`) olamaz; kesinleşmiş tutanak 409 \`department_meeting_finalized\`. \`If-Match\` zorunlu. Başka kurumun tutanağı 404. ${ROLE}`,
        headers: versionHeaders,
        params: meetingParams,
        body: departmentMeetingFinalizeSchema,
        response: { 200: meetingResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await finalizeMeetingCommand(
        contextOf(request),
        request.params.meetingId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return meetingResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    DECISIONS,
    {
      preValidation: [...guard, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createDepartmentMeetingDecision',
        tags,
        summary: 'Tutanağa karar ekle',
        description: `Taslak tutanağın gündem maddesine karar; durum "açık" (K-452). Madde tutanakta yoksa 422 \`department_meeting_agenda_not_found\`, termin toplantıdan önceyse 422 \`department_meeting_due_before_meeting\`; sorumlu kurumun etkin öğretmen ya da yöneticisi (422 \`department_meeting_staff_not_found\`, \`department_meeting_not_staff\`, \`department_meeting_staff_inactive\`). Kesinleşmiş tutanak 409 \`department_meeting_finalized\`. \`Idempotency-Key\` zorunlu. Başka kurumun tutanağı 404. ${ROLE}`,
        headers: createHeaders,
        params: meetingParams,
        body: departmentDecisionInputSchema,
        response: { 201: decisionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createDecisionCommand(
        contextOf(request),
        request.params.meetingId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return decisionResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    DECISION,
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateDepartmentMeetingDecision',
        tags,
        summary: 'Kararı düzelt',
        description: `Taslak tutanakta tam gövde (ekleme kurallarıyla); kesinleşmiş tutanak 409 \`department_meeting_finalized\` (takip ayrı uçtadır). \`If-Match\` zorunlu. Başka tutanağın ya da kurumun kararı 404. ${ROLE}`,
        headers: versionHeaders,
        params: decisionParams,
        body: departmentDecisionInputSchema,
        response: { 200: decisionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateDecisionCommand(
        contextOf(request),
        request.params.meetingId,
        request.params.decisionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return decisionResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    DECISION,
    {
      preValidation: [...guard, requireIfMatch()],
      schema: {
        operationId: 'removeDepartmentMeetingDecision',
        tags,
        summary: 'Kararı kaldır',
        description: `Taslak tutanaktaki karar arşivlenir; kesinleşmiş tutanakta karar kaldırılmaz, iptal edilir (409 \`department_meeting_finalized\`). \`If-Match\` zorunlu. Başka tutanağın ya da kurumun kararı 404. ${ROLE}`,
        headers: versionHeaders,
        params: decisionParams,
        response: { 200: decisionRemoveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await removeDecisionCommand(
        contextOf(request),
        request.params.meetingId,
        request.params.decisionId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return decisionRemoveResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${DECISION}/follow-up`,
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'followUpDepartmentMeetingDecision',
        tags,
        summary: 'Karar takibini yaz',
        description: `Kesinleşmiş tutanakta kararın durumu (açık, tamamlandı, iptal) ve takip notu (K-453); iptalde not zorunlu (400). Taslak tutanak 409 \`department_meeting_not_finalized\`, iptal edilmiş karar 409 \`department_decision_cancelled\`. \`If-Match\` zorunlu. Başka tutanağın ya da kurumun kararı 404. ${ROLE}`,
        headers: versionHeaders,
        params: decisionParams,
        body: departmentDecisionFollowUpSchema,
        response: { 200: decisionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await followUpDecisionCommand(
        contextOf(request),
        request.params.meetingId,
        request.params.decisionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return decisionResponse.parse(sendBody(reply, result))
    },
  )
  typed.get(
    TEMPLATES,
    {
      preValidation: guard,
      schema: {
        operationId: 'listDepartmentMeetingTemplates',
        tags,
        summary: 'Gündem şablonlarını listele',
        description: `Kurumun kurul ve zümre toplantısı gündem şablonları (DOM-FIN-135, K-461), kurul türü sonra ada göre. Varsayılan yalnız etkinler; \`archived=true\` arşivlenmişler. Kurul türüyle süzülür. ${ROLE}`,
        querystring: templateListQuery,
        response: { 200: templateListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, board, archived } = request.query
      const { items, total } = await listTemplatesFor(contextOf(request), {
        page,
        pageSize,
        board,
        archived: archived === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    TEMPLATES,
    {
      preValidation: [...guard, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createDepartmentMeetingTemplate',
        tags,
        summary: 'Gündem şablonu aç',
        description: `Kurul türü, ad (2–120) ve 1–30 sıralı madde (K-461). Kurul türünde aynı adlı etkin şablon 409 \`department_meeting_template_name_taken\`. Toplantı açılırken gündem şablondan kopyalanır, sonra toplantıda düzenlenir. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${ROLE}`,
        headers: createHeaders,
        body: meetingAgendaTemplateInputSchema,
        response: { 201: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTemplateCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = templateResponse.parse(sendBody(reply, result))
      reply.header('location', `${TEMPLATES}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    TEMPLATE,
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateDepartmentMeetingTemplate',
        tags,
        summary: 'Gündem şablonunu düzelt',
        description: `Ad ve maddeler (tam gövde); kurul türü değişmez (gövdede 400). Bu şablondan açılmış toplantıların gündemi değişmez (kopya, K-461). Aynı adlı etkin şablon 409 \`department_meeting_template_name_taken\`, arşivli şablon 409 \`department_meeting_template_archived\`. \`If-Match\` zorunlu. Başka kurumun şablonu 404. ${ROLE}`,
        headers: versionHeaders,
        params: templateParams,
        body: meetingAgendaTemplateUpdateSchema,
        response: { 200: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateTemplateCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    TEMPLATE,
    {
      preValidation: [...guard, requireIfMatch()],
      schema: {
        operationId: 'archiveDepartmentMeetingTemplate',
        tags,
        summary: 'Gündem şablonunu arşivle',
        description: `Şablon silinmez, arşivlenir (K-461): yeni toplantıya bağlanmaz, bağlı toplantılar etkilenmez. Arşivli şablon 409 \`department_meeting_template_archived\`. \`If-Match\` zorunlu. Başka kurumun şablonu 404. ${ROLE}`,
        headers: versionHeaders,
        params: templateParams,
        response: { 200: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveTemplateCommand(
        contextOf(request),
        request.params.templateId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )
}
