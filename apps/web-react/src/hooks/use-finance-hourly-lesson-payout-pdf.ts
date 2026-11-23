import { useQuery } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import type { PdfDocument, TextMeasurer } from '@/lib/pdf/layout.ts'

/**
 * Ders saati hakediş dökümü PDF'leri (DOM-FIN-167; ON-075). Veri pencere açılınca `purpose=pdf` ile
 * yeniden okunur: her PDF üretimi `finance.hourly_lesson_payout.export` denetimine düşer ve taze
 * oturum ister. jsPDF ve şablon yalnız bu noktada dinamik yüklenir; belge önbellekte tutulmaz.
 */

export type PayoutPdfTarget =
  | { kind: 'summary'; month: string }
  | { kind: 'teacher'; month: string; membershipId: string }
  | { kind: 'own'; month: string }

const targetKey = (target: PayoutPdfTarget) =>
  target.kind === 'teacher'
    ? [target.kind, target.month, target.membershipId]
    : [target.kind, target.month]

export function useHourlyLessonPayoutPdf(target: PayoutPdfTarget, enabled: boolean) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(
      institutionId,
      'document-pdf',
      'hourly-lesson-payout',
      ...targetKey(target),
    ),
    enabled: institutionId !== null && enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        const [template, { renderPdf }] = await Promise.all([
          import('@/lib/pdf/templates/finance-hourly-lesson-payout.ts'),
          import('@/lib/pdf/render.ts'),
        ])
        const query = { purpose: 'pdf' as const }
        let build: (measurer: TextMeasurer) => PdfDocument
        let filename: string
        if (target.kind === 'summary') {
          const { data } = await runRequest(() =>
            client.GET('/api/v1/finance/hourly-lesson-payouts/{month}', {
              params: { path: { month: target.month }, query },
              signal,
            }),
          )
          build = (measurer) =>
            template.hourlyPayoutSummaryDocument(measurer, data, { institution })
          filename = template.hourlyPayoutPdfFilename(target.month)
        } else if (target.kind === 'teacher') {
          const { data } = await runRequest(() =>
            client.GET('/api/v1/finance/hourly-lesson-payouts/{month}/teachers/{membershipId}', {
              params: { path: { month: target.month, membershipId: target.membershipId }, query },
              signal,
            }),
          )
          build = (measurer) => template.hourlyPayoutDetailDocument(measurer, data, { institution })
          filename = template.hourlyPayoutPdfFilename(target.month, target.membershipId)
        } else {
          const { data } = await runRequest(() =>
            client.GET('/api/v1/finance/my-hourly-lesson-payouts/{month}', {
              params: { path: { month: target.month }, query },
              signal,
            }),
          )
          const payout = data.payout
          if (payout === null) throw new Error('own hourly payout is empty')
          build = (measurer) =>
            template.hourlyPayoutDetailDocument(measurer, payout, { institution })
          filename = template.hourlyPayoutPdfFilename(target.month)
        }
        const { blob, pages } = await renderPdf(build)
        return { blob, pages, filename }
      } catch (error) {
        // Pencere kapanınca istek iptal edilir; bu hata değildir.
        if (signal.aborted) throw error
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
