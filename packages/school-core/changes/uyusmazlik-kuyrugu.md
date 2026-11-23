---
etki: minor
---

Koordinatör uyuşmazlık kuyruğu ve son puan penceresi (OG-058; IST-005, IST-048, DOM-BEC-024, DOM-YTK-027).

- Puanlama kuyruğu satırı görev başlığını taşır (`GET /api/v1/task-submissions/grading-queue`, `assignmentTitle`): alanındaki uyuşmazlığı okuyan koordinatör atamayı görmeyebilir.
- Web: zümre başkanı ya da akademik koordinatör görevi olan öğretmen Ödevler & Değerlendirme sayfasında Uyuşmazlıklar sekmesini görür (`?sekme=uyusmazlik`); kuyruk sunucu sayfalıdır, süre süzgeci adreste. Son puan penceresi (`?son-puan=`) iki puanı kriter bazında yan yana gösterir ve rubrikli son puanı `final-scores` ucuna `If-Match` ile yazar; form yalnız sunucu `canResolve` derse açılır.
- Puanlama kuyruğunda iki puanı ayrışan satır "Son puan bekliyor" olarak görünür.
- Öğrenci adı satırla gelir (`learnerName`, OG-213): öğrencisini okumasa da uyuşmazlıklı teslimi okuyan koordinatör adı görür; önceki "Öğrenci" sınırı kalktı.
