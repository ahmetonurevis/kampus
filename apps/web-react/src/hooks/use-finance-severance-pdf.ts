import { useQuery } from '@tanstack/react-query'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type { SeveranceEstimateResult } from '@kampus/react-shared/use-finance-severance.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  severanceEstimateDocument,
  severanceEstimateFilename,
} from '@/lib/pdf/templates/finance-severance.ts'

/** Ekrandaki hesap: kimlik her hesapta yenidir; sorgu anahtarı ücret taşımaz. */
export type SeverancePdfSource = { calculationId: string; estimate: SeveranceEstimateResult }

/**
 * Kıdem ve ihbar tahmini PDF'i (DOM-FIN-094; ON-205). Veri ekrandaki hesap yanıtıdır, uç yeniden
 * çağrılmaz; jsPDF yalnız pencere açılınca dinamik yüklenir. Belge önbellekte tutulmaz (`gcTime` 0)
 * ve sorgu anahtarında ücret yer almaz (K-273).
 */
export function useSeverancePdf(source: SeverancePdfSource, enabled: boolean) {
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'severance', source.calculationId),
    enabled: institutionId !== null && enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      try {
        const { renderPdf } = await import('@/lib/pdf/render.ts')
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          severanceEstimateDocument(measurer, source.estimate, { institution, generatedAt }),
        )
        return { blob, pages, filename: severanceEstimateFilename(source.estimate) }
      } catch (error) {
        if (error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
