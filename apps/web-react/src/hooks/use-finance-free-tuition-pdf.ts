import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  freeTuitionMinutesDocument,
  freeTuitionMinutesFilename,
} from '@/lib/pdf/templates/finance-free-tuition-minutes.ts'

/**
 * Ücretsiz okutma kurul tutanağı PDF'i (DOM-FIN-026; ON-284, K-270). Veri belge açılınca uçtan
 * okunur; jsPDF yalnız bu noktada dinamik yüklenir. Önbellek iş emri belgesiyle aynıdır
 * (`use-finance-maintenance-work-order-pdf.ts`).
 */
export function useFreeTuitionMinutesPdf(meetingId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'free-tuition-minutes', meetingId),
    enabled: institutionId !== null && enabled && meetingId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/free-tuition/board-meetings/{meetingId}', {
              params: { path: { meetingId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          freeTuitionMinutesDocument(measurer, response.data, { institution, generatedAt }),
        )
        return { blob, pages, filename: freeTuitionMinutesFilename(response.data) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
