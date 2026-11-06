import type { FastifyReply, FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  financeExportProfileSchema,
  setFinanceExportProfileSchema,
} from '@kampus/school-core/lib/finance-export-profile.ts'
import {
  financeExportQuerySchema,
  financeOverviewQuerySchema,
  financePeriodSchema,
} from '@kampus/school-core/lib/finance-export.ts'
import {
  financeReconciliationExportQuerySchema,
  financeReconciliationQuerySchema,
  RECONCILIATION_MISMATCH_REASONS,
} from '@kampus/school-core/lib/finance-reconciliation.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  financeExportFor,
  financeExportWorkbookFor,
  financeOverviewFor,
  financeSummaryFor,
  financeTotalsFor,
  studentBalanceFor,
  financeExportProfileFor,
  setFinanceExportProfile,
  studentStatementFor,
} from '../services/finance-exports.ts'
import {
  financeReconciliationExportFor,
  financeReconciliationFor,
} from '../services/finance-reconciliation.ts'
import { XLSX_CONTENT_TYPE } from '../services/finance-workbook.ts'
import { captureInput, options, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Muhasebe dışa aktarımı (IST-111; guvenlik-kvkk.md). Modül `finance`. Dönem özeti yönetici ve ön
 * büro; kişisel veri taşıyan dosya yalnız yönetici, taze oturum ve kullanıcı başına 10/dk.
 */

const totals = z.object({ count: z.number().int(), totalCents: z.number().int() })
const summarySchema = dataResponse(
  z.object({
    payments: totals.describe('Tahsilat: iptaller eksi satır olarak düşer'),
    refunds: totals.describe('Ödenmiş iadeler'),
    invoices: totals
      .extend({ paidCents: z.number().int() })
      .describe('Vadesi dönemde olan taksitler'),
  }),
)

const overviewSchema = dataResponse(
  z.object({
    from: z.string(),
    to: z.string(),
    today: z.string(),
    collectedCents: z.number().int().describe('Dönemde alınan net tahsilat'),
    openCents: z.number().int().describe('Bugün kurum geneli açık tutar'),
    overdueCents: z.number().int().describe('Bugün kurum geneli gecikmiş tutar'),
    months: z.array(
      z.object({
        month: z.string().describe('YYYY-MM, Europe/Istanbul'),
        collectedCents: z.number().int(),
        dueCents: z.number().int(),
        openCents: z.number().int(),
        overdueCents: z.number().int(),
      }),
    ),
    overdueStudents: z.array(
      z.object({
        studentId: z.string(),
        overdueCents: z.number().int(),
        oldestDueDate: z.string(),
      }),
    ),
  }),
)

const reconciliationAmounts = z.object({
  openingCents: z.number().int().describe('Dönem başı bakiye: açık borç − alacak'),
  accruedCents: z.number().int().describe('Vadesi dönemde olan taksitler'),
  withdrawalAdjustmentCents: z
    .number()
    .int()
    .describe('Ayrılışta hak edilmeyen tahakkuk; iptal edilen taksite alınmış para varsa eksi'),
  collectedCents: z.number().int().describe('Ödeme günü dönemde olan tahsilatlar (brüt)'),
  reversedCents: z.number().int().describe('İptal günü dönemde olan tahsilatlar'),
  refundedCents: z.number().int().describe('Ödeme günü dönemde olan iadeler'),
  scholarshipCents: z
    .number()
    .int()
    .describe('Eğitim yılı sözleşmelerinin bursu; bilgi amaçlı, formüle girmez'),
  discountCents: z
    .number()
    .int()
    .describe('Eğitim yılı sözleşmelerinin indirimi; bilgi amaçlı, formüle girmez'),
  closingCents: z.number().int().describe('Dönem sonu bakiye: açık borç − alacak'),
  expectedClosingCents: z
    .number()
    .int()
    .describe('Açılış + tahakkuk − ayrılış düzeltmesi − tahsilat + iptal + iade'),
  differenceCents: z.number().int().describe('Kapanış − beklenen kapanış'),
  openDebtCents: z.number().int().describe('Dönem sonunda vadesi gelmiş açık taksit tutarı'),
  creditCents: z.number().int().describe('Dağıtılmamış tahsilat, avans ve ödenmemiş iade'),
})

const reconciliationResponse = z.object({
  data: z.object({
    year: z.number().int().describe('Eğitim yılının başladığı yıl'),
    from: z.string().describe('Dönem başı (YYYY-MM-DD, Europe/Istanbul)'),
    to: z.string().describe('Dönem sonu; süren yılda bugün'),
    totals: reconciliationAmounts,
    studentCount: z.number().int(),
    mismatchCount: z.number().int().describe('Toplamları tutmayan öğrenci sayısı'),
    rows: z.array(
      reconciliationAmounts.extend({
        studentId: z.string(),
        studentName: z.string(),
        studentNumber: z.string(),
        mismatchReason: z.enum(RECONCILIATION_MISMATCH_REASONS).nullable(),
      }),
    ),
  }),
  meta: pageMetaSchema,
})

/** Sayaç doğrulanmış kullanıcıyadır; istemcinin değiştirebildiği başlığa bağlanmaz. */
function exportRateKey(request: FastifyRequest): string {
  return request.auth?.userId ?? request.ip
}

export function registerFinanceExportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

  typed.get(
    '/api/v1/finance/totals',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])],
      schema: {
        operationId: 'getFinanceTotals',
        tags: ['finance-exports'],
        summary: 'Kurum geneli finans toplamları',
        description:
          'Finans ekranı kartları: toplam, tahsil edilen (kısmi ödemeler dahil), kalan ve gecikmiş tutar (DOM-FIN-030). Gecikmiş tutar yalnız kalan kısımdır. Roller: `yonetici`, `onburo`.',
        response: {
          200: dataResponse(
            z.object({
              totalCents: z.number().int(),
              paidCents: z.number().int(),
              remainingCents: z.number().int(),
              overdueCents: z.number().int(),
            }),
          ),
          ...commandErrors,
        },
      },
    },
    async (request) => ({ data: await financeTotalsFor(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/finance/overview',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])],
      schema: {
        operationId: 'getFinanceOverview',
        tags: ['finance-exports'],
        summary: 'Finans özeti: tahsilat, açık ve gecikmiş tutar',
        description:
          'Yönetici panosu ve erken uyarı için özet (IST-116, IST-121). `collectedCents` ve `months` dönemin tahsilatını ve ay kırılımını verir: iptal, iptal edildiği ayda düşer; vade kırılımı taksitin vade ayına göredir. `openCents` ve `overdueCents` dönemden bağımsız, bugünün kurum geneli tutarıdır ve `/finance/totals` ile aynıdır; kısmi ödemede yalnız kalan kısım sayılır. `overdueStudents` gecikmiş borcu olan öğrencileri tutar büyükten küçüğe verir. Dönem verilmezse son altı takvim ayıdır; yalnız bir uç verilirse 400. Gün Europe/Istanbul günüdür. Başlangıç bitişten sonra 422 `export_period_invalid`, dönem bir yılı aşarsa 422 `export_period_too_long`. Muhasebe dosyasının toplamı için `/finance/summary` kullanılır. Roller: `yonetici`, `onburo`.',
        querystring: financeOverviewQuerySchema,
        response: { 200: overviewSchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await financeOverviewFor(contextOf(request), request.query) }),
  )

  typed.get(
    '/api/v1/finance/students/:studentId/balance',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici', 'onburo', 'veli', 'ogrenci']),
      ],
      schema: {
        operationId: 'getStudentBalance',
        tags: ['finance-exports'],
        summary: 'Öğrencinin bakiyesi',
        description:
          'Öğrencinin toplam, ödenen, açık ve gecikmiş tutarı, gecikmiş taksit sayısı ve en yakın açık taksiti (DOM-FIN-052). Kısmi ödemede yalnız kalan kısım sayılır; `/finance/totals` ile aynı kural. Veli yalnız velayetli ve kısıtsız bağlı çocuğunu ve velayeti olmasa da ödeyicisi olduğu öğrenciyi (K-04, DOM-ILT-074), öğrenci yalnız kendisini okur; kapsam dışı, olmayan ya da başka kurumun öğrencisi 404. Roller: `yonetici`, `onburo`, `veli`, `ogrenci`.',
        params: z.object({ studentId: z.string().min(1).max(200).describe('Öğrenci kimliği') }),
        response: {
          200: dataResponse(
            z.object({
              studentId: z.string(),
              totalCents: z.number().int(),
              paidCents: z.number().int(),
              openCents: z.number().int(),
              overdueCents: z.number().int(),
              overdueCount: z.number().int(),
              nextDue: z.object({ date: z.string(), amountCents: z.number().int() }).nullable(),
            }),
          ),
          ...commandErrors,
        },
      },
    },
    async (request) => ({
      data: await studentBalanceFor(contextOf(request), request.params.studentId),
    }),
  )

  typed.get(
    '/api/v1/finance/students/:studentId/statement',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici', 'onburo', 'veli', 'ogrenci']),
      ],
      schema: {
        operationId: 'getStudentStatement',
        tags: ['finance-exports'],
        summary: 'Öğrencinin cari ekstresi',
        description:
          'Taksit borçlarını ve tahsilatları tarih sırasıyla, yürüyen bakiyeyle döner (IST-107). Özet alanları `/balance` ile aynı kuraldadır; borç ve alacak toplamının farkı açık tutara eşittir. İptal edilen tahsilat ters kayıtla kalır; taksite dağıtılmayan tutar `unappliedCents` alanındadır ve bakiyeyi düşürmez. Kapsam bakiyeyle aynıdır: veli bağlı çocuğunu ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini okur. Başka öğrenci veya başka kurum 404, öğretmen 403, modül kapalı 403.',
        params: z.object({ studentId: z.string().min(1).max(200).describe('Öğrenci kimliği') }),
        response: {
          200: dataResponse(
            z.object({
              studentId: z.string(),
              totalCents: z.number().int(),
              paidCents: z.number().int(),
              openCents: z.number().int(),
              overdueCents: z.number().int(),
              overdueCount: z.number().int(),
              nextDue: z.object({ date: z.string(), amountCents: z.number().int() }).nullable(),
              debitTotalCents: z.number().int().describe('Borç sütunu toplamı (kuruş)'),
              creditTotalCents: z.number().int().describe('Alacak sütunu toplamı (kuruş)'),
              unappliedCents: z
                .number()
                .int()
                .describe('Taksite dağıtılmayan, iade alacağı olan tutar (kuruş)'),
              lines: z.array(
                z.object({
                  kind: z
                    .enum(['installment', 'payment', 'payment_reversal', 'legacy_payment'])
                    .describe('Taksit borcu, tahsilat, iptal ters kaydı, kayıtsız eski ödeme'),
                  date: z.string().describe('İşlem günü (YYYY-MM-DD, Europe/Istanbul)'),
                  debitCents: z.number().int().describe('Borç (kuruş)'),
                  creditCents: z.number().int().describe('Alacak (kuruş)'),
                  balanceCents: z.number().int().describe('Satır sonrası bakiye (kuruş)'),
                  invoiceId: z.string().nullable(),
                  installment: z.number().int().nullable(),
                  openCents: z
                    .number()
                    .int()
                    .nullable()
                    .describe('Taksitin açık kalan kısmı (kuruş)'),
                  isOverdue: z.boolean(),
                  paymentId: z.string().nullable(),
                  method: z.string().nullable(),
                  reference: z.string().nullable(),
                  receiptYear: z.number().int().nullable(),
                  receiptNumber: z.number().int().nullable(),
                  unappliedCents: z
                    .number()
                    .int()
                    .describe('Tahsilatın taksite dağıtılmayan kısmı (kuruş)'),
                }),
              ),
            }),
          ),
          ...commandErrors,
        },
      },
    },
    async (request) => ({
      data: await studentStatementFor(contextOf(request), request.params.studentId),
    }),
  )

  typed.get(
    '/api/v1/finance/summary',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])],
      schema: {
        operationId: 'getFinanceSummary',
        tags: ['finance-exports'],
        summary: 'Dönem finans toplamları',
        description:
          'Tahsilat, ödenmiş iade ve taksit toplamları; dışa aktarım dosyasıyla aynı satırlardan hesaplanır (IST-111). Gün Europe/Istanbul günüdür. Başlangıç bitişten sonra 422 `export_period_invalid`, dönem bir yılı aşarsa 422 `export_period_too_long`. Roller: `yonetici`, `onburo`.',
        querystring: financePeriodSchema,
        response: { 200: summarySchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await financeSummaryFor(contextOf(request), request.query) }),
  )

  const profileResponse = dataResponse(
    z.object({
      profile: financeExportProfileSchema
        .nullable()
        .describe('Kurumun aktarım profili; boşsa standart dosya iner'),
      version: z.number().int().describe('`If-Match` için profil sürümü'),
    }),
  )

  typed.get(
    '/api/v1/finance/export-profile',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici'])],
      schema: {
        operationId: 'getFinanceExportProfile',
        tags: ['finance-exports'],
        summary: 'Muhasebe aktarım profili',
        description:
          'Aktarım dosyasının sütun adı, sırası, tarih ve tutar biçimi (ON-024, IST-111). Satır yoksa `profile` boştur ve standart dosya iner. Roller: `yonetici`.',
        response: { 200: profileResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await financeExportProfileFor(contextOf(request)) }),
  )

  typed.patch(
    '/api/v1/finance/export-profile',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici']),
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'setFinanceExportProfile',
        tags: ['finance-exports'],
        summary: 'Muhasebe aktarım profilini kaydet',
        description:
          'Kurumun dosya biçimini kaydeder; `profile: null` standart dosyaya döner. Profil yalnız biçimi belirler, satırları ve toplamları değiştirmez. `If-Match` ve `Idempotency-Key` zorunludur; sürüm tutmazsa 409. Roller: `yonetici`.',
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        body: setFinanceExportProfileSchema,
        response: { 200: profileResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'required')
      if (expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await setFinanceExportProfile(
        contextOf(request),
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      if (result.replayed) void reply.header('idempotent-replayed', 'true')
      void (reply as FastifyReply).status(result.statusCode)
      return profileResponse.parse(result.body)
    },
  )

  typed.get(
    '/api/v1/finance/exports',
    {
      config: {
        // `preHandler`: kimlik `preValidation`'da doğrulanır, anahtar kullanıcı kimliği olur.
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: exportRateKey,
        },
      },
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici']),
        app.requireFreshSession,
      ],
      schema: {
        operationId: 'exportFinance',
        tags: ['finance-exports'],
        summary: 'Muhasebe aktarım dosyası',
        description:
          '`kind` ile tahsilat, iade veya taksit satırlarını döner. `format=csv` (varsayılan): `;` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı. `format=xlsx`: Excel dosyası (ikili gövde); metin alanları formül çalıştırmayan metin hücresi, tutar `#,##0.00` biçimli sayı hücresi, tarih Europe/Istanbul günü olarak profilin tarih biçimiyle tarih hücresidir; sütun adı ve sırası kurumun profilinden gelir, ayırıcı ve ondalık işareti yalnız CSV içindir. Belirli bir muhasebe programına uyum iddiası, hesap kodu ve KDV dökümü yoktur. Önceki dönem tahsilatının iptali iptal gününde eksi satırdır. Yalnız ödenmiş iade yer alır, IBAN maskelidir. Dosya toplamı `GET /finance/summary` toplamına eşittir. Her aktarım denetim kaydına yazılır. Taze oturum ister: eskiyse 403 `reauthentication_required`. Dönem kuralları özet ucuyla aynıdır. Rol: `yonetici`.',
        querystring: financeExportQuerySchema,
        response: { 200: z.string().describe('CSV metni ya da `.xlsx` dosyası'), ...commandErrors },
      },
    },
    async (request, reply) => {
      const { kind, from, to, format } = request.query
      if (format === 'xlsx') {
        const file = await financeExportWorkbookFor(contextOf(request), { kind, from, to })
        // Buffer serileştirilmeden gönderilir; yanıt şeması yalnız OpenAPI içindir.
        return (reply as FastifyReply)
          .type(XLSX_CONTENT_TYPE)
          .header('content-disposition', `attachment; filename="${kind}-${from}-${to}.xlsx"`)
          .send(file)
      }
      const csv = await financeExportFor(contextOf(request), { kind, from, to })
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${kind}-${from}-${to}.csv"`)
        .serializer((payload: unknown) => String(payload))
        .send(`\uFEFF${csv}`)
    },
  )

  typed.get(
    '/api/v1/finance/reconciliation',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici'])],
      schema: {
        operationId: 'getFinanceReconciliation',
        tags: ['finance-exports'],
        summary: 'Yıl sonu mutabakatı',
        description:
          'Seçilen eğitim yılının öğrenci bazında mutabakatı (ON-085, IST-111; DOM-FIN-056). Formül: açılış + tahakkuk − ayrılış düzeltmesi − tahsilat + iptal + iade = kapanış. Kapanış taksit ve dağılımlardan, beklenen kapanış hareketlerden hesaplanır; `differenceCents` sıfırdan farklı olan öğrenci tutmaz. Tahakkuk, tahsilat − iptal ve iade toplamları aynı dönemin `/finance/summary` toplamlarına eşittir. Burs ve indirim sözleşmenin eğitim yılından okunur, formüle girmez. Dönem kurumun eğitim yılı aralığıdır, kayıt yoksa 1 Eylül – 31 Ağustos; süren yılda bitiş bugündür. Başlamamış yıl 422 `reconciliation_year_not_started`. `totals` süzgeçten bağımsızdır; `status=mismatch` satırları tutmayanlarla sınırlar. Hesap kodu ve KDV dökümü üretmez. Yıl kapatmaz, kayıt değiştirmez. Rol: `yonetici`.',
        querystring: financeReconciliationQuerySchema.extend(pageQuerySchema.shape),
        response: { 200: reconciliationResponse, ...commandErrors },
      },
    },
    async (request) => financeReconciliationFor(contextOf(request), request.query),
  )

  typed.get(
    '/api/v1/finance/reconciliation/export',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: exportRateKey,
        },
      },
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici']),
        app.requireFreshSession,
      ],
      schema: {
        operationId: 'exportFinanceReconciliation',
        tags: ['finance-exports'],
        summary: 'Yıl sonu mutabakat dosyası',
        description:
          'Mutabakatın öğrenci satırlarını CSV olarak döner: `;` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı; kurumun aktarım profili varsa onun biçimi ve sütunları. Satır ve toplam kuralı `GET /finance/reconciliation` ile aynıdır. Her aktarım denetim kaydına yazılır. Taze oturum ister: eskiyse 403 `reauthentication_required`. Rol: `yonetici`.',
        querystring: financeReconciliationExportQuerySchema,
        response: { 200: z.string().describe('CSV dosyası'), ...commandErrors },
      },
    },
    async (request, reply) => {
      const { year } = request.query
      const { csv, from, to } = await financeReconciliationExportFor(contextOf(request), year)
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="reconciliation-${from}-${to}.csv"`)
        .serializer((payload: unknown) => String(payload))
        .send(`\uFEFF${csv}`)
    },
  )
}
