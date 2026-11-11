import type { PackageHourBalance, PackageHourKind, PackageHourSource } from './finance-packages.ts'

/** Bakiyeye giren saat hareketi; gün ve kaynak varsa ayrılış süzgeci uygulanır. */
interface CountableHourEntry {
  kind: PackageHourKind
  hours: number
  occurredDate?: string
  sourceType?: PackageHourSource
}

/**
 * Ayrılışın saydığı hareketler (DOM-DIL-051, K-43): ayrılış gününden sonraki ders kayıtlı olunan
 * süreye girmez, ücrete de yazılmaz; iade saati de aynı kümeden çıkar, ücreti alınmayan saat iade
 * edilir. `manual` satır girildiği güne kadarki toplamdır, tarihi dersin değil girişin günüdür:
 * elenmez (K-21, K-43). Kaynağı bilinmeyen tüketim ders sayılır.
 */
export function entriesThroughWithdrawal<T extends CountableHourEntry>(
  entries: readonly T[],
  withdrawalDate: string,
): T[] {
  return entries.filter(
    (entry) =>
      entry.kind !== 'consumed' ||
      entry.sourceType === 'manual' ||
      entry.occurredDate === undefined ||
      entry.occurredDate <= withdrawalDate,
  )
}

/** Ayrılış iadesi yazılmış satışta hareketler ayrılışın saydığı kümedir; yoksa hepsi. */
export function settledHourEntries<T extends CountableHourEntry>(entries: readonly T[]): T[] {
  const withdrawal = entries.find(
    (entry) => entry.kind === 'refunded' && entry.sourceType === 'withdrawal',
  )
  return withdrawal?.occurredDate === undefined
    ? [...entries]
    : entriesThroughWithdrawal(entries, withdrawal.occurredDate)
}

function hourTotals(purchasedHours: number, entries: readonly CountableHourEntry[]) {
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

/**
 * Bakiye hesaplanır, saklanmaz: satın alınan − tüketilen − iade edilen (DOM-DIL-051). Ayrılış
 * iadesi yazılmış satışta ayrılış gününden sonraki ders tüketime girmez (`settledHourEntries`):
 * ayrılış o saati ücrete yazmadı, iade etti. Ayrı dosyadadır: `lib/withdrawals.ts` bunu okur,
 * `lib/finance-packages.ts`'in kayıt ve tarife bağımlılıkları ise yine `lib/withdrawals.ts`'e döner;
 * değer içe aktarımı yükleme döngüsü kurar.
 */
export function packageHourBalance(
  purchasedHours: number,
  entries: readonly CountableHourEntry[],
): PackageHourBalance {
  return hourTotals(purchasedHours, settledHourEntries(entries))
}

/**
 * Ayrılışta kullanılan ve iade edilen saat tek kümeden (DOM-DIL-051, DOM-FIN-040, K-43):
 * kullanılan + önceden iade edilen + iade edilen = satın alınan; saat kaybolmaz.
 */
export function packageWithdrawalHours(
  purchasedHours: number,
  entries: readonly CountableHourEntry[],
  withdrawalDate: string,
): { usedHours: number; returnedHours: number } {
  const counted = hourTotals(purchasedHours, entriesThroughWithdrawal(entries, withdrawalDate))
  return {
    usedHours: counted.consumedHours,
    returnedHours: Math.max(counted.remainingHours, 0),
  }
}

/** Saat hiç girilmediyse iade hesabı sıfır saate dayanır ve fazla çıkabilir; ekran uyarır (K-21). */
export const packageUsedHoursRecorded = (entries: readonly { kind: PackageHourKind }[]): boolean =>
  entries.some((entry) => entry.kind === 'consumed')
