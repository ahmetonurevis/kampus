import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type { FinanceBoardReportQuery } from '@kampus/react-shared/use-finance-board-report.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  boardReportFilename,
  financeBoardReportDocument,
} from '@/lib/pdf/templates/finance-board-report.ts'

/**
 * Yönetim kurulu raporu PDF'i (DOM-FIN-064): rapor belge açılınca ucundan okunur ki ekrandan sonra
 * girilen tahsilat da belgeye yansısın. jsPDF yalnız bu noktada dinamik yüklenir. Önbellek ve
 * yeniden üretim `useDocumentPdf` ile aynıdır.
 */
export function useFinanceBoardReportPdf(query: FinanceBoardReportQuery, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'finance-board-report', query),
    enabled: institutionId !== null && enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [{ data }, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/board-report', { params: { query }, signal }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const { blob, pages } = await renderPdf((measurer) =>
          financeBoardReportDocument(measurer, data, { institution }),
        )
        return { blob, pages, filename: boardReportFilename(data.period) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
