import { useQuery } from '@tanstack/react-query'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  fixedAssetLabelsDocument,
  fixedAssetLabelsFilename,
} from '@/lib/pdf/templates/finance-fixed-asset-labels.ts'

/**
 * Demirbaş etiket sayfası PDF'i (DOM-FIN-087; ON-237). Etiketler listede seçilen demirbaşlardır;
 * karekod yalnız etiket numarasını taşır. jsPDF ve karekod paketi (`qr`, `lib/pdf/qr.ts`) yalnız
 * belge açılınca dinamik yüklenir; sayfa parçasına girmez.
 */

export type LabelAsset = { id: string; tagNumber: string; name: string }

export function useFixedAssetLabelPdf(assets: readonly LabelAsset[], enabled: boolean) {
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(
      institutionId,
      'document-pdf',
      'fixed-asset-labels',
      assets.map((asset) => `${asset.id}:${asset.tagNumber}`).join(','),
    ),
    enabled: institutionId !== null && enabled && assets.length > 0,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      try {
        const [{ renderPdf }, { qrMatrix }] = await Promise.all([
          import('@/lib/pdf/render.ts'),
          import('@/lib/pdf/qr.ts'),
        ])
        const labels = assets.map((asset) => ({
          tagNumber: asset.tagNumber,
          name: asset.name,
          qr: qrMatrix(asset.tagNumber),
        }))
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          fixedAssetLabelsDocument(measurer, labels, { institution, generatedAt }),
        )
        return { blob, pages, filename: fixedAssetLabelsFilename(labels, generatedAt) }
      } catch (error) {
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
