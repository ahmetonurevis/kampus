---
etki: minor
---

Tekillik ihlali (23505) kısıt adına göre sınıflanır (OG-279, DOM-YTK-027, DOM-YTK-065, DOM-ILT-074).

- Önceden her 23505 409 `conflict` ("yeniden deneyin") dönüyordu; kurum kilidi altındaki gerçek kural ihlalinde istemci boşuna yeniden deniyor, kullanıcı anlamsız ileti görüyordu.
- Sınıf tablosu `apps/api/src/unique-constraints.ts` (108 kısıt): yarış sınıfı (idempotency anahtarı, kimlik/oturum tabloları, kimlik ve bağlantı anahtarları, sıra numaraları) 409 `conflict` kalır; iş anlamı taşıyan tekillik 409 ve core'un aynı durumdaki kodu (`coordinator_duty_exists`, `academic_year_active_exists`, `guardian_payer_exists`, `course_name_exists`, `placement_in_progress` …) döner.
- Tabloda olmayan kısıt 422 `duplicate_record` ("Aynı bilgilerle bir kayıt zaten var. Bilgileri kontrol edin.") olur; hata işleyicisi `db.unclassified_unique_violation` olayını yalnız kısıt adıyla `warn` loglar.
- Kayıt ve finans tablolarının kısıtları (tahsilat, makbuz, tarife, burs, öğrenci kimliği, ayrılış, banka hesabı) davranış değişmeden 409 `conflict` kalır.
- Envanter testi migration sonrası her tekil indeksin tabloda olduğunu denetler; yeni kısıt eklenince sınıfı tabloya yazılır. OpenAPI değişmez.
