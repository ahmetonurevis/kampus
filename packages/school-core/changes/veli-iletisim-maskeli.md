---
etki: minor
---

- Velinin iletişim bilgisi öğretmene maskeli gösterilir (KV1; `docs/domain/yetki-ve-kapsam.md` DOM-YTK-055).
- Yeni `lib/parent-contact.ts`: `maskPhone` (`0532 *** ** 12`; `+90`/`90` önekli ve sıfırsız GSM numarası 11 haneye çevrilir), `maskEmail` (`a***@gmail.com`), `maskParentContact`, `revealParentContactSchema` (`{ studentId, field: 'phone' | 'email' }`, katı), `parentContactDecision` ve `revealParentContact`. Göster yalnız öğretmene açıktır (diğer roller `permission_denied`, `forbidden`); ders vermediği öğrenci, öğrenciye bağlı olmayan veli ve olmayan veli `parent_not_found` (`not_found`); boş alan `parent_contact_missing` (`rule`).
- `lib/scope.ts` `parents` alan kapsamı değişti: öğretmen `phone` ve `email`'i maskeli alır, bu alanlar onun için serbest metin aramasına girmez (`searchExcludedFields`); `relationship` öğretmene ve öğrenciye dönmez. Öğrenci iletişim alanlarını hiç almaz. Veli şimdilik bağlı çocuğun velisinin iletişimini görmeye devam eder (TODO #10, DOM-ILT-073). Yönetici ve ön büro değişmedi.
