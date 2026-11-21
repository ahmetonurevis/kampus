import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  donationReceiptDocument,
  donationReceiptFilename,
} from '@/lib/pdf/templates/finance-donation-receipt.ts'

/**
 * Bağış makbuzu PDF'i (DOM-FIN-097). Veri belge açılınca makbuz ucundan okunur (tam kimlik
 * numarası yalnız orada döner ve okuma denetlenir, K-298); jsPDF yalnız bu noktada dinamik yüklenir.
 */
export function useDonationReceiptPdf(donationId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'donation-receipt', donationId),
    enabled: institutionId !== null && enabled && donationId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/donations/{donationId}/receipt', {
              params: { path: { donationId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const receipt = response.data
        const { blob, pages } = await renderPdf((measurer) =>
          donationReceiptDocument(measurer, receipt, { institution }),
        )
        return { blob, pages, filename: donationReceiptFilename(receipt) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
