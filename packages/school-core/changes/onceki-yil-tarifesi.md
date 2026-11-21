---
etki: minor
---

- Tarife süresinde ilan edilmezse önceki yılın yayımlı tarifesi geçerli kalır (K-11, DOM-FIN-002): `resolveEffectiveTariff` hedef yılın yayımlı tarifesini, yoksa ve ilan dönemi bittiyse (`isAnnouncementPeriodOver`; `school`: mayıs sonu) bir önceki yılın yayımlı tarifesini seçer. Dönem sürüyorsa, önceki yılın da tarifesi yoksa ya da kurum türünün ilan dönemi yoksa (dil okulu, kurs) `tariff_not_published` korunur. Yenileme ücret kararı `tariffCarriedOverFromYear` alanını taşır (`RenewalPrice`, `renewalPricingSchema`); artış tavanının bazı değişmedi.
- Kesin kayıt ve tarifeli yenileme uçları geçerli tarifeyi bu kuralla çözer; önizleme ve komut yanıtı `tariffCarriedOverFromYear` döner, gövdedeki `tariffId` geçerli tarifeyle karşılaştırılır (`tariff_changed`). React web kayıt ve yenileme formları, önizleme, ayrıntı, kayıt sonucu ve Ek 2 ücret kararı önceki yılın tarifesinin uygulandığını yazar. İş akışı köprüsü (`assertRenewalWithinTariff`) taşıma uygulamaz.
