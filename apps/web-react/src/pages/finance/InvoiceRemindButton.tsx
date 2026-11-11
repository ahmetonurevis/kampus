import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useRemindInstallment } from '@kampus/react-shared/use-payment-commands.ts'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import { canRemindInvoice, remindedOn, type InvoiceRow } from './finance-rows.ts'

/**
 * Gecikmiş taksitte elle hatırlatma (Vue `Finance.vue` `remind`, DOM-FIN-035, ON-113). Günde bir
 * hatırlatma gider: bugün hatırlatılan taksitte düğme kilitli "Hatırlatıldı"dır, ertesi gün yeniden
 * açılır. Ödenmiş ya da vadesi gelmemiş taksitte çizilmez; kuralı sunucu da uygular.
 */
export function InvoiceRemindButton({
  row,
  size = 'default',
}: {
  row: InvoiceRow
  size?: 'sm' | 'default'
}) {
  const remind = useRemindInstallment()
  if (!canRemindInvoice(row)) return null
  const reminded = remindedOn(row, dayKey())
  const label = reminded ? 'Hatırlatıldı' : 'Hatırlat'

  async function send() {
    const outcome = await remind.submit({ invoiceId: row.id })
    if (outcome.status !== 'success') return
    if (outcome.data.data.reminder === 'sent') notify.success('Hatırlatma veliye gönderildi.')
    else notify.info('Bu taksit için bugün zaten hatırlatma gönderildi.')
  }

  return (
    <Button
      size={size}
      variant="secondary"
      disabled={reminded || remind.isPending}
      aria-busy={remind.isPending || undefined}
      aria-label={`${row.studentName} ${row.installment}. taksit: ${label}`}
      onClick={() => void send()}
    >
      {label}
    </Button>
  )
}
