import { useQuery } from '@tanstack/react-query'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import type {
  EventTicketRow,
  TicketedEventRow,
} from '@kampus/react-shared/use-finance-event-tickets.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DocumentPdfError, type DocumentPdf } from '@/hooks/use-document-pdf.ts'
import { documentErrorMessage } from '@/lib/pdf/document-state.ts'
import {
  eventTicketsDocument,
  eventTicketsFilename,
} from '@/lib/pdf/templates/finance-event-ticket.ts'

/**
 * Etkinlik bileti PDF'i (DOM-FIN-103; ON-159). Bilet başına bir sayfa; karekod yalnız bilet kodunu
 * taşır. jsPDF ve karekod paketi (`qr`, `lib/pdf/qr.ts`) yalnız belge açılınca dinamik yüklenir;
 * sayfa parçasına girmez.
 */
export type EventTicketPdfInput = {
  event: Pick<TicketedEventRow, 'id' | 'name' | 'startsAt' | 'venue'> | null
  tickets: readonly EventTicketRow[]
}

export function useEventTicketPdf({ event, tickets }: EventTicketPdfInput, enabled: boolean) {
  const institutionId = useActiveInstitutionId()
  const { session } = useAuth()
  const institution = session?.institution.name ?? 'Kampüs'
  return useQuery<DocumentPdf, DocumentPdfError>({
    queryKey: institutionKey(
      institutionId,
      'document-pdf',
      'event-tickets',
      event?.id ?? '',
      tickets.map((ticket) => `${ticket.id}:${String(ticket.version)}`).join(','),
    ),
    enabled: institutionId !== null && enabled && event !== null && tickets.length > 0,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      if (event === null) throw new DocumentPdfError('Etkinlik bulunamadı.', null)
      try {
        const [{ renderPdf }, { qrMatrix }] = await Promise.all([
          import('@/lib/pdf/render.ts'),
          import('@/lib/pdf/qr.ts'),
        ])
        const printable = tickets.map((ticket) => ({ ...ticket, qr: qrMatrix(ticket.code) }))
        const generatedAt = new Date()
        const { blob, pages } = await renderPdf((measurer) =>
          eventTicketsDocument(measurer, event, printable, { institution, generatedAt }),
        )
        return { blob, pages, filename: eventTicketsFilename(event, printable.length) }
      } catch (error) {
        console.error('[kampus]', 'pdf', error)
        throw new DocumentPdfError(documentErrorMessage(error), error)
      }
    },
  })
}
