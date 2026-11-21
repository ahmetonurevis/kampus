/**
 * Paket saat uyarıları (IST-078, IST-114; docs/domain/finans.md DOM-FIN-058, dil-okulu.md
 * DOM-DIL-051; kararlar K-248, K-249). Saf karar: hangi satış personel listesinde işaretlenir, hangi
 * satış için aileye hangi bildirim gider. Durum ve bakiye `packageSaleStatus` ve
 * `packageHourBalance` ile hesaplanır, uyarı saklanmaz. Gün Europe/Istanbul takvim günüdür.
 *
 * - **Saat azaldı (`low_balance`):** kullanım başlamış, kalan saat satın alınanın %20'si ya da altı
 *   (en az 1 saat eşiği). Kullanılan saat girilmemiş satış işaretlenmez: kalan, satın alınana eşittir.
 * - **Süre doluyor (`expiring`):** son kullanma günü bugünden en çok 14 gün sonra, kalan saat var.
 * - Süresi dolmuş satış uyarı taşımaz; durumu zaten `expired`dır ve kalan saati silinmez. Aileye
 *   süre dolduktan sonraki ilk taramada (en geç 7 gün içinde) bir kez "süre doldu" bildirimi gider.
 * - Saati biten ya da ayrılışta iade edilen (kalan 0) satış uyarı taşımaz.
 */

import { z } from 'zod'

export const PACKAGE_ALERTS = ['low_balance', 'expiring'] as const
export type PackageAlert = (typeof PACKAGE_ALERTS)[number]

export const PACKAGE_ALERT_LABELS: Readonly<Record<PackageAlert, string>> = {
  low_balance: 'Saat azaldı',
  expiring: 'Süre doluyor',
}

/** Saat azaldı eşiği: satın alınan saatin yüzdesi (K-248). */
export const PACKAGE_LOW_BALANCE_PERCENT = 20
/** Süre doluyor penceresi (gün); son kullanma günü dahil (K-249). */
export const PACKAGE_EXPIRY_NOTICE_DAYS = 14
/** "Süre doldu" bildiriminin geriye dönük penceresi (gün): eski satışlar topluca bildirilmez (K-249). */
export const PACKAGE_EXPIRED_NOTICE_DAYS = 7

export const packageAlertSchema = z.enum(PACKAGE_ALERTS)

const DAY_MS = 86_400_000
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / DAY_MS

/** Satın alınan saate göre "saat azaldı" eşiği; en az 1 saat. */
export const packageLowBalanceHours = (purchasedHours: number): number =>
  Math.max(1, Math.floor((purchasedHours * PACKAGE_LOW_BALANCE_PERCENT) / 100))

export interface PackageAlertSale {
  purchasedHours: number
  remainingHours: number
  expiresDate: string | null
}

/** Satışın bugünkü uyarıları; sıra `PACKAGE_ALERTS` sırasıdır. */
export function packageSaleAlerts(sale: PackageAlertSale, today: string): PackageAlert[] {
  if (sale.remainingHours <= 0) return []
  if (sale.expiresDate !== null && today > sale.expiresDate) return []
  const alerts: PackageAlert[] = []
  if (
    sale.remainingHours < sale.purchasedHours &&
    sale.remainingHours <= packageLowBalanceHours(sale.purchasedHours)
  )
    alerts.push('low_balance')
  if (
    sale.expiresDate !== null &&
    dayNumber(sale.expiresDate) - dayNumber(today) <= PACKAGE_EXPIRY_NOTICE_DAYS
  )
    alerts.push('expiring')
  return alerts
}

export const PACKAGE_NOTICE_TYPES = [
  'package_hours_low',
  'package_expiring',
  'package_expired',
] as const
export type PackageNoticeType = (typeof PACKAGE_NOTICE_TYPES)[number]

export interface PackageNotice {
  type: PackageNoticeType
  saleId: string
  studentId: string
  /**
   * Aynı olay aynı alıcıya ikinci kez yazılmaz (`notify` `dedupeKey`). Saat azaldı satış başına bir
   * kezdir; süre bildirimleri son kullanma gününe bağlıdır, süre uzatılınca yeni gün için yeniden
   * gider.
   */
  dedupeKey: string
}

const NOTICE_OF_ALERT: Readonly<Record<PackageAlert, PackageNoticeType>> = {
  low_balance: 'package_hours_low',
  expiring: 'package_expiring',
}

function noticeKey(type: PackageNoticeType, sale: { id: string; expiresDate: string | null }) {
  return type === 'package_hours_low'
    ? `${sale.id}:low`
    : `${sale.id}:${type === 'package_expiring' ? 'expiring' : 'expired'}:${sale.expiresDate ?? ''}`
}

/**
 * Bugünkü taramanın bildirimleri (K-248, K-249). Kalan saati olmayan satış ve ayrılmış (pasif)
 * kursiyer çağıranın süzgecindedir: bu fonksiyon yalnız saat ve tarihe bakar.
 */
export function packageAlertNotices(
  sales: readonly (PackageAlertSale & { id: string; studentId: string })[],
  today: string,
): PackageNotice[] {
  const notices: PackageNotice[] = []
  for (const sale of sales) {
    const types: PackageNoticeType[] = packageSaleAlerts(sale, today).map(
      (alert) => NOTICE_OF_ALERT[alert],
    )
    if (
      sale.remainingHours > 0 &&
      sale.expiresDate !== null &&
      today > sale.expiresDate &&
      dayNumber(today) - dayNumber(sale.expiresDate) <= PACKAGE_EXPIRED_NOTICE_DAYS
    )
      types.push('package_expired')
    for (const type of types)
      notices.push({
        type,
        saleId: sale.id,
        studentId: sale.studentId,
        dedupeKey: noticeKey(type, sale),
      })
  }
  return notices
}
