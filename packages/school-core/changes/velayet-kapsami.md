---
etki: minor
---

Velayet ve iletişim kısıtı okuma kapsamına uygulandı (OG-032; IST-019, DOM-ILT-070, DOM-ILT-074).

- Yeni `lib/guardianship.ts` `guardedActorLinks`: velinin çocuk bağlantısı (`child`) yalnız aynı öğrencide velayetli ve kısıtsız bağı varsa kapsam verir; öğrenci ve öğretmen bağlantıları değişmez.
- API aktör bağlantılarını bununla kurar (`listMembershipLinks`): iletişim kısıtlı ya da velayeti olmayan veli öğrenciyi `/me` çocuk listesinde, not ve yoklama gibi koleksiyonlarda, panoda, yazışmada, bildirimde, randevuda ve öğrenciye bağlı dosyada görmez; kısıt kalkınca yeniden görür. Bağı kaldırılmış ya da hiç kurulmamış çocuk bağlantısı da kapsam vermez.
- Öğretmenin veli hesapları listesi (`GET /students/:id/parent-accounts`) yalnız velayetli ve kısıtsız velileri döndürür; kısıtlı veliyle yazışma başlatılamaz.
- Rıza kararı değişmedi: velayetsiz ya da kısıtlı veli 403 `consent_custody_required` alır, kendi verdiği rızayı geri çekebilir.
