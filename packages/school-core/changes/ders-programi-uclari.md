---
etki: minor
---

Ders programı kuralları sıkılaştırıldı (OG-039; IST-094, DOM-YTK-068, DOM-YTK-069).

- Ders çakışması öğretmenin sorumlu olduğu okul etkinliğini de kapsar (409 `teacher_event_conflict`).
- Başlamış ya da geçmiş ders planlanmaz, düzenlenmez, yedek atanmaz ve iptal edilmez (422 `lesson_in_past`); iptal edilmiş ders düzenlenemez (`lesson_cancelled`).
- `substitute` gövdesi `{ teacherId, reason }` oldu; asıl öğretmenle aynı öğretmen 422 `teacher_unchanged`. Gerekçe `substitutions` kaydında tutulur.
- `lesson-cancel` gerekçe ister (en çok 500 karakter), `cancelReason` yazar; ikinci iptal 409 `lesson_already_cancelled`; sınıfın o İstanbul gününde yoklaması varsa 422 `lesson_attendance_taken`. Komut tablosunda `lesson-cancel` koleksiyonlarına `attendance` eklendi.
- Öğrenci ve veli kapsamında `cancelReason` ve `substitutions` ayıklanır. İptal formuna gerekçe alanı eklendi.
