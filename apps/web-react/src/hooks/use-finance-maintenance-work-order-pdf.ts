import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  maintenanceWorkOrderDocument,
  maintenanceWorkOrderFilename,
} from '@/lib/pdf/templates/finance-maintenance-work-order.ts'

/**
 * Arıza iş emri PDF'i (DOM-FIN-089; ON-239). Veri belge açılınca uçtan okunur ki son geçiş belgede
 * olsun; jsPDF yalnız bu noktada dinamik yüklenir. Önbellek ve yeniden üretim zimmet tutanağıyla
 * aynıdır (`use-finance-fixed-asset-assignment-pdf.ts`).
 */
export function useMaintenanceWorkOrderPdf(requestId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'maintenance-work-order', requestId),
    enabled: institutionId !== null && enabled && requestId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/maintenance-requests/{requestId}', {
              params: { path: { requestId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          maintenanceWorkOrderDocument(measurer, response.data, { institution, generatedAt }),
        )
        return { blob, pages, filename: maintenanceWorkOrderFilename(response.data) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
