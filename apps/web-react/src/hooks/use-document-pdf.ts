import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { useAuth } from '@/auth/use-auth.ts'
import {
  documentErrorMessage,
  loadDocumentState,
  studentDisplayName,
  studentPaidCents,
} from '@/lib/pdf/document-state.ts'
import { certificateVerificationUrl } from '@/lib/certificate-verification.ts'
import { contractDocument } from '@/lib/pdf/templates/contract.ts'
import { courseCertificateDocument } from '@/lib/pdf/templates/course-certificate.ts'
import { studentStatementDocument } from '@/lib/pdf/templates/finance-statement.ts'
import { homeworkDocument } from '@/lib/pdf/templates/homework.ts'
import { materialDocument } from '@/lib/pdf/templates/material.ts'
import { paymentPlanDocument } from '@/lib/pdf/templates/payment-plan.ts'
import { paymentReceiptDocument, receiptNumberLabel } from '@/lib/pdf/templates/payment-receipt.ts'
import { receiptDocument } from '@/lib/pdf/templates/receipt.ts'
import { refundStatementDocument } from '@/lib/pdf/templates/refund-statement.ts'
import { documentFilename, type PdfDocumentType } from '@/lib/pdf/templates/shared.ts'
import { submissionDocument } from '@/lib/pdf/templates/submission.ts'

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
        const options = { institution }
        const { renderPdf } = await import('@/lib/pdf/render.ts')
        if (type === 'payment-receipt') {
          const { data } = await runRequest(() =>
            client.GET('/api/v1/payments/{paymentId}', {
              params: { path: { paymentId: recordId } },
              signal,
            }),
          )
          const { blob, pages } = await renderPdf((measurer) =>
            paymentReceiptDocument(measurer, data, options),
          )
          return { blob, pages, filename: documentFilename(type, receiptNumberLabel(data)) }
        }
        if (type === 'refund-statement') {
          const { data } = await runRequest(() =>
            client.GET('/api/v1/withdrawals/{withdrawalId}', {
              params: { path: { withdrawalId: recordId } },
              signal,
            }),
          )
          const { blob, pages } = await renderPdf((measurer) =>
            refundStatementDocument(measurer, data, options),
          )
          return { blob, pages, filename: documentFilename(type, recordId) }
        }
        if (type === 'course-certificate') {
          // Belge içeriği düzenleme anının kopyasıdır (DOM-DIL-081); kapsam ayrıntı ucundadır.
          // QR paketi yalnız bu belgede yüklenir; adres uygulamanın yayınlandığı kökten kurulur.
          const [{ data }, { qrMatrix }] = await Promise.all([
            runRequest(() =>
              client.GET('/api/v1/course-certificates/{certificateId}', {
                params: { path: { certificateId: recordId } },
                signal,
              }),
            ),
            import('@/lib/pdf/qr.ts'),
          ])
          const verificationUrl = certificateVerificationUrl(
            new URL(import.meta.env.BASE_URL, window.location.origin).href,
            data.verificationCode,
          )
          const { blob, pages } = await renderPdf((measurer) =>
            courseCertificateDocument(measurer, data, {
              verificationUrl,
              qr: qrMatrix(verificationUrl),
            }),
          )
          return { blob, pages, filename: documentFilename(type, data.number) }
        }
        if (type === 'student-statement') {
          // Kayıt kimliği öğrenci kimliğidir. Bakiye ve satırlar API ekstresinden gelir; burada
          // yeniden hesaplanmaz (DOM-FIN-054). Kapsam ekstre ucundadır.
          const [{ data }, studentName] = await Promise.all([
            runRequest(() =>
              client.GET('/api/v1/finance/students/{studentId}/statement', {
                params: { path: { studentId: recordId } },
                signal,
              }),
            ),
            studentDisplayName(client, recordId, signal),
          ])
          const { blob, pages } = await renderPdf((measurer) =>
            studentStatementDocument(measurer, data, { ...options, studentName }),
          )
          return { blob, pages, filename: documentFilename(type, recordId) }
        }
        // Taahhütnamede kayıt kimliği öğrenci kimliğidir; bakiye belge kayıtlarıyla paralel okunur.
        const [state, collectedCents] = await Promise.all([
          loadDocumentState(
            client,
            { type, recordId, ...(studentId ? { studentId } : {}) },
            signal,
          ),
          type === 'payment-plan' ? studentPaidCents(client, recordId, signal) : undefined,
        ])
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
                collectedCents === undefined ? options : { ...options, collectedCents },
              )
            case 'homework':
              return homeworkDocument(
                measurer,
                documentData(state, 'homework', recordId, studentId),
                options,
              )
            case 'submission':
              return submissionDocument(
                measurer,
                documentData(state, 'submission', recordId),
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
