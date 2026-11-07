import type { operations } from '@kampus/api-client/schema.d.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

// Öğrencinin telefonda gördüğü kalan paket saati (K-24, DOM-DIL-051). Ders planlaması içindir, ödeme
// bilgisi sayılmaz: satış yanıtındaki tutarlar (`hourlyCents`, `grossCents`, `netCents`) satıra
// kopyalanmaz. Kalan saat ve durum sunucudan gelir, burada yeniden hesaplanmaz.

type ListedSale =
  operations['listPackageSales']['responses'][200]['content']['application/json']['data'][number]

/** Satış yanıtından okunan alanlar; tutar alanı bilerek yoktur. */
export type PackageHourSale = Pick<
  ListedSale,
  'id' | 'packageName' | 'remainingHours' | 'expiresDate' | 'status'
>

export type PackageHourRow = {
  id: string
  name: string
  remaining: string
  expires: string
  statusLabel: string
  statusTone: 'green' | 'amber' | 'primary'
  note: string | null
}

export const PACKAGE_HOURS_EXPIRED_NOTE =
  'Kullanım süresi doldu; kalan saatler silinmez. Süre uzatma ya da iade için kurumla görüşün.'

/** Liste sırası da buradan gelir: planlamaya yarayan paket önce, biten paket sonda. */
const STATUS_VIEW: Readonly<
  Record<
    PackageHourSale['status'],
    { order: number; label: string; tone: PackageHourRow['statusTone'] }
  >
> = {
  active: { order: 0, label: 'Etkin', tone: 'green' },
  expired: { order: 1, label: 'Süresi doldu', tone: 'amber' },
  depleted: { order: 2, label: 'Saati bitti', tone: 'primary' },
}

/** Aynı durumdaki satışlar sunucu sırasını (yeni satış önce) korur. */
export function packageHourRows(sales: readonly PackageHourSale[]): PackageHourRow[] {
  return [...sales]
    .sort((a, b) => STATUS_VIEW[a.status].order - STATUS_VIEW[b.status].order)
    .map((sale) => ({
      id: sale.id,
      name: sale.packageName,
      remaining: `${sale.remainingHours} saat`,
      expires: sale.expiresDate ? dateLabel(sale.expiresDate, { year: 'numeric' }) : 'Süresiz',
      statusLabel: STATUS_VIEW[sale.status].label,
      statusTone: STATUS_VIEW[sale.status].tone,
      note: sale.status === 'expired' ? PACKAGE_HOURS_EXPIRED_NOTE : null,
    }))
}
