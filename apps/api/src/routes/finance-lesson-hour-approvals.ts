import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  LESSON_SHEET_APPROVER_ROLES,
  LESSON_SHEET_ROLES,
  lessonConfirmationInputSchema,
  lessonSheetApproveSchema,
  lessonSheetReopenSchema,
  lessonSheetSubmitSchema,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  approveLessonSheetCommand,
  lessonSheetFor,
  recordLessonConfirmationCommand,
  reopenLessonSheetCommand,
  submitLessonSheetCommand,
} from '../services/finance-lesson-hour-approvals.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { lessonSheetParams, lessonSheetResponse } from './finance-lesson-hour-approvals.schemas.ts'

/**
 * Ek ders çizelgesi onayı uçları (docs/domain/finans.md DOM-FIN-120; ON-196). Modül `finance`.
 * Çizelgeyi okuma, öğretmen kontrolüne gönderme ve öğretmen yanıtını işleme yönetici ve ön büro;
 * müdür onayı ve yeniden açma yalnız yönetici (K-409). Bütün yazmalar `Idempotency-Key` ister.
 * Sıra: 401 → 403 modül → 403 rol → 400 → işlem.
 */

const DESK = 'Rol: `yonetici`, `onburo` (K-409). Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (müdür onayı, K-409). Modül `finance`.'
const URL = '/api/v1/finance/lesson-hour-sheets'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceLessonHourApprovalRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const desk: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(LESSON_SHEET_ROLES),
  ]
  const manager: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(LESSON_SHEET_APPROVER_ROLES),
  ]
  const tags = ['finance-lesson-hour-sheets']
  const command = { headers: commandHeadersSchema('required', { ifMatch: false }) }

  typed.get(
    `${URL}/:month`,
    {
      preValidation: desk,
      schema: {
        operationId: 'getLessonHourSheet',
        tags,
        summary: 'Ayın ek ders çizelgesi ve onay durumu',
        description: `Ayın ek ders çizelgesi (DOM-FIN-120): durum (\`draft\` taslak, \`teacher_review\` öğretmen kontrolünde, \`approved\` müdür onaylı ve kilitli), son gönderen, onaylayan ve yeniden açan, ayın saat kayıtları (tutarsız) ve saati olan her personelin teyit durumu ile son yanıtı. Teyit personelin o anki saat kayıtlarına bağlıdır; kayıt sonradan değişirse durum \`pending\` olur. \`entriesHash\` ayın bütün saat kayıtlarının damgasıdır, müdür onayı bunu gönderir. \`payrollLocked\` bordro döneminin (DOM-FIN-108) kilitli olduğunu gösterir. Hiç gönderilmemiş ay taslaktır, \`version\` boştur. Tutar dönmediği için okuma denetime düşmez. ${DESK}`,
        params: lessonSheetParams,
        response: { 200: lessonSheetResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await lessonSheetFor(contextOf(request), request.params.month) }),
  )

  typed.post(
    `${URL}/:month/submit`,
    {
      preValidation: [...desk, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'submitLessonHourSheet',
        tags,
        summary: 'Çizelgeyi öğretmen kontrolüne gönder',
        description: `Taslak çizelge öğretmen kontrolüne geçer (K-409); ilk gönderim çizelge kaydını açar. Taslak olmayan çizelge 409 \`lesson_sheet_not_draft\`; ayda saat kaydı yoksa 422 \`lesson_sheet_empty\`. Kontrol sırasında saat düzeltilebilir; düzeltilen personelin teyidi yeniden alınır. Gövde boş nesnedir. \`Idempotency-Key\` zorunlu. ${DESK}`,
        ...command,
        params: lessonSheetParams,
        body: lessonSheetSubmitSchema,
        response: { 200: lessonSheetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await submitLessonSheetCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return lessonSheetResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:month/confirmations`,
    {
      preValidation: [...desk, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordLessonHourConfirmation',
        tags,
        summary: 'Öğretmenin teyidini ya da itirazını işle',
        description: `Öğretmen ekranı yoktur: ön büro ya da yönetici öğretmenin teyidini ya da gerekçeli itirazını alındığı kanalla (\`in_person\`, \`phone\`, \`email\`, \`message\`, \`signed_sheet\`) öğretmen adına işler (K-409). Yanıt personelin o anki saat kayıtlarının damgasını taşır; itiraz (gerekçe 5–500) çizelgeyi taslağa döndürür. Çizelge öğretmen kontrolünde değilse 409 \`lesson_sheet_not_in_review\`; personelin bu ay saat kaydı yoksa (başka kurumun üyeliği dahil) 422 \`lesson_confirmation_no_hours\`. Yanıt satırı değişmez; denetim kaydına alan adları yazılır, gerekçe yazılmaz. \`Idempotency-Key\` zorunlu. ${DESK}`,
        ...command,
        params: lessonSheetParams,
        body: lessonConfirmationInputSchema,
        response: { 200: lessonSheetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordLessonConfirmationCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return lessonSheetResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:month/approve`,
    {
      preValidation: [...manager, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'approveLessonHourSheet',
        tags,
        summary: 'Çizelgeye müdür onayı ver (kilitle)',
        description: `Öğretmen kontrolündeki çizelge müdür onayıyla kilitlenir (K-409, K-410): o ayın ek ders saati yazmaları 409 \`lesson_hours_locked\` olur ve bordro aktarımı saatleri tutarıyla verir (K-411). Saati olan her personel bugünkü kayıtlarını teyit etmiş olmalı (eksikse 422 \`lesson_sheet_unconfirmed\`); \`entriesHash\` çizelgedeki damgayla aynı değilse 409 \`lesson_hours_changed\`. Öğretmen kontrolünde olmayan çizelge 409 \`lesson_sheet_not_in_review\`; bordro dönemi kilitliyse 409 \`payroll_period_locked\`. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        ...command,
        params: lessonSheetParams,
        body: lessonSheetApproveSchema,
        response: { 200: lessonSheetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await approveLessonSheetCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return lessonSheetResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:month/reopen`,
    {
      preValidation: [...manager, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'reopenLessonHourSheet',
        tags,
        summary: 'Müdür onaylı çizelgeyi yeniden aç',
        description: `Müdür onaylı çizelge gerekçeyle (5–500) taslağa döner; saat yeniden yazılabilir, çizelge yeniden gönderilip onaylanır (K-410). Onaylı olmayan çizelge 409 \`lesson_sheet_not_approved\`; bordro dönemi kilitliyse 409 \`payroll_period_locked\` (fark düzeltme kaydıyla, DOM-FIN-108). Gerekçe çizelgede kalır, denetim kaydına yazılmaz. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        ...command,
        params: lessonSheetParams,
        body: lessonSheetReopenSchema,
        response: { 200: lessonSheetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await reopenLessonSheetCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return lessonSheetResponse.parse(sendBody(reply, result))
    },
  )
}
