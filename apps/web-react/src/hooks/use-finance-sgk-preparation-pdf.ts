import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  sgkPreparationDocument,
  sgkPreparationPdfFilename,
} from '@/lib/pdf/templates/finance-sgk-preparation.ts'

/**
 * SGK bildirge hazırlık listesi PDF'i (DOM-FIN-107; ON-203). Liste pencere açılınca `purpose=pdf`
 * ile yeniden okunur: her PDF üretimi `finance.sgk_preparation_export` denetimine düşer ve taze
 * oturum ister (K-355). jsPDF yalnız bu noktada dinamik yüklenir; belge önbellekte tutulmaz.
 */
export function useSgkPreparationPdf(month: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'sgk-preparation', month),
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
            client.GET('/api/v1/finance/sgk-preparation', {
              params: { query: { month, purpose: 'pdf' } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const { blob, pages } = await renderPdf((measurer) =>
          sgkPreparationDocument(measurer, data, { institution }),
        )
        return { blob, pages, filename: sgkPreparationPdfFilename(month) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
