import { z } from 'zod'

import { defineNotificationType, notificationId } from './notification-type.ts'

/**
 * Finans bildirim türleri (docs/domain/finans.md DOM-FIN-035; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-022, -023, -074). Hepsi ticari ileti onayı gerektirmeyen hizmet bildirimidir ve `finance`
 * modülüne bağlıdır. Veri yalnız kayıt kimliği taşır; başlıkta tutar, vade, referans ve IBAN
 * yoktur, kişisel veri olarak yalnız `{öğrenci}` yer alır. 18 yaş altında veliye, yetişkin
 * kursiyerde kendisine gider (kursiyer kendi ödeyicisidir, DOM-FIN-052). Sözleşme türlerinin
 * kitlesi yaş yerine sözleşmenin ödeyicisidir (`contractPayerIsGuardian`).
 */

const PAYMENT_NOTICE = {
  topic: 'payment',
  category: 'service',
  mandatory: false,
  module: 'finance',
  audiences: { minor: ['parent'], adult: ['student'] },
} as const

const invoiceData = z.strictObject({ invoiceId: notificationId })
const contractData = z.strictObject({ contractId: notificationId })

export const FINANCE_NOTIFICATION_TYPES = {
  /** Taksitin vadesi yaklaşıyor (IST-109, DOM-FIN-035). */
  installment_due: defineNotificationType({
    ...PAYMENT_NOTICE,
    subjectType: 'invoices',
    data: invoiceData,
    subjectId: (data) => data.invoiceId,
    titles: {
      student: 'Taksit vaden yaklaşıyor.',
      parent: '{öğrenci} için taksit vadesi yaklaşıyor.',
    },
  }),
  /** Taksitin vadesi geçti, tam ödenmedi (IST-109, DOM-FIN-034, DOM-FIN-035). */
  installment_overdue: defineNotificationType({
    ...PAYMENT_NOTICE,
    subjectType: 'invoices',
    data: invoiceData,
    subjectId: (data) => data.invoiceId,
    titles: {
      student: 'Taksit vaden geçti.',
      parent: '{öğrenci} için taksit vadesi geçti.',
    },
  }),
  /** Tahsilat kaydedildi (IST-106, DOM-FIN-030). Tutar, yöntem ve referans bildirimde yoktur. */
  payment_received: defineNotificationType({
    ...PAYMENT_NOTICE,
    subjectType: 'payments',
    data: z.strictObject({ paymentId: notificationId }),
    subjectId: (data) => data.paymentId,
    titles: {
      student: 'Ödemen alındı.',
      parent: '{öğrenci} için ödeme alındı.',
    },
  }),
  /** İade ödendi (IST-110, DOM-FIN-041). Tutar, IBAN ve hesap sahibi bildirimde yoktur. */
  refund_paid: defineNotificationType({
    ...PAYMENT_NOTICE,
    subjectType: 'student_withdrawals',
    data: z.strictObject({ withdrawalId: notificationId }),
    subjectId: (data) => data.withdrawalId,
    titles: {
      student: 'İaden ödendi.',
      parent: '{öğrenci} için iade ödendi.',
    },
  }),
} as const

/**
 * Sözleşme bildirimleri (ON-044; IST-092). Finans türlerinden ayrı nesnedir: ödeyici bağının
 * (`payer`, K-04) açtığı tür listesi (`lib/guardianship.ts` `PAYER_NOTIFICATION_KINDS`) finans
 * türlerinden türetilir ve bugün yalnız taksit, tahsilat ve iadeyi kapsar. Bu türlerin veli
 * bildirimini velayetli veliler görür; velayeti olmayan ödeyici velinin görmesi o listenin
 * genişletilmesini bekler.
 */
export const CONTRACT_NOTIFICATION_TYPES = {
  /**
   * Sözleşme ya da ek protokol ödeyici onayını bekliyor (IST-092, DOM-FIN-010): imza yetkilisi
   * işlenince gider, çünkü onay ancak o zaman verilebilir. Tutar ve plan bildirimde yoktur.
   */
  contract_approval_requested: defineNotificationType({
    ...PAYMENT_NOTICE,
    subjectType: 'contracts',
    data: contractData,
    subjectId: (data) => data.contractId,
    titles: {
      student: 'Sözleşmen onayını bekliyor.',
      parent: '{öğrenci} için sözleşme onayınızı bekliyor.',
    },
  }),
  /** Ödeyici onayı tamamlandı: elektronik ya da ıslak imzayla (IST-092, DOM-FIN-010). */
  contract_approved: defineNotificationType({
    ...PAYMENT_NOTICE,
    subjectType: 'contracts',
    data: contractData,
    subjectId: (data) => data.contractId,
    titles: {
      student: 'Sözleşmen onaylandı.',
      parent: '{öğrenci} için sözleşme onaylandı.',
    },
  }),
} as const

/**
 * Sözleşme bildiriminin kitlesi ödeyicidir, yaş değil (DOM-FIN-052, DOM-KAY-012): ödeyici veli
 * (`payer: 'guardian'`; alanı olmayan eski sözleşme de veli ödeyicilidir) `parent`, kendi ödeyicisi
 * yetişkin kursiyer (`payer: 'student'`) `student` kitlesine gider. Sözleşme 18 yaş altında
 * yapılıp kursiyer sonradan reşit olsa da taraf velidir. API bunu `notify` açık kitlesine
 * (`recipients.minor`) çevirir.
 */
export function contractPayerIsGuardian(contract: { payer?: string | undefined }): boolean {
  return contract.payer !== 'student'
}
