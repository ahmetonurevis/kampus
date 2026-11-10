import { useQuery } from '@tanstack/react-query'
import type { KampusClient } from '@kampus/api-client/client.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type {
  FixedAssetCount,
  FixedAssetCountItem,
} from '@kampus/react-shared/use-finance-fixed-asset-counts.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  fixedAssetCountDocument,
  fixedAssetCountFilename,
} from '@/lib/pdf/templates/finance-fixed-asset-count.ts'

/**
 * Demirbaş sayım tutanağı PDF'i (DOM-FIN-087; ON-237). Sayım ve bütün satırları belge açılınca
 * uçtan okunur (sayfa sayfa, 100'er); jsPDF yalnız bu noktada dinamik yüklenir. CSV de aynı
 * satırları kullanır (`loadFixedAssetCountReport`).
 */

const PAGE_SIZE = 100

export async function loadFixedAssetCountReport(
  client: KampusClient,
  countId: string,
  signal?: AbortSignal,
): Promise<{ count: FixedAssetCount; items: FixedAssetCountItem[] }> {
  const count = await runRequest(() =>
    client.GET('/api/v1/finance/fixed-asset-counts/{countId}', {
      params: { path: { countId } },
      ...(signal ? { signal } : {}),
    }),
  )
  const items: FixedAssetCountItem[] = []
  for (let page = 1; ; page += 1) {
    const response = await runRequest(() =>
      client.GET('/api/v1/finance/fixed-asset-counts/{countId}/items', {
        params: { path: { countId }, query: { page, pageSize: PAGE_SIZE } },
        ...(signal ? { signal } : {}),
      }),
    )
    items.push(...response.data)
    if (items.length >= response.meta.total || response.data.length === 0)
      return { count: count.data, items }
  }
}

export function useFixedAssetCountPdf(countId: string, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'fixed-asset-count', countId),
    enabled: institutionId !== null && enabled && countId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [{ count, items }, { renderPdf }] = await Promise.all([
          loadFixedAssetCountReport(client, countId, signal),
          import('@/lib/pdf/render.ts'),
        ])
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          fixedAssetCountDocument(measurer, count, items, { institution, generatedAt }),
        )
        return { blob, pages, filename: fixedAssetCountFilename(count) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
