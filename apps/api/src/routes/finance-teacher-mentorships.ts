import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  mentorshipCompleteSchema,
  mentorshipCreateSchema,
  mentorshipEmptySchema,
  mentorshipEndSchema,
  mentorshipMeetingSchema,
  mentorshipSettingsSchema,
  TEACHER_MENTORSHIP_ROLES,
} from '@kampus/school-core/lib/finance-teacher-mentorships.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  addMentorshipMeetingCommand,
  archiveMentorshipMeetingCommand,
  completeMentorshipCommand,
  createMentorshipCommand,
  endMentorshipCommand,
  getMentorshipFor,
  getMentorshipSettingsFor,
  getMentorshipSummaryFor,
  listMentorshipOnboardingOptionsFor,
  listMentorshipsFor,
  setMentorshipChecklistItemCommand,
  updateMentorshipSettingsCommand,
} from '../services/finance-teacher-mentorships.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  itemParams,
  meetingParams,
  mentorshipListQuery,
  mentorshipListResponse,
  mentorshipParams,
  mentorshipResponse,
  onboardingOptionsResponse,
  settingsResponse,
  summaryResponse,
} from './finance-teacher-mentorships.schemas.ts'

/**
 * Yeni öğretmen mentorluğu uçları (docs/domain/finans.md DOM-FIN-136; ON-219). Modül `finance`;
 * okuma ve yazma bu turda yalnız yönetici (K-465). Açılış `Idempotency-Key`; görüşme kaydı
 * `Idempotency-Key` ve eşleşmenin `If-Match` sürümü; madde işareti, görüşme arşivi, tamamlama ve
 * erken sonlandırma eşleşmenin `If-Match` sürümüyle yapılır. Eşleşme okuması denetime düşer.
 */

const MANAGER = 'Rol: yalnız `yonetici`. Modül `finance`.'
const URL = '/api/v1/finance/teacher-mentorships'
const ITEM = `${URL}/:mentorshipId`
const SETTINGS_URL = '/api/v1/finance/teacher-mentorship-settings'
const SUMMARY_URL = '/api/v1/finance/teacher-mentorship-summary'
const ONBOARDING_URL = '/api/v1/finance/teacher-mentorship-onboarding-options'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceTeacherMentorshipRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(TEACHER_MENTORSHIP_ROLES),
  ]
  const tags = ['finance-teacher-mentorships']
  const transitionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    SETTINGS_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getTeacherMentorshipSettings',
        tags,
        summary: 'Mentorluk ayarı',
        description: `Mentor başına süren en çok eşleşme ve yeni eşleşmelere kopyalanan kontrol listesi (K-463, K-465). Ayar yazılmadıysa varsayılanlar (3 eşleşme, beş madde) ve \`isDefault: true\`. ${MANAGER}`,
        response: { 200: settingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getMentorshipSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS_URL,
    {
      preValidation: [...guarded, captureInput()],
      schema: {
        operationId: 'updateTeacherMentorshipSettings',
        tags,
        summary: 'Mentorluk ayarını değiştir',
        description: `Sınır (1–10) ve madde listesi bütünüyle yazılır (en çok 20; madde 2–120, aynı madde iki kez olmaz). İlk yazma \`If-Match\` almaz (ayar varsa 409), sonrakiler ayarın sürümünü ister. Açılmış eşleşmelerin listesi değişmez. ${MANAGER}`,
        headers: commandHeadersSchema('optional'),
        body: mentorshipSettingsSchema,
        response: { 200: settingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateMentorshipSettingsCommand(
        contextOf(request),
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return settingsResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    SUMMARY_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getTeacherMentorshipSummary',
        tags,
        summary: 'Mentorluk takip özeti',
        description: `Süren, görüşmesi 30 günü aşan, tamamlanan ve erken sonlanan eşleşme sayıları; süren eşleşmelerin kontrol listesi tamamlanma oranı (K-465). Kişisel alan taşımaz. ${MANAGER}`,
        response: { 200: summaryResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getMentorshipSummaryFor(contextOf(request)) }),
  )

  typed.get(
    ONBOARDING_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listTeacherMentorshipOnboardingOptions',
        tags,
        summary: 'Bağlanabilecek işe başlama listeleri',
        description: `Eşleşmeye bağlanabilecek işe başlama listeleri (DOM-FIN-121): kabul edilmiş, geri çekilmemiş ve personel hesabı bağlanmış teklifler; yeni başlangıç önce, en çok 200. Eşleşmede teklifin hesabı yeni öğretmen olmalı (K-463). ${MANAGER}`,
        response: { 200: onboardingOptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMentorshipOnboardingOptionsFor(contextOf(request)) }),
  )

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listTeacherMentorships',
        tags,
        summary: 'Mentorluk eşleşmelerini listele',
        description: `Eşleşmeler (süren önce, yeni başlangıç önce): mentor, yeni öğretmen, günler, durum, görüşme sayısı, son görüşme, son temastan bu yana gün, 30 günü aşma (K-465) ve kontrol listesi ilerlemesi. Mentor ya da yeni öğretmen adında aranır; durum ve \`overdue=true\` ile süzülür. Okuma aynı transaction'da denetime yazılır (\`finance.teacher_mentorship.read\`; alan adları ve kayıt sayısı). ${MANAGER}`,
        querystring: mentorshipListQuery,
        response: { 200: mentorshipListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, overdue } = request.query
      const { items, total } = await listMentorshipsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        overdue,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    ITEM,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getTeacherMentorship',
        tags,
        summary: 'Mentorluk eşleşmesini getir',
        description: `Eşleşme, görüşmeleri (yeni gün önce) ve kontrol listesi (kim ve ne zaman işaretledi). Okuma denetime yazılır. Başka kurumun eşleşmesi 404. ${MANAGER}`,
        params: mentorshipParams,
        response: { 200: mentorshipResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getMentorshipFor(contextOf(request), request.params.mentorshipId),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTeacherMentorship',
        tags,
        summary: 'Mentorluk eşleşmesi aç',
        description: `Mentor (etkin öğretmen ya da yönetici), yeni öğretmen (etkin öğretmen), başlangıç ve planlanan bitiş (en çok 366 gün) ve isteğe bağlı işe başlama listesi (kabul edilmiş, hesabı yeni öğretmene bağlı iş teklifi). Kurum ayarındaki maddeler eşleşmeye kopyalanır (K-465). Ret: mentor yok/uygun değil 422 \`mentorship_mentor_not_found\`/\`mentorship_mentor_invalid\`; yeni öğretmen yok/öğretmen değil/ayrılmış 422 \`mentorship_mentee_not_found\`/\`mentorship_mentee_not_teacher\`/\`mentorship_mentee_inactive\`; aynı kişi 422 \`mentorship_self\`; günler 422 \`mentorship_dates_invalid\`/\`mentorship_too_long\`; işe başlama listesi 422 \`mentorship_onboarding_not_found\`/\`mentorship_onboarding_mismatch\`; yeni öğretmenin süren eşleşmesi 409 \`mentorship_mentee_has_active\`; mentor sınırı 422 \`mentorship_mentor_limit\` (K-463). \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: mentorshipCreateSchema,
        response: { 201: mentorshipResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMentorshipCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return mentorshipResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/meetings`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'addTeacherMentorshipMeeting',
        tags,
        summary: 'Mentorluk görüşmesi kaydet',
        description: `Gün, süre (5–480 dk), konu (2–200), isteğe bağlı not (≤ 4000) ve sonraki adım (≤ 500) (K-464). Kapanmış eşleşmeye eklenmez: 409 \`mentorship_closed\`. Gün bugünden sonra 422 \`mentorship_meeting_date_future\`, başlangıçtan önce 422 \`mentorship_meeting_before_start\`. Not ve sonraki adım denetime yazılmaz. \`Idempotency-Key\` ve eşleşmenin \`If-Match\` sürümü zorunlu. Başka kurumun eşleşmesi 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: mentorshipParams,
        body: mentorshipMeetingSchema,
        response: { 201: mentorshipResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await addMentorshipMeetingCommand(
        contextOf(request),
        request.params.mentorshipId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return mentorshipResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/meetings/:meetingId/archive`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'archiveTeacherMentorshipMeeting',
        tags,
        summary: 'Görüşme kaydını arşivle',
        description: `Yanlış girilmiş görüşme listeden ve takipten kalkar (K-464). Kapanmış eşleşmede 409 \`mentorship_closed\`. Gövde boş nesne. \`If-Match\` eşleşmenin sürümüdür. Başka kurumun eşleşmesi, başka eşleşmenin ya da arşivli görüşme 404. ${MANAGER}`,
        headers: transitionHeaders,
        params: meetingParams,
        body: mentorshipEmptySchema,
        response: { 200: mentorshipResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveMentorshipMeetingCommand(
        contextOf(request),
        request.params.mentorshipId,
        request.params.meetingId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return mentorshipResponse.parse(sendBody(reply, result))
    },
  )

  for (const verb of ['complete', 'reopen'] as const)
    typed.post(
      `${ITEM}/checklist/:itemId/${verb}`,
      {
        preValidation: [...guarded, requireIfMatch(), captureInput()],
        schema: {
          operationId:
            verb === 'complete'
              ? 'completeTeacherMentorshipChecklistItem'
              : 'reopenTeacherMentorshipChecklistItem',
          tags,
          summary:
            verb === 'complete' ? 'Maddeyi tamamlandı işaretle' : 'Maddenin işaretini geri al',
          description: `${
            verb === 'complete'
              ? 'İşaretleyen ve an yazılır (K-465). İşaretli madde 422 `mentorship_item_completed`.'
              : 'İşaretleyen ve an silinir (K-465). İşaretsiz madde 422 `mentorship_item_not_completed`.'
          } Kapanmış eşleşmede 409 \`mentorship_closed\`. Gövde boş nesne. \`If-Match\` eşleşmenin sürümüdür. Başka kurumun eşleşmesi ve başka eşleşmenin maddesi 404. ${MANAGER}`,
          headers: transitionHeaders,
          params: itemParams,
          body: mentorshipEmptySchema,
          response: { 200: mentorshipResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await setMentorshipChecklistItemCommand(
          contextOf(request),
          request.params.mentorshipId,
          request.params.itemId,
          verb,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return mentorshipResponse.parse(sendBody(reply, result))
      },
    )

  typed.post(
    `${ITEM}/complete`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'completeTeacherMentorship',
        tags,
        summary: 'Mentorluğu tamamla',
        description: `Tamamlanma günü başlangıçla bugün arasında (422 \`mentorship_close_before_start\`, \`mentorship_close_date_future\`); en az bir görüşme (422 \`mentorship_no_meetings\`) ve zorunlu maddelerin hepsi tamamlanmış (422 \`mentorship_checklist_incomplete\`) olmalı (K-463, K-465). Kapanmış eşleşme 409 \`mentorship_closed\`. \`If-Match\` zorunlu. Başka kurumun eşleşmesi 404. ${MANAGER}`,
        headers: transitionHeaders,
        params: mentorshipParams,
        body: mentorshipCompleteSchema,
        response: { 200: mentorshipResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await completeMentorshipCommand(
        contextOf(request),
        request.params.mentorshipId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return mentorshipResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/end`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'endTeacherMentorship',
        tags,
        summary: 'Mentorluğu erken sonlandır',
        description: `Sonlanma günü başlangıçla bugün arasında (422 \`mentorship_close_before_start\`, \`mentorship_close_date_future\`) ve gerekçe (5–500, denetime yazılmaz) (K-463). Kapanmış eşleşme 409 \`mentorship_closed\`. \`If-Match\` zorunlu. Başka kurumun eşleşmesi 404. ${MANAGER}`,
        headers: transitionHeaders,
        params: mentorshipParams,
        body: mentorshipEndSchema,
        response: { 200: mentorshipResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await endMentorshipCommand(
        contextOf(request),
        request.params.mentorshipId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return mentorshipResponse.parse(sendBody(reply, result))
    },
  )
}
