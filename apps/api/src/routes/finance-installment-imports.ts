import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  importFileInputSchema,
  IMPORT_ROW_STATUSES,
} from '@kampus/school-core/lib/enrollment-import-cells.ts'
import { PAYMENT_METHODS } from '@kampus/school-core/lib/payments.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { importInstallments } from '../services/finance-installment-import.ts'
import { idempotencyOf } from './command-support.ts'
import { rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'
import { IMPORT_ACCESS, IMPORT_BODY_LIMIT, sendImport } from './enrollment-imports.ts'
import {
  importIssueResponseSchema,
  importNoticeResponseSchema,
} from './enrollment-imports.schemas.ts'

const installmentImportRowSchema = z
  .object({
    line: z.number().int().describe('Dosyadaki satır (başlık 1. satırdır)'),
    status: z.enum(IMPORT_ROW_STATUSES).describe('`ready` yazılacak, `skipped` zaten kayıtlı'),
    studentName: z.string().nullable().describe('Kimlikle bulunan öğrencinin kayıtlı adı'),
    identityMasked: z.string().describe('Kimlik numarasının yalnız son dört hanesi görünür'),
    installment: z.number().int().nullable(),
    amountCents: z.number().int().nullable().describe('Tutar, kuruş'),
    dueDate: z.string().nullable().describe('Vade, `YYYY-MM-DD`'),
    paidDate: z.string().nullable().describe('Ödeme günü, `YYYY-MM-DD`; açık taksitte `null`'),
    method: z.enum(PAYMENT_METHODS).nullable(),
    academicYear: z.number().int().nullable(),
    contractLinked: z.boolean().describe('Taksit öğrencinin sözleşmesine bağlanacak mı'),
    issues: z.array(importIssueResponseSchema),
    notices: z.array(importNoticeResponseSchema),
  })
  .meta({ id: 'InstallmentImportRow' })

/** Onay yanıtı saklanır (idempotency): `rows` boştur, kişisel veri taşımaz. */
const installmentImportResultSchema = z
  .object({
    dryRun: z.boolean().describe('`true`: yalnız doğrulandı, hiçbir kayıt yazılmadı'),
    rowCount: z.number().int().describe('Dosyadaki veri satırı sayısı'),
    readyCount: z.number().int().describe('Yazılacak (onayda yazılan) taksit sayısı'),
    skippedCount: z.number().int().describe('Kayıtlı olduğu için atlanan satır sayısı'),
    invalidCount: z.number().int().describe('Hatalı satır sayısı'),
    linkedCount: z.number().int().describe('Sözleşmeye bağlanan taksit sayısı'),
    totalCents: z.number().int().describe('Yazılacak taksitlerin toplamı, kuruş'),
    paidCents: z.number().int().describe('Bunların ödenmiş olanlarının toplamı, kuruş'),
    rows: z.array(installmentImportRowSchema).describe('Yalnız önizlemede dolu; kimlik maskeli'),
  })
  .meta({ id: 'InstallmentImportResult' })

const installmentImportResponseSchema = dataResponse(installmentImportResultSchema)

/** Pilot verisi aktarımı: taksitler (IST-007, ON-061; DOM-FIN-001, -010, -011, -012; ADR 0010). */
export function registerFinanceInstallmentImportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/api/v1/finance/installment-imports',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        app.requireRole(['yonetici']),
        app.requireFreshSession,
        rejectIfMatch(),
      ],
      bodyLimit: IMPORT_BODY_LIMIT,
      schema: {
        operationId: 'importInstallments',
        tags: ['finance'],
        summary: 'Taksitleri dosyadan aktar',
        description: `Okul canlıya geçerken açık ve ödenmiş taksitleri CSV ya da Excel (.xlsx, ilk sayfa) dosyasıyla yükler (IST-007, DOM-FIN-011, DOM-FIN-012, ADR 0010). \`fileBase64\`: dosyanın base64'ü, en çok 5 MB; tür içerikten anlaşılır. En çok 5.000 veri satırı. Sütunlar: \`kimlik no\`, \`taksit no\`, \`tutar kuruş\` (tamsayı kuruş), \`vade\`; isteğe bağlı \`öğrenci adı\` (verilirse kayıtla eşleşmeli), \`ödeme tarihi\` ve \`ödeme yöntemi\` (birlikte), \`eğitim yılı\` (boşsa kurumun etkin yılı). \`dryRun: true\` önizlemedir: 200 ve satır bazında sorun ve bilgi döner, hiçbir şey yazmaz. Onayda bütün satırlar kurum kilidi altında yeniden doğrulanır: hata varsa 422 \`installment_import_invalid\` (\`issues\` yolu \`['rows', satır, alan]\`) ve hiçbir kayıt yazılmaz, başarı 201. Öğrencinin tek sözleşmesi varsa taksit ona bağlanır; birden çok ya da hiç sözleşmesi yoksa ya da sözleşmenin yılı farklıysa bağ boş kalır (ADR 0010 cevap 3). Onaylı sözleşmenin planına taksit eklenmez (\`contract_approved\`), plan toplamı sözleşmeyi aşamaz (\`contract_total_exceeded\`). Aynı öğrenci, yıl ve taksit numarası kayıtlıysa ve koşulları aynıysa satır atlanır (\`skipped\`): ikinci yükleme mükerrer kayıt açmaz; farklıysa satır hatalıdır. Ödenmiş taksit tahsilat satırı yazmaz: kasa ve dönem tahsilatı değişmez. \`Idempotency-Key\` zorunlu (önizlemede saklanmaz). ${IMPORT_ACCESS}`,
        body: importFileInputSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: installmentImportResponseSchema,
          201: installmentImportResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      const response = await importInstallments(
        contextOf(request),
        request.body,
        idempotencyOf(request, true),
      )
      return sendImport(reply, response, installmentImportResponseSchema)
    },
  )
}
