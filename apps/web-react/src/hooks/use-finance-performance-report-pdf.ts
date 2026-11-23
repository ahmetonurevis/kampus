import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  performanceReportDocument,
  performanceReportFilename,
} from '@/lib/pdf/templates/finance-performance-report.ts'

/**
 * Performans raporu PDF'i (DOM-FIN-137; ON-220). Veri belge açılınca rapor ucundan `purpose=pdf`
 * ile okunur; sunucu her üretimi `finance.performance_report.export` denetimine yazar (K-468).
 * jsPDF yalnız bu noktada dinamik yüklenir; önbellek tutulmaz (`gcTime: 0`), kişisel veri pencere
 * kapanınca bırakılır. Kalıp zümre tutanağı PDF'iyle aynıdır (`use-finance-department-meeting-pdf.ts`).
 */
export function usePerformanceReportPdf(reviewId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'performance-report', reviewId),
    enabled: institutionId !== null && enabled && reviewId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/performance-reviews/{reviewId}/report', {
              params: { path: { reviewId }, query: { purpose: 'pdf' } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          performanceReportDocument(measurer, response.data, { institution, generatedAt }),
        )
        return { blob, pages, filename: performanceReportFilename(response.data) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
