---
etki: minor
---

Aydınlatma ve açık rıza uçları (OG-016; IST-016, IST-017; DOM-YTK-056…062). Core tarafı `academicYearEndsAt` ve `consent.status` hedef tipi aynı görevdedir.

- Yeni uçlar (`routes/privacy.ts`, etiket `privacy`): `GET/POST /api/v1/privacy-notices` (yönetici), `GET /api/v1/privacy-notices/current`, `POST /api/v1/privacy-notices/:noticeId/acknowledge` (ilk 201, aynı sürüm 200, eski sürüm 409 `notice_outdated`), `GET /api/v1/consent-texts/:purpose` (metin yoksa 404 `consent_text_not_found`), `GET /api/v1/consents`, `GET /api/v1/consents/status` (yalnız var/yok; öğretmen yalnız ders verdiği öğrenci), `POST /api/v1/consents` (veli, öğrenci; 201; 403 `consent_guardian_required`, `consent_adult_self`, `consent_custody_required`; 409 `consent_exists`, `consent_text_outdated`; 422 `academic_year_required`) ve `POST /api/v1/consents/:consentId/withdraw` (409 `consent_already_withdrawn`). `POST /privacy-notices` ve `POST /consents` `Idempotency-Key` ister. Kapsam dışı öğrenci ve başka kurumun kaydı 404 `not_found`.
- Eğitim yılı rızası kurum eğitim yılının ertesi yılında 1 Eylül 00:00 Europe/Istanbul'da düşer.
- Konuşma kaydı yüklemesi (`POST /api/v1/files`, `speaking_recording`) artık geçerli rıza varsa açılır; yoksa 403 `consent_required` (önceden her zaman 403). Rıza geri çekilince öğrencinin bağlı konuşma kayıtları imhaya işaretlenir (`retention_until = now`, denetim `file.purge_scheduled`); nesneyi silen iş `TODO(F3c2-imha)`.
- Velayet geçici kuralı: bağlı her veli velayetli sayılır (`services/consents.ts` `guardianBondsOf`, `TODO(OG-031-velayet)`).
- OpenAPI ve api-client şeması yeniden üretildi; migration yok.
