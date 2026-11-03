---
etki: minor
---

Teslim ve deneme yanıtında öğrenci adı (OG-213; DOM-YTK-028, DOM-YTK-027).

- `GET /api/v1/task-submissions`, `/task-submissions/:id`, `/task-submissions/grading-queue`, `/task-attempts` ve `/task-attempts/:id` yanıtı `learnerName` taşır: yalnız satırı zaten okuyan personele (yönetici, öğretmen, uyuşmazlığı okuyan koordinatör) dolu, öğrenci ve veliye `null`. Ad yalnız sayfadaki satırların kimlikleriyle yüklenir.
- Web: görev teslim/deneme listeleri, puanlama ve uyuşmazlık kuyruğu bütün öğrenci listesini çekmeden adı yanıttan gösterir.
