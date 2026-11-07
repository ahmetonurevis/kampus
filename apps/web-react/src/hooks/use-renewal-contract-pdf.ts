import { useQuery } from '@tanstack/react-query'
import type { KampusClient } from '@kampus/api-client/client.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage, loadDocumentState } from '@/lib/pdf/document-state.ts'
import { contractDocument } from '@/lib/pdf/templates/contract.ts'
import type {
  PriceIndexSource,
  RenewalContractContext,
} from '@/lib/pdf/templates/renewal-contract.ts'
import { documentFilename } from '@/lib/pdf/templates/shared.ts'

export type RenewalContractRequest = {
  renewalId: string
  /** Yenileme kaydının sürümü: kayıt değişince belge yeniden üretilir. */
  version: number
  contractId: string
  studentId: string
  /** Yenileme ayrıntısından (`GET /finance/renewals/:id`) dönem geçişi ve ücret kararı. */
  context: Omit<RenewalContractContext, 'rateSources'>
  /** ÜFE/TÜFE profili yalnız yönetici ve ön büroya açıktır; veli belgesi kaynağı genel yazar. */
  canReadRates: boolean
}

/**
 * Oranların kaynağı kurum profilindedir (yıl başına tek satır, 100'ü aşmaz). Okunamazsa belge
 * engellenmez: kaynak genel cümleyle yazılır, neden loga gider.
 */
async function rateSources(
  client: KampusClient,
  signal: AbortSignal,
): Promise<PriceIndexSource[] | undefined> {
  try {
    const { data } = await runRequest(() =>
      client.GET('/api/v1/finance/renewals/price-indexes', {
        params: { query: { page: 1, pageSize: 100 } },
        signal,
      }),
    )
    return data
  } catch (error) {
    if (signal.aborted) throw error
    console.error('[kampus]', 'pdf-rate-sources', error)
    return undefined
  }
}

/**
 * Yenileme sözleşmesi PDF'i (IST-100): sözleşme belgesi `useDocumentPdf` ile aynı kayıtlardan
 * kurulur; şablona yenilemenin plan anındaki ücret kararı eklenir (DOM-FIN-005, DOM-FIN-023).
 * Önbellek ve yeniden üretim davranışı `useDocumentPdf` ile aynıdır.
 */
export function useRenewalContractPdf(request: RenewalContractRequest, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  // Yenileme bugün yalnız okulda açıktır; tür yine geçirilir ki terim şablonla tek yerden seçilsin.
  const institutionType = session?.institution.type
  const { renewalId, version, contractId, studentId, context, canReadRates } = request
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(
      institutionId,
      'document-pdf',
      'renewal-contract',
      renewalId,
      String(version),
      contractId,
    ),
    enabled: institutionId !== null && enabled && Boolean(contractId),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [{ renderPdf }, state, sources] = await Promise.all([
          import('@/lib/pdf/render.ts'),
          loadDocumentState(client, { type: 'contract', recordId: contractId, studentId }, signal),
          canReadRates && context.pricing?.ceiling.status === 'applied'
            ? rateSources(client, signal)
            : undefined,
        ])
        const renewal: RenewalContractContext = sources
          ? { ...context, rateSources: sources }
          : context
        const { blob, pages } = await renderPdf((measurer) =>
          contractDocument(measurer, documentData(state, 'contract', contractId), {
            institution,
            renewal,
            ...(institutionType ? { institutionType } : {}),
          }),
        )
        return { blob, pages, filename: documentFilename('contract', contractId) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
