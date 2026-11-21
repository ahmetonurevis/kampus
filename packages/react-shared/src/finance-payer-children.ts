// Veli finans seçicisinin çocukları (ON-313; K-04, DOM-FIN-052, DOM-ILT-074). Velayet listesi
// (web `/me` bağlantıları, mobil kapsamlı öğrenci okuması) velayeti olmayan ödeyici velinin
// çocuğunu taşımaz; finans sayfaları `GET /finance/payer-children` satırlarını bu listeye ekler.
// Birleşim yalnız finans sayfalarında yapılır: akademik ve iletişim ekranları velayet listesini
// olduğu gibi kullanır. Kapsam sunucudadır; burada yalnız kimlikten birleştirilir.
import type { operations } from '@kampus/api-client/schema.d.ts'

export type PayerChildView =
  operations['listFinancePayerChildren']['responses'][200]['content']['application/json']['data'][number]

/**
 * Velayet listesinde olmayan ödeyici çocuklar, sunucunun sırasıyla. Velayetli ödeyicinin çocuğu
 * velayet listesinde zaten vardır, ikinci kez eklenmez.
 */
export function payerOnlyChildren(
  ownIds: Iterable<string>,
  payer: readonly PayerChildView[],
): PayerChildView[] {
  const own = new Set(ownIds)
  return payer.filter((child) => !own.has(child.id))
}

/**
 * Finans seçicisinin seçenekleri: önce velayet listesi (sırası korunur), sonra yalnız ödeyicisi
 * olunan çocuklar. `fromPayer` ödeyici satırını ekranın seçenek tipine çevirir.
 */
export function withPayerChildren<T extends { id: string }>(
  own: readonly T[],
  payer: readonly PayerChildView[],
  fromPayer: (child: PayerChildView) => T,
): T[] {
  return [
    ...own,
    ...payerOnlyChildren(
      own.map((child) => child.id),
      payer,
    ).map(fromPayer),
  ]
}
