import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  SUPPLIER_INVOICE_STATUSES,
  SUPPLIER_PAYMENT_METHODS,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import { SUPPLIER_TYPES } from '@kampus/school-core/lib/finance-suppliers.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Tedarikçi carisi şemaları (DOM-FIN-076; ON-143). */

const cents = (description: string) => z.number().int().describe(description)
const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const day = (description: string) => z.string().describe(`${description} \`YYYY-MM-DD\``)

const invoiceSummaryShape = {
  id: z.string(),
  invoiceNumber: z.string().describe('Fatura numarası; boşluksuz, büyük harf (K-161)'),
  invoiceDate: day('Fatura tarihi'),
  dueDate: day('Son taksitin vadesi'),
  nextDueDate: day('Kalanı olan ilk taksitin vadesi; kalan yoksa boş').nullable(),
  supplier: z.object({ id: z.string(), name: z.string() }),
  purchaseOrderId: z.string().nullable(),
  netCents: cents('KDV hariç tutar, kuruş'),
  vatCents: cents('KDV, kuruş'),
  grossCents: cents('KDV dahil tutar, kuruş; ödeme planının toplamı'),
  paidCents: cents('Etkin ödemelerin toplamı'),
  remainingCents: cents('Kalan; iptal edilen faturada 0'),
  overdueCents: cents('Vadesi geçmiş taksitlerin kalanı (vade günü dahil vadesi gelmemiş)'),
  status: z.enum(SUPPLIER_INVOICE_STATUSES),
  cancelledAt: z.string().nullable(),
  version,
}

export const supplierInvoiceListResponse = z.object({
  data: z.array(z.object(invoiceSummaryShape)),
  meta: pageMetaSchema,
})

const paymentShape = z.object({
  id: z.string(),
  supplier: z.object({ id: z.string(), name: z.string() }),
  invoice: z.object({ id: z.string(), invoiceNumber: z.string() }),
  installmentId: z.string(),
  paidDate: day('Ödeme günü'),
  amountCents: cents('Ödenen tutar, kuruş'),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  bankAccount: z
    .object({ id: z.string(), label: z.string().describe('Banka adı ve IBAN’ın son dört hanesi') })
    .nullable()
    .describe('Ödemenin çıktığı kurum hesabı; nakitte boş'),
  description: z.string().describe('Banka açıklaması; girilmediyse `Fatura <no> ödemesi`'),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  instructionExportedAt: z
    .string()
    .nullable()
    .describe('Talimat dosyasına ilk alındığı an; doluysa yeniden alma onay ister (K-165)'),
  instructionExportCount: z.number().int(),
  actions: z.object({ cancel: z.boolean() }),
  version,
})

export const supplierPaymentResponse = dataResponse(paymentShape)
export const supplierPaymentListResponse = z.object({
  data: z.array(paymentShape),
  meta: pageMetaSchema,
})

const invoiceDetailSchema = z.object({
  ...invoiceSummaryShape,
  amountIncludesVat: z.boolean().describe('Tutar girişte KDV dahil mi yazıldı'),
  note: z.string().nullable(),
  purchaseOrder: z
    .object({ id: z.string(), number: z.string() })
    .nullable()
    .describe('Bağlı satın alma siparişi (DOM-FIN-073)'),
  installments: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int(),
        dueDate: day('Vade'),
        amountCents: cents('Taksit tutarı'),
        paidCents: cents('Taksite yazılmış etkin ödemeler'),
        remainingCents: cents('Taksit kalanı'),
        overdue: z.boolean().describe('Vadesi geçti ve kalanı var'),
      }),
    )
    .describe('Ödeme planı, vade sırasıyla'),
  payments: z.array(paymentShape).describe('Faturanın ödemeleri (iptal edilenler dahil)'),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  actions: z
    .object({ pay: z.boolean(), replan: z.boolean(), cancel: z.boolean() })
    .describe('Ödeme girişi, plan değişikliği ve iptal yapılabilir mi'),
})
export const supplierInvoiceResponse = dataResponse(invoiceDetailSchema)

export const supplierInvoiceParams = z.object({ invoiceId: z.uuid('Fatura geçersiz.') })
export const supplierPaymentParams = z.object({ paymentId: z.uuid('Ödeme geçersiz.') })
export const supplierLedgerParams = z.object({ supplierId: z.uuid('Tedarikçi geçersiz.') })

export const supplierInvoiceListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Fatura numarasında ya da tedarikçi adında arama'),
  supplierId: z.uuid('Tedarikçi geçersiz.').optional().describe('Tedarikçi'),
  purchaseOrderId: z.uuid('Sipariş geçersiz.').optional().describe('Bağlı sipariş'),
  status: z.enum(SUPPLIER_INVOICE_STATUSES).optional().describe('Durum (Europe/Istanbul bugünü)'),
})

export const supplierPaymentListQuery = z
  .strictObject({
    ...pageQuerySchema.shape,
    supplierId: z.uuid('Tedarikçi geçersiz.').optional(),
    invoiceId: z.uuid('Fatura geçersiz.').optional(),
    method: z.enum(SUPPLIER_PAYMENT_METHODS).optional(),
    from: daySchema.optional().describe('Ödeme günü başı'),
    to: daySchema.optional().describe('Ödeme günü sonu'),
    status: z.enum(['active', 'cancelled']).optional().describe('Etkin ya da iptal edilmiş'),
    instruction: z
      .enum(['pending', 'exported'])
      .optional()
      .describe(
        'Talimat dosyası: `pending` alınmamış, `exported` alınmış etkin havale/EFT ödemeleri',
      ),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ['to'],
    message: 'Bitiş günü başlangıçtan önce olamaz.',
  })

export const supplierLedgerQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Tedarikçi adında arama'),
  balance: z
    .enum(['open', 'overdue'])
    .optional()
    .describe('`open` bakiyesi olan, `overdue` vadesi geçmiş tutarı olan tedarikçiler'),
})

const ledgerTotals = {
  invoicedCents: cents('Etkin faturaların KDV dahil toplamı'),
  paidCents: cents('Etkin ödemelerin toplamı'),
  balanceCents: cents('Bakiye: kurumun tedarikçiye borcu'),
  overdueCents: cents('Vadesi geçmiş kalan'),
}

export const supplierLedgerResponse = z.object({
  data: z.array(
    z.object({
      supplier: z.object({ id: z.string(), name: z.string(), isActive: z.boolean() }),
      invoiceCount: z.number().int(),
      ...ledgerTotals,
      nextDueDate: day('Kalanı olan ilk vade').nullable(),
    }),
  ),
  meta: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0).describe('Süzgece uyan tedarikçi sayısı'),
    totals: z.object(ledgerTotals).describe('Kurumun bütün tedarikçi carisi (süzgeçten bağımsız)'),
  }),
})

export const supplierStatementResponse = z.object({
  data: z.object({
    supplier: z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(SUPPLIER_TYPES),
      taxNumber: z.string().describe('VKN; şahıs TCKN’si maskeli'),
      iban: z.string().nullable().describe('Maskeli IBAN; tam değer yalnız talimat dosyasında'),
      isActive: z.boolean(),
    }),
    ...ledgerTotals,
    movements: z
      .array(
        z.object({
          kind: z.enum(['invoice', 'invoice_cancel', 'payment', 'payment_cancel']),
          date: day('Hareket günü; iptal iptal gününe yazılır'),
          invoiceId: z.string(),
          invoiceNumber: z.string(),
          paymentId: z.string().nullable(),
          method: z.enum(SUPPLIER_PAYMENT_METHODS).nullable(),
          debitCents: cents('Borcu artıran tutar (fatura, ödeme iptali)'),
          creditCents: cents('Borcu azaltan tutar (ödeme, fatura iptali)'),
          balanceCents: cents('Hareket sonrası bakiye'),
        }),
      )
      .describe('Hareketler, yeni önce; bakiye eskiden yeniye yürür'),
  }),
  meta: pageMetaSchema,
})

export const supplierStatementQuery = z.strictObject({ ...pageQuerySchema.shape })
