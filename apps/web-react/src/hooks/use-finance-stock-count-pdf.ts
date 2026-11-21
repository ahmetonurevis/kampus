import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import { stockCountDocument, stockCountFilename } from '@/lib/pdf/templates/finance-stock-count.ts'

/**
 * Stok sayımı fark raporu PDF'i (DOM-FIN-081; ON-231). Veri belge açılınca sayım ucundan okunur ki
 * açık sayımda rapor o anki rakamları göstersin; jsPDF yalnız bu noktada dinamik yüklenir. Önbellek
 * ve yeniden üretim mal kabul tutanağıyla aynıdır (`use-finance-purchase-receipt-pdf.ts`).
 */
export function useStockCountPdf(countId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'stock-count', countId),
    enabled: institutionId !== null && enabled && countId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/stock-counts/{countId}', {
              params: { path: { countId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const count = response.data
        const { blob, pages } = await renderPdf((measurer) =>
          stockCountDocument(measurer, count, { institution }),
        )
        return { blob, pages, filename: stockCountFilename(count) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
