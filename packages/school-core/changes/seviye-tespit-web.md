---
etki: minor
---

- Seviye tespit sınavı web ekranı eklendi (OG-078; IST-058, DOM-DIL-010…012): dil okulunda yönetici ve öğretmen Seviye Tespiti sayfasında kişi seçer, oturum açar, otomatik bölümlerin cevaplarını girer, yazma ve konuşmayı rubrikle puanlar, tespiti bitirir, önerilen CEFR seviyesini görür ve gerekçeli yerleştirme kararı verir.
- Menü girdisi eklendi (`platform/navigation.ts` `placementPage`): yönetici YÖNETİM, öğretmen AKADEMİK kategorisi; yalnız `language_school`, modüle bağlı değil. Ön büro menüde yoktur (tespit uçları 403 verir).
- Tespit formu ucu eklendi: `GET /api/v1/placement-sessions/:sessionId/form` otomatik bölümlerin sorularını cevap anahtarı, doğru seçenek ve açıklama olmadan döner; kapsam oturum okumasıyla aynıdır (başka kurum ve okul kurumu 404, ön büro/öğrenci/veli 403).
