import { useQuery } from '@tanstack/react-query'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { documentErrorMessage, loadDocumentState } from '@/lib/pdf/document-state.ts'
import { homeworkDocument } from '@/lib/pdf/homework-templates.ts'
import {
  contractDocument,
  documentFilename,
  materialDocument,
  paymentPlanDocument,
  receiptDocument,
  type PdfDocumentType,
} from '@/lib/pdf/templates.ts'

export type DocumentPdf = { blob: Blob; pages: number; filename: string }

/** Sorgu hatası: kullanıcıya gösterilecek Türkçe ileti; teknik neden `cause`'ta (loga gider). */
export class DocumentPdfError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'DocumentPdfError'
  }
}

/**
 * Belgeyi hazırlar: kayıtları kapsamlı okur, core `documentData` ile belge verisini kurar,
 * şablonu tembel yüklenen jsPDF ile PDF Blob'una çevirir. `enabled` belge açılana kadar
 * bekletir. Blob önbellekte tutulmaz (`gcTime: 0`) ve pencere odağı dönünce yeniden üretilmez;
 * önizleme, indirme ve yazdırma aynı Blob'u kullanır.
 */
export function useDocumentPdf(
  type: PdfDocumentType,
  recordId: string,
  enabled: boolean,
  studentId?: string,
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(institutionId, 'document-pdf', type, recordId, studentId ?? ''),
    enabled: institutionId !== null && enabled && Boolean(recordId),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const state = await loadDocumentState(
          client,
          { type, recordId, ...(studentId ? { studentId } : {}) },
          signal,
        )
        const options = { institution }
        const { renderPdf } = await import('@/lib/pdf/render.ts')
        const { blob, pages } = await renderPdf((measurer) => {
          switch (type) {
            case 'receipt':
              return receiptDocument(measurer, documentData(state, 'receipt', recordId), options)
            case 'contract':
              return contractDocument(measurer, documentData(state, 'contract', recordId), options)
            case 'material':
              return materialDocument(measurer, documentData(state, 'material', recordId), options)
            case 'payment-plan':
              return paymentPlanDocument(
                measurer,
                documentData(state, 'payment-plan', recordId),
                options,
              )
            case 'homework':
              return homeworkDocument(
                measurer,
                documentData(state, 'homework', recordId, studentId),
                options,
              )
            default:
              return type satisfies never
          }
        })
        return { blob, pages, filename: documentFilename(type, recordId) }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
