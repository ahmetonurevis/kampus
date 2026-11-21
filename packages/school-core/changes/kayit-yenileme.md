---
etki: minor
---

- Tarifeye bağlı kayıt yenileme eklendi (ON-030; IST-100): `lib/renewals.ts` `quoteRenewal` ve `planRenewal` öğrenim ücretini yayımlı tarifeden ve artış tavanından hesaplar (DOM-FIN-002, -005), indirimi tarifedeki türden (DOM-FIN-020…022), bursu yalnız bildirilmiş programdan alır (DOM-FIN-025); sözleşme tarife ve indirim dökümünü, kendi taksitlerini ve ayrı ek hizmet taksitlerini taşır. Tam bursta öğrenim taksiti açılmaz. Plan kaydı ücret kararını (`pricing`) saklar.
- Artış tavanı `lib/renewal-ceiling.ts` `renewalCeiling` ile eklendi: baz son sözleşmenin indirimsiz ücreti, sözleşmesiz öğrencide önceki yılın ilan ücretidir; atlanan yıllarda oranlar sırayla uygulanır; kardeş indirimi koşulu kalkınca baz kayıt yılındaki indirimsiz ücrettir ve gerekçe döner (DOM-FIN-023). Kademenin başlangıç sınıfında (1, 5, 9) tavan uygulanmaz. ÜFE/TÜFE profili `createPriceIndexSchema`, `planPriceIndexCreate`, `planPriceIndexUpdate`.
- Yenilemenin tutardan bağımsız ön koşulları `renewalPreconditions` (`lib/school-workflows.ts`) olarak ayrıldı; iş akışı köprüsü ve tarifeli plan aynı denetimi çalıştırır.
- **Kırıcı:** `assertRenewalWithinTariff` artık köprüdeki serbest burs oranını (422 `scholarship_program_required`) ve serbest indirimi (422 `discount_not_in_tariff`) reddeder, devam eden öğrencide artış tavanını uygular (422 `renewal_above_ceiling`, oran yoksa `price_index_missing`). State parametresi `contracts`, `students`, `renewals` ve `academicYear` ister. Burslu ve indirimli yenileme `planRenewal` ile yapılır.
