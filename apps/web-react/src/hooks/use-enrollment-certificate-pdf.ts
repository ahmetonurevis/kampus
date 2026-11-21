import { useQuery } from '@tanstack/react-query'
import { isApiError } from '@kampus/api-client/errors.ts'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  enrollmentCertificateDocument,
  enrollmentCertificateFilename,
} from '@/lib/pdf/templates/enrollment-certificate.ts'

/** Kural reddinde (ayrılan, mezun) sunucunun Türkçe iletisi; başka hatada genel ileti. */
export function enrollmentCertificateErrorMessage(error: unknown): string {
  return isApiError(error) && error.status === 422 ? error.message : documentErrorMessage(error)
}

/** Belgeyi kimin aldığı: uç, rol ve modül kapısı ayrıdır (K-32); personel `crm`, aile `finance`. */
export type EnrollmentCertificateAudience = 'staff' | 'family'

/**
 * Öğrenci belgesi PDF'i (DOM-KAY-027): içerik belge açılınca ucundan okunur; her açılış yeni belge
 * kimliği ve denetim satırıdır, bu yüzden önbelleğe alınmaz, pencere odağıyla yeniden üretilmez ve
 * kendiliğinden yinelenmez. jsPDF yalnız bu noktada dinamik yüklenir.
 */
export function useEnrollmentCertificatePdf(
  studentId: string,
  enabled: boolean,
  audience: EnrollmentCertificateAudience = 'staff',
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(
      institutionId,
      'document-pdf',
      'enrollment-certificate',
      audience,
      studentId,
    ),
    enabled: institutionId !== null && enabled && studentId !== '',
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [{ data }, { renderPdf }] = await Promise.all([
          runRequest(() =>
            audience === 'family'
              ? client.GET('/api/v1/finance/students/{studentId}/enrollment-certificate', {
                  params: { path: { studentId } },
                  signal,
                })
              : client.GET('/api/v1/prospects/students/{studentId}/enrollment-certificate', {
                  params: { path: { studentId } },
                  signal,
                }),
          ),
          import('@/lib/pdf/render.ts'),
        ])
        const { blob, pages } = await renderPdf((measurer) =>
          enrollmentCertificateDocument(measurer, data),
        )
        return {
          blob,
          pages,
          filename: enrollmentCertificateFilename(data.institutionType, data.documentId),
        }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(enrollmentCertificateErrorMessage(error), error)
      }
    },
  })
}
