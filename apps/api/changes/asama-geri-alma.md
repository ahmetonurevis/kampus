---
etki: minor
---

Aday aşamasını geri alma ucu eklendi: `POST /api/v1/prospects/:prospectId/stage-revert` (ON-007; DOM-KAY-030). Yalnız yönetici, gerekçeli ve `If-Match` ile çalışır; denetim kaydına gerekçe metni yazılmaz. Kayıt Raporları kanal sayımı için `GET /api/v1/collections/prospects/counts?groupBy=source` kullanılır (uç değişmedi).
