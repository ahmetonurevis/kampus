import { useQuery } from '@tanstack/react-query'
import type { KampusClient } from '@kampus/api-client/client.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type { ChemicalInventoryRow } from '@kampus/react-shared/use-finance-chemicals.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  chemicalInventoryDocument,
  chemicalInventoryFilename,
} from '@/lib/pdf/templates/finance-chemical-inventory.ts'

/**
 * Kimyasal envanter raporu PDF'i (DOM-FIN-090; ON-234). Ekrandaki süzgeçle eşleşen bütün satırlar
 * belge açılınca uçtan okunur (sayfa sayfa, 100'er); jsPDF yalnız bu noktada dinamik yüklenir.
 */

const PAGE_SIZE = 100

/** Raporun süzgeci ve belgede yazılacak kapsam adı (ör. "Bütün depolar"). */
export type ChemicalInventoryPdfFilter = { warehouseId?: string; q?: string; scope: string }

export async function loadChemicalInventory(
  client: KampusClient,
  filter: Omit<ChemicalInventoryPdfFilter, 'scope'>,
  signal?: AbortSignal,
): Promise<ChemicalInventoryRow[]> {
  const rows: ChemicalInventoryRow[] = []
  for (let page = 1; ; page += 1) {
    const response = await runRequest(() =>
      client.GET('/api/v1/finance/chemical-inventory', {
        params: { query: { ...filter, page, pageSize: PAGE_SIZE } },
        ...(signal ? { signal } : {}),
      }),
    )
    rows.push(...response.data)
    if (rows.length >= response.meta.total || response.data.length === 0) return rows
  }
}

export function useChemicalInventoryPdf(filter: ChemicalInventoryPdfFilter, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  const { scope, ...query } = filter
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'chemical-inventory', query),
    enabled: institutionId !== null && enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [rows, { renderPdf }] = await Promise.all([
          loadChemicalInventory(client, query, signal),
          import('@/lib/pdf/render.ts'),
        ])
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          chemicalInventoryDocument(measurer, rows, { institution, generatedAt, scope }),
        )
        return {
          blob,
          pages,
          filename: chemicalInventoryFilename(generatedAt, query.warehouseId !== undefined),
        }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
