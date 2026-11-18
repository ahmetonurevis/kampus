/**
 * İade belgeleri görünümünün adres parçaları (DOM-FIN-096, ON-266). Ayrılış listesi bu sabitlerle
 * bağlantı kurar; tembel yüklenen ekran parçası finans sayfasının ana parçasına girmez.
 */
export const REFUND_INVOICES_VIEW = 'iade-belgesi'
/** Seçili ayrılış iadesi: belge bu iade için hazırlanır. */
export const REFUND_INVOICE_WITHDRAWAL_PARAM = 'iade_kaydi'

/** Ayrılış satırından iade belgeleri görünümüne giden adres sorgusu. */
export const refundInvoicesSearch = (withdrawalId: string) =>
  new URLSearchParams({
    gorunum: REFUND_INVOICES_VIEW,
    [REFUND_INVOICE_WITHDRAWAL_PARAM]: withdrawalId,
  })
