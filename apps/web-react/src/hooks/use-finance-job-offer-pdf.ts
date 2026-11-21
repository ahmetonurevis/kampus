import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  jobOfferLetterDocument,
  jobOfferLetterFilename,
} from '@/lib/pdf/templates/finance-job-offer.ts'

/**
 * İş teklif mektubu PDF'i (DOM-FIN-121; K-412). İçerik mektup açılınca mektup ucundan okunur (aday
 * adı ve ücret; okuma denetlenir); önbelleğe alınmaz. Önizleme, indirme ve yazdırma aynı Blob'u
 * kullanır. jsPDF yalnız bu noktada dinamik yüklenir.
 */
export function useJobOfferLetterPdf(offerId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'job-offer-letter', offerId),
    enabled: institutionId !== null && enabled && offerId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/job-offers/{offerId}/letter', {
              params: { path: { offerId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const letter = response.data
        const { blob, pages } = await renderPdf((measurer) =>
          jobOfferLetterDocument(measurer, letter),
        )
        return { blob, pages, filename: jobOfferLetterFilename(letter) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
