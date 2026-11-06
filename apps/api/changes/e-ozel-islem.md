---
etki: minor
---

e-Özel işlem listesi uçları eklendi (IST-085, DOM-KAY-015): `GET /api/v1/finance/e-ozel/items`, `GET /api/v1/finance/e-ozel/export`, `POST /api/v1/finance/e-ozel/items/:kind/:sourceId/record`. Yönetici ve ön büro kullanır, dil okulu ve kursta açıktır, okulda 404. Ücret satırının işareti tahsilatın MEBBİS işaretidir. Migration `e_ozel_records` tablosunu ve `payments.mebbis_fingerprint` kolonunu ekler. Platform e-Özel'e bağlanmaz.

`GET /api/v1/finance/e-ozel/learners/:studentId/identity` eklendi: tek kursiyerin tam kimlik numarası taze oturumla döner, her görüntüleme aynı transaction'da `student_identity.read_full` olarak yalnız alan adlarıyla denetime yazılır (DOM-YTK-052), yanıt önbelleğe alınmaz. Liste ve CSV maskeli kaldı.

İşaretlendikten sonra kaynağı değişen satır listeden düşmez, `recordStatus` `needs_correction` döner (parmak izi karşılaştırması); `status=needs_correction` süzgeci ve CSV "Kaynakta değişiklik" sütunu eklendi, varsayılan süzgeç düzeltilmeli satırları da verir. Kaynağı kalkmış satırın işaretini kaldırmak 409 `e_ozel_source_removed`.
