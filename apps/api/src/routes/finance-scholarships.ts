import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  createScholarshipProgramSchema,
  notifyScholarshipProgramSchema,
  scholarshipMebbisSchema,
} from '@kampus/school-core/lib/finance-scholarships.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  createScholarshipProgramCommand,
  listScholarshipAwardsFor,
  listScholarshipProgramsFor,
  notifyScholarshipProgramCommand,
  recordScholarshipMebbisCommand,
} from '../services/finance-scholarships.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Burs programı uçları (docs/domain/finans.md DOM-FIN-025; IST-105). Modül `finance`. Okuma
 * yönetici ve ön büro, yazma yalnız yönetici (DOM-FIN-052). Atama kesin kayıtta yapılır.
 */

const programSchema = z.object({
  id: z.string(),
  academicYear: z.number().int().describe('Eğitim yılının başlangıç yılı'),
  name: z.string(),
  conditions: z.string(),
  terminationConditions: z.string(),
  durationNote: z.string(),
  percentBasisPoints: z.number().int().nullable().describe('Oran, on binde birlik'),
  amountCents: z.number().int().nullable().describe('Sabit tutar, kuruş'),
  capacity: z.number().int().describe('Burslu sayısı üst sınırı'),
  notifiedDate: z.string().nullable().describe('Bildirim günü (YYYY-MM-DD); boşsa kullanılamaz'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
const listedProgramSchema = programSchema.extend({
  awardedCount: z.number().int().describe('Atanmış burslu sayısı'),
})
const listedProgramResponse = dataResponse(listedProgramSchema)
const programResponse = dataResponse(programSchema)
const awardSchema = z.object({
  id: z.string(),
  programId: z.string(),
  studentId: z.string(),
  academicYear: z.number().int(),
  amountCents: z.number().int().describe('Atamadaki burs tutarı, kuruş'),
  mebbisRecordedDate: z.string().nullable().describe("MEBBİS'e işlendiği gün"),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const awardResponse = dataResponse(awardSchema)

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceScholarshipRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const read = [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])]
  const write = (ifMatch: 'reject' | 'required'): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(WRITE_ACTION_ROLES['scholarship.manage']),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    captureInput(),
  ]

  typed.get(
    '/api/v1/finance/scholarship-programs',
    {
      preValidation: read,
      schema: {
        operationId: 'listScholarshipPrograms',
        tags: ['finance-scholarships'],
        summary: 'Burs programlarını listele',
        description:
          'Kurumun burs programlarını yeni yıl önce, atanmış burslu sayısıyla listeler (DOM-FIN-025). `academicYear` süzer. Roller: `yonetici`, `onburo`.',
        querystring: z.strictObject({
          ...pageQuerySchema.shape,
          academicYear: z.coerce.number().int().min(2000).max(2100).optional(),
        }),
        response: {
          200: z.object({ data: z.array(listedProgramSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listScholarshipProgramsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/scholarship-programs',
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'createScholarshipProgram',
        tags: ['finance-scholarships'],
        summary: 'Burs programı aç',
        description:
          'Şart, oran ya da tutar, süre, burslu sayısı ve kesilme koşullarıyla program açar (DOM-FIN-025). Oran ve tutardan yalnız biri verilir. Aynı yılda aynı ad 409 `scholarship_program_exists`. Bildirim günü işlenene kadar program kullanılamaz. Roller: `yonetici`.',
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createScholarshipProgramSchema,
        response: { 201: listedProgramResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createScholarshipProgramCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = listedProgramResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/scholarship-programs/${body.data.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/finance/scholarship-programs/:programId/notify',
    {
      preValidation: write('required'),
      schema: {
        operationId: 'notifyScholarshipProgram',
        tags: ['finance-scholarships'],
        summary: 'Burs programının bildirim gününü işle',
        description:
          'İl millî eğitim müdürlüğüne bildirim gününü bir kez işler (DOM-FIN-025). Gelecek gün 422 `scholarship_date_future`, ikinci kez 409 `scholarship_already_notified`. `If-Match` zorunlu. Roller: `yonetici`.',
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: z.object({ programId: z.uuid('Program kimliği geçersiz.') }),
        body: notifyScholarshipProgramSchema,
        response: { 200: programResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await notifyScholarshipProgramCommand(
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
    '/api/v1/finance/scholarship-awards',
    {
      preValidation: read,
      schema: {
        operationId: 'listScholarshipAwards',
        tags: ['finance-scholarships'],
        summary: 'Burs atamalarını listele',
        description:
          'Kesin kayıtta yapılan burs atamaları, yeni önce (DOM-FIN-025). `programId` süzer. Roller: `yonetici`, `onburo`.',
        querystring: z.strictObject({
          ...pageQuerySchema.shape,
          programId: z.uuid('Program kimliği geçersiz.').optional(),
        }),
        response: {
          200: z.object({ data: z.array(awardSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listScholarshipAwardsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/scholarship-awards/:awardId/mebbis-record',
    {
      preValidation: write('required'),
      schema: {
        operationId: 'recordScholarshipMebbis',
        tags: ['finance-scholarships'],
        summary: "Burs atamasının MEBBİS'e işlendiğini kaydet",
        description:
          "Atamanın MEBBİS'e işlendiği günü bir kez kaydeder (DOM-FIN-025); MEBBİS'e bağlantı yoktur. İkinci kez 409 `scholarship_mebbis_recorded`, gelecek gün 422 `scholarship_date_future`. `If-Match` zorunlu. Roller: `yonetici`.",
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: z.object({ awardId: z.uuid('Atama kimliği geçersiz.') }),
        body: scholarshipMebbisSchema,
        response: { 200: awardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await recordScholarshipMebbisCommand(
        contextOf(request),
        request.params.awardId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return awardResponse.parse(sendBody(reply, result))
    },
  )
}
