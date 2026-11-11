import { useStudentPackageBalance } from '@kampus/react-shared/use-finance-packages.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { PACKAGE_SALE_STATUS_VIEW } from './package-forms.ts'

/**
 * Satın alınan paketler (veli ve öğrenci, dil okulu; IST-078, IST-114, DOM-DIL-051, K-07). Saatler
 * öğrencinin bakiye ucundan gelir (ON-310): satış listesiyle aynı hareketlerden hesaplanır, süresi
 * dolan saat kalan saatin içinde ayrıca verilir. Kapsam sunucudadır: veli bağlı çocuğunu ve
 * ödeyicisi olduğu öğrenciyi, öğrenci kendisini görür. Yalnız okunur; satış kurumdadır. Tutar burada
 * yoktur, sunucu da göndermez (K-40): taksitler ve sözleşme kendi bölümlerinde görünür.
 */
export function FamilyPackagesSection({ studentId }: { studentId: string }) {
  const balance = useStudentPackageBalance(studentId)
  const sales = balance.data?.data.sales
  return (
    <section
      aria-labelledby="satin-alinan-paketler"
      className="panel mt-6 grid gap-4 rounded-card border bg-surface px-6 py-5"
    >
      <h2 id="satin-alinan-paketler" className="text-lg font-semibold">
        Satın alınan paketler
      </h2>
      {balance.error ? (
        <QueryError error={balance.error} onRetry={() => void balance.refetch()} />
      ) : null}
      {balance.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Paketler yükleniyor…
        </p>
      ) : null}
      {sales?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz satın alınmış paket yok. Paket satışı kurumda yapılır.
        </p>
      ) : null}
      {sales && sales.length > 0 ? (
        <ul aria-label="Satın alınan paketler" className="grid gap-5 divide-y">
          {sales.map((sale) => {
            const status = PACKAGE_SALE_STATUS_VIEW[sale.status]
            return (
              <li key={sale.saleId} className="grid gap-3 pb-5 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium [overflow-wrap:anywhere]">{sale.packageName}</h3>
                  <StatusBadge text={status.label} tone={status.tone} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Satın alınan</dt>
                    <dd className="font-medium">{sale.purchasedHours} saat</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Kullanılan</dt>
                    <dd className="font-medium">{sale.usedHours} saat</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Kalan</dt>
                    <dd className="font-medium">{sale.remainingHours} saat</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Son kullanma</dt>
                    <dd className="font-medium">
                      {sale.expiresDate
                        ? dateLabel(sale.expiresDate, { year: 'numeric' })
                        : 'Süresiz'}
                    </dd>
                  </div>
                </dl>
                {sale.expiredHours > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Süresi dolan: {sale.expiredHours} saat (kalan saatin içinde)
                  </p>
                ) : null}
                {sale.refundedHours > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    İade edilen: {sale.refundedHours} saat
                  </p>
                ) : null}
                {sale.alerts.includes('low_balance') ? (
                  <p className="text-sm">
                    Paket saati azaldı. Yeni paket için kurumla görüşebilirsiniz.
                  </p>
                ) : null}
                {sale.alerts.includes('expiring') && sale.expiresDate ? (
                  <p className="text-sm">
                    Kullanım süresi {dateLabel(sale.expiresDate, { year: 'numeric' })} günü doluyor;
                    kalan saatler silinmez. Süre uzatma için kurumla görüşün.
                  </p>
                ) : null}
                {sale.status === 'expired' ? (
                  <p className="text-sm">
                    Kullanım süresi doldu; kalan saatler silinmez. Süre uzatma ya da iade için
                    kurumla görüşün.
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
