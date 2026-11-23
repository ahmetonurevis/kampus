import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  purchaseOrderDocument,
  purchaseOrderFilename,
} from '@/lib/pdf/templates/finance-purchase-order.ts'

/**
 * Satın alma siparişi PDF'i (DOM-FIN-073; ON-225). Veri belge açılınca ucundan okunur ki gönderim ya
 * da iptal sonrası belge güncel olsun; jsPDF yalnız bu noktada dinamik yüklenir. Önbellek ve yeniden
 * üretim toplu fatura PDF'iyle aynıdır (`use-finance-corporate-pdf.ts`).
 */
export function usePurchaseOrderPdf(orderId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'purchase-order', orderId),
    enabled: institutionId !== null && enabled && orderId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/purchase-orders/{orderId}', {
              params: { path: { orderId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const order = response.data
        const { blob, pages } = await renderPdf((measurer) =>
          purchaseOrderDocument(measurer, order, { institution }),
        )
        return { blob, pages, filename: purchaseOrderFilename(order) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
