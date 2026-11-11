---
etki: minor
---

Dil okulunda kur (program) tanımı eklendi (OG-028; IST-076, DOM-DIL-005…008).

- Yeni `lib/courses.ts`: kur dil, tek CEFR seviyesi, isteğe bağlı beceri odağı (dört temel beceri), toplam ve haftalık ders saati (45 dk), oturum uzunluğu (45/90 dk), en az (açılış) ve en çok mevcut (≤ 18), belgeli/belgesiz ve seviyeli kursta sonraki kur (`nextCourseId`) taşır. Tarih, öğretmen, derslik ve fiyat kurda yoktur (grup OG-029, paket ON-058). Süre (hafta) hesaplanır: `courseDurationWeeks`.
- İşlemler: `planCourseCreation` (taslak; ad tekil 409 `course_name_exists`; 422 `course_hours_invalid`, `course_session_mismatch`, `course_learners_invalid`, `course_next_*`), `planCourseUpdate` (etkin kurun program alanları 422 `course_active_locked`; taslakta program alanı değişirse e-Özel izi sıfırlanır), `planCourseActivation` (yalnız taslak 409 `course_not_draft`; belgeli kur e-Özel onayı olmadan 422 `course_program_not_approved`), `planCourseArchive` (arşiv son durum; başka kurun sonraki kuruysa 422 `course_has_dependents`), `planCourseEOzelRecord` (program kodu, onay durumu, kim/ne zaman izi; kod tekil 409 `course_program_code_exists`).
- Yetki: `assertCourseManager` yönetici her kuru, akademik koordinatör (DOM-YTK-027) yalnız kendi seviyesini yönetir (403 `course_coordinator_required`). Yalnız `language_school`; okulda 404 `module_unavailable_for_type`.
- Okuma: `courseView` ve `courseVisibleTo`; öğrenci ve veli yalnız etkin kurların katalog alanlarını görür.
- Yetki tablosuna `course.read` (beş rol), `course.manage` (yönetici, öğretmen + koordinatör görevi), `course.eozel` (yönetici) eklendi; modüle bağlı değildir.
- Örnek veri: `platform/seed-courses.ts` `createCourses` Kampüs Dil Akademisi için altı kur (sabit kimlikler `seedCourseId`).
