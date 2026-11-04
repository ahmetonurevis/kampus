---
etki: minor
---

Öğrencinin sağlık ve acil bilgisi için core kuralı eklendi (OG-090; IST-020, DOM-ILT-035, DOM-YTK-052).

- Yeni `lib/health-profile.ts`: alerji (ad, şiddet), kronik durum, düzenli ilaç (ad, kullanım düzeni, okulda verilir mi), destek/engellilik ihtiyacı listeleri (her biri en çok 20 kalem, ad en çok 80 karakter, aynı ad iki kez yok), en çok 500 karakter acil müdahale talimatı ve hukuki dayanak kodu (`explicit_consent`, `vital_interest`, `legal_obligation`). Serbest not alanı yoktur; bilinmeyen alan reddedilir.
- Erişim `healthAccessFor` (`full`, `emergency`, `none`) ve `canWriteHealthProfile`: yönetici, öğrencinin sınıfının rehber öğretmeni, 18 yaş altı öğrencinin velayetli ve kısıtsız velisi ve 18 yaşını doldurmuş öğrencinin kendisi tam okur; sınıfa derse giren öğretmen yalnız acil görünümü (`emergencyView`: alerji adı ve şiddeti, acil talimat) okur. Yazma yönetici, velayetli ve kısıtsız veli ve yetişkin öğrencinin kendisindedir. Ön büro, ilgisiz öğretmen, reşit olmayan öğrencinin kendisi ve yetişkin öğrencinin velisi erişemez; yetişkinlik izin formuyla aynı kuraldır (`permissionDecider`).
- `requireHealthRead`/`requireHealthWrite` kapsam dışı öğrencide 404 `student_not_found`, yetkisiz rolde 403 `health_profile_forbidden`/`health_profile_write_forbidden` fırlatır; `changedHealthFields` denetim kaydı için yalnız değişen alan adlarını verir.
