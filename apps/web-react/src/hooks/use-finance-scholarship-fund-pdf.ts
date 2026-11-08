import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  scholarshipFundReportDocument,
  scholarshipFundReportFilename,
} from '@/lib/pdf/templates/finance-scholarship-fund.ts'

/**
 * Burs fonu raporu PDF'i (DOM-FIN-068). Veri belge açılınca rapor ucundan okunur ki ekrandan sonra
 * girilen bağış da belgeye yansısın; jsPDF yalnız bu noktada dinamik yüklenir. Öğrenci adı
 * yanıttaki gibidir (yalnız yöneticide dolu).
 */
export function useScholarshipFundPdf(fundId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'scholarship-fund', fundId),
    enabled: institutionId !== null && enabled && fundId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/scholarship-funds/{fundId}/report', {
              params: { path: { fundId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const report = response.data
        const { blob, pages } = await renderPdf((measurer) =>
          scholarshipFundReportDocument(measurer, report, { institution }),
        )
        return { blob, pages, filename: scholarshipFundReportFilename(report.fund.name) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
