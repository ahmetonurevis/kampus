import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  staffSeparationDocument,
  staffSeparationFilename,
} from '@/lib/pdf/templates/finance-staff-separation.ts'

/**
 * İlişik kesme belgesi PDF'i (DOM-FIN-118). Veri belge açılınca belge ucundan okunur, önbelleğe
 * alınmaz (adımlar zimmet ve hesap durumundan değişir). Önizleme, indirme ve yazdırma aynı Blob'u
 * kullanır. jsPDF yalnız bu noktada dinamik yüklenir.
 */
export function useStaffSeparationPdf(separationId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'staff-separation', separationId),
    enabled: institutionId !== null && enabled && separationId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/staff-separations/{separationId}/document', {
              params: { path: { separationId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const separation = response.data
        const { blob, pages } = await renderPdf((measurer) =>
          staffSeparationDocument(measurer, separation),
        )
        return { blob, pages, filename: staffSeparationFilename(separation) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
