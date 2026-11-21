---
etki: patch
---

- Paketli ayrılışta ücrete yazılan ve iade edilen saat aynı hareket kümesinden hesaplandı (`packageWithdrawalHours`; DOM-DIL-051, DOM-FIN-040, K-43): geriye tarihli ayrılışta ayrılıştan sonraki ders ücrete girmez, iade edilir; elle girilen toplam yine elenmez. Önceden bu saat ne ücrete ne iadeye giriyordu.
- `packageHourBalance` ayrılış iadesi yazılmış satışta ayrılış gününden sonraki ders hareketini saymıyor (`settledHourEntries`); paket bakiyesi ve paket saat raporu ayrılışla tutarlı, kalan sıfır kalır (DOM-FIN-058). `PackageHourEntry` isteğe bağlı `occurredDate` aldı.
- API: kardeş kümesi kilit dışında yalnız tahmin edilir, yenileme, toplu önizleme, aday listesi ve ek protokolde kilit altında yeniden doğrulanır; arada kaydolan kardeşin sözleşmesi yüklenir (DOM-FIN-022, DOM-FIN-023).
