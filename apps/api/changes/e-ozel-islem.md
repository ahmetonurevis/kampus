---
etki: minor
---

e-Özel işlem listesi uçları eklendi (IST-085, DOM-KAY-015): `GET /api/v1/finance/e-ozel/items`, `GET /api/v1/finance/e-ozel/export`, `POST /api/v1/finance/e-ozel/items/:kind/:sourceId/record`. Yönetici ve ön büro kullanır, dil okulu ve kursta açıktır, okulda 404. Ücret satırının işareti tahsilatın MEBBİS işaretidir. Migration `e_ozel_records` tablosunu ekler. Platform e-Özel'e bağlanmaz.
