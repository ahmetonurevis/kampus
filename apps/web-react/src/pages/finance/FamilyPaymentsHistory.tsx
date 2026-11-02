import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { useStudentPayments } from '@kampus/react-shared/use-payment-commands.ts'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { receiptNumberLabel } from '@/lib/pdf/templates/payment-receipt.ts'

/**
 * Veli ve öğrencinin tahsilat geçmişi (DOM-FIN-030, -050, -052): sunucu kapsamı kendi öğrencisiyle
 * sınırlıdır; iptal gerekçesi bu rollere dönmez. Tahsilat yoksa bölüm gösterilmez.
 */
export function FamilyPaymentsHistory({ studentId }: { studentId: string }) {
  const payments = useStudentPayments(studentId)
  if (payments.error)
    return <QueryError error={payments.error} onRetry={() => void payments.refetch()} />
  const rows = payments.data?.data ?? []
  if (rows.length === 0) return null
  return (
    <section
      aria-labelledby="tahsilat-gecmisi"
      className="panel mt-6 rounded-card border bg-surface"
    >
      <h2 id="tahsilat-gecmisi" className="px-6 pt-6 pb-3 text-lg font-semibold max-[650px]:px-4">
        Tahsilat geçmişi
      </h2>
      <ul className="divide-y">
        {rows.map((payment) => {
          const number = receiptNumberLabel(payment)
          return (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 max-[650px]:px-4"
            >
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  {money(payment.amountCents)} · {payment.method}
                </p>
                <p className="text-muted-foreground">
                  {dateLabel(payment.paidAt, { year: 'numeric' })} · Dekont {number}
                </p>
              </div>
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge text={payment.reversedAt === null ? 'Geçerli' : 'İptal edildi'} />
                <PdfButton
                  type="payment-receipt"
                  recordId={payment.id}
                  label="Dekont"
                  ariaLabel={`${number} numaralı dekontu görüntüle`}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
