---
etki: minor
---

Teslim ve deneme yanıtında öğrenci adı (OG-213; DOM-YTK-028, DOM-YTK-027).

- `GET /api/v1/task-submissions`, `/task-submissions/:id`, `/task-submissions/grading-queue`, `/task-attempts` ve `/task-attempts/:id` yanıtı `learnerName` taşır. Yönetici her öğrencinin adını görür; öğretmen yalnız öğrenci kapsamındaki öğrencilerin adını görür (atamayı gördüğü için okuduğu başka sınıfın öğrencisinde `null`); uyuşmazlıklı teslimi okuyan koordinatör o teslimin adını görür; öğrenci ve veliye `null`. Kaydı olmayan öğrencide `null`, arşivli öğrencide ad gelir. Ad yalnız sayfadaki satırların kimlikleriyle yüklenir.
- Web: görev teslim/deneme listeleri, puanlama ve uyuşmazlık kuyruğu bütün öğrenci listesini çekmeden adı yanıttan gösterir; ad yoksa genel "Öğrenci" etiketi kalır.
