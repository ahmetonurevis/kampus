import { useQuery } from '@tanstack/react-query'
import type { KampusClient } from '@kampus/api-client/client.ts'
import {
  fetchAllCollectionPages,
  fetchCollectionItem,
  isUnreadableCollectionError,
} from '@kampus/react-shared/collections.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type { OwnContract } from '@kampus/react-shared/use-contract-self-service.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import { contractDocument } from '@/lib/pdf/templates/contract.ts'
import { documentFilename } from '@/lib/pdf/templates/shared.ts'
import { buildWorkflowState } from '../pages/workflows/workflow-state.ts'

type CollectionRecord<K extends keyof State> = State[K] extends readonly (infer T)[] ? T : never

/** Yardımcı kayıt okunamazsa (rol, modül) belge o alanı "—" yazar; başka hata belgeyi engeller. */
async function optionalItem<K extends 'classes' | 'branches' | 'parents'>(
  client: KampusClient,
  collection: K,
  id: string | undefined,
  signal: AbortSignal,
): Promise<CollectionRecord<K>[]> {
  if (!id) return []
  try {
    return [(await fetchCollectionItem<CollectionRecord<K>>(client, collection, id, signal)).record]
  } catch (error) {
    if (isUnreadableCollectionError(error)) return []
    throw error
  }
}

/**
 * Yetişkin kursiyerin sözleşme PDF'i (IST-082, DOM-FIN-059, DOM-FIN-051). Kursiyer sözleşme
 * koleksiyonunu okumaz: kayıt kendi sözleşmeler ucundan gelir (`useOwnContracts`), öğrenci, sınıf,
 * şube ve taksitler kapsamlı koleksiyon okumasıyla; belge veli ve personelin gördüğü şablonla
 * (`contractDocument`, kurum türüyle "kursiyer" terimi) üretilir. Önbellek ve yeniden üretim
 * davranışı `useDocumentPdf` ile aynıdır.
 */
export function useOwnContractPdf(item: OwnContract, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  const institutionType = session?.institution.type
  const { contract } = item
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', 'own-contract', contract.id),
    enabled: institutionId !== null && enabled,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [{ renderPdf }, student, invoices] = await Promise.all([
          import('@/lib/pdf/render.ts'),
          fetchCollectionItem<CollectionRecord<'students'>>(
            client,
            'students',
            contract.studentId,
            signal,
          ),
          fetchAllCollectionPages<CollectionRecord<'invoices'>>(
            client,
            'invoices',
            { filters: { studentId: contract.studentId } },
            signal,
          ),
        ])
        const [classes, parents] = await Promise.all([
          optionalItem(client, 'classes', contract.classId ?? student.record.classId, signal),
          optionalItem(client, 'parents', student.record.parentId, signal),
        ])
        const branches = await optionalItem(client, 'branches', classes[0]?.branchId, signal)
        const state = buildWorkflowState(
          {
            contracts: [contract],
            students: [student.record],
            invoices: invoices.map((row) => row.record),
            classes,
            parents,
            branches,
          },
          { modules: {}, academicYear: null },
        )
        const { blob, pages } = await renderPdf((measurer) =>
          contractDocument(measurer, documentData(state, 'contract', contract.id), {
            institution,
            ...(institutionType ? { institutionType } : {}),
          }),
        )
        return { blob, pages, filename: documentFilename('contract', contract.id) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
