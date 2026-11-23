import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  purchaseReceiptDocument,
  purchaseReceiptFilename,
} from '@/lib/pdf/templates/finance-purchase-receipt.ts'

export type PurchaseReceiptRef = { orderId: string; receiptId: string }

/**
 * Mal kabul tutanağı PDF'i (DOM-FIN-074; ON-337). Veri belge açılınca kabul panosundan okunur ki
 * iptal sonrası tutanak güncel olsun; jsPDF yalnız bu noktada dinamik yüklenir. Önbellek ve yeniden
 * üretim sipariş PDF'iyle aynıdır (`use-finance-purchase-order-pdf.ts`).
 */
export function usePurchaseReceiptPdf(ref: PurchaseReceiptRef, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  const { orderId, receiptId } = ref
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'purchase-receipt', orderId, receiptId),
    enabled: institutionId !== null && enabled && orderId !== '' && receiptId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/purchase-orders/{orderId}/receipts', {
              params: { path: { orderId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const board = response.data
        const receipt = board.receipts.find((item) => item.id === receiptId)
        // Kabul silinmez; panoda yoksa kayıt bu siparişe ait değildir.
        if (!receipt)
          throw new DomainError('purchase_receipt_not_found', 'Mal kabul kaydı bulunamadı.', {
            kind: 'not_found',
          })
        const { blob, pages } = await renderPdf((measurer) =>
          purchaseReceiptDocument(measurer, board.order, receipt, { institution }),
        )
        return { blob, pages, filename: purchaseReceiptFilename(board.order, receipt) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
