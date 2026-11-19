import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_PROFESSIONAL_DEVELOPMENT_READ_ROLES,
  FINANCE_PROFESSIONAL_DEVELOPMENT_WRITE_ROLES,
  professionalDevelopmentEnrollmentInputSchema,
  professionalDevelopmentEnrollmentUpdateSchema,
  professionalDevelopmentProgramInputSchema,
  professionalDevelopmentStatusInputSchema,
} from '@kampus/school-core/lib/finance-professional-development.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  changeProgramStatusCommand,
  createEnrollmentCommand,
  createProgramCommand,
  listEnrollmentsFor,
  listProgramsFor,
  programFor,
  updateEnrollmentCommand,
  updateProgramCommand,
} from '../services/finance-professional-development.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  enrollmentListQuery,
  enrollmentListResponse,
  enrollmentParams,
  enrollmentResponse,
  programListQuery,
  programListResponse,
  programParams,
  programResponse,
} from './finance-professional-development.schemas.ts'

/**
 * Mesleki gelişim kataloğu uçları (docs/domain/finans.md DOM-FIN-125; ON-214). Modül `finance`.
 * Yönetici yazar; yönetici ve ön büro okur, ön büro taslağı görmez (K-430). Yeni eğitim ve yeni
 * atama `Idempotency-Key` ister; düzeltme ve durum değişiklikleri `If-Match`.
 */

const READ = 'Rol: `yonetici`, `onburo` (ön büro taslak eğitimi görmez; K-430). Modül `finance`.'
const WRITE = 'Rol: yalnız `yonetici` (K-430). Modül `finance`.'
const URL = '/api/v1/finance/professional-development'
const ITEM = `${URL}/:programId`
const ENROLLMENTS = `${ITEM}/enrollments`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceProfessionalDevelopmentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const reader: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PROFESSIONAL_DEVELOPMENT_READ_ROLES),
  ]
  const writer: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PROFESSIONAL_DEVELOPMENT_WRITE_ROLES),
  ]
  const tags = ['finance-professional-development']
  const transitionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    URL,
    {
      preValidation: reader,
      schema: {
        operationId: 'listProfessionalDevelopmentPrograms',
        tags,
        summary: 'Mesleki gelişim kataloğunu listele',
        description: `Kurs, seminer, konferans, kurum içi ve çevrim içi eğitimler (DOM-FIN-125); yayında önce, sonra başlangıç günü. Ad ya da sağlayıcıda aranır; tür ve durumla süzülür. Her satırda atanan ve katılan sayısı. ${READ}`,
        querystring: programListQuery,
        response: { 200: programListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, kind, status } = request.query
      const { items, total } = await listProgramsFor(contextOf(request), {
        page,
        pageSize,
        q,
        kind,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    URL,
    {
      preValidation: [...writer, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createProfessionalDevelopmentProgram',
        tags,
        summary: 'Kataloğa eğitim ekle',
        description: `Yeni eğitim taslak açılır (K-431). Süre yarım saat adımlı; sürekli eğitimde tarih girilmez, değilse başlangıç ve bitiş zorunlu. Yer ya da https bağlantıdan biri zorunlu, çevrim içi türde bağlantı zorunlu. Ücret kuruş ve isteğe bağlı; maliyet merkezi yalnız ücretle ve kurumun etkin merkezi (yoksa 422 \`professional_development_cost_center_not_found\`, pasifse 422 \`professional_development_cost_center_inactive\`). Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${WRITE}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: professionalDevelopmentProgramInputSchema,
        response: { 201: programResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createProgramCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = programResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    ITEM,
    {
      preValidation: reader,
      schema: {
        operationId: 'getProfessionalDevelopmentProgram',
        tags,
        summary: 'Eğitim ayrıntısı',
        description: `Olmayan, başka kurumun ya da (ön büro için) taslak eğitim 404. ${READ}`,
        params: programParams,
        response: { 200: programResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await programFor(contextOf(request), request.params.programId) }),
  )

  typed.patch(
    ITEM,
    {
      preValidation: [...writer, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateProfessionalDevelopmentProgram',
        tags,
        summary: 'Eğitimi düzelt',
        description: `Tam gövde yazılır (oluşturma kurallarıyla). Taslak ve yayındaki eğitim düzeltilir; arşivdeki 409 \`professional_development_archived\`. Kontenjan atanmış personel sayısının altına (422 \`professional_development_capacity_below_enrolled\`), süre girilmiş katılım saatinin altına inemez (422 \`professional_development_duration_below_attended\`). \`If-Match\` zorunlu. Başka kurumun eğitimi 404. ${WRITE}`,
        headers: transitionHeaders,
        params: programParams,
        body: professionalDevelopmentProgramInputSchema,
        response: { 200: programResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateProgramCommand(
        contextOf(request),
        request.params.programId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return programResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEM}/status`,
    {
      preValidation: [...writer, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'changeProfessionalDevelopmentProgramStatus',
        tags,
        summary: 'Eğitimin durumunu değiştir',
        description: `Taslak → yayında, taslak ya da yayında → arşiv (K-431). Arşiv son durumdur; izinsiz geçiş 409 \`professional_development_status_transition\`. \`If-Match\` zorunlu. Başka kurumun eğitimi 404. ${WRITE}`,
        headers: transitionHeaders,
        params: programParams,
        body: professionalDevelopmentStatusInputSchema,
        response: { 200: programResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await changeProgramStatusCommand(
        contextOf(request),
        request.params.programId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return programResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    ENROLLMENTS,
    {
      preValidation: reader,
      schema: {
        operationId: 'listProfessionalDevelopmentEnrollments',
        tags,
        summary: 'Eğitimin katılımcıları',
        description: `Atanan ya da katılım isteği kaydedilen personel, ada göre; durumla süzülür. Ön büro taslak eğitimin listesini göremez (404). Başka kurumun eğitimi 404. ${READ}`,
        params: programParams,
        querystring: enrollmentListQuery,
        response: { 200: enrollmentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status } = request.query
      const { items, total } = await listEnrollmentsFor(
        contextOf(request),
        request.params.programId,
        { page, pageSize, ...(status === undefined ? {} : { status }) },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    ENROLLMENTS,
    {
      preValidation: [...writer, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createProfessionalDevelopmentEnrollment',
        tags,
        summary: 'Personeli eğitime ata',
        description: `Atama ya da personelin katılım isteği kaydı; durum "atandı" (K-432). Yalnız yayındaki eğitime (422 \`professional_development_not_published\`); personel kurumun etkin yönetici, öğretmen ya da ön büro üyeliği (yoksa 422 \`professional_development_staff_not_found\`, öğrenci ya da veli 422 \`professional_development_not_staff\`, ayrılmış 422 \`professional_development_staff_inactive\`). Aynı personel ikinci kez 409 \`professional_development_already_enrolled\`; kontenjan doluysa 422 \`professional_development_capacity_full\`. \`Idempotency-Key\` zorunlu. Başka kurumun eğitimi 404. ${WRITE}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: programParams,
        body: professionalDevelopmentEnrollmentInputSchema,
        response: { 201: enrollmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createEnrollmentCommand(
        contextOf(request),
        request.params.programId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return enrollmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${ENROLLMENTS}/:enrollmentId`,
    {
      preValidation: [...writer, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateProfessionalDevelopmentEnrollment',
        tags,
        summary: 'Katılım durumunu işaretle',
        description: `Atandı, katıldı ya da tamamlamadı (K-432). "Katıldı" katılım saati ister (yarım saat adımlı, eğitim süresini aşamaz: 422 \`professional_development_hours_exceed\`); diğer durumlarda saat girilmez. Arşivdeki eğitimin katılımı değişmez (409 \`professional_development_archived\`). Sertifika ayrı iştir (ON-215). \`If-Match\` zorunlu. Başka kurumun kaydı 404. ${WRITE}`,
        headers: transitionHeaders,
        params: enrollmentParams,
        body: professionalDevelopmentEnrollmentUpdateSchema,
        response: { 200: enrollmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateEnrollmentCommand(
        contextOf(request),
        request.params.programId,
        request.params.enrollmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return enrollmentResponse.parse(sendBody(reply, result))
    },
  )
}
