---
etki: minor
---

Dil okulu kur programı tablosu ve uçları (OG-028; IST-076, DOM-DIL-005…008).

- Migration `0028_create_courses`: `courses` (anahtar `(institution_id, id)`; ad ve e-Özel program kodu arşivlenmemiş kurlarda tekil, anahtarlar core `courseNameKey`/`courseProgramKey`; sonraki kur aynı kurumun kuruna bileşik yabancı anahtar; yaşam döngüsü, saat, oturum, mevcut ve onaysız etkin belgeli kur `check` kısıtıdır). Demo tohumu Kampüs Dil Akademisi'ne altı kur yazar.
- Yeni uçlar (`routes/courses.ts`, etiket `institution`): `GET /api/v1/courses`, `GET /api/v1/courses/:courseId` (beş rol; öğrenci ve veli yalnız etkin kurların katalog alanlarını alır), `POST /api/v1/courses` (`Idempotency-Key` zorunlu, 201), `PATCH /api/v1/courses/:courseId`, `POST …/:courseId/activate`, `DELETE …/:courseId` (arşiv) — yönetici ve seviyenin akademik koordinatörü — ve yalnız yöneticinin `POST …/:courseId/record-e-ozel`. Var olan kura yazma `If-Match` ister. Okulda (`school`) her uç her rol için 404.
- Hata kodları: 403 `course_coordinator_required`; 409 `course_name_exists`, `course_program_code_exists`, `course_archived`, `course_not_draft`, `version_conflict`; 422 `course_hours_invalid`, `course_session_mismatch`, `course_learners_invalid`, `course_next_invalid`, `course_next_not_found`, `course_next_language`, `course_next_level`, `course_next_cycle`, `course_active_locked`, `course_program_not_approved`, `course_has_dependents`.
- Sözleşme notu (paket satışı, ON-058): paket kura `courseId` ile bağlanır, satışta kurun etkin olması aranır, ders saati ve seviye satış satırına kopyalanır, fiyat paket tarafındadır.
- OpenAPI ve api-client şeması yeniden üretildi.
