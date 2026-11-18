import { useQuery } from '@tanstack/react-query'
import { isApiError } from '@kampus/api-client/errors.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  alumniDocumentFilename,
  alumniDocumentPdf,
} from '@/lib/pdf/templates/enrollment-alumni-document.ts'

/**
 * Mezun belgesi PDF'i (DOM-KAY-044): dondurulmuş içerik pencere açılınca ucundan okunur; her açılış
 * denetim satırıdır, bu yüzden önbelleğe alınmaz ve kendiliğinden yinelenmez. jsPDF yalnız bu
 * noktada dinamik yüklenir. Kural reddinde (hazır değil) sunucunun Türkçe iletisi gösterilir.
 */
export function useAlumniDocumentPdf(requestId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'alumni-document', requestId),
    enabled: institutionId !== null && enabled && requestId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [{ data }, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/prospects/alumni-document-requests/{requestId}/document', {
              params: { path: { requestId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const { blob, pages } = await renderPdf((measurer) => alumniDocumentPdf(measurer, data))
        return { blob, pages, filename: alumniDocumentFilename(data) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(
          isApiError(error) && error.status === 422 ? error.message : documentErrorMessage(error),
          error,
        )
      }
    },
  })
}
