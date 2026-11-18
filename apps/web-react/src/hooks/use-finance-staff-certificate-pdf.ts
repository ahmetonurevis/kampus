import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  staffCertificateDocument,
  staffCertificateFilename,
} from '@/lib/pdf/templates/finance-staff-certificate.ts'

/**
 * Personel belgesi PDF'i (DOM-FIN-106). İçerik belge açılınca belge ucundan okunur (T.C. kimlik no
 * ve ücret yalnız orada döner, okuma denetlenir; K-343); önbelleğe alınmaz. Önizleme, indirme ve
 * yazdırma aynı Blob'u kullanır. jsPDF yalnız bu noktada dinamik yüklenir.
 */
export function useStaffCertificatePdf(certificateId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'staff-certificate', certificateId),
    enabled: institutionId !== null && enabled && certificateId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [response, { renderPdf }] = await Promise.all([
          runRequest(() =>
            client.GET('/api/v1/finance/staff-certificates/{certificateId}/document', {
              params: { path: { certificateId } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const certificate = response.data
        const { blob, pages } = await renderPdf((measurer) =>
          staffCertificateDocument(measurer, certificate),
        )
        return { blob, pages, filename: staffCertificateFilename(certificate) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
