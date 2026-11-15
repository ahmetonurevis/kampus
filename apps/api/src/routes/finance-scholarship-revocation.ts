import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  revokeScholarshipSchema,
  SCHOLARSHIP_END_KINDS,
  scholarshipEndQuoteSchema,
  terminateScholarshipSchema,
  type ScholarshipEndKind,
} from '@kampus/school-core/lib/finance-scholarship-revocation.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  endScholarshipCommand,
  quoteScholarshipEndFor,
  scholarshipEndsFor,
} from '../services/finance-scholarship-revocation.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'

/**
 * Burs kesmesi ve gerçek dışı beyanla iptal ile geri isteme uçları (docs/domain/finans.md
 * DOM-FIN-025; IST-105; ON-283). Modül `finance`, yalnız yönetici (`scholarship.manage`). Yazma
 * taksit oluşturduğu için `Idempotency-Key` ve `If-Match` (atamanın sürümü) zorunludur, taze oturum
 * ister. Gerekçe açıklaması yalnız ayrıntı okumasında döner.
 */

const day = z.string().describe('Gün (YYYY-MM-DD)')
const segmentSchema = z.object({
  from: day,
  to: day.describe('Aralığın sonu (hariç)'),
  days: z.number().int(),
  basisPoints: z.number().int().describe('Yıllık kanuni faiz, on binde birlik'),
  source: z.string().describe('Oranın dayanağı'),
})
const lineSchema = z.object({
  dueDate: day,
  shareCents: z.number().int().describe('Bu vadenin burs payı, kuruş'),
  status: z
    .enum(['kept', 'reinstated', 'clawback', 'already_reinstated'])
    .describe(
      '`kept` önceki dönemde kalan, `reinstated` ileriye kalkan, `clawback` geri istenen, `already_reinstated` önceki kesmenin kaldırdığı pay',
    ),
  interestCents: z.number().int(),
  interestDays: z.number().int(),
  segments: z.array(segmentSchema),
})
const amounts = {
  effectiveDate: day.describe('Kesme günü ya da geri isteme günü'),
  keptCents: z.number().int().describe('Kesmede önceki dönemde kalan burs; fon payı buna iner'),
  reinstatedCents: z.number().int().describe('İleriye kalkan burs: yeni taksitlerin toplamı'),
  principalCents: z.number().int().describe('Geri istenen burs anaparası'),
  interestCents: z.number().int().describe('Kanuni faiz'),
  clawbackDueDate: day.nullable().describe('Geri isteme alacağının son ödeme günü'),
  lines: z.array(lineSchema),
}
const quoteResponse = dataResponse(
  z.object({
    kind: z.enum(SCHOLARSHIP_END_KINDS),
    awardId: z.string(),
    contractId: z.string(),
    scholarshipCents: z.number().int(),
    fullScholarship: z.boolean().describe('Taksitsiz tam burs; pay ayları sanaldır'),
    totalCents: z.number().int().describe('Yeni alacak toplamı; komutta `confirmedCents`'),
    reinstated: z.array(z.object({ dueDate: day, amountCents: z.number().int() })),
    ...amounts,
  }),
)
const endBase = z.object({
  id: z.string(),
  awardId: z.string(),
  contractId: z.string(),
  kind: z.enum(SCHOLARSHIP_END_KINDS),
  reason: z.string().describe('Neden anahtarı; iptalde `false_declaration`'),
  invoiceIds: z.array(z.string()).describe('Yazılan taksitler'),
  createdAt: z.string(),
  ...amounts,
})
const commandResponse = dataResponse(endBase)
const endsResponse = dataResponse(
  z.object({
    awardId: z.string(),
    studentId: z.string(),
    academicYear: z.number().int(),
    programName: z.string(),
    ends: z.array(endBase.extend({ note: z.string().describe('Gerekçe açıklaması') })),
  }),
)
const params = z.object({ awardId: z.uuid('Atama kimliği geçersiz.') })

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerScholarshipRevocationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const manager = app.requireRole(WRITE_ACTION_ROLES['scholarship.manage'])

  typed.post(
    '/api/v1/finance/scholarship-awards/:awardId/end-quote',
    {
      preValidation: [app.authenticate, finance, manager],
      schema: {
        operationId: 'quoteScholarshipEnd',
        tags: ['finance-scholarships'],
        summary: 'Burs kesme ya da iptal hesabını önizle',
        description:
          'Yazmadan hesaplar (DOM-FIN-025, K-264…K-266). `terminate`: kesme gününden sonra vadesi gelen burs payı yeni taksit olur; gün bugünden önce 422 `scholarship_end_date_past`, eğitim yılı dışı 422 `scholarship_end_date_out_of_year`. `revoke`: bugüne kadar uygulanan pay vade gününden bugüne kanuni faiziyle geri istenir. Etkisiz işlem 422 `scholarship_end_no_change`; ayrılan öğrenci 409 `scholarship_student_inactive`, açık ek protokol 409 `scholarship_contract_amendment_open`, kesilmiş burs 409 `scholarship_already_terminated`, iptal edilmiş 409 `scholarship_already_revoked`. Roller: `yonetici`.',
        params,
        body: scholarshipEndQuoteSchema,
        response: { 200: quoteResponse, ...commandErrors },
      },
    },
    async (request) => {
      const quote = await quoteScholarshipEndFor(
        contextOf(request),
        request.params.awardId,
        request.body,
      )
      return quoteResponse.parse({ data: quote })
    },
  )

  typed.get(
    '/api/v1/finance/scholarship-awards/:awardId/ends',
    {
      preValidation: [app.authenticate, finance, manager],
      schema: {
        operationId: 'listScholarshipEnds',
        tags: ['finance-scholarships'],
        summary: 'Burs kesme ve iptal kayıtları',
        description:
          'Atamanın kesme ve iptal kayıtları, yazma anındaki hesabıyla (geri isteme yazısı buradan üretilir). Gerekçe açıklaması yalnız burada döner. Roller: `yonetici`.',
        params,
        response: { 200: endsResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { award, programName, ends } = await scholarshipEndsFor(
        contextOf(request),
        request.params.awardId,
      )
      return endsResponse.parse({
        data: {
          awardId: award.id,
          studentId: award.studentId,
          academicYear: award.academicYear,
          programName,
          ends,
        },
      })
    },
  )

  const command = (kind: ScholarshipEndKind) =>
    typed.post(
      `/api/v1/finance/scholarship-awards/:awardId/${kind}`,
      {
        preValidation: [
          app.authenticate,
          finance,
          manager,
          // Kesme ve geri isteme borç doğurur; ortak cihazda açık kalmış oturumla yapılmaz.
          app.requireFreshSession,
          requireIfMatch(),
          captureInput(),
        ],
        schema: {
          operationId: kind === 'terminate' ? 'terminateScholarship' : 'revokeScholarship',
          tags: ['finance-scholarships'],
          summary:
            kind === 'terminate'
              ? 'Bursu kes'
              : 'Bursu gerçek dışı beyan nedeniyle iptal et ve geri iste',
          description:
            kind === 'terminate'
              ? 'Bursu gerekçeyle ileriye etkili keser (DOM-FIN-025, K-265): kesme gününden sonra vadesi gelen burs payı sözleşmeye bağlı ayrı öğrenim taksiti olur, önceki taksitler değişmez; fon payı kalan bursa iner, ödeyiciye `scholarship_ended` bildirimi gider. `confirmedCents` önizlemedeki `totalCents`tir; değiştiyse 409 `scholarship_end_changed`. Önizlemenin hataları geçerlidir. `Idempotency-Key` ve `If-Match` (atama sürümü) zorunlu, taze oturum ister. Roller: `yonetici`.'
              : 'Bursu geriye etkili iptal eder (DOM-FIN-025, K-266): bugüne kadar uygulanan pay ve 3095 sayılı Kanun kanuni faizi sözleşme dışı iki alacak (son ödeme 30 gün) olarak yazılır, sonraki taksitlerde burs kalkar; fon payı bırakılır, ödeyiciye bildirim gider. `confirmedCents` önizlemedeki `totalCents`tir; değiştiyse 409 `scholarship_end_changed`. `Idempotency-Key` ve `If-Match` zorunlu, taze oturum ister. Roller: `yonetici`.',
          headers: commandHeadersSchema('required', { ifMatch: 'required' }),
          params,
          body: kind === 'terminate' ? terminateScholarshipSchema : revokeScholarshipSchema,
          response: { 201: commandResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'required')
        if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
        const result = await endScholarshipCommand(
          contextOf(request),
          request.params.awardId,
          kind,
          request.commandInput,
          opts.expectedVersion,
          opts.idempotency,
        )
        return commandResponse.parse(sendBody(reply, result))
      },
    )
  command('terminate')
  command('revoke')
}
