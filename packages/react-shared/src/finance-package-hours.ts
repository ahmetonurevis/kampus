import type { operations } from '@kampus/api-client/schema.d.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

// Öğrencinin ve velinin gördüğü paket saati (K-24, DOM-DIL-051). Ders planlaması içindir, ödeme
// bilgisi sayılmaz: tutar alanları (`amounts`) öğrenci ve veli yanıtında hiç yoktur (K-40),
// personel yanıtında olsa da satıra kopyalanmaz. Saatler ve durum bakiye ucundan
// (`/finance/students/:id/package-balance`) gelir, burada yeniden hesaplanmaz; süresi dolan saat
// kalan saatin içindedir, ayrıca gösterilir.

type BalanceSale =
  operations['getStudentPackageBalance']['responses'][200]['content']['application/json']['data']['sales'][number]

/** Bakiye satırından okunan alanlar; tutar alanı bilerek yoktur. */
export type PackageHourSale = Pick<
  BalanceSale,
  'saleId' | 'packageName' | 'remainingHours' | 'expiredHours' | 'expiresDate' | 'status'
>

export type PackageHourRow = {
  id: string
  name: string
  remaining: string
  /** Süresi dolan saat (kalan saatin içinde); süresi dolmamış pakette `null`. */
  expired: string | null
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

const hoursText = (hours: number) => `${String(hours)} saat`

/** Aynı durumdaki satışlar sunucu sırasını (yeni satış önce) korur. */
export function packageHourRows(sales: readonly PackageHourSale[]): PackageHourRow[] {
  return [...sales]
    .sort((a, b) => STATUS_VIEW[a.status].order - STATUS_VIEW[b.status].order)
    .map((sale) => ({
      id: sale.saleId,
      name: sale.packageName,
      remaining: hoursText(sale.remainingHours),
      expired: sale.expiredHours > 0 ? hoursText(sale.expiredHours) : null,
      expires: sale.expiresDate ? dateLabel(sale.expiresDate, { year: 'numeric' }) : 'Süresiz',
      statusLabel: STATUS_VIEW[sale.status].label,
      statusTone: STATUS_VIEW[sale.status].tone,
      note: sale.status === 'expired' ? PACKAGE_HOURS_EXPIRED_NOTE : null,
    }))
}
