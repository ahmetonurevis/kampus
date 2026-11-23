---
etki: minor
---

Tekillik ihlali (23505) kısıt adına göre sınıflanır (OG-279, DOM-YTK-027, DOM-YTK-065, DOM-ILT-074).

- Önceden her 23505 409 `conflict` ("yeniden deneyin") dönüyordu; kurum kilidi altındaki gerçek kural ihlalinde istemci boşuna yeniden deniyor, kullanıcı anlamsız ileti görüyordu.
- Sınıf tablosu `apps/api/src/unique-constraints.ts` (108 kısıt): yarış sınıfı (idempotency anahtarı, kimlik/oturum tabloları, kimlik ve bağlantı anahtarları, sıra numaraları) 409 `conflict` kalır; iş anlamı taşıyan tekillik 409 ve kendi kodunu döner: core'un aynı durumdaki kodu (`coordinator_duty_exists`, `guardian_payer_exists`, `course_name_exists`, `placement_in_progress` …) ya da core'da karşılığı yoksa API'ye özgü kod (`academic_year_active_exists`, `consent_decision_exists`, `waitlist_entry_exists`).
- Tabloda olmayan kısıt eski davranışla 409 `conflict` (yeniden denenebilir) kalır; hata işleyicisi `db.unclassified_unique_violation` olayını yalnız kısıt adıyla `warn` loglar.
- Kayıt ve finans tablolarının kısıtları (tahsilat, makbuz, tarife, burs, öğrenci kimliği, ayrılış, banka hesabı) davranış değişmeden 409 `conflict` kalır.
- Envanter testi migration sonrası, şema dosyası Oğuzhan'ın alanındaki tabloların her tekil indeksinin tabloda olduğunu denetler (sahip `alan-koruma` sınıflamasıyla); Onur'un tablolarındaki kısıtlar zorunlu değildir. OpenAPI değişmez.
- Velayet bağı kısıtları (`student_guardians_*_key`) artık 409 `guardian_payer_exists` / `guardian_link_exists` döner; kesin kayıttaki veli bağı yolu (`insertGuardianLink`) da bu kodu alır.
