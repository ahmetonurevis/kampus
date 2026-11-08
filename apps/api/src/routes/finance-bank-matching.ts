import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  BANK_MATCH_ROLES,
  bankIgnoreSchema,
  bankMatchSchema,
} from '@kampus/school-core/lib/finance-bank-matching.ts'
import { bankStatementImportSchema } from '@kampus/school-core/lib/finance-bank-statement.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  bankTransactionSuggestionsFor,
  ignoreBankTransactionCommand,
  importBankStatement,
  listBankTransactionsFor,
  matchBankTransactionCommand,
  restoreBankTransactionCommand,
} from '../services/finance-bank-matching.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { IMPORT_BODY_LIMIT } from './enrollment-imports.ts'
import {
  bankMatchResponseSchema,
  bankStatementImportResponseSchema,
  bankSuggestionQuerySchema,
  bankSuggestionResponseSchema,
  bankTransactionListQuerySchema,
  bankTransactionListResponseSchema,
  bankTransactionParamsSchema,
  bankTransactionResponseSchema,
} from './finance-bank-matching.schemas.ts'

/**
 * Banka hareketi eşleştirme uçları (IST-115, ON-099; docs/domain/finans.md DOM-FIN-069). Modül
 * `finance`; rol `BANK_MATCH_ROLES` (bugün yönetici, muhasebe rolü açılınca o da; K-105). Ön büro,
 * öğretmen, veli ve öğrenci 403. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const ACCESS =
  'Rol: `yonetici` (muhasebe rolü açılınca o da; K-105). Modül `finance`. Kurum oturumdan gelir; başka kurumun hareketi 404.'
const IF_MATCH = '`If-Match` zorunlu; sürüm tutmazsa 409 `version_conflict`.'

function send(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceBankMatchingRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guard = [app.authenticate, app.requireModule('finance'), app.requireRole(BANK_MATCH_ROLES)]
  const tags = ['finance-bank-matching']

  typed.post(
    '/api/v1/finance/bank-statement-imports',
    {
      preValidation: [...guard, rejectIfMatch()],
      bodyLimit: IMPORT_BODY_LIMIT,
      schema: {
        operationId: 'importBankStatement',
        tags,
        summary: 'Banka ekstresini aktar',
        description: `Seçilen kurum banka hesabının (\`bankAccountId\`, DOM-FIN-032) hareket dökümünü yükler (IST-115, DOM-FIN-069). \`fileBase64\`: CSV, Excel (.xlsx, ilk sayfa) ya da MT940 dosyasının base64'ü, en çok 5 MB; tür içerikten anlaşılır, dosya saklanmaz. CSV başlık satırı ilk 30 satırda aranır; yaygın banka başlıkları (tarih/işlem tarihi, açıklama, tutar ya da alacak/borç, bakiye, referans/dekont no, gönderen) tanınır, \`columns\` ile alan → başlık adı elle eşlenir. En çok 5.000 satır. Yalnız gelen (alacak) hareket yazılır; giden hareket (\`outgoing\`) ve tarihi ya da tutarı boş satır (\`ignored\`) yazılmaz (K-106). Aynı hesapta daha önce aktarılmış hareket atlanır (\`skipped\`, K-107): ikinci yükleme mükerrer kayıt açmaz. İz hesap, gün ve tutarla birlikte banka referansıdır (en az 6 harf/rakam ve rakam içerir); referans yoksa normalleştirilmiş açıklamadır, böylece aynı ekstre CSV ve MT940 olarak yüklense de referanslı hareket ikinci kez yazılmaz (K-120). \`dryRun: true\` önizlemedir: 200 ve satır bazında durum, açıklama ve referans maskeli (K-122); hiçbir şey yazmaz. Onay 201; hatalı satır varsa 422 \`bank_statement_invalid\` (\`issues\` yolu \`['rows', satır, alan]\`) ve hiçbir hareket yazılmaz. Arşivli ya da başka kurumun hesabı 422 \`bank_account_invalid\`; MT940 hesabı seçilen hesap değilse 422 \`bank_statement_account_mismatch\`. Başlık bulunamazsa 422 \`bank_statement_header_missing\`. Aktarım tahsilat oluşturmaz. \`Idempotency-Key\` zorunlu. ${ACCESS}`,
        body: bankStatementImportSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: bankStatementImportResponseSchema,
          201: bankStatementImportResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      const result = await importBankStatement(
        contextOf(request),
        request.body,
        idempotencyOf(request, true),
      )
      return bankStatementImportResponseSchema.parse(send(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/bank-transactions',
    {
      preValidation: guard,
      schema: {
        operationId: 'listBankTransactions',
        tags,
        summary: 'Banka hareketlerini listele',
        description: `Aktarılmış gelen hareketler, en yeni işlem günü önce. \`status\`, \`bankAccountId\`, \`dateFrom\`/\`dateTo\` (işlem günü, dahil) ve \`q\` (açıklama, gönderen, referans; Türkçe harf duyarsız) ile süzülür; sayfalıdır, \`pageSize\` en çok 100, bilinmeyen parametre 400. Eşleşmemiş harekette en iyi öneri (\`suggestion\`) ve referansı başka tahsilatta kullanılmışsa \`referenceInUse\` döner. Açıklama, gönderen ve referansta 11 ve daha çok haneli rakam dizileri (boşluk, tire ya da noktayla gruplanmış kimlik no ve IBAN dahil) son dört hane dışında maskelidir (K-112, K-122). ${ACCESS}`,
        querystring: bankTransactionListQuerySchema,
        response: { 200: bankTransactionListResponseSchema, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listBankTransactionsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/bank-transactions/:transactionId/suggestions',
    {
      preValidation: guard,
      schema: {
        operationId: 'listBankMatchSuggestions',
        tags,
        summary: 'Eşleştirme önerileri',
        description: `Hareket için en çok 5 öneri, puana göre sıralı (K-108): T.C. kimlik no (tamamı ya da son haneleri), öğrenci numarası, sözleşme kimliği, öğrenci ve veli adı ile tutarın açık taksite uyumu. Öğrenci başına tek öneri: tutarı eşit ilk açık taksit, yoksa en eski vadeli açık taksit. Güven \`high\` yalnız kimlik sinyali olan, puanı 70+ ve ikinci adaydan 15+ önde olan ilk öneridir; kimlik sinyali yoksa tutarı eşit açık taksitler \`low\` önerilir. \`amountFit\`: \`exact\`, \`multiple\` (birden çok taksite eşit), \`partial\`, \`over\`; \`creditCents\` iade alacağı olacak kısımdır (DOM-FIN-030). \`studentId\` verilirse yalnız o öğrencinin önerisi döner. Eşleşmiş ya da yoksayılmış harekette liste boştur. Kimlik numarası yanıtta yoktur. ${ACCESS}`,
        params: bankTransactionParamsSchema,
        querystring: bankSuggestionQuerySchema,
        response: { 200: bankSuggestionResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await bankTransactionSuggestionsFor(
        contextOf(request),
        request.params.transactionId,
        request.query.studentId,
      ),
    }),
  )

  typed.post(
    '/api/v1/finance/bank-transactions/:transactionId/match',
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'matchBankTransaction',
        tags,
        summary: 'Eşleşmeyi onayla ve tahsilat oluştur',
        description: `Öneriyi ya da seçilen taksiti onaylar (DOM-FIN-069): tahsilat hareketin tamamıyla, \`Banka havalesi\` yöntemiyle, hareketin hesabına ve işlem gününe yazılır; referans hareketin banka referansıdır, yoksa \`EKSTRE-…\` (K-109). Dağılım tahsilat kuralıdır: önce \`invoiceId\`, artanı en eski vade, açık taksitleri aşanı iade alacağı (DOM-FIN-030, K-110). Hareket aynı işlemde \`matched\` olur; ikinci onay 409 \`bank_transaction_not_open\` ve tek tahsilat (DOM-FIN-031). İşlem günü kapatılmışsa 422 \`finance_day_closed\` (DOM-FIN-036); referans başka tahsilatta kullanılmışsa 409 \`payment_reference_used\`; aynı hesaba aynı gün aynı tutarda gelen başka hareket aynı öğrenciye eşleşmişse 409 \`bank_match_possible_duplicate\` (K-121), ayrı ödemeyse \`confirmDuplicate: true\` ile yeniden gönderilir; taksit öğrencinin değilse 404, ödenmişse 409 \`invoice_already_paid\`; hesap arşivlenmişse 422 \`bank_account_invalid\`. ${IF_MATCH} \`Idempotency-Key\` zorunlu: aynı anahtar ikinci tahsilat açmaz. Başarı 201: hareket ve tahsilat. ${ACCESS}`,
        params: bankTransactionParamsSchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        body: bankMatchSchema,
        response: { 201: bankMatchResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await matchBankTransactionCommand(
        contextOf(request),
        request.params.transactionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return bankMatchResponseSchema.parse(send(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/bank-transactions/:transactionId/ignore',
    {
      preValidation: [...guard, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'ignoreBankTransaction',
        tags,
        summary: 'Hareketi yoksay',
        description: `Öğrenci tahsilatı olmayan gelen hareketi (kira, iade, başka gelir) gerekçeyle (\`ignoreReason\`, 3–200 karakter) yoksayar; tahsilat yazılmaz. Yalnız eşleşmemiş hareket: aksi 409 \`bank_transaction_not_open\`. ${IF_MATCH} ${ACCESS}`,
        params: bankTransactionParamsSchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: bankIgnoreSchema,
        response: { 200: bankTransactionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await ignoreBankTransactionCommand(
        contextOf(request),
        request.params.transactionId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return bankTransactionResponseSchema.parse(send(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/bank-transactions/:transactionId/restore',
    {
      preValidation: [...guard, requireIfMatch()],
      schema: {
        operationId: 'restoreBankTransaction',
        tags,
        summary: 'Yoksaymayı geri al',
        description: `Yoksayılan hareket yeniden eşleşmemiş olur; yalnız yoksayılan hareket: aksi 409 \`bank_transaction_not_ignored\`. Eşleşmiş hareket tahsilat iptaliyle (\`POST /payments/:paymentId/reverse\`, yönetici) geri açılır (K-111). ${IF_MATCH} ${ACCESS}`,
        params: bankTransactionParamsSchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: bankTransactionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await restoreBankTransactionCommand(
        contextOf(request),
        request.params.transactionId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return bankTransactionResponseSchema.parse(send(reply, result))
    },
  )
}
