---
etki: minor
---

- Duyuru durumu core'a taşındı (OG-218; DOM-ILT-003, DOM-ILT-004): `ANNOUNCEMENT_STATUS`, `ANNOUNCEMENT_STATUSES` ve `announcementStatusOf` (geri çekildi > okunmadı > güncellendi > yayında). API durum süzgecini ve web rozetini aynı kuraldan çalıştırır.
- Alıcı olmayan okuyucuda (ör. ön büro) duyuru kaydında `myReadAt` yoktur; hiçbir duyuru "Okunmadı" sayılmaz, okunmamış sayısı 0'dır (OG-218; DOM-ILT-003). Alıcıda `null` açılmadı demektir.
