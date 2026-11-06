import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  renewalCeilingSchema,
  renewalPricingSchema,
} from '@kampus/school-core/lib/renewal-ceiling.ts'
import {
  RENEWAL_BULK_LIMIT,
  RENEWAL_PLAN_STATUSES,
  renewalBulkPlanSchema,
  renewalBulkPreviewSchema,
} from '@kampus/school-core/lib/renewal-bulk.ts'
import {
  createPriceIndexSchema,
  renewalPlanSchema,
  renewalQuoteSchema,
  updatePriceIndexSchema,
} from '@kampus/school-core/lib/renewals.ts'
import { contractPaymentTermSchema } from '@kampus/school-core/lib/payment-terms.ts'
import { mayRun } from '@kampus/school-core/lib/school-workflows.ts'

import { ROLES } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { executeWorkflowCommand } from '../services/commands.ts'
import {
  bulkPlanRenewalsCommand,
  listRenewalCandidatesFor,
  previewRenewalBulkFor,
} from '../services/finance-renewal-bulk.ts'
import {
  createPriceIndexCommand,
  getRenewalFor,
  listPriceIndexesFor,
  listRenewalsFor,
  planRenewalCommand,
  quoteRenewalFor,
  updatePriceIndexCommand,
} from '../services/finance-renewals.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Tarifeye bağlı kayıt yenileme uçları (docs/domain/finans.md DOM-FIN-002, -005, -023, -025;
 * kayit-ve-crm.md DOM-KAY-020, -021; IST-100). Planlama ve sınıf geçişi ayrı uçlardır. Rol core
 * `mayRun`'dan; kapsam core `scopeFor`/`renewalPreconditions`'tan gelir. Tarife ve taksit finans
 * kaydı olduğundan uçlar hem `finance` hem `renewal` modülüne bağlıdır: `renewal` kurum türünde
 * yoksa 404, biri kapalıysa 403 `module_disabled` (DOM-YTK-012, DOM-YTK-040).
 */

const WRITE_ROLES = ROLES.filter((role) => mayRun({ role }, 'renewal'))
const ACTIVATE_ROLES = ROLES.filter((role) => mayRun({ role }, 'renewal-activate'))
const READ_ROLES = ['yonetici', 'onburo', 'veli'] as const
const INDEX_READ_ROLES = ['yonetici', 'onburo'] as const
const CANDIDATE_ROLES = ['yonetici', 'onburo'] as const
const BULK_PLAN_ROLES = ['yonetici'] as const

const lineSchema = z.object({ kind: z.string(), amountCents: z.number().int() })
const scholarshipSchema = renewalPricingSchema.shape.scholarship
const quoteSchema = z.object({
  tariffId: z.string(),
  tariffVersion: z.number().int(),
  tariffCarriedOverFromYear: z
    .number()
    .int()
    .nullable()
    .describe(
      'Hedef yılın tarifesi süresinde ilan edilmediği için önceki yılın tarifesi uygulandıysa o yıl (DOM-FIN-002); hedef yılın kendi tarifesinde `null`',
    ),
  announcedCents: z.number().int().describe('İlan edilen öğrenim ücreti'),
  ceiling: renewalCeilingSchema,
  maxTuitionCents: z.number().int().describe('Uygulanabilecek en yüksek ücret'),
  tuitionCents: z.number().int().describe('Sözleşmenin indirimsiz öğrenim ücreti'),
  discounts: z.array(lineSchema),
  discountCents: z.number().int(),
  scholarship: scholarshipSchema,
  netCents: z.number().int().describe('İndirim ve burstan sonra kalan öğrenim ücreti'),
  extras: z.array(lineSchema),
  installments: z.array(z.number().int()).describe('Öğrenim taksitleri, kuruş'),
  paymentTerm: contractPaymentTermSchema
    .nullable()
    .describe(
      'Planın dayandığı ilanlı ödeme koşulu (DOM-FIN-013); koşulsuz eski tarifede `null`, ilanda olmayan taksit sayısı 422 `payment_term_not_in_tariff`',
    ),
  outstandingTuitionCents: z
    .number()
    .int()
    .describe(
      'Önceki yıllardan ödenmemiş öğrenim ücreti (kuruş, DOM-KAY-025); sıfırdan büyükse plan `debtApproved: true` ve yönetici ister',
    ),
})
const renewalSchema = z.object({
  id: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
  createdAt: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  fromClassId: z.string(),
  fromClassName: z.string().nullable(),
  targetClassId: z.string().nullable(),
  targetClassName: z.string().nullable(),
  academicYear: z.number().int(),
  mode: z.enum(['renew', 'graduate']),
  status: z.string(),
  netCents: z.number().int(),
  tuitionCents: z.number().int().nullable(),
  discountCents: z.number().int().nullable(),
  scholarshipCents: z.number().int().nullable(),
  contractId: z.string().nullable(),
  activatedAt: z.string().nullable(),
  pricing: renewalPricingSchema
    .nullable()
    .describe('Plan anındaki ücret kararı; iş akışı köprüsüyle açılan kayıtta yoktur'),
})
const renewalDetailSchema = renewalSchema.extend({
  invoices: z.array(
    z.object({
      id: z.string(),
      installment: z.number().int(),
      amountCents: z.number().int(),
      dueDate: z.string(),
      paidAt: z.string().nullable(),
      feeKind: z.string().nullable(),
    }),
  ),
})
const planResponseSchema = z.object({
  data: commandResponseSchema.shape.data.extend({
    contractId: z.string().optional().describe('Açılan sözleşme; mezuniyette yoktur'),
    tariffCarriedOverFromYear: z
      .number()
      .int()
      .optional()
      .describe('Önceki yılın tarifesi uygulandıysa o yıl (DOM-FIN-002); aksi halde yoktur'),
  }),
})
const priceIndexSchema = z.object({
  academicYear: z.number().int().describe('Oranın sınırladığı ücret yılı'),
  ppiBasisPoints: z.number().int(),
  cpiBasisPoints: z.number().int(),
  source: z.string(),
  bulletinDate: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
const priceIndexResponse = dataResponse(priceIndexSchema)
const renewalParams = z.object({ renewalId: z.string().min(1).max(200).describe('Yenileme kaydı') })
const yearParams = z.object({
  academicYear: z.coerce.number('Eğitim yılı geçersiz.').int().min(2000).max(2100),
})
const listQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Öğrenci adında arama'),
  status: z.string().min(1).max(40).optional().describe('Yenileme durumu'),
  studentId: z.string().min(1).max(200).optional().describe('Öğrenci; veli için seçili çocuk'),
  sort: z.enum(['createdAt', 'studentName', 'status', 'netCents']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

const problemSchema = z
  .object({ code: z.string(), message: z.string() })
  .describe('Kuralın kodu ve Türkçe iletisi; borçlu öğrencide `renewal_debt_unapproved`')
const candidateSchema = z.object({
  studentId: z.string(),
  studentName: z.string().nullable(),
  classId: z.string(),
  className: z.string().nullable(),
  grade: z.number().int(),
  targetClassId: z
    .string()
    .nullable()
    .describe('Önerilen hedef sınıf: aynı kampüs ve şube; birden çok aday varsa `null`'),
  targetClassName: z.string().nullable(),
  previousContract: z
    .object({ academicYear: z.number().int(), tuitionCents: z.number().int() })
    .nullable()
    .describe('Hedef yıldan önceki son sözleşmenin yılı ve indirimsiz ücreti'),
  announcedCents: z.number().int().nullable().describe('Hedef düzeyin ilan edilen ücreti'),
  ceiling: renewalCeilingSchema.nullable().describe('Artış tavanı kararı (DOM-FIN-005)'),
  suggestedTuitionCents: z
    .number()
    .int()
    .nullable()
    .describe('Önerilen ücret: ilan ve tavanın küçüğü'),
  outstandingTuitionCents: z
    .number()
    .int()
    .describe('Önceki yıllardan ödenmemiş öğrenim ücreti (DOM-KAY-025)'),
  planStatus: z.enum(RENEWAL_PLAN_STATUSES),
  renewalId: z.string().nullable(),
  renewalNetCents: z.number().int().nullable(),
  problem: problemSchema.nullable().describe('Ücret hesaplanamıyorsa nedeni'),
})
const candidatesQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  academicYear: z.coerce.number('Eğitim yılı geçersiz.').int().min(2000).max(2100),
  classId: z.string().min(1).max(200).optional().describe('Şimdiki sınıf'),
  planStatus: z.enum(RENEWAL_PLAN_STATUSES).optional().describe('Yeni yılın plan durumu'),
  q: z.string().trim().min(2).max(100).optional().describe('Öğrenci adında arama'),
})
const bulkPreviewSchema = z.object({
  academicYear: z.number().int(),
  tariff: z
    .object({
      id: z.string().describe('Onayda `tariffId` olarak gönderilir'),
      versionNumber: z.number().int(),
      carriedOverFromYear: z.number().int().nullable(),
    })
    .nullable()
    .describe('Uygulanacak yayımlı tarife; yoksa `null`'),
  summary: z.object({
    ready: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
  }),
  rows: z.array(
    z.object({
      studentId: z.string(),
      studentName: z.string().nullable(),
      targetClassId: z.string(),
      targetClassName: z.string().nullable(),
      outcome: z.enum(['ready', 'skipped', 'failed']),
      price: quoteSchema.nullable(),
      problem: problemSchema.nullable(),
    }),
  ),
})
const bulkPlanResponse = dataResponse(
  z.object({
    academicYear: z.number().int(),
    summary: z.object({
      planned: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
    }),
    rows: z.array(
      z.object({
        studentId: z.string(),
        studentName: z.string().nullable(),
        outcome: z.enum(['planned', 'skipped', 'failed']),
        problem: problemSchema.nullable(),
        renewalId: z.string().nullable(),
        contractId: z.string().nullable(),
        netCents: z.number().int().nullable(),
        installments: z.array(z.number().int()).describe('Öğrenim taksitleri; toplamı nettir'),
      }),
    ),
  }),
)

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceRenewalRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const renewal = app.requireModule('renewal')
  /**
   * `renewal` ikinci modül denetimidir; sarmalanır, çünkü rota → modül envanteri (`module-inventory`)
   * `/finance` uçlarında `crm` ve `finance` dışında anahtar kabul etmez.
   */
  const renewalModule: preValidationAsyncHookHandler = async function (
    this: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    await renewal.call(this, request, reply)
  }
  const guarded = (roles: readonly (typeof ROLES)[number][]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    renewalModule,
    app.requireRole(roles),
  ]

  typed.get(
    '/api/v1/finance/renewals',
    {
      preValidation: guarded(READ_ROLES),
      schema: {
        operationId: 'listRenewals',
        tags: ['finance-renewals'],
        summary: 'Kayıt yenilemelerini listele',
        description:
          'Core kapsamıyla daralır: yönetici ve ön büro kurum geneli, veli bağlı çocukları (DOM-KAY-020). `q` öğrenci adında arar, `status` ve `studentId` süzer; varsayılan sıra yeni kayıt önce. Modüller `finance` ve `renewal`. Roller: `yonetici`, `onburo`, `veli`.',
        querystring: listQuerySchema,
        response: {
          200: z.object({ data: z.array(renewalSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, studentId, sort, order } = request.query
      const { items, total } = await listRenewalsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        studentId,
        sort,
        descending: order === 'desc',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/renewals/candidates',
    {
      preValidation: guarded(CANDIDATE_ROLES),
      schema: {
        operationId: 'listRenewalCandidates',
        tags: ['finance-renewals'],
        summary: 'Yeni yılın yenilenecek öğrencilerini listele',
        description:
          'Hedef yıl için etkin ve son düzeyde olmayan öğrenciler (IST-105): sınıf, önerilen hedef sınıf, önceki sözleşme, ilan ücreti, artış tavanı, önerilen ücret, borç ve plan durumu; hiçbir şey yazmaz. Ücret tek öğrenci planıyla aynı kuraldan gelir. Tavan oranı ya da tarife eksikse satır düşmez, `problem` nedenini söyler. Mezuniyet ve yenileme daveti bu listede yoktur. Geçmiş yıl 422 `renewal_year_invalid`. Modüller `finance` ve `renewal`. Roller: `yonetici`, `onburo`.',
        querystring: candidatesQuerySchema,
        response: {
          200: z.object({ data: z.array(candidateSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listRenewalCandidatesFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/renewals/bulk-preview',
    {
      preValidation: [...guarded(CANDIDATE_ROLES), captureInput()],
      schema: {
        operationId: 'previewRenewalBulk',
        tags: ['finance-renewals'],
        summary: 'Toplu yenileme planını önizle',
        description: `Hiçbir kayıt yazmaz. Her satır tek öğrenci önizleme ve planını sırayla çalıştırır: tavan (DOM-FIN-005), ödeme koşulu (DOM-FIN-013), indirim (DOM-FIN-020…-022), burs (DOM-FIN-025) ve kuruş dağıtımı aynı kuraldır; öndeki satır sınıf ve burs kontenjanını doldurur. Bir satırın reddi öteki satırı etkilemez: \`outcome\` \`ready\`, \`skipped\` (borçlu öğrenci "yönetici onayı gerekir", ya da planı zaten var) ya da \`failed\`, neden \`problem\`te. En çok ${String(RENEWAL_BULK_LIMIT)} öğrenci; aşılırsa, öğrenci yinelenirse ya da \`debtApproved\` gönderilirse 400. Roller: \`yonetici\`, \`onburo\`.`,
        body: renewalBulkPreviewSchema,
        response: { 200: dataResponse(bulkPreviewSchema), ...commandErrors },
      },
    },
    async (request) => ({
      data: await previewRenewalBulkFor(contextOf(request), request.commandInput),
    }),
  )

  typed.post(
    '/api/v1/finance/renewals/bulk-plan',
    {
      preValidation: [...guarded(BULK_PLAN_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'bulkPlanRenewals',
        tags: ['finance-renewals'],
        summary: 'Toplu yenileme planını onayla',
        description: `Seçili öğrenciler için tek öğrenci planını çalıştırır; her öğrenci kendi işlemindedir, biri reddedilirse öteki geri alınmaz ve rapor satır satır söyler (\`planned\`, \`skipped\`, \`failed\`). Yanıt kısmi başarıda da 200'dür. Borçlu öğrenci atlanır, kod \`renewal_debt_unapproved\`, ileti "yönetici onayı gerekir"; toplu yolda borç onayı yoktur, karar \`POST /api/v1/finance/renewals\` \`debtApproved\` ile verilir (DOM-KAY-025). Planı olan öğrenci \`renewal_already_exists\` ile atlanır. Tarife değiştiyse satır kodu \`tariff_changed\` olur. \`Idempotency-Key\` zorunludur: aynı anahtar + aynı gövde ilk raporu döner, yarıda kalan istek planlananları yinelemez, farklı gövde 422 \`idempotency_key_reused\`. En çok ${String(RENEWAL_BULK_LIMIT)} öğrenci. Roller: \`yonetici\`.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: renewalBulkPlanSchema,
        response: { 200: bulkPlanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency } = options(request, 'required')
      if (idempotency === null) throw new Error('Idempotency guard did not run')
      const result = await bulkPlanRenewalsCommand(
        contextOf(request),
        request.commandInput,
        idempotency,
      )
      return bulkPlanResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/renewals/quote',
    {
      preValidation: [...guarded(WRITE_ROLES), captureInput()],
      schema: {
        operationId: 'quoteRenewal',
        tags: ['finance-renewals'],
        summary: 'Yenileme ücretini önizle',
        description:
          'Hiçbir kayıt yazmaz; planla aynı kuralları çalıştırır. İlan edilen ücret, artış tavanı (ara sınıfta `baz × (1 + ((ÜFE + TÜFE) / 2 + 5) / 100)`, DOM-FIN-005), indirimler, burs, net ve taksitler döner. Hedef yılın yayımlı tarifesi yoksa ve ilan dönemi bittiyse (okulda eğitim yılının başladığı yılın mayıs sonu) önceki yılın yayımlı tarifesi uygulanır, `tariffCarriedOverFromYear` o yılı söyler (DOM-FIN-002); dönem sürüyorsa ya da önceki yılın da tarifesi yoksa 422 `tariff_not_published`. Oran yoksa 422 `price_index_missing`, ilan aşılırsa 422 `renewal_above_tariff`, tavan aşılırsa 422 `renewal_above_ceiling`. Kardeş indirimi koşulu kalktıysa gerekçesi `ceiling.discountLoss`te gelir (DOM-FIN-023). Baz bulunamazsa `ceiling.status` `no_base`. Roller: `yonetici`, `onburo`. Taksit sayısı yayımlı tarifenin ödeme koşullarından çıkar: ilanda olmayan sayı 422 `payment_term_not_in_tariff`, peşin indirimi peşin koşulu dışında 422 `early_payment_requires_upfront`; koşulsuz eski tarifede sınır yoktur (DOM-FIN-013).',
        body: renewalQuoteSchema,
        response: { 200: dataResponse(quoteSchema), ...commandErrors },
      },
    },
    async (request) => ({
      data: await quoteRenewalFor(contextOf(request), request.commandInput),
    }),
  )

  typed.post(
    '/api/v1/finance/renewals',
    {
      preValidation: [...guarded(WRITE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'planRenewal',
        tags: ['finance-renewals'],
        summary: 'Kayıt yenileme planla',
        description:
          'Yeni yılın sözleşmesini ve taksitlerini tek işlemde yazar; öğrencinin sınıfı değişmez, sınıf geçişi ayrı uçtur (DOM-KAY-020). Ücret yayımlı tarifeden ve artış tavanından çıkar (DOM-FIN-002, -005); süresinde ilan yapılmadıysa önceki yılın tarifesi uygulanır: sözleşme o tarifenin kimlik ve sürümünü taşır, `academicYear` hedef yıl kalır, yanıtta `tariffCarriedOverFromYear` döner. İndirim tarifedeki türden (DOM-FIN-020), burs yalnız bildirilmiş programdan ve yönetici onayıyla (DOM-FIN-025; 422 `scholarship_approval_required`, `scholarship_program_not_notified`, 409 `scholarship_capacity_full`). Tam bursta öğrenim taksiti açılmaz; ek hizmet ayrı taksittir (DOM-FIN-003). Aynı yıla ikinci yenileme 409 `renewal_already_exists`, açık plan 409 `transition_planned_exists` (DOM-KAY-021); gövdedeki `tariffId` geçerli tarifeden farklıysa (yeni sürüm ya da hedef yılın tarifesi sonradan yayımlandı) 409 `tariff_changed`. Mezuniyet (`mode: graduate`) borç açmaz (DOM-KAY-022). Önceki yıldan ödenmemiş öğrenim ücreti borcu olan öğrencide (DOM-KAY-025) `debtApproved: true` yoksa 422 `renewal_debt_unapproved`; onayı yönetici dışındaki rol verirse 403 `renewal_debt_approval_forbidden`. Kapsam dışı ya da olmayan kayıt 404. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Roller: `yonetici`, `onburo`. Taksit sayısı yayımlı tarifenin ödeme koşullarından çıkar: ilanda olmayan sayı 422 `payment_term_not_in_tariff`, peşin indirimi peşin koşulu dışında 422 `early_payment_requires_upfront`; koşulsuz eski tarifede sınır yoktur (DOM-FIN-013).',
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: renewalPlanSchema,
        response: { 201: planResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await planRenewalCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = sendCommand(reply, result, planResponseSchema)
      if (body.data.entity)
        reply.header('location', `/api/v1/finance/renewals/${body.data.entity.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/renewals/price-indexes',
    {
      preValidation: guarded(INDEX_READ_ROLES),
      schema: {
        operationId: 'listPriceIndexes',
        tags: ['finance-renewals'],
        summary: 'ÜFE ve TÜFE oranlarını listele',
        description:
          'Kurumun artış tavanı oranları, yeni yıl önce (DOM-FIN-005). `academicYear` oranın sınırladığı ücret yılıdır. Roller: `yonetici`, `onburo`.',
        querystring: z.strictObject(pageQuerySchema.shape),
        response: {
          200: z.object({ data: z.array(priceIndexSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listPriceIndexesFor(contextOf(request), { page, pageSize })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  const manageIndex = (ifMatch: 'reject' | 'required'): preValidationAsyncHookHandler[] => [
    ...guarded(WRITE_ACTION_ROLES['tariff.manage']),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    captureInput(),
  ]

  typed.post(
    '/api/v1/finance/renewals/price-indexes',
    {
      preValidation: manageIndex('reject'),
      schema: {
        operationId: 'createPriceIndex',
        tags: ['finance-renewals'],
        summary: 'ÜFE ve TÜFE oranı gir',
        description:
          'Ücret yılının tavan oranlarını kaynağıyla (TÜİK bülteni, tarih) girer (DOM-FIN-005). Aynı yıl 409 `price_index_exists`, gelecek bülten tarihi 422 `price_index_date_future`. Roller: `yonetici`.',
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createPriceIndexSchema,
        response: { 201: priceIndexResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPriceIndexCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = priceIndexResponse.parse(sendBody(reply, result))
      reply.header(
        'location',
        `/api/v1/finance/renewals/price-indexes/${String(body.data.academicYear)}`,
      )
      return body
    },
  )

  typed.patch(
    '/api/v1/finance/renewals/price-indexes/:academicYear',
    {
      preValidation: manageIndex('required'),
      schema: {
        operationId: 'updatePriceIndex',
        tags: ['finance-renewals'],
        summary: 'ÜFE ve TÜFE oranını düzelt',
        description:
          'Yanlış girilen oranı düzeltir; önceden açılmış plan değişmez. Olmayan yıl 404, sürüm tutmazsa 409 `version_conflict`. `If-Match` zorunlu. Roller: `yonetici`.',
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: yearParams,
        body: updatePriceIndexSchema,
        response: { 200: priceIndexResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updatePriceIndexCommand(
        contextOf(request),
        request.params.academicYear,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return priceIndexResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/renewals/:renewalId',
    {
      preValidation: guarded(READ_ROLES),
      schema: {
        operationId: 'getRenewal',
        tags: ['finance-renewals'],
        summary: 'Yenileme ayrıntısı',
        description:
          'Plan anındaki ücret kararı ve sözleşmenin yalnız kendi taksitleri (DOM-FIN-012). Yok, başka kurumda ya da kapsam dışı: 404. Roller: `yonetici`, `onburo`, `veli`.',
        params: renewalParams,
        response: { 200: dataResponse(renewalDetailSchema), ...commandErrors },
      },
    },
    async (request) => ({
      data: await getRenewalFor(contextOf(request), request.params.renewalId),
    }),
  )

  typed.post(
    '/api/v1/finance/renewals/:renewalId/activate',
    {
      preValidation: [...guarded(ACTIVATE_ROLES), captureInput()],
      schema: {
        operationId: 'activateRenewal',
        tags: ['finance-renewals'],
        summary: 'Sınıf geçişini uygula',
        description:
          'Planlanmış yenilemenin sınıf geçişini ayrı işlem olarak uygular; geçmiş not, yoklama ve tahsilat korunur (DOM-KAY-020, -023). Mezuniyette öğrenci pasifleşir. İkinci kez 409 `transition_already_applied`, sınıfı değişmişse 409 `transition_class_changed`, ileri tarihli etüt 422 `transition_has_future_tutoring`, dolu sınıf 422 `class_capacity_full`. Olmayan ya da başka kurumun kaydı 404. `If-Match` verilirse kaydın sürümüyle karşılaştırılır. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('optional'),
        params: renewalParams,
        body: z.object({}).describe('Gövdesiz komut'),
        response: { 200: commandResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await executeWorkflowCommand(
          contextOf(request),
          {
            command: 'renewal-activate',
            input: {},
            recordId: request.params.renewalId,
            childId: undefined,
          },
          options(request, 'optional'),
        ),
      ),
  )
}
