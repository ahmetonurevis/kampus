---
etki: patch
---

Bildirim sorguları için ifade indeksi (OG-020, IST-065; migration `0025_index_notifications`).

- `records_notifications_idx (institution_id, (data ->> 'studentId'), position, id) where collection = 'notifications' and archived_at is null`: bildirim listesi ve okunmamış sayımı artık kurumun bütün bildirim satırlarını taramaz (`TODO(F6-bildirim-indeksi)` kapandı). Davranış ve OpenAPI değişmez.
- Sorgu ifadesi anahtar adını sabit metin yazar; parametreli ifade indeksle eşleşmezdi.
- Kurulum `concurrently` değildir (Drizzle migrator tek transaction'da koşar); dolu üretim için `docs/muhendislik/veritabani.md` açık kararı geçerlidir.
