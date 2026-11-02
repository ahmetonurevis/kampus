---
etki: minor
---

- Okuma-anlama etkinliği eklendi (OG-051; IST-042, DOM-BEC-006): `SUBSKILLS` (ana fikir, ayrıntı, çıkarım, kelime bilgisi) ve etiketlerde `subskill` (yalnız soruda). Okuma parçası `glossary` sözlükçesini (kelime, anlam, isteğe bağlı örnek; aynı kelime bir kez) taşır; quiz ve alıştırma seti `passageVersionId` ile okuma parçası sürümüne bağlanır, yayım bağlı parçanın bulunmasını, okuma parçası olmasını ve yayında olmasını ister. `passageView` kursiyerin metnini (seviye, hesaplanan kelime sayısı, sözlükçe, kaynak gösterimi) verir. `subskillBreakdown` alt beceri dökümünü madde puanlarından hesaplar, saklamaz; `scoringItemsFor` alt beceriyi soru etiketinden alır. Kaldırılan parçaya bağlı etkinlik `planResourceRemoval` etkilenen içeriğe girer; sözlükçe aramaya girer.
