import { usePackageSales } from '@kampus/react-shared/use-finance-packages.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { PACKAGE_SALE_STATUS_VIEW } from './package-forms.ts'

const PAGE = { page: 1, pageSize: 100 } as const

/**
 * Satın alınan paketler (veli ve öğrenci, dil okulu; IST-078, DOM-DIL-051, K-07). Kapsam sunucudadır:
 * veli bağlı çocuğunu ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini görür. Yalnız okunur; satış
 * kurumdadır. Tutar burada yoktur, sunucu da göndermez (K-40): taksitler ve sözleşme kendi
 * bölümlerinde görünür.
 */
export function FamilyPackagesSection({ studentId }: { studentId: string }) {
  const sales = usePackageSales({ ...PAGE, studentId })
  return (
    <section
      aria-labelledby="satin-alinan-paketler"
      className="panel mt-6 grid gap-4 rounded-card border bg-surface px-6 py-5"
    >
      <h2 id="satin-alinan-paketler" className="text-lg font-semibold">
        Satın alınan paketler
      </h2>
      {sales.error ? <QueryError error={sales.error} onRetry={() => void sales.refetch()} /> : null}
      {sales.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Paketler yükleniyor…
        </p>
      ) : null}
      {sales.data?.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz satın alınmış paket yok. Paket satışı kurumda yapılır.
        </p>
      ) : null}
      {sales.data && sales.data.data.length > 0 ? (
        <ul aria-label="Satın alınan paketler" className="grid gap-5 divide-y">
          {sales.data.data.map((sale) => {
            const status = PACKAGE_SALE_STATUS_VIEW[sale.status]
            return (
              <li key={sale.id} className="grid gap-3 pb-5 last:pb-0">
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
                    <dd className="font-medium">{sale.consumedHours} saat</dd>
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
                {sale.refundedHours > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    İade edilen: {sale.refundedHours} saat
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
