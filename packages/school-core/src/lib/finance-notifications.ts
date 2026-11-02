import { z } from 'zod'

import { defineNotificationType, notificationId } from './notification-type.ts'

/**
 * Finans bildirim türleri (docs/domain/finans.md DOM-FIN-035; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-022, -023, -074). Hepsi ticari ileti onayı gerektirmeyen hizmet bildirimidir ve `finance`
 * modülüne bağlıdır. Veri yalnız kayıt kimliği taşır; başlıkta tutar, vade, referans ve IBAN
 * yoktur, kişisel veri olarak yalnız `{öğrenci}` yer alır. 18 yaş altında veliye, yetişkin
 * kursiyerde kendisine gider (kursiyer kendi ödeyicisidir, DOM-FIN-052).
 */

const PAYMENT_NOTICE = {
  topic: 'payment',
  category: 'service',
  mandatory: false,
  module: 'finance',
  audiences: { minor: ['parent'], adult: ['student'] },
} as const

const invoiceData = z.strictObject({ invoiceId: notificationId })

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
} as const
