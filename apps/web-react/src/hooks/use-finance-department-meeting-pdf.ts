import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  departmentMeetingMinutesDocument,
  departmentMeetingMinutesFilename,
} from '@/lib/pdf/templates/finance-department-meeting-minutes.ts'

/**
 * Zümre toplantısı tutanağı PDF'i (DOM-FIN-132; ON-217). Veri belge açılınca ayrıntı ucundan
 * okunur; jsPDF yalnız bu noktada dinamik yüklenir. Önbellek ücretsiz okutma tutanağıyla aynıdır
 * (`use-finance-free-tuition-pdf.ts`).
 */
export function useDepartmentMeetingMinutesPdf(meetingId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'department-meeting', meetingId),
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
            client.GET('/api/v1/finance/department-meetings/{meetingId}', {
              params: { path: { meetingId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          departmentMeetingMinutesDocument(measurer, response.data, { institution, generatedAt }),
        )
        return { blob, pages, filename: departmentMeetingMinutesFilename(response.data) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
