import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import type { PdfDocument, TextMeasurer } from '@/lib/pdf/layout.ts'
import {
  corporateInvoiceDocument,
  corporateInvoiceFilename,
  corporateReportDocument,
  corporateReportFilename,
} from '@/lib/pdf/templates/finance-corporate.ts'

/**
 * Kurumsal müşteri PDF'leri (IST-089): toplu fatura dökümü ve katılım özeti. Veri belge açılınca
 * ucundan okunur ki ekrandan sonra girilen tahsilat da belgeye yansısın; jsPDF yalnız bu noktada
 * dinamik yüklenir. Önbellek ve yeniden üretim gün sonu PDF'iyle aynıdır.
 */
function useCorporatePdf<T>(
  kind: string,
  id: string,
  enabled: boolean,
  load: (signal: AbortSignal) => Promise<T>,
  build: (
    measurer: TextMeasurer,
    data: T,
    institution: string,
  ) => { document: PdfDocument; filename: string },
) {
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', kind, id),
    enabled: institutionId !== null && enabled && id !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [data, { renderPdf }] = await Promise.all([
          load(signal),
          import('@/lib/pdf/render.ts'),
        ])
        let filename = ''
        const { blob, pages } = await renderPdf((measurer) => {
          const built = build(measurer, data, institution)
          filename = built.filename
          return built.document
        })
        return { blob, pages, filename }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}

export function useCorporateInvoicePdf(invoiceId: string, enabled: boolean) {
  const client = useKampusClient()
  return useCorporatePdf(
    'corporate-invoice',
    invoiceId,
    enabled,
    async (signal) =>
      (
        await runRequest(() =>
          client.GET('/api/v1/finance/corporate-invoices/{invoiceId}', {
            params: { path: { invoiceId } },
            signal,
          }),
        )
      ).data,
    (measurer, invoice, institution) => ({
      document: corporateInvoiceDocument(measurer, invoice, { institution }),
      filename: corporateInvoiceFilename(invoice),
    }),
  )
}

export function useCorporateReportPdf(customerId: string, enabled: boolean) {
  const client = useKampusClient()
  return useCorporatePdf(
    'corporate-report',
    customerId,
    enabled,
    async (signal) =>
      (
        await runRequest(() =>
          client.GET('/api/v1/finance/corporate-customers/{customerId}/attendance-report', {
            params: { path: { customerId } },
            signal,
          }),
        )
      ).data,
    (measurer, report, institution) => ({
      document: corporateReportDocument(measurer, report, { institution }),
      filename: corporateReportFilename(report.customerName),
    }),
  )
}
