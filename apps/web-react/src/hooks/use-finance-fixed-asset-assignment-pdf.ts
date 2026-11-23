import { useQuery } from '@tanstack/react-query'
import type { KampusClient } from '@kampus/api-client/client.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type { FixedAssetAssignment } from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  fixedAssetAssignmentDocument,
  fixedAssetAssignmentFilename,
} from '@/lib/pdf/templates/finance-fixed-asset-assignment.ts'

/**
 * Demirbaş zimmet tutanağı PDF'i (DOM-FIN-086; ON-236). Veri belge açılınca uçtan okunur ki iade
 * ya da yeni zimmet sonrası belge güncel olsun; jsPDF yalnız bu noktada dinamik yüklenir. Önbellek
 * ve yeniden üretim sipariş PDF'iyle aynıdır (`use-finance-purchase-order-pdf.ts`).
 */

const PAGE_SIZE = 100

type Load = (client: KampusClient, signal: AbortSignal) => Promise<FixedAssetAssignment[]>

function useAssignmentPdf(kind: string, id: string, enabled: boolean, load: Load) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', kind, id),
    enabled: institutionId !== null && enabled && id !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [assignments, { renderPdf }] = await Promise.all([
          load(client, signal),
          import('@/lib/pdf/render.ts'),
        ])
        if (assignments.length === 0)
          throw new DocumentPdfError('Bu personelin açık zimmeti yok; tutanak oluşturulmadı.', null)
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          fixedAssetAssignmentDocument(measurer, assignments, { institution, generatedAt }),
        )
        return { blob, pages, filename: fixedAssetAssignmentFilename(assignments, generatedAt) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}

/** Tek zimmetin tutanağı (iade edildiyse iade bilgisiyle). */
export function useFixedAssetAssignmentPdf(assignmentId: string, enabled: boolean) {
  return useAssignmentPdf(
    'fixed-asset-assignment',
    assignmentId,
    enabled,
    async (client, signal) => {
      const response = await runRequest(() =>
        client.GET('/api/v1/finance/fixed-asset-assignments/{assignmentId}', {
          params: { path: { assignmentId } },
          signal,
        }),
      )
      return [response.data]
    },
  )
}

/** Personelin bütün açık zimmetlerinin tek tutanağı (ilişik kesme ve toplu teslim; K-214). */
export function useStaffAssignmentsPdf(membershipId: string, enabled: boolean) {
  return useAssignmentPdf('staff-assignments', membershipId, enabled, async (client, signal) => {
    const items: FixedAssetAssignment[] = []
    for (let page = 1; ; page += 1) {
      const response = await runRequest(() =>
        client.GET('/api/v1/finance/fixed-asset-assignments', {
          params: { query: { membershipId, state: 'open', page, pageSize: PAGE_SIZE } },
          signal,
        }),
      )
      items.push(...response.data)
      if (items.length >= response.meta.total || response.data.length === 0) return items
    }
  })
}
