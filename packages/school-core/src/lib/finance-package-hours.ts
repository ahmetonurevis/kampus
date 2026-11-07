import type { PackageHourBalance, PackageHourKind } from './finance-packages.ts'

/**
 * Bakiye hesaplanır, saklanmaz: satın alınan − tüketilen − iade edilen (DOM-DIL-051). Ayrı dosyadadır:
 * `lib/withdrawals.ts` bunu okur, `lib/finance-packages.ts`'in kayıt ve tarife bağımlılıkları ise
 * yine `lib/withdrawals.ts`'e döner; değer içe aktarımı yükleme döngüsü kurar.
 */
export function packageHourBalance(
  purchasedHours: number,
  entries: readonly { kind: PackageHourKind; hours: number }[],
): PackageHourBalance {
  const total = (kind: PackageHourKind) =>
    entries.reduce((sum, entry) => (entry.kind === kind ? sum + entry.hours : sum), 0)
  const consumedHours = total('consumed')
  const refundedHours = total('refunded')
  return {
    purchasedHours,
    consumedHours,
    refundedHours,
    remainingHours: purchasedHours - consumedHours - refundedHours,
  }
}
