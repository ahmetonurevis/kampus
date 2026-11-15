import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'

export type ScholarshipEndPdfTarget = { awardId: string; studentName: string }

/**
 * Burs kesme bildirimi ya da geri isteme yazısı PDF'i (DOM-FIN-025; ON-283). Kayıt belge açılınca
 * okunur; son karar (iptal kesmeden sonra gelir) belgelenir. jsPDF ve şablon yalnız bu noktada
 * dinamik yüklenir.
 */
export function useScholarshipEndPdf(target: ScholarshipEndPdfTarget, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  const institutionType = session?.institution.type
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'scholarship-end', target.awardId),
    enabled: institutionId !== null && enabled && target.awardId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }, template] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/scholarship-awards/{awardId}/ends', {
              params: { path: { awardId: target.awardId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
          import('@/lib/pdf/templates/finance-scholarship-end.ts'),
        ])
        const { ends, programName } = response.data
        const record = ends.find((item) => item.kind === 'revoke') ?? ends.at(-1)
        if (record === undefined) throw new Error('scholarship end record missing')
        const { blob, pages } = await renderPdf((measurer) =>
          template.scholarshipEndDocument(
            measurer,
            record,
            { programName, studentName: target.studentName, institutionType },
            { institution },
          ),
        )
        return { blob, pages, filename: template.scholarshipEndFilename(record) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
