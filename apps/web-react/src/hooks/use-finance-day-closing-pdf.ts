import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  dayClosingFilename,
  financeDayClosingDocument,
} from '@/lib/pdf/templates/finance-day-closing.ts'

/**
 * Gün sonu PDF'i (IST-113): rapor belge açılınca ucundan okunur ki ekrandan sonra girilen tahsilat
 * da belgeye yansısın. jsPDF yalnız bu noktada dinamik yüklenir. Önbellek ve yeniden üretim
 * `useDocumentPdf` ile aynıdır.
 */
export function useFinanceDayClosingPdf(closingDate: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  // Tahsilat ve iptal tablolarının kişi sütunu kurum türüyle adlandırılır (DOM-KAY-012).
  const institutionType = session?.institution.type
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'finance-day-closing', closingDate),
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
            client.GET('/api/v1/finance/day-closings/{closingDate}', {
              params: { path: { closingDate } },
              signal,
            }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const { blob, pages } = await renderPdf((measurer) =>
          financeDayClosingDocument(measurer, data, {
            institution,
            ...(institutionType ? { institutionType } : {}),
          }),
        )
        return { blob, pages, filename: dayClosingFilename(closingDate) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
