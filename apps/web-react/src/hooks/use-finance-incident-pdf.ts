import { useQuery } from '@tanstack/react-query'
import {
  healthAccessReasonHeaders,
  type HealthAccessReason,
} from '@kampus/school-core/lib/finance-health-access.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  incidentReportDocument,
  incidentReportFilename,
} from '@/lib/pdf/templates/finance-incident-report.ts'

/**
 * Kaza tutanağı PDF'i (DOM-FIN-146; ON-162). Veri belge açılınca yöneticinin ayrıntı ucundan okunur
 * (okuma panelde seçilen erişim gerekçesiyle denetime düşer, DOM-FIN-156); jsPDF yalnız bu noktada dinamik yüklenir. Önbellek tutulmaz: sağlık
 * verisi belge kapanınca bellekten düşer.
 */
export function useIncidentReportPdf(
  { incidentId, reason }: { incidentId: string; reason: HealthAccessReason },
  enabled: boolean,
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(
      institutionId,
      'document-pdf',
      'incident-report',
      incidentId,
      reason.code,
      reason.note,
    ),
    enabled: institutionId !== null && enabled && incidentId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/incidents/{incidentId}', {
              params: { path: { incidentId }, header: healthAccessReasonHeaders(reason) },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          incidentReportDocument(measurer, response.data, { institution, generatedAt }),
        )
        return { blob, pages, filename: incidentReportFilename(response.data) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
