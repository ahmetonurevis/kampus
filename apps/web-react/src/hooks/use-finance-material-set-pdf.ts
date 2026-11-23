import { useQuery } from '@tanstack/react-query'
import type { KampusClient } from '@kampus/api-client/client.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type {
  MaterialStudentQuery,
  MaterialStudentRow,
} from '@kampus/react-shared/use-finance-material-sets.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import type { PdfDocument, TextMeasurer } from '@/lib/pdf/layout.ts'
import {
  materialDeliveryDocument,
  materialDeliveryFilename,
  materialDeliveryListDocument,
  materialDeliveryListFilename,
} from '@/lib/pdf/templates/finance-material-set-delivery.ts'

/**
 * Materyal seti teslim tutanağı ve toplu teslim listesi PDF'leri (DOM-FIN-080; ON-338). Veri belge
 * açılınca uçtan okunur ki imza ya da iptal sonrası belge güncel olsun; jsPDF yalnız bu noktada
 * dinamik yüklenir. Önbellek ve yeniden üretim zimmet tutanağıyla aynıdır
 * (`use-finance-fixed-asset-assignment-pdf.ts`).
 */

const PAGE_SIZE = 100

type Built = { draw: (measurer: TextMeasurer) => PdfDocument; filename: string }
type Context = Parameters<typeof materialDeliveryDocument>[2] & { generatedAt: Date }
type Build = (client: KampusClient, signal: AbortSignal, context: Context) => Promise<Built>

function useMaterialPdf(key: readonly unknown[], enabled: boolean, build: Build) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  const institutionType = session?.institution.type
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', ...key),
    enabled: institutionId !== null && enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const generatedAt = new Date()
        const [built, { renderPdf }] = await Promise.all([
          build(client, signal, {
            institution,
            generatedAt,
            ...(institutionType ? { institutionType } : {}),
          }),
          import('@/lib/pdf/render.ts'),
        ])
        const { blob, pages } = await renderPdf(built.draw)
        return { blob, pages, filename: built.filename }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted || error instanceof DocumentPdfError) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}

/** Tek teslimin tutanağı; iptal edilmiş teslimde "İPTAL" işaretiyle (K-218). */
export function useMaterialDeliveryPdf(deliveryId: string, enabled: boolean) {
  return useMaterialPdf(
    ['material-delivery', deliveryId],
    enabled && deliveryId !== '',
    async (client, signal, context) => {
      const response = await runRequest(() =>
        client.GET('/api/v1/finance/material-deliveries/{deliveryId}', {
          params: { path: { deliveryId } },
          signal,
        }),
      )
      const delivery = response.data
      return {
        draw: (measurer) => materialDeliveryDocument(measurer, delivery, context),
        filename: materialDeliveryFilename(delivery),
      }
    },
  )
}

export type MaterialDeliveryListRef = {
  setId: string
  query: MaterialStudentQuery
  /** Ekrandaki süzgecin kısa açıklaması (belgede "Liste" alanı). */
  filter: string
}

/** Setin toplu teslim listesi: ekrandaki süzgeçle eşleşen bütün öğrenciler (K-219). */
export function useMaterialDeliveryListPdf(ref: MaterialDeliveryListRef, enabled: boolean) {
  const { setId, query, filter } = ref
  return useMaterialPdf(
    ['material-delivery-list', setId, query],
    enabled && setId !== '',
    async (client, signal, context) => {
      const [set, rows] = await Promise.all([
        runRequest(() =>
          client.GET('/api/v1/finance/material-sets/{setId}', {
            params: { path: { setId } },
            signal,
          }),
        ),
        (async () => {
          const items: MaterialStudentRow[] = []
          for (let page = 1; ; page += 1) {
            const response = await runRequest(() =>
              client.GET('/api/v1/finance/material-sets/{setId}/students', {
                params: { path: { setId }, query: { ...query, page, pageSize: PAGE_SIZE } },
                signal,
              }),
            )
            items.push(...response.data)
            if (items.length >= response.meta.total || response.data.length === 0) return items
          }
        })(),
      ])
      if (rows.length === 0)
        throw new DocumentPdfError('Bu seçimle eşleşen öğrenci yok; liste oluşturulmadı.', null)
      return {
        draw: (measurer) =>
          materialDeliveryListDocument(measurer, { set: set.data, rows, filter }, context),
        filename: materialDeliveryListFilename(set.data, context.generatedAt),
      }
    },
  )
}
