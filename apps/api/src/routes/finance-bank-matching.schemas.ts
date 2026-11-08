import { z } from 'zod'

import {
  BANK_AMOUNT_FITS,
  BANK_MATCH_CONFIDENCES,
  BANK_MATCH_REASONS,
  BANK_TRANSACTION_STATUSES,
} from '@kampus/school-core/lib/finance-bank-matching.ts'
import {
  BANK_IMPORT_ROW_STATUSES,
  BANK_STATEMENT_FIELDS,
  BANK_STATEMENT_FORMATS,
} from '@kampus/school-core/lib/finance-bank-statement.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'
import { paymentSchema } from './payments.schemas.ts'

/**
 * Banka hareketi eşleştirme uçlarının yol, sorgu ve yanıt şemaları (IST-115, ON-099; DOM-FIN-069).
 * Gövde şemaları core'dadır (`lib/finance-bank-statement.ts`, `lib/finance-bank-matching.ts`).
 */

export const bankTransactionParamsSchema = z.object({
  transactionId: z.uuid('Hareket kimliği geçersiz.').describe('Banka hareketi kimliği'),
})

export const bankTransactionListQuerySchema = z
  .strictObject({
    ...pageQuerySchema.shape,
    status: z.enum(BANK_TRANSACTION_STATUSES).optional().describe('Yalnız bu durumdaki hareketler'),
    bankAccountId: z.uuid('Hesap kimliği geçersiz.').optional().describe('Yalnız bu hesabın'),
    dateFrom: z.iso.date().optional().describe('İşlem günü başlangıç (`YYYY-MM-DD`, dahil)'),
    dateTo: z.iso.date().optional().describe('İşlem günü bitiş (`YYYY-MM-DD`, dahil)'),
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional()
      .describe('Açıklama, gönderen ve referansta arar'),
  })
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    path: ['dateTo'],
    message: 'Bitiş günü başlangıç gününden önce olamaz.',
  })

export const bankSuggestionQuerySchema = z.strictObject({
  studentId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Yalnız bu öğrencinin açık taksiti önerilir (yetkili başka öğrenci seçti)'),
})

const issueSchema = z.object({
  field: z.enum(BANK_STATEMENT_FIELDS).nullable(),
  code: z.string(),
  message: z.string(),
})

const importRowSchema = z
  .object({
    line: z.number().int().describe('Dosyadaki satır'),
    status: z
      .enum(BANK_IMPORT_ROW_STATUSES)
      .describe(
        '`ready` yazılacak, `skipped` daha önce aktarılmış, `outgoing` giden hareket (yazılmaz), `ignored` hareket değil (devir, toplam), `invalid` hatalı',
      ),
    bookingDate: z.string().nullable().describe('İşlem günü, `YYYY-MM-DD`'),
    amountCents: z.number().int().nullable().describe('Mutlak tutar, kuruş'),
    direction: z.enum(['credit', 'debit']).nullable(),
    description: z.string().describe('Açıklama ve gönderen; uzun rakam dizileri maskeli'),
    reference: z.string(),
    issues: z.array(issueSchema),
  })
  .meta({ id: 'BankStatementImportRow' })

export const bankStatementImportResponseSchema = dataResponse(
  z
    .object({
      dryRun: z.boolean().describe('`true`: yalnız doğrulandı, hiçbir kayıt yazılmadı'),
      format: z.enum(BANK_STATEMENT_FORMATS),
      headers: z.array(z.string()).describe('CSV başlık satırının hücreleri (sütun eşleme için)'),
      columns: z
        .partialRecord(z.enum(BANK_STATEMENT_FIELDS), z.string())
        .describe('Alan → kullanılan başlık adı'),
      rowCount: z.number().int(),
      readyCount: z.number().int().describe('Yazılacak (onayda yazılan) gelen hareket'),
      skippedCount: z.number().int().describe('Daha önce aktarıldığı için atlanan'),
      outgoingCount: z.number().int().describe('Giden hareket; yazılmaz'),
      ignoredCount: z.number().int().describe('Hareket olmayan satır'),
      invalidCount: z.number().int(),
      totalCents: z.number().int().describe('Yazılacak gelen hareketlerin toplamı, kuruş'),
      rows: z.array(importRowSchema).describe('Yalnız önizlemede dolu'),
    })
    .meta({ id: 'BankStatementImportResult' }),
)

const suggestionSchema = z
  .object({
    studentId: z.string(),
    studentName: z.string(),
    invoiceId: z.string(),
    installment: z.number().int(),
    dueDate: z.string().describe('Vade, `YYYY-MM-DD`'),
    openCents: z.number().int().describe('Önerilen taksitin kalanı, kuruş'),
    studentOpenCents: z.number().int().describe('Öğrencinin bütün açık taksitlerinin kalanı'),
    creditCents: z.number().int().describe('Açık taksitleri aşan, iade alacağı olacak kısım'),
    amountFit: z.enum(BANK_AMOUNT_FITS),
    score: z.number().int().min(0).max(100),
    confidence: z.enum(BANK_MATCH_CONFIDENCES),
    reasons: z.array(z.enum(BANK_MATCH_REASONS)).describe('Gerekçe kodları; değer taşımaz'),
  })
  .meta({ id: 'BankMatchSuggestion' })

const transactionSchema = z
  .object({
    id: z.string(),
    bankAccountId: z.string(),
    bankAccountLabel: z.string().describe('Banka adı ve IBAN son dört hanesi'),
    bookingDate: z.string().describe('İşlem günü, `YYYY-MM-DD`'),
    amountCents: z.number().int().describe('Gelen tutar, kuruş'),
    description: z.string().describe('Açıklama; 11+ haneli rakam dizileri maskeli (K-112)'),
    counterparty: z.string().nullable(),
    reference: z.string().nullable().describe('Banka referansı'),
    balanceCents: z.number().int().nullable(),
    sourceFormat: z.enum(BANK_STATEMENT_FORMATS),
    status: z.enum(BANK_TRANSACTION_STATUSES),
    paymentId: z.string().nullable(),
    payment: z
      .object({
        receiptYear: z.number().int(),
        receiptNumber: z.number().int(),
        studentId: z.string(),
        studentName: z.string().nullable(),
      })
      .nullable()
      .describe('Eşleşen tahsilatın dekontu ve öğrencisi'),
    referenceInUse: z
      .boolean()
      .describe('Eşleşmemiş hareketin referansı başka bir tahsilatta kullanılmış'),
    matchedAt: z.string().nullable(),
    ignoredAt: z.string().nullable(),
    ignoreReason: z.string().nullable(),
    importedAt: z.string(),
    version: z.number().int().describe('`If-Match` için hareket sürümü'),
  })
  .meta({ id: 'BankTransaction' })

export const bankTransactionResponseSchema = dataResponse(transactionSchema)

export const bankTransactionListResponseSchema = z.object({
  data: z.array(
    transactionSchema
      .extend({
        suggestion: suggestionSchema
          .nullable()
          .describe('Eşleşmemiş harekette en iyi öneri; yoksa boş'),
      })
      .meta({ id: 'BankTransactionListItem' }),
  ),
  meta: pageMetaSchema,
})

export const bankSuggestionResponseSchema = dataResponse(
  z.object({ transaction: transactionSchema, suggestions: z.array(suggestionSchema) }),
)

export const bankMatchResponseSchema = dataResponse(
  z.object({ transaction: transactionSchema, payment: paymentSchema }),
)
