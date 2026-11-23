import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_FEEDBACK_ROLES,
  staffFeedbackAssignmentCreateSchema,
  staffFeedbackResponseSchema,
  staffFeedbackSettingsSchema,
  staffFeedbackTemplateInputSchema,
  staffFeedbackWithdrawSchema,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  createStaffFeedbackAssignmentCommand,
  createStaffFeedbackTemplateCommand,
  getStaffFeedbackOverview,
  getStaffFeedbackResultFor,
  listStaffFeedbackAssignmentsFor,
  listStaffFeedbackSubjectsFor,
  recordStaffFeedbackResponseCommand,
  removeStaffFeedbackAssignmentCommand,
  setStaffFeedbackSettingsCommand,
  staffFeedbackSettingsFor,
  updateStaffFeedbackTemplateCommand,
  withdrawStaffFeedbackResponseCommand,
} from '../services/finance-staff-feedback.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  assignmentParams,
  periodParams,
  resultParams,
  staffFeedbackAssignmentListQuery,
  staffFeedbackAssignmentListResponse,
  staffFeedbackAssignmentRemoveResponse,
  staffFeedbackAssignmentResponse,
  staffFeedbackOverviewResponse,
  staffFeedbackResultResponse,
  staffFeedbackSettingsResponse,
  staffFeedbackSubjectListQuery,
  staffFeedbackSubjectListResponse,
  staffFeedbackTemplateResponse,
  templateParams,
} from './finance-staff-feedback.schemas.ts'

/**
 * Çok kaynaklı geri bildirim uçları (docs/domain/finans.md DOM-FIN-134; ON-212). Modül `finance`;
 * okuma ve yazma yalnız yönetici. Şablon ve atama açmak `Idempotency-Key`, düzeltme, kaldırma,
 * yanıt girişi, geri alma ve eşik ayarı `If-Match` ister. Tek bir meslektaş yanıtını döndüren uç
 * yoktur; toplu sonucun okunuşu denetime düşer (K-459). Değerlendirenin kendi ekranı yoktur;
 * yönetici yanıtı değerlendiren adına girer (K-458).
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-459; geri bildirim kişiseldir, değerlendirenin ve değerlendirilenin kendi ekranı ayrı iştir). Modül `finance`.'
const PERIODS = '/api/v1/finance/performance-periods'
const TEMPLATES = '/api/v1/finance/staff-feedback-templates'
const ASSIGNMENTS = '/api/v1/finance/staff-feedback-assignments'
const SETTINGS = '/api/v1/finance/staff-feedback-settings'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceStaffFeedbackRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFF_FEEDBACK_ROLES),
  ]
  const tags = ['finance-staff-feedback']
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    SETTINGS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffFeedbackSettings',
        tags,
        summary: 'Meslektaş anonimlik eşiği',
        description: `Kurumun meslektaş anonimlik eşiği (3–10; hiç kaydedilmediyse varsayılan 3, sürüm 1; K-459). ${MANAGER}`,
        response: { 200: staffFeedbackSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await staffFeedbackSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setStaffFeedbackSettings',
        tags,
        summary: 'Meslektaş anonimlik eşiğini kaydet',
        description: `Eşik 3–10 (400); aynı değer 422 \`staff_feedback_settings_unchanged\`. Meslektaş sonucu en az bu kadar yanıtla ve soru başına en az bu kadar cevapla toplu gösterilir (K-459). \`If-Match\` zorunlu (hiç kaydedilmediyse 1). Denetim \`finance.staff_feedback.settings\`. ${MANAGER}`,
        headers: versionHeaders,
        body: staffFeedbackSettingsSchema,
        response: { 200: staffFeedbackSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await setStaffFeedbackSettingsCommand(
        contextOf(request),
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffFeedbackSettingsResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${PERIODS}/:periodId/staff-feedback`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffFeedbackOverview',
        tags,
        summary: 'Dönemin geri bildirim şablonu ve yanıt oranı',
        description: `Şablon (sorular, girilmiş yanıt sayısı, kilit) ya da hazırlanmadıysa boş; atanan, yanıtlanan, bekleyen ve yanıt oranı (toplam ve yönetici/meslektaş; K-458); kurumun anonimlik eşiği. Kişisel veri taşımaz. Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        response: { 200: staffFeedbackOverviewResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffFeedbackOverview(contextOf(request), request.params.periodId),
    }),
  )

  typed.post(
    `${PERIODS}/:periodId/staff-feedback-template`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffFeedbackTemplate',
        tags,
        summary: 'Dönemin geri bildirim şablonunu hazırla',
        description: `Sorular (1–20): tür (\`scale\` puanlı 1–5, \`open\` açık uçlu), metin (5–300), zorunlu mu (K-457). Dönem başına tek şablon (409 \`staff_feedback_template_exists\`); kapanmış dönem 409 \`performance_period_closed\`. \`Idempotency-Key\` zorunlu. Başka kurumun dönemi 404. ${MANAGER}`,
        headers: createHeaders,
        params: periodParams,
        body: staffFeedbackTemplateInputSchema,
        response: { 201: staffFeedbackTemplateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffFeedbackTemplateCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return staffFeedbackTemplateResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${TEMPLATES}/:templateId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStaffFeedbackTemplate',
        tags,
        summary: 'Geri bildirim şablonunun sorularını düzelt',
        description: `Soruların tamamı yeniden yazılır (K-457). Şablonla yanıt girildiyse (geri alınan dahil) 409 \`staff_feedback_template_in_use\`, kapanmış dönem 409 \`performance_period_closed\`, sürüm tutmazsa 409. \`If-Match\` zorunlu. Başka kurumun şablonu 404. ${MANAGER}`,
        headers: versionHeaders,
        params: templateParams,
        body: staffFeedbackTemplateInputSchema,
        response: { 200: staffFeedbackTemplateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateStaffFeedbackTemplateCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffFeedbackTemplateResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${PERIODS}/:periodId/staff-feedback-subjects`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffFeedbackSubjects',
        tags,
        summary: 'Dönemin değerlendirilenleri ve yanıt oranı',
        description: `Dönemde performans kaydı olan her personel, ada göre: atanan ve yanıtlanan değerlendiren sayısı (toplam, yönetici, meslektaş; K-458). Değerlendiren adı ve cevap dönmez. Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        querystring: staffFeedbackSubjectListQuery,
        response: { 200: staffFeedbackSubjectListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listStaffFeedbackSubjectsFor(
        contextOf(request),
        request.params.periodId,
        { page, pageSize, q },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${PERIODS}/:periodId/staff-feedback-assignments`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffFeedbackAssignments',
        tags,
        summary: 'Dönemin değerlendiren atamaları',
        description: `Değerlendirilen, değerlendiren, ilişki (\`manager\`, \`peer\`), durum (\`pending\`, \`submitted\`), kanal ve giriş anı (K-458). Cevap ve geri alma gerekçesi dönmez (K-459). Değerlendirilen, ilişki ve durumla süzülür; adlarda aranır. Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        querystring: staffFeedbackAssignmentListQuery,
        response: { 200: staffFeedbackAssignmentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, subjectMembershipId, relation, status } = request.query
      const { items, total } = await listStaffFeedbackAssignmentsFor(
        contextOf(request),
        request.params.periodId,
        { page, pageSize, q, subjectMembershipId, relation, status },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${PERIODS}/:periodId/staff-feedback-assignments`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffFeedbackAssignment',
        tags,
        summary: 'Değerlendiren ata',
        description: `Değerlendirilen (dönemde performans kaydı olmalı; 422 \`staff_feedback_not_enrolled\`), değerlendiren (kurumun etkin yönetici, öğretmen ya da ön bürosu; 422 \`staff_feedback_reviewer_not_found\`, \`staff_feedback_reviewer_not_staff\`, \`staff_feedback_reviewer_inactive\`) ve ilişki (\`manager\`, \`peer\`). Kişi kendini değerlendirmez (422 \`staff_feedback_self\`); dönemde değerlendirilen × değerlendiren tek atama (409 \`staff_feedback_assignment_exists\`). Yalnız planlama, yürürlük ve ara görüşmede (409 \`staff_feedback_assign_closed\`; kapanmış 409 \`performance_period_closed\`) (K-458). \`Idempotency-Key\` zorunlu. Başka kurumun dönemi 404. ${MANAGER}`,
        headers: createHeaders,
        params: periodParams,
        body: staffFeedbackAssignmentCreateSchema,
        response: { 201: staffFeedbackAssignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffFeedbackAssignmentCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return staffFeedbackAssignmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${ASSIGNMENTS}/:assignmentId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'removeStaffFeedbackAssignment',
        tags,
        summary: 'Değerlendiren atamasını kaldır',
        description: `Yanıtı girilmemiş atama arşivlenir (K-458); yanıtlanmış 409 \`staff_feedback_responded\`, değerlendirme aşaması 409 \`staff_feedback_assign_closed\`, kapanmış dönem 409 \`performance_period_closed\`. \`If-Match\` zorunlu. Başka kurumun ataması 404. ${MANAGER}`,
        headers: versionHeaders,
        params: assignmentParams,
        response: { 200: staffFeedbackAssignmentRemoveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await removeStaffFeedbackAssignmentCommand(
        contextOf(request),
        request.params.assignmentId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffFeedbackAssignmentRemoveResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ASSIGNMENTS}/:assignmentId/response`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'recordStaffFeedbackResponse',
        tags,
        summary: 'Değerlendiren adına yanıtı gir',
        description: `Kanal (\`paper\` kâğıt form, \`email\` e-posta) ve soru sırasıyla cevaplar (puanlı soruda \`score\` 1–5, açık uçluda \`text\`); giriş yanıtı gönderir (K-458). Dönem yürürlük ya da ara görüşmede olmalı (422 \`staff_feedback_not_open\`; kapanmış 409 \`performance_period_closed\`); şablon yoksa 422 \`staff_feedback_template_missing\`; yanıtlanmış atama 409 \`staff_feedback_already_responded\`; değerlendirilen yönetici kendi hakkındaki yanıtı giremez (422 \`staff_feedback_subject_entry\`); cevap sayısı/türü şablona uymazsa 422 \`staff_feedback_answers_mismatch\` / \`staff_feedback_answer_kind\`; zorunlu soru boşsa 422 \`staff_feedback_incomplete\`. Yanıtta cevap dönmez; cevaplar denetime yazılmaz (K-459). \`If-Match\` zorunlu. Başka kurumun ataması 404. ${MANAGER}`,
        headers: versionHeaders,
        params: assignmentParams,
        body: staffFeedbackResponseSchema,
        response: { 200: staffFeedbackAssignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await recordStaffFeedbackResponseCommand(
        contextOf(request),
        request.params.assignmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffFeedbackAssignmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ASSIGNMENTS}/:assignmentId/withdraw`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'withdrawStaffFeedbackResponse',
        tags,
        summary: 'Girilmiş yanıtı geri al',
        description: `Gerekçe (5–500) zorunlu; cevaplar silinir, atama yanıt bekler, son gerekçe, geri alan ve an saklanır, geri alma sayısı artar (K-458). Yanıtsız atama 409 \`staff_feedback_not_responded\`; dönem yürürlük ya da ara görüşmede değilse 422 \`staff_feedback_not_open\`, kapanmışsa 409 \`performance_period_closed\`. Gerekçe metni denetime yazılmaz. \`If-Match\` zorunlu. Başka kurumun ataması 404. ${MANAGER}`,
        headers: versionHeaders,
        params: assignmentParams,
        body: staffFeedbackWithdrawSchema,
        response: { 200: staffFeedbackAssignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await withdrawStaffFeedbackResponseCommand(
        contextOf(request),
        request.params.assignmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return staffFeedbackAssignmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${PERIODS}/:periodId/staff-feedback-results/:membershipId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffFeedbackResult',
        tags,
        summary: 'Değerlendirilenin toplu geri bildirim sonucu',
        description: `Yönetici yanıtları değerlendirenin adıyla (anonim değil). Meslektaş yanıtları yalnız toplu: dönem değerlendirme ya da kapandı aşamasında (değilse \`hiddenReason: period_open\`) ve en az eşik kadar meslektaş yanıtı varsa (değilse \`below_threshold\`); soru başına cevap eşiğin altındaysa o soru gizli. Puanlı soruda ortalama, açık uçluda alfabetik metinler; kimden geldiği dönmez (K-459). Okuma aynı transaction'da denetime yazılır (\`finance.staff_feedback_result.read\`, alan adları). Dönemde performans kaydı olmayan personel ve başka kurum 404. ${MANAGER}`,
        params: resultParams,
        response: { 200: staffFeedbackResultResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffFeedbackResultFor(
        contextOf(request),
        request.params.periodId,
        request.params.membershipId,
      ),
    }),
  )
}
