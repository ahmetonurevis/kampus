---
etki: minor
---

Eğitim yılı ve dönem tabloları ve uçları (OG-023; IST-011, DOM-YTK-063…067).

- Migration `0026_create_academic_years`: `academic_years` (anahtar `(institution_id, start_year)`, kurumda tek etkin yıl indeksi) ve `academic_terms` (yıl içi dönem, ad yılda tekil). Demo tohumu örnek yılları yazar; geri doldurma yok.
- Yeni uçlar (`routes/academic-years.ts`, etiket `institution`): `GET /api/v1/academic-years`, `GET /api/v1/academic-years/current`, `GET /api/v1/academic-years/:startYear` (beş rol; öğrenci ve veli yalnız ad, tarih, sıra ve etkinlik bilgisini alır) ve yalnız yöneticinin yazma uçları `POST /api/v1/academic-years` (`Idempotency-Key` zorunlu, 201), `PATCH /api/v1/academic-years/:startYear`, `POST …/:startYear/terms` (201), `PATCH`/`DELETE …/:startYear/terms/:termId`, `POST …/:startYear/activate`, `POST …/:startYear/close`. Var olan yıla yazma `If-Match` (yılın `rowVersion`'ı, dönemlerle ortak) ister.
- Hata kodları: 409 `academic_year_exists`, `academic_year_closed`, `academic_year_already_active`, `academic_term_name_exists`; 422 `academic_year_start_mismatch`, `academic_year_dates_invalid`, `academic_year_too_long`, `academic_year_overlap`, `academic_term_outside_year`, `academic_term_overlap`, `academic_term_limit`, `academic_terms_required`, `academic_year_activation_order`, `academic_year_ended`, `academic_year_not_active`, `academic_year_not_ended`.
- Etkinleştirme önceki etkin yılı aynı işlemde kapatır ve `institution_settings.academic_year`'ı etkin yıla eşitler (yenileme, rıza süresi ve tarife bu sayıyı okur).
- Sözleşme notu (kayıt ve finans): tarife `academicYear: number`'ı korur; yıl listedeki `startYear`'dan seçilir, varsayılan `/current` yanıtındaki `data.year.startYear`'dır.
- OpenAPI ve api-client şeması yeniden üretildi.
