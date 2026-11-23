import type { State } from '../data/seed.ts'
import { DomainError } from './errors.ts'
import { PAYMENT_METHODS } from './payments.ts'

/**
 * Yalnız çevrimdışı demo: taksiti tek seferde ödenmiş işaretler (ON-037, DOM-FIN-030).
 *
 * Gerçek tahsilat API'dedir (`POST /api/v1/payments`, `planPayment`/`recordPaymentSchema`); bu yol
 * kısmi ödeme, referans, banka hesabı, nakit ayarı ve tahsilat kaydı bilmez. `apps/api/src`,
 * `apps/web-react/src`, `packages/api-client` ve `packages/react-shared` bu dosyaya ulaşamaz
 * (`tests/payments-demo.test.ts` denetler). Yetkiyi kendisi denetlemez.
 *
 * TODO(demo-kalicilik): demo kalıcılığı silinince bu dosya ve `payments.ts`'teki köprü silinir.
 * Kalan tüketiciler ve bekledikleri görev:
 * - `apps/web/src/views/Finance.vue` (`apps/web/src/lib/payments.js` üzerinden): OG-072 Vue silme.
 * - `apps/mobile/src/model/operations.ts` ve `tests/mobile.test.ts`: OG-074 mobil yalnız API'ye geçer.
 * - `tests/domain.test.ts` (Vue sarmalayıcısıyla): OG-072/OG-073.
 * - `payments.ts` köprüsünden içe aktaranlar: mobil (OG-074), `apps/api/test/idempotency.test.ts`,
 *   `apps/api/test/operation-runner.test.ts`, `tests/commands.test.ts` (işlem koşucusu testlerinde örnek
 *   işlem olarak; Oğuzhan'ın alanı, demo yolu yerine başka bir işleme ya da bu dosyaya geçmeli).
 */

/** Çevrimdışı demonun yazdığı eski yöntem değerleri: Vue "Demo Sanal POS", mobil "Kredi kartı (demo)". */
export const LEGACY_DEMO_PAYMENT_METHODS = ['Demo Sanal POS', 'Kredi kartı (demo)'] as const
export type DemoPaymentMethod =
  (typeof PAYMENT_METHODS)[number] | (typeof LEGACY_DEMO_PAYMENT_METHODS)[number]

// `payments.ts` bu dosyayı köprüyle yeniden dışa aktardığı için döngü vardır; `PAYMENT_METHODS`
// modül yüklenirken değil, çağrı anında okunur.
const isDemoPaymentMethod = (method: string): method is DemoPaymentMethod =>
  (PAYMENT_METHODS as readonly string[]).includes(method) ||
  (LEGACY_DEMO_PAYMENT_METHODS as readonly string[]).includes(method)

export function payInvoice(
  state: State,
  invoiceId: string,
  method: string,
  now = new Date().toISOString(),
) {
  if (!isDemoPaymentMethod(method))
    throw new DomainError('invalid_payment_method', 'Ödeme yöntemini seçin.', {
      path: ['method'],
    })
  const invoice = state.invoices.find((i) => i.id === invoiceId)
  if (!invoice)
    throw new DomainError('invoice_not_found', 'Ödeme kaydı bulunamadı.', { kind: 'not_found' })
  if (invoice.paidAt)
    throw new DomainError('invoice_already_paid', 'Bu taksit zaten ödenmiş.', { kind: 'conflict' })
  invoice.paidAt = now
  invoice.method = method
  return invoice
}
