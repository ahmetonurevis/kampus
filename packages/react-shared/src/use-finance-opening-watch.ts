import { useApiQuery } from './use-api-query.ts'

// Açılış nöbeti kancası (`GET /finance/opening-watch`; DOM-FIN-061, ON-095).

export interface OpeningWatchQuery {
  /** Eğitim yılının başlangıç yılı; verilmezse kurumun etkin yılı. */
  academicYear?: number
  /** Dönem kimliği: pencere dönemin başlangıcına kurulur (dil okulu). */
  termId?: string
  from?: string
  to?: string
}

/**
 * Açılış nöbeti: ilk taksitler, onaysız sözleşmeler, kayıt değişiklikleri ve bekleyen iadeler.
 * Anahtar `payments` altındadır: tahsilat ve iptal sonrası kendiliğinden tazelenir.
 */
export function useFinanceOpeningWatch(query: OpeningWatchQuery = {}) {
  return useApiQuery({
    key: ['payments', 'finance-opening-watch', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/opening-watch', { params: { query }, signal }),
  })
}
